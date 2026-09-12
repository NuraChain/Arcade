import 'reflect-metadata';

import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { privateKeyToAccount } from 'viem/accounts';

import { createDeviceService } from '../src/domains/device/service.ts';
import { createRecoveryService } from '../src/domains/device/recovery-service.ts';
import { recoveryChallenge } from '../src/domains/device/recovery.ts';
import { deviceIdFrom } from '../src/domains/device/id.ts';
import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { hashToken, mintToken } from '../src/lib/crypto.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * The recovery vault, against a real database.
 *
 * This is the most dangerous feature in the product: the phrase cannot be revoked, and whoever
 * holds it reads everything the account has ever received. So the tests that earn their keep are
 * the refusals - a pending device writing its own vault, a challenge issued for somebody else's
 * device, a signature replayed onto a different browser, a nonce used twice.
 *
 * The signing half is real WebCrypto rather than a stub. `exportKey('raw')` on a P-256 public key
 * gives exactly the uncompressed point the service expects, so these tests exercise the same bytes
 * a browser publishes.
 *
 * OPT-IN, like the other `.db.spec` suites.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

let db: DataSource;
let devices: ReturnType<typeof createDeviceService>;
let recovery: ReturnType<typeof createRecoveryService>;

const config = { origin: 'https://nura.games', chainId: '1', rpcUrl: '' };

const alice = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const bob = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

let seq = 0;

const b64url = (buffer: ArrayBuffer): string => Buffer.from(new Uint8Array(buffer)).toString('base64url');

/** A recovery keypair, as a browser derives one from a phrase. */
async function phraseKeys(): Promise<{ publicKey: string; sign: (text: string) => Promise<string> }>
{
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;

    return {
        publicKey: b64url(await webcrypto.subtle.exportKey('raw', pair.publicKey)),
        sign: async (text) => b64url(await webcrypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            pair.privateKey,
            Buffer.from(text, 'utf8')
        ))
    };
}

async function keypair(): Promise<{ id: string; exchangeKey: string; signingKey: string }>
{
    const exchange = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;

    const exchangeKey = b64url(await webcrypto.subtle.exportKey('spki', exchange.publicKey));
    const signingKey = b64url(await webcrypto.subtle.exportKey('spki', signing.publicKey));

    return { id: deviceIdFrom(exchangeKey, signingKey), exchangeKey, signingKey };
}

async function makeUser(wallet: typeof alice): Promise<string>
{
    seq += 1;
    const handle = `r${ seq }x${ Math.floor(Math.random() * 100000) }`;

    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind) values ($1, $2, $3, 'wallet') returning id`,
        [handle, `Person ${ seq }`, seq % 360]
    );

    const id = rowsOf<{ id: string }>(rows)[0].id;

    await db.query(
        `insert into wallets (user_id, address, chain_id, attestation, last_used_at)
         values ($1, $2, '1', 'wallet', now())`,
        [id, wallet.address.toLowerCase()]
    );
    return id;
}

async function openSession(userId: string): Promise<string>
{
    const rows = await db.query(
        `insert into sessions (user_id, token_hash, expires_at)
         values ($1, $2, now() + interval '30 days') returning id`,
        [userId, hashToken(mintToken())]
    );
    return rowsOf<{ id: string }>(rows)[0].id;
}

async function enrol(userId: string, wallet: typeof alice): Promise<string>
{
    const keys = await keypair();
    const { nonce, message } = await devices.challenge(userId, keys.id);

    const row = await devices.enrol(userId, await openSession(userId), {
        ...keys,
        nonce,
        signature: await wallet.signMessage({ message }),
        label: 'Browser',
        userAgent: ''
    });
    return row.id;
}

const vaultOf = (publicKey: string) => ({
    salt: 'c2FsdHk',
    publicKey,
    wrapped: 'the-archive-key-under-the-phrase',
    checkValue: 'a-fixed-sentence-under-the-same-key'
});

describe.skipIf(!active)('recovery, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', url, entities, migrations, synchronize: false, logging: ['error'] });
        await db.initialize();
        await db.runMigrations();
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
        await db.query('truncate users cascade');
        await db.query('truncate siwe_nonces');
        devices = createDeviceService(db, config);
        recovery = createRecoveryService(db);
    });

    /** An account with one confirmed device and a vault, which is where every recovery starts. */
    const withVault = async (): Promise<{
        userId: string;
        first: string;
        session: string;
        keys: Awaited<ReturnType<typeof phraseKeys>>;
    }> =>
    {
        const userId = await makeUser(alice);
        const first = await enrol(userId, alice);
        const session = await openSession(userId);

        await db.query('update sessions set device_id = $1 where id = $2', [first, session]);

        const keys = await phraseKeys();
        await recovery.setVault(userId, first, vaultOf(keys.publicKey));

        return { userId, first, session, keys };
    };

    it('has no vault until somebody makes one', async () =>
    {
        const userId = await makeUser(alice);
        expect(await recovery.vaultOf(userId)).toBeNull();
    });

    it('refuses to write a vault from a device the account has not confirmed', async () =>
    {
        const userId = await makeUser(alice);
        await enrol(userId, alice);

        // The second device arrives pending. If it could write its own vault it would then present
        // its own phrase to confirm itself, and confirmation would mean nothing whatsoever.
        const pending = await enrol(userId, alice);
        const keys = await phraseKeys();

        await expect(recovery.setVault(userId, pending, vaultOf(keys.publicKey)))
            .rejects.toThrow(/confirmed/);

        await expect(recovery.setVault(userId, null, vaultOf(keys.publicKey)))
            .rejects.toThrow(/confirmed/);
    });

    it('replaces a vault in place, which is how a phrase is rolled', async () =>
    {
        const { userId, first } = await withVault();

        const rolled = await phraseKeys();
        await recovery.setVault(userId, first, { ...vaultOf(rolled.publicKey), wrapped: 'the-same-archive-key-under-a-new-phrase' });

        const vault = await recovery.vaultOf(userId);
        expect(vault?.public_key).toBe(rolled.publicKey);
        expect(vault?.wrapped).toBe('the-same-archive-key-under-a-new-phrase');

        const rows = await db.query('select count(*)::int as n from recovery_vaults where user_id = $1', [userId]);
        expect(rowsOf<{ n: number }>(rows)[0].n).toBe(1);
    });

    it('confirms a waiting device for a signature over its own challenge', async () =>
    {
        const { userId, keys } = await withVault();
        const replacement = await enrol(userId, alice);

        const { nonce, salt } = await recovery.challenge(userId, replacement);
        expect(salt).toBe('c2FsdHk');

        const answer = await recovery.confirm(
            userId,
            replacement,
            nonce,
            await keys.sign(recoveryChallenge(userId, replacement, nonce))
        );

        expect(answer.wrapped).toBe('the-archive-key-under-the-phrase');

        const rows = await db.query('select confirmed_at from devices where id = $1', [replacement]);
        expect(rowsOf<{ confirmed_at: Date | null }>(rows)[0].confirmed_at).not.toBeNull();
    });

    it('refuses a signature that is not this account phrase, and leaves the device waiting', async () =>
    {
        const { userId } = await withVault();
        const replacement = await enrol(userId, alice);

        const { nonce } = await recovery.challenge(userId, replacement);
        const impostor = await phraseKeys();

        await expect(recovery.confirm(
            userId,
            replacement,
            nonce,
            await impostor.sign(recoveryChallenge(userId, replacement, nonce))
        )).rejects.toThrow(/not the recovery phrase/);

        const rows = await db.query('select confirmed_at from devices where id = $1', [replacement]);
        expect(rowsOf<{ confirmed_at: Date | null }>(rows)[0].confirmed_at).toBeNull();
    });

    it('will not let a signature for one browser confirm another', async () =>
    {
        const { userId, keys } = await withVault();

        const wanted = await enrol(userId, alice);
        const other = await enrol(userId, alice);

        const { nonce } = await recovery.challenge(userId, wanted);

        // A perfectly good signature by the real phrase, over a challenge naming a different
        // device. The nonce remembers which browser it was issued for.
        await expect(recovery.confirm(
            userId,
            other,
            nonce,
            await keys.sign(recoveryChallenge(userId, other, nonce))
        )).rejects.toThrow(/different browser/);

        const rows = await db.query('select confirmed_at from devices where id = $1', [other]);
        expect(rowsOf<{ confirmed_at: Date | null }>(rows)[0].confirmed_at).toBeNull();
    });

    it('burns the nonce, so one signature cannot be replayed', async () =>
    {
        const { userId, keys } = await withVault();
        const replacement = await enrol(userId, alice);

        const { nonce } = await recovery.challenge(userId, replacement);
        const signature = await keys.sign(recoveryChallenge(userId, replacement, nonce));

        await recovery.confirm(userId, replacement, nonce, signature);

        await expect(recovery.confirm(userId, replacement, nonce, signature))
            .rejects.toThrow(/expired or has already been used/);
    });

    it('races two replays of one signature and lets exactly one through', async () =>
    {
        const { userId, keys } = await withVault();
        const replacement = await enrol(userId, alice);

        const { nonce } = await recovery.challenge(userId, replacement);
        const signature = await keys.sign(recoveryChallenge(userId, replacement, nonce));

        // Burned FIRST, by a conditional UPDATE that only matches an unconsumed row, so the race
        // happens in the database. Verifying first would leave a window where both passed.
        const results = await Promise.allSettled([
            recovery.confirm(userId, replacement, nonce, signature),
            recovery.confirm(userId, replacement, nonce, signature)
        ]);

        expect(results.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    });

    it('refuses an expired challenge', async () =>
    {
        const { userId, keys } = await withVault();
        const replacement = await enrol(userId, alice);

        const { nonce } = await recovery.challenge(userId, replacement);
        await db.query('update recovery_nonces set expires_at = now() - interval \'1 minute\' where nonce = $1', [nonce]);

        await expect(recovery.confirm(
            userId,
            replacement,
            nonce,
            await keys.sign(recoveryChallenge(userId, replacement, nonce))
        )).rejects.toThrow(/expired/);
    });

    it('will not issue a challenge for a device that is already confirmed, or somebody else', async () =>
    {
        const { userId, first } = await withVault();

        await expect(recovery.challenge(userId, first)).rejects.toThrow(/waiting to be confirmed/);

        const stranger = await makeUser(bob);
        const theirs = await enrol(stranger, bob);

        await expect(recovery.challenge(userId, theirs)).rejects.toThrow(/waiting to be confirmed/);
    });

    it('archives an epoch key only for a conversation this account is in', async () =>
    {
        const { userId } = await withVault();

        const conversation = rowsOf<{ id: string }>(await db.query(
            `insert into conversations (kind, pair_key) values ('direct', $1) returning id`,
            [`${ userId }:zzz`]
        ))[0].id;

        await expect(recovery.archive(userId, conversation, 1, 'sealed'))
            .rejects.toThrow(/No conversation with that id/);

        await db.query('insert into conversation_members (conversation_id, user_id) values ($1, $2)', [conversation, userId]);

        await recovery.archive(userId, conversation, 1, 'sealed');
        expect(await recovery.archived(userId)).toEqual([
            { conversation_id: conversation, epoch: 1, wrapped: 'sealed' }
        ]);

        // Idempotent, because the client archives whenever it learns a key and may learn one twice.
        await recovery.archive(userId, conversation, 1, 'sealed-again');
        expect((await recovery.archived(userId))[0].wrapped).toBe('sealed');
    });

    it('refuses to archive against a vault that does not exist', async () =>
    {
        const userId = await makeUser(alice);
        await enrol(userId, alice);

        await expect(recovery.archive(userId, '00000000-0000-4000-8000-000000000000', 1, 'sealed'))
            .rejects.toThrow(/no recovery phrase/);
    });

    it('takes the archive with the vault when recovery is turned off', async () =>
    {
        const { userId } = await withVault();

        const conversation = rowsOf<{ id: string }>(await db.query(
            `insert into conversations (kind, pair_key) values ('direct', $1) returning id`,
            [`${ userId }:yyy`]
        ))[0].id;

        await db.query('insert into conversation_members (conversation_id, user_id) values ($1, $2)', [conversation, userId]);
        await recovery.archive(userId, conversation, 1, 'sealed');

        await recovery.clearVault(userId);

        // A vault with no archive restores nothing, and an archive with no vault is ciphertext
        // nobody can ever open. Leaving either behind would be leaving a broken promise.
        expect(await recovery.vaultOf(userId)).toBeNull();
        expect(await recovery.archived(userId)).toEqual([]);
    });
});
