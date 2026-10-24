import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { Referral, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

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
    vapidSubject: '',
    vaultAddress: '',
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

let db: DataSource;
let ports: Services;

const enter = async (ref?: string) =>
{
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { nonce, message } = await ports.identity.challenge(wallet.address);
    const established = await ports.identity.signInWithWallet({ address: wallet.address, nonce, signature: await wallet.signMessage({ message }), userAgent: 'test', ref });

    return { wallet, account: established.account };
};

const again = async (wallet: ReturnType<typeof privateKeyToAccount>, ref?: string) =>
{
    const { nonce, message } = await ports.identity.challenge(wallet.address);

    return await ports.identity.signInWithWallet({ address: wallet.address, nonce, signature: await wallet.signMessage({ message }), userAgent: 'test', ref });
};

const referrals = async () =>
    (await db.getRepository(Referral).find({ relations: { invitee: true, inviter: true } }))
        .map((row) => [row.invitee.handle, row.inviter?.handle ?? null, row.countedAt === null ? 'pending' : 'counted'])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

describe.skipIf(!active)('invites, against a real database', () =>
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
            await db.query('truncate table users, avatars cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        await db.query('truncate table users, avatars cascade');
    });

    it('credits a new account to whoever\'s link it came through, whatever the case of the handle or an @ before it', async () =>
    {
        const { account: inviter } = await enter();
        const { account: first } = await enter(inviter.handle.toUpperCase());
        const { account: second } = await enter(`@${ inviter.handle }`);

        expect(await referrals()).toEqual([
            [first.handle, inviter.handle, 'pending'],
            [second.handle, inviter.handle, 'pending']
        ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
    });

    it('credits an account once, at its first sign-in, and never moves it', async () =>
    {
        const { account: inviter } = await enter();
        const { account: other } = await enter();
        const { wallet, account: invitee } = await enter(inviter.handle);

        await again(wallet, other.handle);

        expect(await referrals()).toEqual([[invitee.handle, inviter.handle, 'pending']]);

        const { wallet: late } = await enter();
        await again(late, inviter.handle);

        expect(await referrals(), 'an account that already existed is nobody\'s invite').toHaveLength(1);
    });

    it('lets go, without a word, of a name that is nobody, a suspended account or the new account itself', async () =>
    {
        const { account: suspended } = await enter();
        await db.getRepository(User).update({ handle: suspended.handle }, { isSuspended: true });

        await enter('nobody-holds-this');
        await enter(suspended.handle);
        await enter('');

        expect(await referrals()).toEqual([]);
        expect(await db.query(`select 1 from referrals where invitee_id = inviter_id`)).toEqual([]);
    });
});
