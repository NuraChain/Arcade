import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getAddress, keccak256, encodeAbiParameters, type Hex } from 'viem';

import { errorResponse } from '@azerothjs/http';

import { vaultIdOf } from '../src/chain/vault.ts';
import { Conversation, Escrow, EscrowSeat, Game, Match, MatchAction, MatchPlayer, Message, PaidAccount, StakeConsent, Table, TableSeat, TableStake, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { endingOf } from '../src/domains/match/declare.ts';
import type { Engine, ForfeitReason } from '../src/domains/match/engine.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import { OPENING, drawOf, drawsOf, seedOf } from '../src/domains/match/fair.ts';
import type { Variant } from '../src/domains/match/sides.ts';
import { WEI_PER_NURA, type EscrowState } from '../src/domains/stake/policy.ts';
import { hmacSha256, keccak } from '../src/lib/crypto.ts';
import type { MatchPlay } from '../src/schemas.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';
import { fakeVault, signatureOf } from './fake-vault.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'
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
    catalogueChanged: () => undefined,
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

const resultLines = async (tableId: string) =>
{
    const room = await db.getRepository(Conversation).findOneByOrFail({ tableId, kind: 'game' });

    return (await db.getRepository(Message).findBy({ conversationId: room.id, kind: 'result' })).map((line) => line.payload);
};

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
            await db.getRepository(Table).createQueryBuilder().delete().execute();
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

        it('asks nobody to sign for a game that is paused, refuses a stake signed before the pause, locks nothing while it lasts and locks once it is back', async () =>
        {
            const { host, guest, tableId } = await seated();
            const early = await ports.table.stake(guest.id, tableId);
            const late = await ports.table.stake(host.id, tableId);

            await db.getRepository(Game).update({ id: 'ludo' }, { status: 'disabled' });

            try
            {
                expect(await word(ports.table.stake(host.id, tableId))).toBe('409 game-off');
                expect(await word(ports.table.setReady(guest.id, tableId, true, signFor(guest, early.typedData)))).toBe('409 game-off');
                expect(await readiness(tableId)).toEqual([false, false]);

                for (const [person, terms] of [[host, late], [guest, early]] as const)
                {
                    await db.query(`update stake_consents set signature = $1 where table_id = $2 and user_id = $3`, [signFor(person, terms.typedData), tableId, person.id]);
                }
                await db.query(`update table_seats set ready = true where table_id = $1`, [tableId]);

                await sweep();

                expect(await escrowOf(tableId)).toBeNull();
                expect(await readiness(tableId)).toEqual([true, true]);
            }
            finally
            {
                await db.getRepository(Game).update({ id: 'ludo' }, { status: 'available' });
            }

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

        it('names whoever the stakes were paid to in the table\'s result line, however early the game ended', async () =>
        {
            const { host, guest, tableId, matchId } = await playing();

            await ports.match.resign(host.id, matchId, { key: 'give-up' });

            expect((await db.getRepository(Match).findOneByOrFail({ id: matchId })).outcome).toBe('abandoned');
            expect(await resultLines(tableId)).toEqual([{ key: 'chat.line.result', params: { game: 'ludo', winners: [guest.handle] } }]);
        });

        it('names both of a pair the stakes were paid to, in seat order, when the other side walks out', async () =>
        {
            const people = [await makeUser(0), await makeUser(1), await makeUser(2), await makeUser(3)];
            const table = await ports.table.create(people[0].id, { ...live(TEN), seats: 4, teams: true });

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

            const escrow = (await escrowOf(table.id)) as Escrow;

            fake.receipts.set(escrow.openTx as Hex, 'success');
            fake.games.set(vaultIdOf(escrow.id), 'open');
            fake.state.mine = 'success';
            await sweep();

            await ports.table.leave(people[0].id, table.id, true);

            expect(await escrowOf(table.id)).toMatchObject({ state: 'settling', winners: 0b1010 });
            expect(await resultLines(table.id)).toEqual([{ key: 'chat.line.result', params: { game: 'ludo', winners: [people[1].handle, people[3].handle] } }]);
        });

        it('tells a game the judge and the payment disagree about as it was paid, as the card does', async () =>
        {
            const { host, guest, matchId } = await playing();

            await ports.match.resign(host.id, matchId, { key: 'give-up' });
            await db.getRepository(MatchPlayer).update({ matchId, userId: host.id }, { result: 'won' });
            await db.getRepository(Match).update({ id: matchId }, { outcome: 'won' });

            expect(await endingOf(db, matchId)).toMatchObject({ key: 'chat.line.result', params: { winners: [guest.handle] } });
        });

        it('names nobody in the result line of a free game that ended as early', async () =>
        {
            const host = await makeUser(0);
            const guest = await makeUser(1);
            const table = await ports.table.create(host.id, live());

            await ports.table.claim(guest.id, table.id);
            await ports.table.setReady(host.id, table.id, true);
            await ports.table.setReady(guest.id, table.id, true);

            const started = await ports.match.start(host.id, table.id);

            await ports.match.resign(host.id, started.id, { key: 'done' });

            expect(await resultLines(table.id)).toEqual([{ key: 'chat.line.result.none', params: { game: 'ludo' } }]);
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

        it('tells each player their vault moved when the stakes are locked and when they are paid, and nobody when a lock is refused', async () =>
        {
            const rung: string[] = [];

            const ringing: WriteListener = {
                ...listener,
                selfChanged: (userId, what) =>
                {
                    if (what === 'vault')
                    {
                        rung.push(userId);
                    }
                }
            };

            ports = buildPorts(db, CONFIG, ringing, undefined, undefined, fake.vault);

            const { host, guest, tableId } = await seated();
            const both = [host.id, guest.id].sort();

            fake.state.refuse = { error: 'StakeUnfunded', player: getAddress(guest.address) };
            await ready(guest, tableId);
            await ready(host, tableId);
            await sweep();

            expect((await escrowOf(tableId))?.state).toBe('failed');
            expect(rung).toEqual([]);

            fake.state.refuse = null;
            fake.state.mine = 'pending';
            await ready(guest, tableId);
            await sweep();

            const escrow = (await escrowOf(tableId)) as Escrow;

            expect(rung).toEqual([]);

            fake.receipts.set(escrow.openTx as Hex, 'success');
            fake.games.set(vaultIdOf(escrow.id), 'open');
            fake.state.mine = 'success';
            await sweep();

            expect([...rung].sort()).toEqual(both);

            rung.length = 0;
            await ports.match.resign(host.id, (await escrowOf(tableId))?.matchId as string, { key: 'give-up' });
            await sweep();
            await sweep();

            expect((await escrowOf(tableId))?.state).toBe('settled');
            expect([...rung].sort()).toEqual(both);
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

    describe('a player\'s paid games', () =>
    {
        it('lists the reader\'s paid games newest first, with what each won, and leaves out a lock that failed', async () =>
        {
            const first = await playing();

            await ports.match.resign(first.host.id, first.matchId, { key: 'give-up' });
            await sweep();

            fake.state.refuse = { error: 'EnforcedPause', player: null };
            await ready(first.guest, first.tableId);
            await ready(first.host, first.tableId);
            await sweep();
            fake.state.refuse = null;

            const won = await ports.vault.games(first.guest.id, null);
            const lost = await ports.vault.games(first.host.id, null);

            expect(won.games).toEqual([{
                id: first.escrowId,
                game: 'ludo',
                amount: TEN,
                feeBps: 500,
                seats: 2,
                seat: 1,
                state: 'settled',
                won: true,
                share: (19n * WEI_PER_NURA).toString(),
                openTx: expect.stringMatching(/^0x[0-9a-f]{64}$/),
                closeTx: expect.stringMatching(/^0x[0-9a-f]{64}$/),
                match: first.matchId,
                at: expect.any(String)
            }]);
            expect(won).not.toHaveProperty('cursor');
            expect(lost.games).toMatchObject([{ id: first.escrowId, seat: 0, won: false }]);
            expect(lost.games[0]).not.toHaveProperty('share');
            expect((await ports.vault.games((await makeUser(2)).id, null)).games).toEqual([]);
        });

        it('pages by when each game was locked', async () =>
        {
            const { guest, tableId, escrowId } = await playing();
            const at = Date.now();

            for (let index = 0; index < 21; index += 1)
            {
                const made = await db.getRepository(Escrow).insert({ tableId, game: 'ludo', amount: TEN, feeBps: 500, state: 'refunded', createdAt: new Date(at - (index + 1) * 60_000) });
                await db.getRepository(EscrowSeat).insert({
                    escrowId: made.identifiers[0].id as string,
                    seat: 1,
                    userId: guest.id,
                    address: guest.address,
                    nonce: `0x${ (index + 1).toString(16).padStart(64, '0') }`,
                    commitment: `0x${ 'c'.repeat(64) }`,
                    secret: `0x${ 'd'.repeat(64) }`,
                    deadline: new Date(at),
                    signature: '0x00'
                });
            }

            const page = await ports.vault.games(guest.id, null);
            const next = await ports.vault.games(guest.id, page.cursor ?? null);

            expect(page.games).toHaveLength(20);
            expect(page.games[0].id).toBe(escrowId);
            expect(next.games).toHaveLength(2);
            expect(next).not.toHaveProperty('cursor');
            expect(new Set([...page.games, ...next.games].map((one) => one.id)).size).toBe(22);
            expect((await ports.vault.games(guest.id, 'not a cursor')).games[0].id).toBe(escrowId);
        });

        it('hands a player the call that takes their stakes back once the vault\'s wait has passed, and nobody else', async () =>
        {
            const { host, guest, escrowId } = await playing();
            const id = vaultIdOf(escrowId);

            expect(await word(ports.vault.reclaim(guest.id, escrowId))).toBe('409 paid-early');

            fake.openedAt.set(id, BigInt(Math.floor(Date.now() / 1000) - 259_201));

            expect(await ports.vault.reclaim(guest.id, escrowId)).toMatchObject({ from: getAddress(guest.address), data: `0xreclaim${ id.slice(2) }`, value: '0x0' });
            expect(await word(ports.vault.reclaim((await makeUser(2)).id, escrowId))).toBe('404 not-found');
            expect(await word(ports.vault.reclaim(host.id, 'nope'))).toBe('404 not-found');

            fake.games.set(id, 'settled');

            expect(await word(ports.vault.reclaim(host.id, escrowId))).toBe('409 paid-done');
        });

        it('asks the chain\'s clock as well as its own whether the vault\'s wait has passed', async () =>
        {
            const { guest, escrowId } = await playing();
            const id = vaultIdOf(escrowId);
            const now = BigInt(Math.floor(Date.now() / 1000));
            const reclaim = { data: `0xreclaim${ id.slice(2) }` };

            fake.openedAt.set(id, now);
            fake.state.clock = now + 259_201n;

            expect(await ports.vault.reclaim(guest.id, escrowId), 'a chain whose clock is past the wait').toMatchObject(reclaim);

            fake.state.clock = now - 600n;
            fake.openedAt.set(id, now - 259_201n);

            expect(await ports.vault.reclaim(guest.id, escrowId), 'a chain whose newest block is older than the wait').toMatchObject(reclaim);

            fake.openedAt.set(id, now);

            expect(await word(ports.vault.reclaim(guest.id, escrowId)), 'neither clock past the wait').toBe('409 paid-early');
        });
    });

    describe('quick play at a stake', () =>
    {
        const FIVE = (5n * WEI_PER_NURA).toString();

        const search = async (person: Person, stake?: string) =>
        {
            if (stake === undefined)
            {
                return await ports.table.quick(person.id, { game: 'ludo', seats: 2, voice: 'off' });
            }

            const terms = await ports.table.quickStake(person.id, 'ludo', stake);

            return await ports.table.quick(person.id, { game: 'ludo', seats: 2, voice: 'off', stake, signature: signFor(person, terms.typedData) });
        };

        it('hands a searcher the stake to sign for the game and stake they look for, and keeps one at a time', async () =>
        {
            const searcher = await makeUser(0);
            const first = await ports.table.quickStake(searcher.id, 'ludo', TEN);
            const second = await ports.table.quickStake(searcher.id, 'ludo', TEN);
            const message = JSON.parse(second.typedData).message as Record<string, string | number>;

            expect(message).toMatchObject({ player: getAddress(searcher.address), game: 'ludo', amount: TEN, feeBps: 500 });
            expect(JSON.parse(first.typedData).message.nonce).not.toBe(message.nonce);
            expect(await db.getRepository(StakeConsent).find({ where: { userId: searcher.id } })).toMatchObject([{ nonce: message.nonce, tableId: null, signature: null }]);
        });

        it('opens a table at that stake for the first searcher, seats the next one there, and locks both stakes', async () =>
        {
            const first = await makeUser(0);
            const second = await makeUser(1);
            fake.state.mine = 'pending';

            const opened = await search(first, TEN);

            expect(opened).toMatchObject({ stake: TEN, quick: true, taken: 1, mine: 0 });
            expect(await db.getRepository(StakeConsent).findOneByOrFail({ userId: first.id })).toMatchObject({ tableId: opened.id });
            expect((await db.getRepository(StakeConsent).findOneByOrFail({ userId: first.id })).signature).not.toBeNull();

            const joined = await search(second, TEN);

            expect(joined.id).toBe(opened.id);
            expect(await escrowOf(opened.id)).toMatchObject({ state: 'locking', amount: TEN });
        });

        it('never seats a search at another stake, a free search at a paid table, or a paid search at a free one', async () =>
        {
            const free = await search(await makeUser(null));
            const ten = await search(await makeUser(0), TEN);
            const five = await search(await makeUser(1), FIVE);
            const another = await search(await makeUser(2));

            expect(new Set([free.id, ten.id, five.id]).size).toBe(3);
            expect(five.stake).toBe(FIVE);
            expect(another.id).toBe(free.id);
            expect(free).not.toHaveProperty('stake');
        });

        it('refuses a search at a stake with no signature, somebody else\'s, a turn-based pace, a stake off the ladder or a guest, and seats nobody', async () =>
        {
            const searcher = await makeUser(0);
            const other = await makeUser(1);
            const terms = await ports.table.quickStake(searcher.id, 'ludo', TEN);
            const ask = { game: 'ludo', seats: 2, voice: 'off' as const, stake: TEN };

            expect(await word(ports.table.quick(searcher.id, ask))).toBe('422 paid-consent');
            expect(await word(ports.table.quick(searcher.id, { ...ask, signature: signFor(other, terms.typedData) }))).toBe('422 paid-consent');
            expect(await word(ports.table.quick(searcher.id, { ...ask, mode: 'turns', signature: signFor(searcher, terms.typedData) }))).toBe('422 paid-pace');
            expect(await word(ports.table.quick(searcher.id, { ...ask, stake: '7', signature: signFor(searcher, terms.typedData) }))).toBe('422 paid-stake');
            expect(await word(ports.table.quick(searcher.id, { ...ask, stake: FIVE, signature: signFor(searcher, terms.typedData) }))).toBe('422 paid-consent');
            expect(await word(ports.table.quickStake(searcher.id, 'ludo', '7'))).toBe('422 paid-stake');
            expect(await word(ports.table.quickStake((await makeUser(null)).id, 'ludo', TEN))).toBe('409 paid-wallet');
            expect(await db.getRepository(Table).count()).toBe(0);
        });

        it('lets go of a searcher\'s wait at a paid table when they look for another game, and never of one that is locking', async () =>
        {
            const first = await makeUser(0);
            const waiting = await search(first, TEN);

            await ports.table.quick(first.id, { game: 'backgammon', voice: 'off' });

            expect(await db.getRepository(TableSeat).existsBy({ tableId: waiting.id, userId: first.id })).toBe(false);
            expect(await db.getRepository(StakeConsent).countBy({ tableId: waiting.id })).toBe(0);

            const second = await makeUser(1);
            const third = await makeUser(2);
            fake.state.mine = 'pending';
            const locking = await search(second, TEN);
            await search(third, TEN);

            expect(await escrowOf(locking.id)).toMatchObject({ state: 'locking' });

            await ports.table.quick(second.id, { game: 'backgammon', voice: 'off' });

            expect(await db.getRepository(TableSeat).existsBy({ tableId: locking.id, userId: second.id })).toBe(true);
        });
    });

    describe('the owner\'s view of the vault', () =>
    {
        const OWNER = 5;

        const owned = () =>
        {
            ports = buildPorts(db, { ...CONFIG, adminWallet: WALLETS[OWNER] }, listener, undefined, undefined, fake.vault);
        };

        const backdated = async (id: string, minutes: number) =>
        {
            await db.getRepository(Escrow).createQueryBuilder()
                .update()
                .set({ updatedAt: () => 'now() - make_interval(mins => :minutes)' })
                .setParameter('minutes', minutes)
                .where('id = :id', { id })
                .execute();
        };

        const escrowAt = async (tableId: string, state: EscrowState, minutes: number, error: string | null = null) =>
        {
            const saved = await db.getRepository(Escrow).save({
                tableId,
                game: 'ludo',
                amount: TEN,
                feeBps: 500,
                state,
                winners: state === 'settling' || state === 'settled' ? 1 : null,
                error
            });

            await backdated(saved.id, minutes);

            return saved.id;
        };

        it('answers the owner\'s wallet and nobody else, a guest included', async () =>
        {
            owned();
            const owner = await makeUser(OWNER);
            const player = await makeUser(0);
            const guest = await makeUser(null);

            expect(await ports.admin.vault(player.id)).toBeNull();
            expect(await ports.admin.vault(guest.id)).toBeNull();
            expect(await ports.admin.fee(player.id, 400)).toBeNull();
            expect(await ports.admin.fees(player.id, TEN)).toBeNull();
            expect(await ports.admin.pause(guest.id, true)).toBeNull();
            expect(fake.adminCalls, 'a call was composed for somebody who is not the owner').toEqual([]);
            expect(await ports.admin.vault(owner.id)).toMatchObject({ configured: true, vault: fake.vault.address, chainId: 31337 });
        });

        it('shows an admin the vault, a moderator nothing, and hands the wallet\'s calls to the owner alone', async () =>
        {
            owned();
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const moderator = await makeUser(1);

            await ports.admin.setStaff(owner.id, { handle: admin.handle, role: 'admin', reason: 'Keeps an eye on the money' });
            await ports.admin.setStaff(owner.id, { handle: moderator.handle, role: 'moderator', reason: 'Reads the reports' });

            expect(await ports.admin.vault(admin.id)).toMatchObject({ configured: true, vault: fake.vault.address });
            expect(await ports.admin.vault(moderator.id)).toBeNull();
            expect(await ports.admin.fee(admin.id, 400)).toBeNull();
            expect(await ports.admin.ceiling(admin.id, TEN)).toBeNull();
            expect(await ports.admin.fees(admin.id, TEN)).toBeNull();
            expect(await ports.admin.pause(admin.id, true)).toBeNull();
            expect(fake.adminCalls, 'a call was composed for an admin').toEqual([]);
            expect(await ports.admin.fee(owner.id, 400)).not.toBeNull();
        });

        it('counts the games in each state and lists those stuck on their way, the oldest first', async () =>
        {
            owned();
            const owner = await makeUser(OWNER);
            const { matchId, escrowId, tableId } = await playing();

            await db.getRepository(Escrow).update({ id: escrowId }, { state: 'settling', winners: 1 });
            await backdated(escrowId, 20);

            const tables = await Promise.all([0, 1, 2, 3].map(() => ports.table.create(owner.id, live(TEN))));
            const made = [
                await escrowAt(tables[0].id, 'refunding', 0, 'missing'),
                await escrowAt(tables[1].id, 'locking', 1),
                await escrowAt(tables[2].id, 'open', 30),
                await escrowAt(tables[3].id, 'settled', 30)
            ];

            fake.state.ledger = { ...fake.state.ledger, fees: 7n, free: 20n, locked: 30n, held: 57n, gas: 10n ** 18n, gasPrice: 47_000_000_000n };

            const standing = await ports.admin.vault(owner.id);

            expect(standing).toMatchObject({
                configured: true,
                fee: 500,
                maxFee: 1000,
                maxStake: (1_000n * WEI_PER_NURA).toString(),
                paused: false,
                held: '57',
                free: '20',
                locked: '30',
                fees: '7',
                solvent: true,
                referee: { address: fake.vault.referee, gas: WEI_PER_NURA.toString(), games: '19', low: true, allowed: true },
                roles: { admin: true, pauser: true },
                playing: 1
            });
            expect(standing?.configured === true && standing.states.filter((one) => one.count > 0)).toEqual([
                { state: 'locking', count: 1 },
                { state: 'open', count: 1 },
                { state: 'settling', count: 1 },
                { state: 'settled', count: 1 },
                { state: 'refunding', count: 1 }
            ]);
            expect(standing?.configured === true && standing.stuck.map((row) => [row.id, row.state, row.seats, row.error ?? null, row.match ?? null, row.table])).toEqual([
                [escrowId, 'settling', 2, null, matchId, tableId],
                [made[0], 'refunding', 0, 'missing', null, tables[0].id]
            ]);
            expect(standing?.configured === true && standing.stuck[0].openTx).toMatch(/^0x[0-9a-f]{64}$/);

            fake.state.ledger = { ...fake.state.ledger, gas: 2n * WEI_PER_NURA };
            expect(await ports.admin.vault(owner.id)).toMatchObject({ referee: { games: '38', low: false } });

            fake.state.ledger = { ...fake.state.ledger, gasPrice: 0n };
            const unpriced = await ports.admin.vault(owner.id);
            expect(unpriced?.configured === true && unpriced.referee).toEqual({ address: fake.vault.referee, gas: (2n * WEI_PER_NURA).toString(), low: false, allowed: true });

            await db.getRepository(Escrow).delete(made);
        });

        it('composes the owner\'s calls from the owner\'s own wallet, and says what the vault would refuse in its words', async () =>
        {
            owned();
            const owner = await makeUser(OWNER);
            const address = getAddress(WALLETS[OWNER]);

            expect(await ports.admin.fee(owner.id, 400)).toMatchObject({ from: address, to: fake.vault.address, value: '0x0', chainId: 31337 });
            expect(await ports.admin.ceiling(owner.id, TEN)).toMatchObject({ from: address });
            expect(await ports.admin.fees(owner.id, TEN)).toMatchObject({ from: address });
            expect(await ports.admin.pause(owner.id, true)).toMatchObject({ from: address });
            expect(fake.adminCalls).toEqual([
                { name: 'setFee', admin: address, args: [400] },
                { name: 'setMaxStake', admin: address, args: [BigInt(TEN)] },
                { name: 'withdrawFees', admin: address, args: [address, BigInt(TEN)] },
                { name: 'pause', admin: address, args: [] }
            ]);

            expect(await word(ports.admin.fee(owner.id, 1001)), 'a fee past the vault\'s own ceiling').toBe('422 vault-fee');
            expect(await word(ports.admin.ceiling(owner.id, 'ten')), 'an amount that is no amount').toBe('422 paid-amount');
            expect(await word(ports.admin.fees(owner.id, '0')), 'nothing to take').toBe('422 paid-amount');
            expect(fake.adminCalls, 'the vault was asked about a call refused here').toHaveLength(4);

            for (const [error, said] of [
                ['AccessControlUnauthorizedAccount', '409 vault-role'],
                ['FeeTooHigh', '422 vault-fee'],
                ['InsufficientFees', '409 vault-fees'],
                ['EnforcedPause', '409 vault-paused'],
                ['ExpectedPause', '409 vault-running'],
                ['ZeroAmount', '422 paid-amount'],
                ['SomethingElse', '409 vault-refused']
            ])
            {
                fake.state.adminRefuse = { error, player: null };
                expect(await word(ports.admin.pause(owner.id, false)), error).toBe(said);
            }

            fake.state.adminRefuse = null;
        });

        it('says the vault is not set up, and composes nothing, where it is not', async () =>
        {
            fake = fakeVault(false);
            owned();
            const owner = await makeUser(OWNER);

            expect(await ports.admin.vault(owner.id)).toEqual({ configured: false });
            expect(await word(ports.admin.fee(owner.id, 400))).toBe('404 paid-off');
            expect(await word(ports.admin.ceiling(owner.id, TEN))).toBe('404 paid-off');
            expect(await word(ports.admin.fees(owner.id, TEN))).toBe('404 paid-off');
            expect(await word(ports.admin.pause(owner.id, true))).toBe('404 paid-off');
        });
    });

    describe('dice that can be checked', () =>
    {
        const replay = async (matchId: string, seed: Uint8Array) =>
        {
            const match = await db.getRepository(Match).findOneByOrFail({ id: matchId });
            const [opening, ...rest] = await db.getRepository(MatchAction).find({ where: { matchId }, order: { rev: 'ASC' } });
            const seats = (await db.getRepository(MatchPlayer).find({ where: { matchId }, order: { seat: 'ASC' } })).map((player) => player.seat);
            const engine = (match.game === 'poker' ? pokerEngine : ludoEngine) as Engine;
            const made = engine.create(seats, drawsOf(hmacSha256, seed, OPENING), { target: 0, cube: false, blinds: 'low', variant: match.variant as Variant });
            const told = [{ rev: OPENING, said: opening.events, drawn: made.events as unknown[] }];
            let state = made.state;

            for (const action of rest)
            {
                const payload = action.payload as { verb?: string };
                const dice = drawsOf(hmacSha256, seed, action.rev);
                const asked = action.kind === 'forfeit'
                    ? engine.forfeit(action.seat, payload.verb as ForfeitReason)
                    : (payload.verb === 'auto' ? engine.autoplay(state, action.seat, dice) : engine.parse(action.payload as MatchPlay, action.seat));
                const outcome = asked === null ? null : engine.apply(state, asked, dice);

                if (outcome === null || !outcome.ok)
                {
                    told.push({ rev: action.rev, said: action.events, drawn: [] });
                    break;
                }

                told.push({ rev: action.rev, said: action.events, drawn: outcome.events });
                state = outcome.state;
            }

            return { opening: opening.rev, told, kinds: [opening, ...rest].map((action) => (action.payload as { verb?: string }).verb ?? action.kind) };
        };

        const turnOf = async (players: Person[], matchId: string) =>
        {
            for (const person of players)
            {
                const view = await ports.match.view(person.id, matchId);

                if (view !== null && view.finishedAt === undefined && view.turn === view.mine)
                {
                    return { person, view };
                }
            }

            return null;
        };

        it('draws every die of a paid game from the seed its players signed for, through every way a move is made', async () =>
        {
            const { host, guest, matchId, escrowId } = await playing();

            for (let step = 0; step < 14; step += 1)
            {
                const on = await turnOf([host, guest], matchId);

                if (on === null)
                {
                    break;
                }

                const board = on.view.view as { die?: number; moves: number[] };
                const play: MatchPlay = board.die === undefined || board.moves.length === 0
                    ? { kind: 'ludo', verb: 'roll' }
                    : { kind: 'ludo', verb: 'move', piece: board.moves[0] };

                await ports.match.play(on.person.id, matchId, { key: `step-${ step }`, play });
            }

            await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [matchId]);
            await ports.jobs.sweepTurns(4000);
            await ports.match.resign(host.id, matchId, { key: 'give-up' });

            const seats = await db.getRepository(EscrowSeat).find({ where: { escrowId }, order: { seat: 'ASC' } });
            const seed = seedOf(keccak, seats.map((seat) => seat.secret), seats.map((seat) => seat.signature));
            const checked = await replay(matchId, seed);

            expect(checked.opening).toBe(OPENING);
            expect(checked.kinds).toContain('roll');
            expect(checked.kinds).toContain('auto');
            expect(checked.kinds.at(-1)).toBe('resign');
            expect(checked.told.length).toBeGreaterThan(10);

            for (const one of checked.told)
            {
                expect(one.drawn, `revision ${ one.rev }`).toEqual(one.said);
            }

            const other = seedOf(keccak, [`0x${ '00'.repeat(32) }`, seats[1].secret], seats.map((seat) => seat.signature));
            const wrong = await replay(matchId, other);

            expect(wrong.told.some((one) => JSON.stringify(one.drawn) !== JSON.stringify(one.said))).toBe(true);
        });

        it('draws a paid game\'s opening deal from its seed, and the next hand a walkout deals', async () =>
        {
            const people = [await makeUser(0), await makeUser(1), await makeUser(2), await makeUser(3), await makeUser(4), await makeUser(5)];
            const table = await ports.table.create(people[0].id, { ...live(TEN), game: 'poker', seats: 6 });

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
            const escrow = (await escrowOf(table.id)) as Escrow;
            fake.receipts.set(escrow.openTx as Hex, 'success');
            fake.games.set(vaultIdOf(escrow.id), 'open');
            fake.state.mine = 'success';
            await sweep();
            const matchId = (await escrowOf(table.id))?.matchId as string;

            for (let step = 0; step < 4; step += 1)
            {
                const on = await turnOf(people, matchId);

                await ports.match.play(on!.person.id, matchId, { key: `fold-${ step }`, play: { kind: 'poker', verb: 'fold' } });
            }

            const left = await turnOf(people, matchId);

            await ports.table.leave(left!.person.id, table.id, true);

            const seats = await db.getRepository(EscrowSeat).find({ where: { escrowId: escrow.id }, order: { seat: 'ASC' } });
            const checked = await replay(matchId, seedOf(keccak, seats.map((seat) => seat.secret), seats.map((seat) => seat.signature)));
            const kinds = (events: unknown[]) => events.map((event) => (event as { e: string }).e);

            expect(checked.kinds.at(-1)).toBe('left');
            expect(kinds(checked.told[0].said)).toContain('hole');
            expect(kinds(checked.told.at(-1)!.said)).toContain('deal');

            for (const one of checked.told)
            {
                expect(one.drawn, `revision ${ one.rev }`).toEqual(one.said);
            }
        });

        it('draws every step of a turn the sweep plays from the seed, a six that rolls again included', async () =>
        {
            const { host, guest, matchId, escrowId } = await playing();
            const seats = await db.getRepository(EscrowSeat).find({ where: { escrowId }, order: { seat: 'ASC' } });
            const seed = seedOf(keccak, seats.map((seat) => seat.secret), seats.map((seat) => seat.signature));
            let primed = false;

            for (let step = 0; step < 80 && !primed; step += 1)
            {
                const on = await turnOf([host, guest], matchId);
                const board = on!.view.view as { die?: number; moves: number[] };

                if (board.die === undefined && drawOf(hmacSha256, seed, on!.view.rev + 1, 0, 6) === 6)
                {
                    primed = true;
                }
                else
                {
                    const play: MatchPlay = board.die === undefined || board.moves.length === 0
                        ? { kind: 'ludo', verb: 'roll' }
                        : { kind: 'ludo', verb: 'move', piece: board.moves[0] };

                    await ports.match.play(on!.person.id, matchId, { key: `prime-${ step }`, play });
                }
            }

            expect(primed).toBe(true);

            await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [matchId]);
            await ports.jobs.sweepTurns(4000);

            const checked = await replay(matchId, seed);

            expect(checked.kinds.filter((kind) => kind === 'auto').length).toBeGreaterThanOrEqual(3);

            for (const one of checked.told)
            {
                expect(one.drawn, `revision ${ one.rev }`).toEqual(one.said);
            }
        });

        it('hands a player of a finished paid game what proves it, and nobody else anything', async () =>
        {
            const { host, guest, matchId, escrowId } = await playing();
            const stranger = await makeUser(2);

            expect(await ports.match.proof(host.id, matchId), 'a game still on').toBeNull();

            await ports.match.resign(host.id, matchId, { key: 'done' });

            const proof = await ports.match.proof(guest.id, matchId);
            const seats = await db.getRepository(EscrowSeat).find({ where: { escrowId }, order: { seat: 'ASC' } });
            const ledger = await db.getRepository(MatchAction).find({ where: { matchId }, order: { rev: 'ASC' } });

            expect(proof).toMatchObject({ game: 'ludo', variant: 'standard', seats: [0, 1], target: 0, cube: false, blinds: 'low', chainId: 31337, amount: TEN, feeBps: 500 });
            expect(proof?.vault).toBe(fake.vault.address);
            expect(proof?.state).toBe((await db.getRepository(Escrow).findOneByOrFail({ id: escrowId })).state);
            expect(proof?.players.map((seat) => [seat.seat, seat.who, seat.address, seat.commit, seat.secret, seat.nonce, seat.signature])).toEqual(
                seats.map((seat) => [seat.seat, seat.seat === 0 ? host.handle : guest.handle, seat.address, seat.commitment, seat.secret, seat.nonce, seat.signature])
            );
            expect(proof?.players.map((seat) => seat.deadline)).toEqual(seats.map((seat) => Math.floor(seat.deadline.getTime() / 1000)));
            expect(proof?.actions.map((action) => [action.rev, action.seat, action.kind, JSON.parse(action.payload), JSON.parse(action.events)])).toEqual(
                ledger.map((action) => [action.rev, action.seat, action.kind, action.payload, action.events])
            );
            expect(proof?.openTx).toMatch(/^0x[0-9a-f]{64}$/);
            expect(await ports.match.proof(host.id, matchId)).toEqual(proof);
            expect(await ports.match.proof(stranger.id, matchId), 'somebody who did not play').toBeNull();
            expect(await ports.match.proof(host.id, 'not-a-match'), 'an id that is no id').toBeNull();
        });

        it('proves nothing about a free game', async () =>
        {
            const host = await makeUser(0);
            const guest = await makeUser(1);
            const table = await ports.table.create(host.id, live());

            await ports.table.claim(guest.id, table.id);
            await ports.table.setReady(host.id, table.id, true);
            await ports.table.setReady(guest.id, table.id, true);

            const started = await ports.match.start(host.id, table.id);

            await ports.match.resign(host.id, started.id, { key: 'done' });

            expect(await ports.match.proof(host.id, started.id)).toBeNull();
        });

        it('draws a walkout from the seed as well', async () =>
        {
            const { host, guest, tableId, matchId, escrowId } = await playing();
            const on = await turnOf([host, guest], matchId);

            await ports.match.play(on!.person.id, matchId, { key: 'first', play: { kind: 'ludo', verb: 'roll' } });
            await ports.table.leave(guest.id, tableId, true);

            const seats = await db.getRepository(EscrowSeat).find({ where: { escrowId }, order: { seat: 'ASC' } });
            const checked = await replay(matchId, seedOf(keccak, seats.map((seat) => seat.secret), seats.map((seat) => seat.signature)));

            expect(checked.kinds.at(-1)).toBe('left');

            for (const one of checked.told)
            {
                expect(one.drawn, `revision ${ one.rev }`).toEqual(one.said);
            }
        });
    });
});
