import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getAddress, toHex, type Address, type Hex } from 'viem';

import { HttpError, errorResponse } from '@azerothjs/http';

import type { Vault, VaultTerms } from '../src/chain/vault.ts';
import { PaidAccount, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { STAKE_LADDER, WEI_PER_NURA } from '../src/domains/stake/policy.ts';
import { createStakeService, type StakeHooks } from '../src/domains/stake/service.ts';
import { rowsOf } from '../src/lib/rows.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const VAULT: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const DANA = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const OMID = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const DAY_MS = 24 * 60 * 60 * 1000;

let db: DataSource;

const idle: StakeHooks = { begin: async () => null, began: async () => undefined, changed: async () => undefined };
let seq = 0;

const unreachable = () => new HttpError(503, 'We could not reach the network. Try again in a moment.', { code: 'chain-unreachable', expose: true });

const fakeVault = (overrides: Partial<VaultTerms> = {}, configured = true) =>
{
    const asked: string[] = [];
    let terms: VaultTerms = { fee: 500, maxStake: 50n * WEI_PER_NURA, reclaimAfter: 259_200n, paused: false, games: {}, ...overrides };
    let away = false;

    const vault: Vault = {
        configured,
        address: configured ? VAULT : null,
        chainId: 31337,
        referee: configured ? '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' : null,
        stakeTypedData: () => '{}',
        signedBy: async () => true,
        async balances(owner)
        {
            asked.push(`balances ${ owner }`);

            if (away)
            {
                throw unreachable();
            }

            return { free: 7n * WEI_PER_NURA, locked: 2n * WEI_PER_NURA, wallet: 11n * WEI_PER_NURA };
        },
        async terms()
        {
            asked.push('terms');
            return terms;
        },
        game: async () => ({ status: 'none', feeBps: 0, openedAt: 0n, amount: 0n, players: [] }),
        clock: async () => BigInt(Math.floor(Date.now() / 1000)),
        async depositCall(amount)
        {
            asked.push(`deposit ${ amount }`);
            return { to: VAULT, data: '0xd0e30db0', value: amount, chainId: 31337, gasPrice: null };
        },
        async withdrawCall(amount)
        {
            asked.push(`withdraw ${ amount }`);
            return { to: VAULT, data: '0x2e1a7d4d', value: 0n, chainId: 31337, gasPrice: 47_000_000_000n };
        },
        reclaimCall: async () => ({ to: VAULT, data: '0x', value: 0n, chainId: 31337, gasPrice: null }),
        open: async () => ({ ok: true, hash: `0x${ '00'.repeat(32) }` as Hex }),
        settle: async () => ({ ok: true, hash: `0x${ '00'.repeat(32) }` as Hex }),
        refund: async () => ({ ok: true, hash: `0x${ '00'.repeat(32) }` as Hex }),
        mined: async () => 'pending',
        gas: async () => 0n,
        ledger: async () => ({ terms, fees: 0n, free: 0n, locked: 0n, held: 0n, solvent: true, gas: 0n, gasPrice: 0n, refereeAllowed: true, chainReferee: '0x0000000000000000000000000000000000000000', ownFees: {}, adminAllowed: false, pauserAllowed: false }),
        feeCall: async () => ({ ok: false, refusal: { error: 'AccessControlUnauthorizedAccount', player: null } }),
        gameFeeCall: async () => ({ ok: false, refusal: { error: 'AccessControlUnauthorizedAccount', player: null } }),
        refereeCall: async () => ({ ok: false, refusal: { error: 'AccessControlUnauthorizedAccount', player: null } }),
        ceilingCall: async () => ({ ok: false, refusal: { error: 'AccessControlUnauthorizedAccount', player: null } }),
        feesCall: async () => ({ ok: false, refusal: { error: 'AccessControlUnauthorizedAccount', player: null } }),
        pauseCall: async () => ({ ok: false, refusal: { error: 'AccessControlUnauthorizedAccount', player: null } })
    };

    return {
        vault,
        asked,
        set: (next: Partial<VaultTerms>) =>
        {
            terms = { ...terms, ...next };
        },
        drop: () =>
        {
            away = true;
        }
    };
};

const makeUser = async (wallets: string[] = [], overrides: Partial<Pick<User, 'isMinor' | 'allowStrangerMessages'>> = {}) =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `v${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Vault ${ seq }`,
        hue: seq % 360,
        kind: wallets.length === 0 ? 'guest' : 'wallet',
        ...overrides
    });

    for (const [index, address] of wallets.entries())
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at)
             values ($1, $2, '31337', 'wallet', now() - make_interval(mins => $3))`,
            [made.id, address, wallets.length - index]
        );
    }

    return made.id;
};

const refusal = async (work: Promise<unknown>) =>
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

const breakOf = async (userId: string) =>
    rowsOf<{ until: Date | null }>(await db.query('select break_until as until from paid_accounts where user_id = $1', [userId]))[0]?.until ?? null;

describe.skipIf(!active)('a player\'s NURA in the vault, against a real database', () =>
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
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    describe('a server with no vault', () =>
    {
        it('says so, refuses every change as a thing that is not here, and asks the chain nothing', async () =>
        {
            const { vault, asked } = fakeVault({}, false);
            const stakes = createStakeService(db, vault, idle);
            const me = await makeUser([DANA]);

            expect(stakes.configured).toBe(false);
            expect(await stakes.state(me)).toEqual({ configured: false });
            expect(await refusal(stakes.accept(me))).toBe('404 paid-off');
            expect(await refusal(stakes.rest(me, 7))).toBe('404 paid-off');
            expect(await refusal(stakes.deposit(me, '1'))).toBe('404 paid-off');
            expect(await refusal(stakes.withdraw(me, '1'))).toBe('404 paid-off');
            expect(asked).toEqual([]);
            expect(await db.getRepository(PaidAccount).count()).toBe(0);
        });
    });

    describe('who may play for NURA', () =>
    {
        it('is never a guest, who has no wallet: no balances, and every step refused for that reason', async () =>
        {
            const { vault, asked } = fakeVault();
            const stakes = createStakeService(db, vault, idle);
            const guest = await makeUser();

            const state = await stakes.state(guest);

            expect(state).toMatchObject({ configured: true, may: 'paid-wallet' });
            expect(state).not.toHaveProperty('balances');
            expect(asked.filter((ask) => ask.startsWith('balances'))).toEqual([]);
            expect(await refusal(stakes.accept(guest))).toBe('409 paid-wallet');
            expect(await refusal(stakes.rest(guest, 1))).toBe('409 paid-wallet');
            expect(await refusal(stakes.deposit(guest, '1'))).toBe('409 paid-wallet');
            expect(await refusal(stakes.withdraw(guest, '1'))).toBe('409 paid-wallet');
        });

        it('is never a minor, whatever they confirm, and nothing is written for them', async () =>
        {
            const stakes = createStakeService(db, fakeVault().vault, idle);
            const minor = await makeUser([DANA], { isMinor: true, allowStrangerMessages: false });

            expect(await stakes.state(minor)).toMatchObject({ may: 'paid-minor' });
            expect(await refusal(stakes.accept(minor))).toBe('409 paid-minor');
            expect(await refusal(stakes.rest(minor, 30))).toBe('409 paid-minor');
            expect(await refusal(stakes.deposit(minor, '1'))).toBe('409 paid-minor');
            expect(await db.getRepository(PaidAccount).count()).toBe(0);
        });

        it('is an adult with a wallet once they accept the terms, which is recorded once and kept', async () =>
        {
            const stakes = createStakeService(db, fakeVault().vault, idle);
            const me = await makeUser([DANA]);

            expect(await stakes.state(me)).toMatchObject({ may: 'paid-terms' });
            expect(await refusal(stakes.deposit(me, '1'))).toBe('409 paid-terms');
            expect(await refusal(stakes.rest(me, 1))).toBe('409 paid-terms');

            expect(await stakes.accept(me)).toMatchObject({ may: 'yes' });

            const first = await db.getRepository(PaidAccount).findOneByOrFail({ userId: me });

            expect(await stakes.accept(me)).toMatchObject({ may: 'yes' });
            expect(await db.getRepository(PaidAccount).findBy({ userId: me })).toEqual([first]);
        });

        it('stops for a break of the length asked, which a shorter one never cuts short', async () =>
        {
            const stakes = createStakeService(db, fakeVault().vault, idle);
            const me = await makeUser([DANA]);
            await stakes.accept(me);

            const before = Date.now();
            const week = await stakes.rest(me, 7);

            expect(week).toMatchObject({ may: 'paid-break' });

            const until = await breakOf(me);

            expect(until).not.toBeNull();
            expect(until!.getTime()).toBeGreaterThan(before + 7 * DAY_MS - 60_000);
            expect(until!.getTime()).toBeLessThan(Date.now() + 7 * DAY_MS + 60_000);
            expect(week).toMatchObject({ breakUntil: until!.toISOString() });

            expect(await stakes.rest(me, 1)).toMatchObject({ may: 'paid-break', breakUntil: until!.toISOString() });
            expect(await breakOf(me)).toEqual(until);

            await stakes.rest(me, 30);

            expect((await breakOf(me))!.getTime()).toBeGreaterThan(before + 30 * DAY_MS - 60_000);
        });

        it('stops deposits during a break, never a withdrawal', async () =>
        {
            const stakes = createStakeService(db, fakeVault().vault, idle);
            const me = await makeUser([DANA]);
            await stakes.accept(me);
            await stakes.rest(me, 1);

            expect(await refusal(stakes.deposit(me, '1'))).toBe('409 paid-break');
            expect(await stakes.withdraw(me, '5')).toMatchObject({ from: getAddress(DANA) });
        });

        it('plays again once a break has run out, which the database\'s clock decides', async () =>
        {
            const stakes = createStakeService(db, fakeVault().vault, idle);
            const me = await makeUser([DANA]);
            await stakes.accept(me);
            await stakes.rest(me, 1);
            await db.query(`update paid_accounts set break_until = now() - interval '1 second' where user_id = $1`, [me]);

            const state = await stakes.state(me);

            expect(state).toMatchObject({ may: 'yes' });
            expect(state).not.toHaveProperty('breakUntil');

            await stakes.rest(me, 1);

            expect((await breakOf(me))!.getTime()).toBeGreaterThan(Date.now() + DAY_MS - 60_000);
        });
    });

    describe('the vault page', () =>
    {
        it('carries the vault\'s terms, the ladder up to its ceiling, and the balances of the wallet the reader signed in with last', async () =>
        {
            const { vault, asked } = fakeVault();
            const stakes = createStakeService(db, vault, idle);
            const me = await makeUser([OMID, DANA]);

            expect(await stakes.state(me)).toEqual({
                configured: true,
                vault: VAULT,
                chainId: 31337,
                fee: 500,
                games: {},
                maxStake: (50n * WEI_PER_NURA).toString(),
                reclaimAfter: 259_200,
                paused: false,
                ladder: STAKE_LADDER.slice(0, 5),
                may: 'paid-terms',
                balances: {
                    address: getAddress(DANA),
                    free: (7n * WEI_PER_NURA).toString(),
                    locked: (2n * WEI_PER_NURA).toString(),
                    wallet: (11n * WEI_PER_NURA).toString()
                }
            });
            expect(asked).toContain(`balances ${ getAddress(DANA) }`);
        });

        it('offers the whole ladder under a ceiling above it, and none of it under one below the first rung', async () =>
        {
            const { vault, set } = fakeVault({ maxStake: 1_000n * WEI_PER_NURA });
            const stakes = createStakeService(db, vault, idle);
            const me = await makeUser([DANA]);

            expect(await stakes.state(me)).toMatchObject({ ladder: STAKE_LADDER });

            set({ maxStake: WEI_PER_NURA - 1n });

            expect(await stakes.state(me)).toMatchObject({ ladder: [] });
        });

        it('hands the wallet a deposit from the reader\'s own address, its value as a quantity', async () =>
        {
            const { vault, asked } = fakeVault();
            const stakes = createStakeService(db, vault, idle);
            const me = await makeUser([DANA]);
            await stakes.accept(me);

            const call = await stakes.deposit(me, '2500000000000000000');

            expect(call).toEqual({ from: getAddress(DANA), to: VAULT, data: '0xd0e30db0', value: toHex(2_500_000_000_000_000_000n), chainId: 31337 });
            expect(asked).toContain('deposit 2500000000000000000');
        });

        it('hands the wallet a withdrawal with the gas price it should pay, whoever has not accepted the terms', async () =>
        {
            const stakes = createStakeService(db, fakeVault().vault, idle);
            const me = await makeUser([DANA]);

            expect(await stakes.withdraw(me, '3')).toEqual({
                from: getAddress(DANA),
                to: VAULT,
                data: '0x2e1a7d4d',
                value: '0x0',
                chainId: 31337,
                gasPrice: toHex(47_000_000_000n)
            });
        });

        it('lets a minor take back what is theirs', async () =>
        {
            const stakes = createStakeService(db, fakeVault().vault, idle);
            const minor = await makeUser([DANA], { isMinor: true, allowStrangerMessages: false });

            expect(await stakes.withdraw(minor, '3')).toMatchObject({ from: getAddress(DANA) });
        });

        it('refuses an amount that is not a whole number of wei above nothing, before it asks anybody', async () =>
        {
            const { vault, asked } = fakeVault();
            const stakes = createStakeService(db, vault, idle);
            const me = await makeUser([DANA]);
            await stakes.accept(me);
            asked.length = 0;

            for (const amount of ['', '0', '-5', '1.5', '1e18', '0x10', 'NURA', '9'.repeat(41)])
            {
                expect(await refusal(stakes.deposit(me, amount)), amount).toBe('422 paid-amount');
                expect(await refusal(stakes.withdraw(me, amount)), amount).toBe('422 paid-amount');
            }

            expect(asked).toEqual([]);
        });

        it('takes no deposit while the vault is paused, and still hands back a withdrawal', async () =>
        {
            const { vault, asked } = fakeVault({ paused: true });
            const stakes = createStakeService(db, vault, idle);
            const me = await makeUser([DANA]);
            await stakes.accept(me);

            expect(await stakes.state(me)).toMatchObject({ paused: true });
            expect(await refusal(stakes.deposit(me, '1'))).toBe('409 paid-paused');
            expect(asked.filter((ask) => ask.startsWith('deposit'))).toEqual([]);
            expect(await stakes.withdraw(me, '1')).toMatchObject({ value: '0x0' });
        });

        it('says a chain it could not reach as that, never as an empty vault', async () =>
        {
            const { vault, drop } = fakeVault();
            const stakes = createStakeService(db, vault, idle);
            const me = await makeUser([DANA]);
            drop();

            expect(await refusal(stakes.state(me))).toBe('503 chain-unreachable');
        });
    });
});
