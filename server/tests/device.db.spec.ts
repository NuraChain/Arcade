import 'reflect-metadata';

import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { privateKeyToAccount } from 'viem/accounts';

import { createDeviceService } from '../src/domains/device/service.ts';
import { deviceIdFrom } from '../src/domains/device/id.ts';
import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { hashToken, mintToken } from '../src/lib/crypto.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * Devices, against a real database.
 *
 * Four of these are the reason the domain exists at all, and none of them can be shown against a
 * fake DataSource: that a revoked id can never come back, that revoking ends the sessions bound to
 * the device, that two browsers enrolling at the same instant produce exactly one device that
 * thinks it is the first, and that a signature collected for one device does not authorise
 * another.
 *
 * OPT-IN, like the other `.db.spec` suites. `npm run test:db` with `TEST_DATABASE_URL` pointed at
 * a database you do not mind losing; every test truncates first.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

let db: DataSource;
let device: ReturnType<typeof createDeviceService>;

const config = { origin: 'https://nura.games', chainId: '1', rpcUrl: '' };

/** The standard hardhat account zero. It controls nothing; it exists to produce signatures. */
const signer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

let seq = 0;

const b64url = (buffer: ArrayBuffer): string => Buffer.from(buffer).toString('base64url');

async function keypair(): Promise<{ id: string; exchangeKey: string; signingKey: string }>
{
    const exchange = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;

    const exchangeKey = b64url(await webcrypto.subtle.exportKey('spki', exchange.publicKey));
    const signingKey = b64url(await webcrypto.subtle.exportKey('spki', signing.publicKey));

    return { id: deviceIdFrom(exchangeKey, signingKey), exchangeKey, signingKey };
}

async function makeUser(): Promise<string>
{
    seq += 1;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest') returning id`,
        [`d${ seq }x${ Math.floor(Math.random() * 100000) }`, `Device ${ seq }`, seq % 360]
    );
    return rowsOf<{ id: string }>(rows)[0].id;
}

/** An account with a wallet on it, which is what makes enrolment demand a signature. */
async function makeWalletUser(): Promise<string>
{
    const userId = await makeUser();
    await db.query(
        `insert into wallets (user_id, address, chain_id, attestation, last_used_at)
         values ($1, $2, '1', 'wallet', now())`,
        [userId, signer.address.toLowerCase()]
    );
    return userId;
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

const enrol = async (userId: string, sessionId: string, label = 'A browser'): ReturnType<typeof device.enrol> =>
    device.enrol(userId, sessionId, { ...await keypair(), label, userAgent: 'vitest' });

describe.skipIf(!active)('devices, against a real database', () =>
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
        device = createDeviceService(db, config);
    });

    it('confirms the first device at birth, because there is nobody to ask', async () =>
    {
        const userId = await makeUser();
        const first = await enrol(userId, await openSession(userId));

        expect(first.confirmed_at).not.toBeNull();
        expect(first.attested).toBe('server');
    });

    it('leaves every device after the first waiting to be vouched for', async () =>
    {
        const userId = await makeUser();
        await enrol(userId, await openSession(userId));
        const second = await enrol(userId, await openSession(userId), 'A phone');

        expect(second.confirmed_at).toBeNull();
    });

    it('refuses an id that does not belong to the keys sent with it', async () =>
    {
        const userId = await makeUser();
        const keys = await keypair();
        const other = await keypair();

        await expect(device.enrol(userId, await openSession(userId), {
            ...keys,
            exchangeKey: other.exchangeKey,
            label: '',
            userAgent: ''
        })).rejects.toThrow(/do not match/i);
    });

    it('never lets a revoked id come back, even with the same keys', async () =>
    {
        const userId = await makeUser();
        const keys = await keypair();
        const session = await openSession(userId);

        await device.enrol(userId, session, { ...keys, label: '', userAgent: '' });
        await device.revoke(userId, keys.id);

        // The whole point of revocation. Deleting the row instead would let a stolen laptop
        // present the same keys and be trusted again.
        await expect(device.enrol(userId, await openSession(userId), { ...keys, label: '', userAgent: '' }))
            .rejects.toThrow(/cannot be used again/i);
    });

    it('signs out every session bound to a device when that device is revoked', async () =>
    {
        const userId = await makeUser();
        const [one, two] = [await openSession(userId), await openSession(userId)];
        const keys = await keypair();

        await device.enrol(userId, one, { ...keys, label: '', userAgent: '' });

        // Bound directly, because re-enrolling no longer moves the binding: the existing-device
        // branch is satisfied entirely by PUBLIC data, so letting it rebind let any session on the
        // account assert itself to be any device. This is what a second genuine enrolment produced.
        await db.query('update sessions set device_id = $1 where id = $2', [keys.id, two]);

        const { sessions } = await device.revoke(userId, keys.id);
        expect(new Set(sessions)).toEqual(new Set([one, two]));

        const live = await db.query('select count(*)::int as n from sessions where user_id = $1 and revoked_at is null', [userId]);
        expect(rowsOf<{ n: number }>(live)[0].n).toBe(0);
    });

    it('leaves the other devices of the account alone when one is revoked', async () =>
    {
        const userId = await makeUser();
        const mine = await openSession(userId);
        const theirs = await openSession(userId);

        const kept = await enrol(userId, mine);
        const gone = await enrol(userId, theirs, 'The lost one');

        await device.revoke(userId, gone.id);

        const rows = await db.query('select id from sessions where user_id = $1 and revoked_at is null', [userId]);
        expect(rowsOf<{ id: string }>(rows).map((row) => row.id)).toEqual([mine]);
        expect((await device.list(userId)).find((row) => row.id === kept.id)?.revoked_at).toBeNull();
    });

    it('keeps a revoked device in the list rather than making it disappear', async () =>
    {
        const userId = await makeUser();
        const row = await enrol(userId, await openSession(userId));
        await device.revoke(userId, row.id);

        const listed = await device.list(userId);
        expect(listed).toHaveLength(1);
        expect(listed[0].revoked_at).not.toBeNull();
    });

    it('lets exactly one of two simultaneous enrolments believe it is the first', async () =>
    {
        const userId = await makeUser();

        const [one, two] = await Promise.all([
            enrol(userId, await openSession(userId), 'One'),
            enrol(userId, await openSession(userId), 'Two')
        ]);

        // Without the advisory lock both read "no devices yet" and both arrive confirmed, which
        // would mean an account could never have an unconfirmed device to notice.
        const confirmed = [one, two].filter((row) => row.confirmed_at !== null);
        expect(confirmed).toHaveLength(1);
    });

    it('re-enrolling the same device is a touch, not a second device', async () =>
    {
        const userId = await makeUser();
        const keys = await keypair();
        const first = await openSession(userId);
        const second = await openSession(userId);

        await device.enrol(userId, first, { ...keys, label: 'Laptop', userAgent: '' });
        const again = await device.enrol(userId, second, { ...keys, label: 'ignored', userAgent: 'newer' });

        expect(again.label).toBe('Laptop');
        expect(await device.list(userId)).toHaveLength(1);

        // And the new session is NOT bound to it. Everything the existing-device branch checks is
        // satisfied by public data - the id is a hash of two published keys, and `GET /devices`
        // hands every device's keys to any session on the account - so rebinding here let any
        // signed-in browser name somebody else's device and become it. That binding decides which
        // wrapped epoch key a caller is handed; possession is proved by USING the key, which a
        // browser does on every seal.
        expect(await device.deviceOfSession(second)).toBeNull();
        expect(await device.deviceOfSession(first)).toBe(keys.id);
    });

    it('refuses keys that already belong to somebody else', async () =>
    {
        const keys = await keypair();
        const mine = await makeUser();
        const theirs = await makeUser();

        await device.enrol(mine, await openSession(mine), { ...keys, label: '', userAgent: '' });

        await expect(device.enrol(theirs, await openSession(theirs), { ...keys, label: '', userAgent: '' }))
            .rejects.toThrow(/already belong/i);
    });

    describe('a device cannot vouch for itself', () =>
    {
        it('refuses confirmation from the device being confirmed', async () =>
        {
            const userId = await makeUser();
            const session = await openSession(userId);
            const row = await enrol(userId, session);

            await expect(device.confirm(userId, row.id, row.id)).rejects.toThrow(/cannot vouch for itself/i);
        });

        it('refuses confirmation from a device that is not confirmed itself', async () =>
        {
            const userId = await makeUser();
            await enrol(userId, await openSession(userId));

            const second = await enrol(userId, await openSession(userId), 'Second');
            const third = await enrol(userId, await openSession(userId), 'Third');

            // Otherwise one enrolled device could bless a chain of others and `pending` would
            // mean nothing at all.
            await expect(device.confirm(userId, second.id, third.id)).rejects.toThrow(/not confirmed yet/i);
        });

        it('lets a confirmed device vouch for a waiting one, once', async () =>
        {
            const userId = await makeUser();
            const first = await enrol(userId, await openSession(userId));
            const second = await enrol(userId, await openSession(userId), 'Second');

            const confirmed = await device.confirm(userId, first.id, second.id);
            expect(confirmed.confirmed_at).not.toBeNull();

            await expect(device.confirm(userId, first.id, second.id)).rejects.toThrow();
        });
    });

    describe('an account with a wallet on it', () =>
    {
        const sign = async (userId: string, deviceId: string): Promise<{ nonce: string; signature: string }> =>
        {
            const { nonce, message } = await device.challenge(userId, deviceId);
            return { nonce, signature: await signer.signMessage({ message }) };
        };

        it('records the wallet as the authority when the signature checks out', async () =>
        {
            const userId = await makeWalletUser();
            const keys = await keypair();

            const row = await device.enrol(userId, await openSession(userId), {
                ...keys,
                ...await sign(userId, keys.id),
                label: 'Laptop',
                userAgent: ''
            });

            expect(row.attested).toBe('wallet');
        });

        it('will not enrol a device with no signature at all', async () =>
        {
            const userId = await makeWalletUser();

            // The downgrade nobody would see: without this, omitting the signature would produce
            // a server-attested device on an account that can prove its devices properly.
            await expect(device.enrol(userId, await openSession(userId), { ...await keypair(), label: '', userAgent: '' }))
                .rejects.toThrow(/signs for its devices/i);
        });

        it('will not let a signature collected for one device authorise another', async () =>
        {
            const userId = await makeWalletUser();
            const wanted = await keypair();
            const other = await keypair();

            const proof = await sign(userId, other.id);

            await expect(device.enrol(userId, await openSession(userId), { ...wanted, ...proof, label: '', userAgent: '' }))
                .rejects.toThrow(/different device/i);
        });

        it('burns the challenge, so one signature enrols one device', async () =>
        {
            const userId = await makeWalletUser();
            const keys = await keypair();
            const proof = await sign(userId, keys.id);

            await device.enrol(userId, await openSession(userId), { ...keys, ...proof, label: '', userAgent: '' });
            await device.revoke(userId, keys.id);

            const replay = await keypair();
            await expect(device.enrol(userId, await openSession(userId), { ...replay, ...proof, label: '', userAgent: '' }))
                .rejects.toThrow(/expired/i);
        });

        it('refuses a signature from a different wallet', async () =>
        {
            const userId = await makeWalletUser();
            const keys = await keypair();
            const { nonce, message } = await device.challenge(userId, keys.id);

            const impostor = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
            const signature = await impostor.signMessage({ message });

            await expect(device.enrol(userId, await openSession(userId), { ...keys, nonce, signature, label: '', userAgent: '' }))
                .rejects.toThrow(/did not match/i);
        });

        it('has nothing to offer an account with no wallet', async () =>
        {
            const userId = await makeUser();
            await expect(device.challenge(userId, (await keypair()).id)).rejects.toThrow(/no wallet/i);
        });
    });
});
