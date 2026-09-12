import 'reflect-metadata';

import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { privateKeyToAccount } from 'viem/accounts';

import { createChatService } from '../src/domains/chat/service.ts';
import { createPeerDevices } from '../src/domains/device/peers.ts';
import { createDeviceService } from '../src/domains/device/service.ts';
import { deviceIdFrom } from '../src/domains/device/id.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { hashToken, mintToken } from '../src/lib/crypto.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * What a PEER may learn about somebody's devices, against a real database.
 *
 * Every test here is a filter, and every filter is the difference between an end-to-end encrypted
 * product and one that says it is. A device the server fabricates re-derives its own id perfectly -
 * the self-certifying id proves the keys were not swapped and says nothing about whose device it
 * is - so what stops a fabricated device being wrapped into a conversation is exactly this: it is
 * not confirmed by another device of that account, and it carries no signature from that account's
 * wallet. Both of those are WHERE clauses, and a fake DataSource cannot prove a WHERE clause.
 *
 * OPT-IN, like the other `.db.spec` suites.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

let db: DataSource;
let devices: ReturnType<typeof createDeviceService>;
let peers: ReturnType<typeof createPeerDevices>;
let chat: ReturnType<typeof createChatService>;

const config = { origin: 'https://nura.games', chainId: '1', rpcUrl: '' };

const signer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const second = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

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

async function makeUser(kind: 'guest' | 'wallet', wallet?: typeof signer): Promise<{ id: string; handle: string }>
{
    seq += 1;
    const handle = `p${ seq }x${ Math.floor(Math.random() * 100000) }`;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, $4) returning id, handle::text as handle`,
        [handle, `Peer ${ seq }`, seq % 360, kind]
    );
    const user = rowsOf<{ id: string; handle: string }>(rows)[0];

    if (wallet !== undefined)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at)
             values ($1, $2, '1', 'wallet', now())`,
            [user.id, wallet.address.toLowerCase()]
        );
    }
    return user;
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

/** Enrols a device the way a wallet account really does: challenge, sign, send. */
async function enrolWithWallet(userId: string, wallet: typeof signer, label = 'Laptop'): Promise<string>
{
    const keys = await keypair();
    const { nonce, message } = await devices.challenge(userId, keys.id);
    const signature = await wallet.signMessage({ message });

    const row = await devices.enrol(userId, await openSession(userId), {
        ...keys, nonce, signature, label, userAgent: ''
    });
    return row.id;
}

describe.skipIf(!active)('what a peer may learn about somebody devices', () =>
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
        peers = createPeerDevices(db);
        chat = createChatService(db, createSocialService(db));
    });

    it('keeps the proof, so somebody other than this server can check it', async () =>
    {
        const alice = await makeUser('wallet', signer);
        const id = await enrolWithWallet(alice.id, signer);

        const [row] = (await devices.list(alice.id)).filter((one) => one.id === id);

        expect(row.attested).toBe('wallet');
        expect(row.attested_address).toBe(signer.address.toLowerCase());
        expect(row.attested_signature).not.toBeNull();

        // The kept bytes must be the bytes that were signed, and they must name this device -
        // otherwise the proof verifies against something nobody can reproduce.
        expect(row.attested_message).toContain(`nura:device:${ id }`);
    });

    it('refuses to hold a wallet-attested device with no proof beside it', async () =>
    {
        const alice = await makeUser('wallet', signer);
        await enrolWithWallet(alice.id, signer);

        // The CHECK is the point: `attested: wallet` can never come to mean "we said so".
        await expect(db.query(`update devices set attested_signature = null where user_id = $1`, [alice.id]))
            .rejects.toThrow(/devices_attestation_whole/);

        await expect(db.query(
            `update devices set attested_address = null, attested_message = null, attested_signature = null where user_id = $1`,
            [alice.id]
        )).rejects.toThrow(/devices_attestation_matches_kind/);
    });

    it('lets a device that had no proof gain one later, without burning its keys', async () =>
    {
        // A guest enrols, then connects a wallet. Forcing a revoke-and-re-enrol would throw away
        // working keys for bookkeeping, and a revoked id can never come back.
        const person = await makeUser('guest');
        const keys = await keypair();
        const session = await openSession(person.id);

        const before = await devices.enrol(person.id, session, { ...keys, label: 'Laptop', userAgent: '' });
        expect(before.attested).toBe('server');
        expect(before.attested_address).toBeNull();

        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at)
             values ($1, $2, '1', 'wallet', now())`,
            [person.id, signer.address.toLowerCase()]
        );

        const { nonce, message } = await devices.challenge(person.id, keys.id);
        const after = await devices.enrol(person.id, session, {
            ...keys, nonce, signature: await signer.signMessage({ message }), label: 'Laptop', userAgent: ''
        });

        expect(after.attested).toBe('wallet');
        expect(after.attested_address).toBe(signer.address.toLowerCase());
        expect(after.id).toBe(before.id);
    });

    it('never re-attests a device that already carries a proof', async () =>
    {
        const alice = await makeUser('wallet', signer);
        const keys = await keypair();
        const session = await openSession(alice.id);

        const first = await devices.challenge(alice.id, keys.id);
        await devices.enrol(alice.id, session, {
            ...keys, nonce: first.nonce, signature: await signer.signMessage({ message: first.message }),
            label: '', userAgent: ''
        });

        // Point the account's most recent wallet at a DIFFERENT address and try again. The upgrade
        // path must not move one address's claim onto a device another address vouched for.
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at)
             values ($1, $2, '1', 'wallet', now())`,
            [alice.id, second.address.toLowerCase()]
        );

        const again = await devices.challenge(alice.id, keys.id);
        const row = await devices.enrol(alice.id, session, {
            ...keys, nonce: again.nonce, signature: await second.signMessage({ message: again.message }),
            label: '', userAgent: ''
        });

        expect(row.attested_address).toBe(signer.address.toLowerCase());
    });

    describe('the list a peer is handed', () =>
    {
        const conversationOf = async (a: { id: string }, b: { id: string }): Promise<string> =>
            chat.openDirect(a.id, b.id);

        it('carries the keys and the proof, and nothing about the owner life', async () =>
        {
            const alice = await makeUser('wallet', signer);
            const bob = await makeUser('wallet', second);
            await enrolWithWallet(alice.id, signer, 'Alice laptop');
            await enrolWithWallet(bob.id, second, 'Bob phone');

            const rows = await peers.forConversation(await conversationOf(alice, bob));
            const listed = rows.filter((row) => row.handle === bob.handle);

            expect(listed).toHaveLength(1);
            expect(listed[0].exchange_key).not.toBeNull();
            expect(listed[0].attested_address).toBe(second.address.toLowerCase());

            // The label is the thing this shape exists to leave out.
            expect(Object.keys(listed[0])).not.toContain('label');
            expect(Object.keys(listed[0])).not.toContain('last_seen_at');
        });

        it('leaves out a device that was signed out', async () =>
        {
            const alice = await makeUser('wallet', signer);
            const bob = await makeUser('wallet', second);
            await enrolWithWallet(alice.id, signer);
            const gone = await enrolWithWallet(bob.id, second);

            const conversation = await conversationOf(alice, bob);
            expect((await peers.forConversation(conversation)).filter((r) => r.device_id === gone)).toHaveLength(1);

            await devices.revoke(bob.id, gone);

            // Wrapping a key to a device somebody signed out is the one thing revocation exists to
            // prevent, and a filter somewhere else is a filter somebody forgets.
            expect((await peers.forConversation(conversation)).filter((r) => r.device_id === gone)).toHaveLength(0);
        });

        it('leaves out a device nothing has vouched for', async () =>
        {
            const alice = await makeUser('wallet', signer);
            const bob = await makeUser('wallet', second);
            await enrolWithWallet(alice.id, signer);

            await enrolWithWallet(bob.id, second, 'first');
            const pending = await enrolWithWallet(bob.id, second, 'second');

            const rows = await peers.forConversation(await conversationOf(alice, bob));

            // This is the ghost-device defence. A device the server fabricates re-derives its id
            // correctly; what it cannot do is get another of Bob's devices to confirm it.
            expect(rows.filter((row) => row.device_id === pending)).toHaveLength(0);
        });

        it('leaves out a device only this server vouches for', async () =>
        {
            const alice = await makeUser('wallet', signer);
            const guest = await makeUser('guest');

            await enrolWithWallet(alice.id, signer);
            await devices.enrol(guest.id, await openSession(guest.id), { ...await keypair(), label: '', userAgent: '' });

            const rows = await peers.forConversation(await conversationOf(alice, guest));
            const theirs = rows.filter((row) => row.handle === guest.handle);

            // A guest has no wallet, so a guest has no provable device. The member is still listed,
            // with nothing in it.
            expect(theirs).toHaveLength(1);
            expect(theirs[0].device_id).toBeNull();
            expect(theirs[0].kind).toBe('guest');
        });

        it('lists a member with no devices at all rather than leaving them out', async () =>
        {
            const alice = await makeUser('wallet', signer);
            const bob = await makeUser('wallet', second);
            await enrolWithWallet(alice.id, signer);

            const rows = await peers.forConversation(await conversationOf(alice, bob));

            // "Nobody on the other side can read this" and "I have not loaded the other side yet"
            // are different states, and a missing key cannot tell them apart.
            expect(rows.map((row) => row.handle).sort()).toEqual([alice.handle, bob.handle].sort());
            expect(rows.filter((row) => row.handle === bob.handle)[0].device_id).toBeNull();
        });
    });
});
