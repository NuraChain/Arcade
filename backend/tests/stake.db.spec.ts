import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getAddress, keccak256, encodeAbiParameters, type Hex } from 'viem';

import { errorResponse } from '@azerothjs/http';

import { vaultIdOf } from '../src/chain/vault.ts';
import { Escrow, EscrowSeat, PaidAccount, StakeConsent, Table, TableSeat, TableStake, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { WEI_PER_NURA } from '../src/domains/stake/policy.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import { fakeVault, signatureOf } from './fake-vault.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906'
];

const TEN = (10n * WEI_PER_NURA).toString();

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1];

let db: DataSource;
let ports: Services;
let fake: ReturnType<typeof fakeVault>;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
    address: string;
}

const makeUser = async (wallet: number | null, overrides: Partial<Pick<User, 'isMinor' | 'allowStrangerMessages'>> = {}, terms = true): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `k${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Staker ${ seq }`,
        hue: seq % 360,
        kind: wallet === null ? 'guest' : 'wallet',
        ...overrides
    });
    const address = wallet === null ? '' : WALLETS[wallet];

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, address]
        );

        if (terms)
        {
            await db.getRepository(PaidAccount).insert({ userId: made.id, acceptedAt: new Date() });
        }

        fake.fund(address, 50n);
    }

    return { id: made.id, handle: made.handle, address };
};

const live = (stake?: string, mode: 'live' | 'turns' = 'live') => ({
    game: 'ludo',
    seats: 2,
    mode,
    privacy: 'public' as const,
    target: 0,
    cube: false,
    blinds: 'low' as const,
    chat: true,
    voice: 'off' as const,
    teams: false,
    invitees: [],
    ...(stake === undefined ? {} : { stake })
});

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return null;
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string } };

    return `${ response.status } ${ body.error.code }`;
};

const signFor = (person: Person, typedData: string) =>
    signatureOf(person.address, { nonce: (JSON.parse(typedData) as { message: { nonce: Hex } }).message.nonce });

const ready = async (person: Person, tableId: string) =>
{
    const terms = await ports.table.stake(person.id, tableId);
    await ports.table.setReady(person.id, tableId, true, signFor(person, terms.typedData));
    return terms;
};

const seated = async () =>
{
    const host = await makeUser(0);
    const guest = await makeUser(1);
    const table = await ports.table.create(host.id, live(TEN));
    await ports.table.claim(guest.id, table.id);

    return { host, guest, tableId: table.id };
};

const sweep = () => ports.jobs.sweepStakes(4000);

const escrowOf = (tableId: string) => db.getRepository(Escrow).findOne({ where: { tableId }, order: { createdAt: 'DESC' } });

const readiness = async (tableId: string) =>
    (await db.getRepository(TableSeat).find({ where: { tableId }, order: { seat: 'ASC' } })).map((chair) => chair.ready);

const consents = (tableId: string) => db.getRepository(StakeConsent).countBy({ tableId });

const locked = async () =>
{
    const { host, guest, tableId } = await seated();
    fake.state.mine = 'pending';
    await ready(guest, tableId);
    await ready(host, tableId);
    await sweep();

    return { host, guest, tableId, escrow: (await escrowOf(tableId)) as Escrow };
};

const playing = async () =>
{
    const { host, guest, tableId, escrow } = await locked();

    fake.receipts.set(escrow.openTx as Hex, 'success');
    fake.games.set(vaultIdOf(escrow.id), 'open');
    fake.state.mine = 'success';
    await sweep();

    const matchId = (await escrowOf(tableId))?.matchId as string;

    return { host, guest, tableId, matchId, escrowId: escrow.id };
};

describe.skipIf(!active)('a table played for NURA, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        fake = fakeVault();
        ports = buildPorts(db, CONFIG, listener, undefined, undefined, fake.vault);
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    afterEach(async () =>
    {
        await sweep();
    });

    describe('opening one', () =>
    {
        it('opens a live table at a stake on the ladder, and every reader is told the stake', async () =>
        {
            const host = await makeUser(0);
            const stranger = await makeUser(1);
            const table = await ports.table.create(host.id, live(TEN));

            expect(table.stake).toBe(TEN);
            expect(table).not.toHaveProperty('money');
            expect((await ports.table.view(stranger.id, table.id))?.stake).toBe(TEN);
            expect(await db.getRepository(TableStake).findOneBy({ tableId: table.id })).toMatchObject({ amount: TEN });
        });

        it('leaves a table opened with no stake free', async () =>
        {
            const host = await makeUser(0);
            const table = await ports.table.create(host.id, live());

            expect(table).not.toHaveProperty('stake');
            expect(await db.getRepository(TableStake).count()).toBe(0);
        });

        it('refuses a stake off the ladder or over the vault\'s ceiling, a turn-based table, and a host who may not play', async () =>
        {
            const host = await makeUser(0);
            const guest = await makeUser(null);
            const unsworn = await makeUser(1, {}, false);

            expect(await word(ports.table.create(host.id, live('2000000000000000000')))).toBe('422 paid-stake');

            fake.state.terms = { ...fake.state.terms, maxStake: 5n * WEI_PER_NURA };
            expect(await word(ports.table.create(host.id, live(TEN)))).toBe('422 paid-stake');

            expect(await word(ports.table.create(host.id, live((5n * WEI_PER_NURA).toString(), 'turns')))).toBe('422 paid-pace');
            expect(await word(ports.table.create(guest.id, live((5n * WEI_PER_NURA).toString())))).toBe('409 paid-wallet');
            expect(await word(ports.table.create(unsworn.id, live((5n * WEI_PER_NURA).toString())))).toBe('409 paid-terms');

            fake.state.terms = { ...fake.state.terms, paused: true };
            expect(await word(ports.table.create(host.id, live((5n * WEI_PER_NURA).toString())))).toBe('409 paid-paused');

            expect(await db.getRepository(Table).count()).toBe(0);
        });

        it('refuses a stake where no vault is configured', async () =>
        {
            fake = fakeVault(false);
            ports = buildPorts(db, CONFIG, listener, undefined, undefined, fake.vault);
            const host = await makeUser(0);

            expect(await word(ports.table.create(host.id, live(TEN)))).toBe('404 paid-off');
        });
    });

    describe('sitting down', () =>
    {
        it('refuses a chair to whoever may not play for NURA, and seats whoever may', async () =>
        {
            const host = await makeUser(0);
            const table = await ports.table.create(host.id, { ...live(TEN), seats: 4 });

            const breaker = await makeUser(3);
            await ports.vault.rest(breaker.id, 7);

            expect(await word(ports.table.claim((await makeUser(null)).id, table.id))).toBe('409 paid-wallet');
            expect(await word(ports.table.claim((await makeUser(1, { isMinor: true, allowStrangerMessages: false })).id, table.id))).toBe('409 paid-minor');
            expect(await word(ports.table.claim((await makeUser(2, {}, false)).id, table.id))).toBe('409 paid-terms');
            expect(await word(ports.table.claim(breaker.id, table.id))).toBe('409 paid-break');

            const fine = await db.getRepository(User).save({ handle: `ok${ seq }x`, displayName: 'Fine', hue: 1, kind: 'wallet' });
            await db.query(`insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65', '31337', 'wallet', now())`, [fine.id]);
            await db.getRepository(PaidAccount).insert({ userId: fine.id, acceptedAt: new Date() });

            expect((await ports.table.claim(fine.id, table.id)).seat).toBe(1);
            expect((await ports.table.view(host.id, table.id))?.taken).toBe(2);
        });

        it('seats a guest at a free table as it always did', async () =>
        {
            const host = await makeUser(0);
            const table = await ports.table.create(host.id, live());

            expect((await ports.table.claim((await makeUser(null)).id, table.id)).seat).toBe(1);
        });
    });

    describe('saying ready', () =>
    {
        it('hands the reader the stake to sign: their own wallet, this game and stake, the vault\'s fee, a fresh nonce and commitment, half an hour', async () =>
        {
            const { guest, tableId } = await seated();
            const before = Math.floor(Date.now() / 1000);

            const terms = await ports.table.stake(guest.id, tableId);
            const typed = JSON.parse(terms.typedData) as { domain: { verifyingContract: string; chainId: number }; primaryType: string; message: Record<string, string | number> };
            const consent = await db.getRepository(StakeConsent).findOneByOrFail({ tableId, userId: guest.id });

            expect(typed.primaryType).toBe('Stake');
            expect(typed.domain).toMatchObject({ chainId: 31337, verifyingContract: getAddress(fake.vault.address as string) });
            expect(typed.message).toMatchObject({ player: getAddress(guest.address), game: 'ludo', amount: TEN, feeBps: 500, nonce: consent.nonce, commit: consent.commitment });
            expect(consent.commitment).toBe(keccak256(encodeAbiParameters([{ type: 'bytes32' }], [consent.secret as Hex])));
            expect(Number(typed.message.deadline)).toBeGreaterThanOrEqual(before + 1800);
            expect(Number(typed.message.deadline)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1800);
            expect(new Date(terms.deadline).getTime() / 1000).toBe(Number(typed.message.deadline));
            expect(consent.signature).toBeNull();

            const again = await ports.table.stake(guest.id, tableId);

            expect(JSON.parse(again.typedData).message.nonce).not.toBe(consent.nonce);
            expect(await consents(tableId)).toBe(1);
        });

        it('asks only somebody sitting at a table played for NURA', async () =>
        {
            const { tableId } = await seated();
            const stranger = await makeUser(2);
            const free = await ports.table.create(stranger.id, live());

            expect(await word(ports.table.stake(stranger.id, tableId))).toBe('404 not-found');
            expect(await word(ports.table.stake(stranger.id, free.id))).toBe('404 not-found');
        });

        it('takes a ready signed by the reader\'s wallet with the NURA free to cover it', async () =>
        {
            const { guest, tableId } = await seated();

            await ready(guest, tableId);

            expect(await readiness(tableId)).toEqual([false, true]);
            expect((await db.getRepository(StakeConsent).findOneByOrFail({ tableId, userId: guest.id })).signature).not.toBeNull();
        });

        it('refuses a ready with no signature, with somebody else\'s, after the fee moved, beyond the balance, and once the stake has run out', async () =>
        {
            const { host, guest, tableId } = await seated();

            let terms = await ports.table.stake(guest.id, tableId);
            expect(await word(ports.table.setReady(guest.id, tableId, true))).toBe('422 paid-consent');
            expect(await word(ports.table.setReady(guest.id, tableId, true, signFor(host, terms.typedData)))).toBe('422 paid-consent');

            fake.state.terms = { ...fake.state.terms, fee: 250 };
            expect(await word(ports.table.setReady(guest.id, tableId, true, signFor(guest, terms.typedData)))).toBe('422 paid-consent');
            fake.state.terms = { ...fake.state.terms, fee: 500 };

            fake.fund(guest.address, 9n);
            expect(await word(ports.table.setReady(guest.id, tableId, true, signFor(guest, terms.typedData)))).toBe('409 paid-funds');
            fake.fund(guest.address, 50n);

            await db.query(`update stake_consents set deadline = now() + interval '1 minute' where table_id = $1`, [tableId]);
            expect(await word(ports.table.setReady(guest.id, tableId, true, signFor(guest, terms.typedData)))).toBe('422 paid-consent');

            expect(await readiness(tableId)).toEqual([false, false]);

            terms = await ports.table.stake(guest.id, tableId);
            await ports.table.setReady(guest.id, tableId, true, signFor(guest, terms.typedData));
            expect(await readiness(tableId)).toEqual([false, true]);
        });

        it('lets the reader take a ready back, and forgets what they signed', async () =>
        {
            const { guest, tableId } = await seated();
            await ready(guest, tableId);

            await ports.table.setReady(guest.id, tableId, false);

            expect(await readiness(tableId)).toEqual([false, false]);
            expect(await consents(tableId)).toBe(0);
        });

        it('takes back a ready the reader asks to sign for again', async () =>
        {
            const { guest, tableId } = await seated();
            await ready(guest, tableId);

            await ports.table.stake(guest.id, tableId);

            expect(await readiness(tableId)).toEqual([false, false]);
        });

        it('forgets what a player signed when they leave', async () =>
        {
            const { guest, tableId } = await seated();
            await ready(guest, tableId);

            await ports.table.leave(guest.id, tableId, false);

            expect(await consents(tableId)).toBe(0);
        });

        it('answers a start at a table played for NURA with what it waits for, and never deals a game', async () =>
        {
            const { host, guest, tableId } = await seated();

            expect(await word(ports.match.start(host.id, tableId))).toBe('409 not-ready');

            fake.state.mine = 'pending';
            await ready(guest, tableId);
            await ready(host, tableId);

            expect(await word(ports.match.start(host.id, tableId))).toBe('409 paid-locking');
            expect((await ports.table.view(host.id, tableId))?.matchId).toBeUndefined();
        });
    });

    describe('locking the stakes', () =>
    {
        it('locks them at the last signed ready, sends every signature in seat order, and deals the game once the chain has them', async () =>
        {
            const { host, guest, tableId } = await seated();
            fake.state.mine = 'pending';

            await ready(guest, tableId);
            expect(await escrowOf(tableId)).toBeNull();

            const hostTerms = await ready(host, tableId);
            const escrow = (await escrowOf(tableId)) as Escrow;

            expect(escrow).toMatchObject({ state: 'locking', game: 'ludo', amount: TEN, feeBps: 500, matchId: null });
            expect(await consents(tableId)).toBe(0);

            await sweep();

            const seats = await db.getRepository(EscrowSeat).find({ where: { escrowId: escrow.id }, order: { seat: 'ASC' } });

            expect(fake.opened).toHaveLength(1);
            expect(fake.opened[0]).toMatchObject({ id: vaultIdOf(escrow.id), game: 'ludo', amount: 10n * WEI_PER_NURA, feeBps: 500 });
            expect(fake.opened[0].seats.map((seat) => seat.player)).toEqual([getAddress(host.address), getAddress(guest.address)]);
            expect(fake.opened[0].seats.map((seat) => seat.nonce)).toEqual(seats.map((seat) => seat.nonce));
            expect(fake.opened[0].seats[0].nonce).toBe(JSON.parse(hostTerms.typedData).message.nonce);
            expect(fake.opened[0].seats.map((seat) => seat.signature)).toEqual(seats.map((seat) => seat.signature));
            expect(fake.opened[0].seats.map((seat) => seat.commit)).toEqual(seats.map((seat) => keccak256(encodeAbiParameters([{ type: 'bytes32' }], [seat.secret as Hex]))));

            const sent = (await escrowOf(tableId)) as Escrow;

            expect(sent.state).toBe('locking');
            expect(sent.openTx).toMatch(/^0x[0-9a-f]{64}$/);
            expect((await ports.table.view(host.id, tableId))?.money).toMatchObject({ state: 'locking', openTx: sent.openTx });

            await sweep();
            expect(fake.opened).toHaveLength(1);
            expect((await escrowOf(tableId))?.state).toBe('locking');

            fake.receipts.set(sent.openTx as Hex, 'success');
            fake.games.set(vaultIdOf(escrow.id), 'open');
            await sweep();

            const open = (await escrowOf(tableId)) as Escrow;
            const view = await ports.table.view(host.id, tableId);

            expect(open.state).toBe('open');
            expect(open.matchId).not.toBeNull();
            expect(view).toMatchObject({ status: 'playing', matchId: open.matchId, money: { state: 'open', openTx: sent.openTx } });
        });

        it('lets nobody leave, close, take somebody out, take a ready back or sign again while the stakes are locking', async () =>
        {
            const { host, guest, tableId } = await locked();

            expect(await word(ports.table.leave(guest.id, tableId, false))).toBe('409 paid-locking');
            expect(await word(ports.table.close(host.id, tableId))).toBe('409 paid-locking');
            expect(await word(ports.table.remove(host.id, tableId, guest.handle))).toBe('409 paid-locking');
            expect(await word(ports.table.setReady(guest.id, tableId, false))).toBe('409 paid-locking');
            expect(await word(ports.table.stake(guest.id, tableId))).toBe('409 paid-locking');
            expect(await readiness(tableId)).toEqual([true, true]);
        });

        it('passes over a table that is locking when it stands absent players up', async () =>
        {
            const { tableId } = await locked();
            const absent = buildPorts(db, CONFIG, listener, { present: () => new Set<string>() }, undefined, fake.vault);

            await absent.jobs.sweepTables();
            expect((await absent.jobs.sweepTables()).stoodUp).toBe(0);
            expect((await db.getRepository(TableSeat).find({ where: { tableId } })).every((chair) => chair.userId !== null)).toBe(true);
        });

        it('un-readies only the player whose stake the vault refused, keeps everybody else\'s signature, and locks again once they sign', async () =>
        {
            const { host, guest, tableId } = await seated();
            fake.state.refuse = { error: 'StakeUnfunded', player: getAddress(guest.address) };

            await ready(guest, tableId);
            const hostTerms = await ready(host, tableId);
            await sweep();

            const failed = (await escrowOf(tableId)) as Escrow;

            expect(failed).toMatchObject({ state: 'failed', error: 'StakeUnfunded', failedSeat: 1 });
            expect(await readiness(tableId)).toEqual([true, false]);
            expect((await ports.table.view(host.id, tableId))?.money).toMatchObject({ state: 'failed', failed: 'StakeUnfunded', blame: guest.handle });
            expect((await db.getRepository(StakeConsent).findOneByOrFail({ tableId, userId: host.id })).nonce)
                .toBe(JSON.parse(hostTerms.typedData).message.nonce);

            fake.state.refuse = null;
            fake.state.mine = 'pending';
            await ready(guest, tableId);
            await sweep();

            const again = (await escrowOf(tableId)) as Escrow;

            expect(again.id).not.toBe(failed.id);
            expect(again.state).toBe('locking');
            expect(fake.opened.at(-1)?.seats[0].nonce).toBe(JSON.parse(hostTerms.typedData).message.nonce);
        });

        it('un-readies everybody when the vault refuses the game rather than a player', async () =>
        {
            const { host, guest, tableId } = await seated();
            fake.state.refuse = { error: 'EnforcedPause', player: null };

            await ready(guest, tableId);
            await ready(host, tableId);
            await sweep();

            expect(await escrowOf(tableId)).toMatchObject({ state: 'failed', error: 'EnforcedPause', failedSeat: null });
            expect(await readiness(tableId)).toEqual([false, false]);
            expect(await consents(tableId)).toBe(0);
        });

        it('fails a lock the chain reverted, and un-readies everybody', async () =>
        {
            const { tableId, escrow } = await locked();

            fake.receipts.set(escrow.openTx as Hex, 'reverted');
            await sweep();

            expect(await escrowOf(tableId)).toMatchObject({ state: 'failed', error: 'reverted' });
            expect(await readiness(tableId)).toEqual([false, false]);
        });

        it('finds a lock that was sent but not written down on the chain, and never sends it twice', async () =>
        {
            const { tableId, escrow } = await locked();

            await db.getRepository(Escrow).update({ id: escrow.id }, { openTx: null });
            fake.games.set(vaultIdOf(escrow.id), 'open');
            await sweep();

            expect(fake.opened).toHaveLength(1);
            expect(await escrowOf(tableId)).toMatchObject({ state: 'open' });
        });

        it('waits out a chain it cannot reach, and sends when it can', async () =>
        {
            const { host, guest, tableId } = await seated();
            fake.state.away = true;

            await ready(guest, tableId);
            await ready(host, tableId);

            const sweptAway = await sweep();

            expect(sweptAway.faults.length).toBeGreaterThan(0);
            expect(await escrowOf(tableId)).toMatchObject({ state: 'locking', openTx: null });

            fake.state.away = false;
            await sweep();
            await sweep();

            expect(await escrowOf(tableId)).toMatchObject({ state: 'open' });
        });

        it('un-readies a player whose signature would run out before the lock, and locks nothing', async () =>
        {
            const { host, guest, tableId } = await seated();
            await ready(guest, tableId);
            await db.query(`update stake_consents set deadline = now() + interval '1 minute' where table_id = $1 and user_id = $2`, [tableId, guest.id]);

            await ready(host, tableId);

            expect(await escrowOf(tableId)).toBeNull();
            expect(await readiness(tableId)).toEqual([true, false]);
            expect(await db.getRepository(StakeConsent).countBy({ tableId, userId: guest.id })).toBe(0);
            expect(await db.getRepository(StakeConsent).countBy({ tableId, userId: host.id })).toBe(1);
        });

        it('un-readies everybody when the fee moved between their signatures', async () =>
        {
            const { host, guest, tableId } = await seated();
            await ready(guest, tableId);
            fake.state.terms = { ...fake.state.terms, fee: 250 };

            await ready(host, tableId);

            expect(await escrowOf(tableId)).toBeNull();
            expect(await readiness(tableId)).toEqual([false, false]);
            expect(await consents(tableId)).toBe(0);
        });

        it('gives up a lock whose stakes ran out before it could be sent', async () =>
        {
            const { host, guest, tableId } = await seated();
            fake.state.away = true;
            await ready(guest, tableId);
            await ready(host, tableId);
            await sweep();

            await db.query(`update escrow_seats set deadline = now() - interval '2 minutes' where escrow_id = (select id from escrows where table_id = $1)`, [tableId]);
            fake.state.away = false;
            await sweep();

            expect(fake.opened).toEqual([]);
            expect(await escrowOf(tableId)).toMatchObject({ state: 'failed', error: 'StakeExpired' });
            expect(await readiness(tableId)).toEqual([false, false]);
        });

        it('gives up a lock still waiting to be mined once its stakes have run out, and lets the table go', async () =>
        {
            const { guest, tableId, escrow } = await locked();

            await db.query(`update escrow_seats set deadline = now() - interval '2 minutes' where escrow_id = $1`, [escrow.id]);
            await sweep();

            expect(await escrowOf(tableId)).toMatchObject({ state: 'failed', error: 'StakeExpired' });
            expect(await readiness(tableId)).toEqual([false, false]);
            expect(await word(ports.table.leave(guest.id, tableId, false))).toBeNull();
        });

        it('never locks a chair that is not ready, whatever it signed', async () =>
        {
            const { host, guest, tableId } = await seated();
            await ready(guest, tableId);
            await db.query(`update table_seats set ready = false where table_id = $1 and user_id = $2`, [tableId, guest.id]);

            await ready(host, tableId);

            expect(await escrowOf(tableId)).toBeNull();
        });

        it('forgets every signature when the host changes who hears whom between games', async () =>
        {
            const people = [await makeUser(0), await makeUser(1), await makeUser(2), await makeUser(3)];
            const table = await ports.table.create(people[0].id, { ...live(TEN), seats: 4, teams: true, voice: 'table' as const });

            for (const person of people.slice(1))
            {
                await ports.table.claim(person.id, table.id);
            }

            for (const person of people.slice(1))
            {
                await ready(person, table.id);
            }

            await ports.table.setVoice(people[0].id, table.id, 'team');

            expect(await readiness(table.id)).toEqual([false, false, false, false]);
            expect(await consents(table.id)).toBe(0);
        });

        it('keeps the call a team table locked under until the game begins', async () =>
        {
            const people = [await makeUser(0), await makeUser(1), await makeUser(2), await makeUser(3)];
            const table = await ports.table.create(people[0].id, { ...live(TEN), seats: 4, teams: true, voice: 'table' as const });

            for (const person of people.slice(1))
            {
                await ports.table.claim(person.id, table.id);
            }

            fake.state.mine = 'pending';

            for (const person of people)
            {
                await ready(person, table.id);
            }

            await sweep();

            expect((await escrowOf(table.id))?.state).toBe('locking');
            expect(await word(ports.table.setVoice(people[0].id, table.id, 'team'))).toBe('409 paid-locking');
            expect((await ports.table.view(people[0].id, table.id))?.voice).toBe('table');
        });

        it('locks a table whose players all signed even when nothing asked it to', async () =>
        {
            const { host, guest, tableId } = await seated();
            fake.state.refuse = { error: 'EnforcedPause', player: null };
            await ready(guest, tableId);
            await ready(host, tableId);
            await sweep();
            fake.state.refuse = null;

            await db.getRepository(Escrow).delete({ tableId });
            await db.query(`update table_seats set ready = true where table_id = $1`, [tableId]);

            for (const person of [host, guest])
            {
                const terms = await ports.table.stake(person.id, tableId);
                await db.query(`update stake_consents set signature = $1 where table_id = $2 and user_id = $3`, [signFor(person, terms.typedData), tableId, person.id]);
            }
            await db.query(`update table_seats set ready = true where table_id = $1`, [tableId]);

            await sweep();

            expect((await escrowOf(tableId))?.state).toBe('locking');
        });
    });

    describe('paying for the game', () =>
    {
        it('pays the pot to whoever is left when the other gives up, with every secret in seat order', async () =>
        {
            const { host, tableId, matchId, escrowId } = await playing();

            await ports.match.resign(host.id, matchId, { key: 'give-up' });

            const settling = (await escrowOf(tableId)) as Escrow;

            expect(settling).toMatchObject({ state: 'settling', winners: 2 });

            await sweep();

            const seats = await db.getRepository(EscrowSeat).find({ where: { escrowId }, order: { seat: 'ASC' } });

            expect(fake.settled).toEqual([{ id: vaultIdOf(escrowId), winners: 2n, secrets: seats.map((seat) => seat.secret) }]);

            await sweep();

            const paid = (await escrowOf(tableId)) as Escrow;

            expect(paid).toMatchObject({ state: 'settled', winners: 2 });
            expect(paid.closeTx).toMatch(/^0x[0-9a-f]{64}$/);
            expect((await ports.table.view(host.id, tableId))?.money).toMatchObject({ state: 'settled', winners: [1], closeTx: paid.closeTx });
        });

        it('takes the stake of a player who walks out and pays it to the one who stayed', async () =>
        {
            const { guest, tableId } = await playing();

            await ports.table.leave(guest.id, tableId, true);

            expect(await escrowOf(tableId)).toMatchObject({ state: 'settling', winners: 1 });
        });

        it('refunds every stake of a game that could not be dealt after the lock', async () =>
        {
            const { tableId, escrow } = await locked();

            fake.receipts.set(escrow.openTx as Hex, 'success');
            fake.games.set(vaultIdOf(escrow.id), 'open');
            fake.state.mine = 'success';
            await db.query(`update tables set status = 'closed', closed_at = now() where id = $1`, [tableId]);
            await sweep();

            expect(await escrowOf(tableId)).toMatchObject({ state: 'refunding', matchId: null });

            await sweep();
            await sweep();

            expect(fake.refunded).toEqual([vaultIdOf(escrow.id)]);
            expect(await escrowOf(tableId)).toMatchObject({ state: 'refunded', winners: null });
        });

        it('records a payment the chain already made, and never sends it twice', async () =>
        {
            const { host, tableId, matchId, escrowId } = await playing();

            fake.state.away = true;
            await ports.match.resign(host.id, matchId, { key: 'give-up' });
            fake.state.away = false;
            fake.games.set(vaultIdOf(escrowId), 'settled');

            await sweep();

            expect(fake.settled).toEqual([]);
            expect(await escrowOf(tableId)).toMatchObject({ state: 'settled' });
        });

        it('sends a payment the chain reverted again, after a pause', async () =>
        {
            const { host, tableId, matchId, escrowId } = await playing();
            fake.state.mine = 'reverted';

            await ports.match.resign(host.id, matchId, { key: 'give-up' });
            await sweep();

            expect(fake.settled).toHaveLength(1);
            expect(await escrowOf(tableId)).toMatchObject({ state: 'settling', closeTx: null, error: 'reverted' });

            fake.state.mine = 'success';
            await sweep();

            expect(fake.settled).toHaveLength(1);

            await db.query(`update escrows set updated_at = now() - interval '1 minute' where id = $1`, [escrowId]);
            await sweep();
            await sweep();

            expect(fake.settled).toHaveLength(2);
            expect(await escrowOf(tableId)).toMatchObject({ state: 'settled', error: null });
        });

        it('locks the next game once the last one is paid, when both have signed again', async () =>
        {
            const { host, guest, tableId, matchId, escrowId } = await playing();

            fake.state.mine = 'pending';
            await ports.match.resign(host.id, matchId, { key: 'give-up' });
            await ready(host, tableId);
            await ready(guest, tableId);

            expect((await escrowOf(tableId))?.id).toBe(escrowId);

            await sweep();
            const paying = (await escrowOf(tableId)) as Escrow;
            fake.receipts.set(paying.closeTx as Hex, 'success');
            fake.games.set(vaultIdOf(escrowId), 'settled');
            await sweep();

            const next = (await escrowOf(tableId)) as Escrow;

            expect(next.id).not.toBe(escrowId);
            expect(next.state).toBe('locking');
            expect((await db.getRepository(Escrow).findOneByOrFail({ id: escrowId })).state).toBe('settled');
        });
    });

    describe('quick play', () =>
    {
        it('never seats a free search at a table played for NURA', async () =>
        {
            const host = await makeUser(0);
            const paid = await ports.table.create(host.id, live(TEN));
            const searcher = await makeUser(1);

            const found = await ports.table.quick(searcher.id, { game: 'ludo', seats: 2, voice: 'off' });

            expect(found.id).not.toBe(paid.id);
            expect(found).not.toHaveProperty('stake');
        });
    });
});
