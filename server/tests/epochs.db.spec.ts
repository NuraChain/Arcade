import 'reflect-metadata';

import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { privateKeyToAccount } from 'viem/accounts';

import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService } from '../src/domains/chat/service.ts';
import { createEpochService } from '../src/domains/chat/epochs.ts';
import { createDeviceService } from '../src/domains/device/service.ts';
import { createPeerDevices } from '../src/domains/device/peers.ts';
import { deviceIdFrom } from '../src/domains/device/id.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { hashToken, mintToken } from '../src/lib/crypto.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * What this server will and will not accept into a conversation's key schedule.
 *
 * The server is not a party to the sealing and cannot check anything about the key. What it CAN do
 * is refuse a recipient nobody should be wrapping to, refuse an epoch that is claimed twice, and
 * make an envelope that is missing half of itself unrepresentable. Every one of those is a database
 * rule - a WHERE clause, a primary key, a CHECK - and a fake DataSource can only prove that the
 * fake agrees with the code.
 *
 * OPT-IN, like the other `.db.spec` suites: `npm run test:db --workspace server` with
 * `TEST_DATABASE_URL` pointed at a database you do not mind losing.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

let db: DataSource;
let devices: ReturnType<typeof createDeviceService>;
let peers: ReturnType<typeof createPeerDevices>;
let epochs: ReturnType<typeof createEpochService>;
let chat: ReturnType<typeof createChatService>;

const config = { origin: 'https://nura.games', chainId: '1', rpcUrl: '' };

const alice = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const bob = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const outsider = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

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

async function makeUser(wallet: typeof alice | null): Promise<{ id: string; handle: string }>
{
    seq += 1;
    const handle = `e${ seq }x${ Math.floor(Math.random() * 100000) }`;

    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, $4) returning id, handle::text as handle`,
        [handle, `Member ${ seq }`, seq % 360, wallet === null ? 'guest' : 'wallet']
    );

    const user = rowsOf<{ id: string; handle: string }>(rows)[0];

    if (wallet !== null)
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

async function enrol(userId: string, wallet: typeof alice): Promise<string>
{
    const keys = await keypair();
    const { nonce, message } = await devices.challenge(userId, keys.id);
    const signature = await wallet.signMessage({ message });

    const row = await devices.enrol(userId, await openSession(userId), {
        ...keys, nonce, signature, label: 'Laptop', userAgent: ''
    });
    return row.id;
}

/** A recipient entry. The bytes are not real wraps - this suite is about the rules, not the maths. */
const wrapFor = (deviceId: string) => ({ deviceId, ephemeralKey: `eph-${ deviceId }`, wrapped: `box-${ deviceId }` });

const mintOf = (mintedBy: string, recipients: string[], epoch = 1) => ({
    epoch,
    mintedBy,
    recipients,
    signature: 'signature-over-the-recipients',
    confirmation: 'the-key-check-value',
    keys: recipients.map(wrapFor)
});

describe.skipIf(!active)('the epoch a conversation is sealed under', () =>
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
        epochs = createEpochService(db);
        chat = createChatService(db, createSocialService(db), createFranking('test-secret'));
    });

    const pair = async (): Promise<{
        left: { id: string; handle: string; device: string };
        right: { id: string; handle: string; device: string };
        conversationId: string;
    }> =>
    {
        const one = await makeUser(alice);
        const two = await makeUser(bob);

        return {
            left: { ...one, device: await enrol(one.id, alice) },
            right: { ...two, device: await enrol(two.id, bob) },
            conversationId: await chat.openDirect(one.id, two.id)
        };
    };

    it('wraps to both members and says the epoch is no longer stale', async () =>
    {
        const { left, right, conversationId } = await pair();

        const before = await epochs.state(conversationId, left.device);
        expect(before.epoch).toBeNull();
        expect(before.stale).toBe(true);
        expect(before.eligible.sort()).toEqual([left.device, right.device].sort());

        expect(await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]))).toBe(true);

        const after = await epochs.state(conversationId, left.device);
        expect(after.epoch?.epoch).toBe(1);
        expect(after.stale).toBe(false);
        expect(after.wrapped?.wrapped).toBe(`box-${ left.device }`);
        expect(after.nextSeq).toBe(1);

        // The other member's copy is a different row, and neither can see the other's.
        const theirs = await epochs.state(conversationId, right.device);
        expect(theirs.wrapped?.wrapped).toBe(`box-${ right.device }`);
    });

    it('refuses a recipient this conversation cannot seal to', async () =>
    {
        const { left, right, conversationId } = await pair();

        const stranger = await makeUser(outsider);
        const theirs = await enrol(stranger.id, outsider);

        // A device belonging to somebody who is not in the conversation. If this were accepted, a
        // server could name its own device here and be wrapped in beside the members.
        await expect(epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device, theirs])))
            .rejects.toThrow(/cannot seal to/);
    });

    it('refuses a recipient list with a key missing, and one with a key too many', async () =>
    {
        const { left, right, conversationId } = await pair();

        const short = mintOf(left.device, [left.device, right.device]);
        short.keys = [wrapFor(left.device)];

        // An epoch row whose keys do not cover its recipients is an epoch somebody cannot open, and
        // it would take the conversation with it: every later sender seals under a key they do not
        // hold.
        await expect(epochs.mint(left.id, conversationId, short)).rejects.toThrow(/exactly one wrapped key/);

        const long = mintOf(left.device, [left.device]);
        long.keys = [wrapFor(left.device), wrapFor(right.device)];

        await expect(epochs.mint(left.id, conversationId, long)).rejects.toThrow(/exactly one wrapped key/);
    });

    it('refuses a device that is not the minter own', async () =>
    {
        const { left, right, conversationId } = await pair();

        await expect(epochs.mint(left.id, conversationId, mintOf(right.device, [left.device, right.device])))
            .rejects.toThrow(/cannot mint/);
    });

    it('gives the epoch to exactly one of two devices that claim it at once', async () =>
    {
        const { left, right, conversationId } = await pair();

        const results = await Promise.all([
            epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device])),
            epochs.mint(right.id, conversationId, mintOf(right.device, [left.device, right.device]))
        ]);

        // Losing is ordinary: two devices noticing one membership change compute the same next
        // number, the primary key arbitrates, and the loser reads what the winner wrote.
        expect(results.filter(Boolean)).toHaveLength(1);

        const rows = await db.query('select count(*)::int as n from conversation_epochs where conversation_id = $1', [conversationId]);
        expect(rowsOf<{ n: number }>(rows)[0].n).toBe(1);
    });

    it('goes stale when somebody revokes a device, and a new epoch clears it', async () =>
    {
        const { left, right, conversationId } = await pair();

        await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));
        expect((await epochs.state(conversationId, left.device)).stale).toBe(false);

        await devices.revoke(right.id, right.device);

        // Rotation is client-driven and server-detected. This server holds no key it could re-wrap
        // with, so all it can do is say the set no longer describes the room.
        const after = await epochs.state(conversationId, left.device);
        expect(after.stale).toBe(true);
        expect(after.eligible).toEqual([left.device]);

        expect(await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device], 2))).toBe(true);
        expect((await epochs.state(conversationId, left.device)).stale).toBe(false);
    });

    it('a revoked device is gone from the recipients and still present among the signers', async () =>
    {
        const { right, conversationId } = await pair();

        await devices.revoke(right.id, right.device);

        const recipients = await peers.forConversation(conversationId);
        expect(recipients.filter((row) => row.device_id === right.device)).toHaveLength(0);

        // This is the whole point of the second read. That device signed things while it was valid,
        // and a reader who cannot check those signatures has a thread whose history evaporated
        // because somebody replaced a laptop.
        const signers = await peers.signersFor(conversationId);
        const gone = signers.find((row) => row.device_id === right.device);

        expect(gone?.revoked).toBe(true);
        expect(gone?.signing_key).not.toBe('');
    });

    it('counts a sender own messages, and refuses the same number twice', async () =>
    {
        const { left, right, conversationId } = await pair();
        await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));

        const envelope = (seqNumber: number) => ({
            id: crypto.randomUUID(),
            epoch: 1,
            seq: seqNumber,
            iv: 'nonce',
            body: 'ciphertext',
            senderDeviceId: left.device,
            signature: 'signature',
            clientAt: new Date().toISOString(),
            commitment: 'a-commitment'
        });

        await chat.send(left.id, conversationId, left.device, envelope(1));
        expect((await epochs.state(conversationId, left.device)).nextSeq).toBe(2);

        await expect(chat.send(left.id, conversationId, left.device, envelope(1)))
            .rejects.toThrow(/already been used/);

        // The counter is per SENDER DEVICE, so the other member starting at one is not a collision -
        // it is the only reason two people typing at once never have to coordinate.
        await chat.send(right.id, conversationId, right.device, { ...envelope(1), senderDeviceId: right.device });
        expect((await epochs.state(conversationId, right.device)).nextSeq).toBe(2);
    });

    it('refuses a message that names a device this session is not on', async () =>
    {
        const { left, right, conversationId } = await pair();
        await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));

        await expect(chat.send(left.id, conversationId, left.device, {
            id: crypto.randomUUID(),
            epoch: 1,
            seq: 1,
            iv: 'nonce',
            body: 'ciphertext',
            senderDeviceId: right.device,
            signature: 'signature',
            clientAt: new Date().toISOString(),
            commitment: 'a-commitment'
        })).rejects.toThrow(/name the device/);
    });

    it('refuses a message sealed under an epoch nobody minted', async () =>
    {
        const { left, right, conversationId } = await pair();
        await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));

        await expect(chat.send(left.id, conversationId, left.device, {
            id: crypto.randomUUID(),
            epoch: 9,
            seq: 1,
            iv: 'nonce',
            body: 'ciphertext',
            senderDeviceId: left.device,
            signature: 'signature',
            clientAt: new Date().toISOString(),
            commitment: 'a-commitment'
        })).rejects.toThrow(/has not been minted/);
    });

    /**
     * Rotation, and the race the plan calls the riskiest thing in this whole project.
     *
     * The failure it warns about is an epoch claimed with `on conflict do nothing`: the loser
     * believes it minted, seals under a key nobody else holds, and the messages are unreadable
     * forever - with the symptom appearing days later in somebody else's client. `mint` therefore
     * lets the 23505 surface and answers `false`, and the client reads the epoch again before it
     * seals anything. These tests are that promise.
     */
    describe('rotation', () =>
    {
        it('goes stale when a second device is confirmed, and the new epoch includes it', async () =>
        {
            const { left, right, conversationId } = await pair();

            await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));
            expect((await epochs.state(conversationId, left.device)).stale).toBe(false);

            // A second device of the same account. It arrives pending, so nothing changes until
            // somebody confirms it - which is the whole point of the confirmation step.
            const second = await enrol(left.id, alice);
            expect((await epochs.state(conversationId, left.device)).stale).toBe(false);

            await devices.confirm(left.id, left.device, second);

            const after = await epochs.state(conversationId, left.device);
            expect(after.stale).toBe(true);
            expect(after.eligible.sort()).toEqual([left.device, right.device, second].sort());

            expect(await epochs.mint(left.id, conversationId, mintOf(left.device, after.eligible, 2))).toBe(true);
            expect((await epochs.state(conversationId, second)).wrapped).not.toBeNull();
        });

        it('a device that lost the race is told so, and the winner epoch is what everybody reads', async () =>
        {
            const { left, right, conversationId } = await pair();

            const winner = await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));
            expect(winner).toBe(true);

            // The loser computed the same next number from the same facts. It must not believe it
            // minted: everything it sealed under its own key would be unreadable by everybody else.
            const loser = await epochs.mint(right.id, conversationId, mintOf(right.device, [left.device, right.device]));
            expect(loser).toBe(false);

            const state = await epochs.state(conversationId, right.device);
            expect(state.epoch?.minted_by).toBe(left.device);
            expect(state.wrapped?.wrapped).toBe(`box-${ right.device }`);
        });

        it('a message sealed under the epoch that lost is refused outright', async () =>
        {
            const { left, right, conversationId } = await pair();

            await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));
            expect(await epochs.mint(right.id, conversationId, mintOf(right.device, [left.device, right.device]))).toBe(false);

            // There is exactly one epoch 1 and the loser did not write it. A message claiming epoch
            // 2 - the number the loser might have gone on to use - has nothing behind it.
            await expect(chat.send(right.id, conversationId, right.device, {
                id: crypto.randomUUID(),
                epoch: 2,
                seq: 1,
                iv: 'nonce',
                body: 'ciphertext',
                senderDeviceId: right.device,
                signature: 'signature',
                clientAt: new Date().toISOString(),
                commitment: 'a-commitment'
            })).rejects.toThrow(/has not been minted/);
        });

        it('keeps the old epoch readable while the new one is in force', async () =>
        {
            const { left, right, conversationId } = await pair();

            await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));

            const said = {
                id: crypto.randomUUID(),
                epoch: 1,
                seq: 1,
                iv: 'nonce',
                body: 'the first thing',
                senderDeviceId: left.device,
                signature: 'signature',
                clientAt: new Date().toISOString(),
                commitment: 'a-commitment'
            };

            await chat.send(left.id, conversationId, left.device, said);
            await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device], 2));

            // Rotating does not rewrite history. The old epoch, its wrapped keys and the messages
            // under it are all still there - a reader fetches that epoch by number to open them.
            const old = await epochs.state(conversationId, right.device, 1);
            expect(old.epoch?.epoch).toBe(1);
            expect(old.wrapped).not.toBeNull();

            // And an epoch read by number is never stale: it describes the room as it WAS.
            expect(old.stale).toBe(false);

            const page = await chat.messages(right.id, conversationId, null);
            expect(page.messages.map((one) => one.epoch)).toEqual([1]);
        });

        it('starts the sequence again in a new epoch, because the counter is per epoch', async () =>
        {
            const { left, right, conversationId } = await pair();

            await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));

            const envelope = (epoch: number, seqNumber: number) => ({
                id: crypto.randomUUID(),
                epoch,
                seq: seqNumber,
                iv: 'nonce',
                body: 'ciphertext',
                senderDeviceId: left.device,
                signature: 'signature',
                clientAt: new Date().toISOString(),
                commitment: 'a-commitment'
            });

            await chat.send(left.id, conversationId, left.device, envelope(1, 1));
            await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device], 2));

            expect((await epochs.state(conversationId, left.device)).nextSeq).toBe(1);
            await expect(chat.send(left.id, conversationId, left.device, envelope(2, 1))).resolves.toBeDefined();
        });

        it('a member who leaves stops being eligible, and one who joins cannot read the past', async () =>
        {
            const { left, right, conversationId } = await pair();
            const third = await makeUser(outsider);
            const theirs = await enrol(third.id, outsider);

            await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device]));

            await db.query(
                'insert into conversation_members (conversation_id, user_id) values ($1, $2)',
                [conversationId, third.id]
            );

            const joined = await epochs.state(conversationId, theirs);
            expect(joined.stale).toBe(true);
            expect(joined.eligible.sort()).toEqual([left.device, right.device, theirs].sort());

            // Joining a room does not hand you what was said before you were in it. There is no
            // wrapped key for this device in epoch 1 and nothing can make one.
            expect(joined.wrapped).toBeNull();

            await db.query(
                'delete from conversation_members where conversation_id = $1 and user_id = $2',
                [conversationId, right.id]
            );

            const afterLeaving = await epochs.state(conversationId, left.device);
            expect(afterLeaving.eligible).not.toContain(right.device);

            await expect(epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, right.device, theirs], 2)))
                .rejects.toThrow(/cannot seal to/);

            expect(await epochs.mint(left.id, conversationId, mintOf(left.device, [left.device, theirs], 2))).toBe(true);
        });
    });

    it('will not hold a text message without its envelope, or a line with one', async () =>
    {
        const { left, right, conversationId } = await pair();
        expect(right.device).not.toBe(left.device);

        // The CHECK is what makes a partly-authenticated message unrepresentable. Without it, a row
        // with a body and no signature would render as somebody's words with nothing to check.
        await expect(db.query(
            `insert into messages (conversation_id, sender_id, kind, body) values ($1, $2, 'text', 'hello')`,
            [conversationId, left.id]
        )).rejects.toThrow(/messages_text_is_sealed/);

        await expect(db.query(
            `insert into messages (conversation_id, sender_id, kind, payload, signature)
             values ($1, $2, 'system', '{"key":"chat.line.created","params":{}}'::jsonb, 'forged')`,
            [conversationId, left.id]
        )).rejects.toThrow(/messages_line_is_plain/);
    });
});
