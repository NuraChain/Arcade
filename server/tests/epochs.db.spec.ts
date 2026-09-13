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
import { epochCommitment } from '../src/domains/chat/envelope.ts';
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

async function keypair(): Promise<{ id: string; exchangeKey: string; signingKey: string; privateSigning: CryptoKey }>
{
    const exchange = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;

    const exchangeKey = b64url(await webcrypto.subtle.exportKey('spki', exchange.publicKey));
    const signingKey = b64url(await webcrypto.subtle.exportKey('spki', signing.publicKey));

    return { id: deviceIdFrom(exchangeKey, signingKey), exchangeKey, signingKey, privateSigning: signing.privateKey };
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
        id: keys.id,
        exchangeKey: keys.exchangeKey,
        signingKey: keys.signingKey,
        nonce,
        signature,
        label: 'Laptop',
        userAgent: ''
    });

    signers.set(row.id, keys.privateSigning);
    return row.id;
}

/** A recipient entry. The bytes are not real wraps - this suite is about the rules, not the maths. */
const wrapFor = (deviceId: string) => ({ deviceId, ephemeralKey: `eph-${ deviceId }`, wrapped: `box-${ deviceId }` });

/**
 * The device keypairs, kept so a mint can be SIGNED.
 *
 * The server verifies the commitment now, so a fixture that made one up would be testing the
 * refusal path on every call. `enrol` records the signing key it generated here.
 */
const signers = new Map<string, CryptoKey>();

const CONFIRMATION = 'the-key-check-value';

/** A mint, signed by the minting device the way a real client signs one. */
async function mintOf(mintedBy: string, recipients: string[], epoch = 1)
{
    const commitment = epochCommitment({
        conversationId: currentConversation,
        epoch,
        minterDeviceId: mintedBy,
        recipients,
        confirmation: CONFIRMATION
    });

    const key = signers.get(mintedBy);

    const signature = key === undefined
        ? 'not-a-signature'
        : b64url(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(commitment, 'utf8')));

    return { epoch, mintedBy, recipients, signature, confirmation: CONFIRMATION, keys: recipients.map(wrapFor) };
}

/** Which conversation the next `mintOf` is for. Set by `pair()`; the commitment binds it. */
let currentConversation = '';

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
        signers.clear();
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

        const made = {
            left: { ...one, device: await enrol(one.id, alice) },
            right: { ...two, device: await enrol(two.id, bob) },
            conversationId: await chat.openDirect(one.id, two.id)
        };

        currentConversation = made.conversationId;
        return made;
    };

    it('wraps to both members and says the epoch is no longer stale', async () =>
    {
        const { left, right, conversationId } = await pair();

        const before = await epochs.state(conversationId, left.device);
        expect(before.epoch).toBeNull();
        expect(before.stale).toBe(true);
        expect(before.eligible.sort()).toEqual([left.device, right.device].sort());

        expect(await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]))).toBe(true);

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
        await expect(epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device, theirs])))
            .rejects.toThrow(/cannot seal to/);
    });

    it('refuses a recipient list with a key missing, and one with a key too many', async () =>
    {
        const { left, right, conversationId } = await pair();

        const short = await mintOf(left.device, [left.device, right.device]);
        short.keys = [wrapFor(left.device)];

        // An epoch row whose keys do not cover its recipients is an epoch somebody cannot open, and
        // it would take the conversation with it: every later sender seals under a key they do not
        // hold.
        await expect(epochs.mint(left.id, conversationId, short)).rejects.toThrow(/exactly one wrapped key/);

        const long = await mintOf(left.device, [left.device]);
        long.keys = [wrapFor(left.device), wrapFor(right.device)];

        await expect(epochs.mint(left.id, conversationId, long)).rejects.toThrow(/exactly one wrapped key/);
    });

    it('refuses a device that is not the minter own', async () =>
    {
        const { left, right, conversationId } = await pair();

        await expect(epochs.mint(left.id, conversationId, await mintOf(right.device, [left.device, right.device])))
            .rejects.toThrow(/cannot mint/);
    });

    it('refuses an epoch whose commitment is not signed by the device that claims to have minted it', async () =>
    {
        const { left, right, conversationId } = await pair();

        const real = await mintOf(left.device, [left.device, right.device]);

        // A string where a signature should be. Without this check, any member could write one and
        // every other member's `adopt` would fail forever with no way to mint past it - one request
        // wedging a room's key schedule permanently.
        await expect(epochs.mint(left.id, conversationId, { ...real, signature: 'not-a-signature' }))
            .rejects.toThrow(/not signed by the device/);

        // A real signature, over a DIFFERENT commitment. The server cannot judge whether a recipient
        // set is right, but it can tell that this signature is not about this epoch.
        const elsewhere = await mintOf(left.device, [left.device, right.device], 7);

        await expect(epochs.mint(left.id, conversationId, { ...real, signature: elsewhere.signature }))
            .rejects.toThrow(/not signed by the device/);

        // And the honest one still lands.
        expect(await epochs.mint(left.id, conversationId, real)).toBe(true);
    });

    it('refuses an epoch number the column cannot hold', async () =>
    {
        const { left, right, conversationId } = await pair();

        // 2147483647 is the top of `integer`. Accepting it means the NEXT mint raises 22003 rather
        // than the 23505 the race handler catches, and the route 500s with no way forward.
        const huge = await mintOf(left.device, [left.device, right.device], 2_147_483_647);
        await expect(epochs.mint(left.id, conversationId, huge)).rejects.toThrow(/not an epoch number/);

        const zero = await mintOf(left.device, [left.device, right.device], 0);
        await expect(epochs.mint(left.id, conversationId, zero)).rejects.toThrow(/not an epoch number/);
    });

    it('gives the epoch to exactly one of two devices that claim it at once', async () =>
    {
        const { left, right, conversationId } = await pair();

        const results = await Promise.all([
            epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device])),
            epochs.mint(right.id, conversationId, await mintOf(right.device, [left.device, right.device]))
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

        await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));
        expect((await epochs.state(conversationId, left.device)).stale).toBe(false);

        await devices.revoke(right.id, right.device);

        // Rotation is client-driven and server-detected. This server holds no key it could re-wrap
        // with, so all it can do is say the set no longer describes the room.
        const after = await epochs.state(conversationId, left.device);
        expect(after.stale).toBe(true);
        expect(after.eligible).toEqual([left.device]);

        expect(await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device], 2))).toBe(true);
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
        await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

        const envelope = (seqNumber: number) => ({
            id: crypto.randomUUID(),
            epoch: 1,
            seq: seqNumber,
            iv: 'nonce',
            body: 'ciphertext',
            senderDeviceId: left.device,
            signature: 'signature',
            clientAt: new Date().toISOString(),
            commitment: 'a-commitment',
            expiresAt: 0
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
        await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

        // Another account's device entirely. The session check was narrowed to ownership - a
        // browser that signed out and back in has no session device and must still be able to send -
        // so what refuses this is that the device is not this account's to seal with.
        await expect(chat.send(left.id, conversationId, left.device, {
            id: crypto.randomUUID(),
            epoch: 1,
            seq: 1,
            iv: 'nonce',
            body: 'ciphertext',
            senderDeviceId: right.device,
            signature: 'signature',
            clientAt: new Date().toISOString(),
            commitment: 'a-commitment',
            expiresAt: 0
        })).rejects.toThrow(/not a device this account can seal with/);
    });

    it('refuses a message sealed under an epoch nobody minted', async () =>
    {
        const { left, right, conversationId } = await pair();
        await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

        await expect(chat.send(left.id, conversationId, left.device, {
            id: crypto.randomUUID(),
            epoch: 9,
            seq: 1,
            iv: 'nonce',
            body: 'ciphertext',
            senderDeviceId: left.device,
            signature: 'signature',
            clientAt: new Date().toISOString(),
            commitment: 'a-commitment',
            expiresAt: 0
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

            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));
            expect((await epochs.state(conversationId, left.device)).stale).toBe(false);

            // A second device of the same account. It arrives pending, so nothing changes until
            // somebody confirms it - which is the whole point of the confirmation step.
            const second = await enrol(left.id, alice);
            expect((await epochs.state(conversationId, left.device)).stale).toBe(false);

            await devices.confirm(left.id, left.device, second);

            const after = await epochs.state(conversationId, left.device);
            expect(after.stale).toBe(true);
            expect(after.eligible.sort()).toEqual([left.device, right.device, second].sort());

            expect(await epochs.mint(left.id, conversationId, await mintOf(left.device, after.eligible, 2))).toBe(true);
            expect((await epochs.state(conversationId, second)).wrapped).not.toBeNull();
        });

        it('a device that lost the race is told so, and the winner epoch is what everybody reads', async () =>
        {
            const { left, right, conversationId } = await pair();

            const winner = await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));
            expect(winner).toBe(true);

            // The loser computed the same next number from the same facts. It must not believe it
            // minted: everything it sealed under its own key would be unreadable by everybody else.
            const loser = await epochs.mint(right.id, conversationId, await mintOf(right.device, [left.device, right.device]));
            expect(loser).toBe(false);

            const state = await epochs.state(conversationId, right.device);
            expect(state.epoch?.minted_by).toBe(left.device);
            expect(state.wrapped?.wrapped).toBe(`box-${ right.device }`);
        });

        it('a message sealed under the epoch that lost is refused outright', async () =>
        {
            const { left, right, conversationId } = await pair();

            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));
            expect(await epochs.mint(right.id, conversationId, await mintOf(right.device, [left.device, right.device]))).toBe(false);

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
                commitment: 'a-commitment',
                expiresAt: 0
            })).rejects.toThrow(/has not been minted/);
        });

        it('keeps the old epoch readable while the new one is in force', async () =>
        {
            const { left, right, conversationId } = await pair();

            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

            const said = {
                id: crypto.randomUUID(),
                epoch: 1,
                seq: 1,
                iv: 'nonce',
                body: 'the first thing',
                senderDeviceId: left.device,
                signature: 'signature',
                clientAt: new Date().toISOString(),
                commitment: 'a-commitment',
                expiresAt: 0
            };

            await chat.send(left.id, conversationId, left.device, said);
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device], 2));

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

            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

            const envelope = (epoch: number, seqNumber: number) => ({
                id: crypto.randomUUID(),
                epoch,
                seq: seqNumber,
                iv: 'nonce',
                body: 'ciphertext',
                senderDeviceId: left.device,
                signature: 'signature',
                clientAt: new Date().toISOString(),
                commitment: 'a-commitment',
                expiresAt: 0
            });

            await chat.send(left.id, conversationId, left.device, envelope(1, 1));
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device], 2));

            expect((await epochs.state(conversationId, left.device)).nextSeq).toBe(1);
            await expect(chat.send(left.id, conversationId, left.device, envelope(2, 1))).resolves.toBeDefined();
        });

        it('a member who leaves stops being eligible, and one who joins cannot read the past', async () =>
        {
            const { left, right, conversationId } = await pair();
            const third = await makeUser(outsider);
            const theirs = await enrol(third.id, outsider);

            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

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

            await expect(epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device, theirs], 2)))
                .rejects.toThrow(/cannot seal to/);

            expect(await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, theirs], 2))).toBe(true);
        });
    });

    /**
     * Disappearing messages, which are a promise about STORAGE and nothing more.
     *
     * The expiry arrives signed in the envelope and is written down here, so this server can delete
     * the row on time and cannot give a message a longer life than its sender asked for. What it
     * cannot do is un-say anything - somebody who read a message keeps it - and the copy in the
     * product says exactly that rather than implying the words are recallable.
     */
    describe('expiry', () =>
    {
        /** An hour, which is what these rooms agree to. */
        const HOUR = 3600;

        /**
         * A message whose signed expiry is the one the ROOM agreed to.
         *
         * The server refuses anything else now, which is what stops a sender choosing their own
         * lifetime - so a test that wants an already-expired message has to back-date the message
         * rather than shorten it, exactly as a real client sending an hour ago would have.
         */
        const envelope = (device: string, seqNumber: number, sentMinutesAgo: number) =>
        {
            const clientAt = Date.now() - sentMinutesAgo * 60_000;

            return {
                id: crypto.randomUUID(),
                epoch: 1,
                seq: seqNumber,
                iv: 'nonce',
                body: 'ciphertext',
                senderDeviceId: device,
                signature: 'signature',
                clientAt: new Date(clientAt).toISOString(),
                commitment: 'a-commitment',
                expiresAt: clientAt + HOUR * 1000
            };
        };

        /** The same, in a room with expiry off: nothing expires and the envelope has to say so. */
        const permanent = (device: string, seqNumber: number) => ({
            id: crypto.randomUUID(),
            epoch: 1,
            seq: seqNumber,
            iv: 'nonce',
            body: 'ciphertext',
            senderDeviceId: device,
            signature: 'signature',
            clientAt: new Date().toISOString(),
            commitment: 'a-commitment',
            expiresAt: 0
        });

        it('is a property of the room, settable by anybody in it', async () =>
        {
            const { left, right, conversationId } = await pair();

            expect(await chat.setExpiry(left.id, conversationId, 3600)).toBe(3600);
            expect((await chat.list(right.id))[0].expire_after).toBe(3600);

            // The other member can change it too. It describes the room, not whoever opened it.
            expect(await chat.setExpiry(right.id, conversationId, null)).toBeNull();
            expect((await chat.list(left.id))[0].expire_after).toBeNull();
        });

        it('refuses a length of time nobody means to choose', async () =>
        {
            const { left, conversationId } = await pair();

            // Zero is what an off-by-one in a picker produces, and it means "vanishes before it is
            // read". Off is expressed by null, which is a different thing and says so.
            await expect(chat.setExpiry(left.id, conversationId, 0)).rejects.toThrow(/length of time/);
            await expect(chat.setExpiry(left.id, conversationId, 30)).rejects.toThrow(/length of time/);
        });

        it('refuses a message that does not last as long as the room agreed', async () =>
        {
            const { left, right, conversationId } = await pair();
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

            // Expiry off. A sender who signs a short life for their own words would otherwise be
            // choosing it for themselves - and words that are gone before anybody can report them
            // take the frank with them when the row is swept.
            await expect(chat.send(left.id, conversationId, left.device, envelope(left.device, 1, 0)))
                .rejects.toThrow(/how long a message in this conversation lasts/);

            await chat.setExpiry(left.id, conversationId, HOUR);

            // And the other way: expiry on, and a sender claiming their message lasts forever.
            await expect(chat.send(left.id, conversationId, left.device, permanent(left.device, 1)))
                .rejects.toThrow(/how long a message in this conversation lasts/);
        });

        it('hides a message once its moment passes, before the sweep runs', async () =>
        {
            const { left, right, conversationId } = await pair();
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));
            await chat.setExpiry(left.id, conversationId, HOUR);

            await chat.send(left.id, conversationId, left.device, envelope(left.device, 1, 90));
            await chat.send(left.id, conversationId, left.device, envelope(left.device, 2, 0));

            // Both rows are still there - the sweep has not run - and the read filters anyway. A
            // reader must never see a message in the window between its moment and the next pass.
            const page = await chat.messages(right.id, conversationId, null);
            expect(page.messages).toHaveLength(1);
            expect(page.messages[0].seq).toBe('2');
        });

        it('sweeps what has run out and leaves the rest', async () =>
        {
            const { left, right, conversationId } = await pair();
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

            await chat.setExpiry(left.id, conversationId, HOUR);

            await chat.send(left.id, conversationId, left.device, envelope(left.device, 1, 90));
            await chat.send(left.id, conversationId, left.device, envelope(left.device, 2, 0));

            expect(await chat.sweepExpired()).toBe(1);

            // The expiry line `setExpiry` writes is a server-authored message and never expires, so
            // what is left is the live sealed one and that line.
            const rows = await db.query(
                `select count(*)::int as n from messages where conversation_id = $1 and kind = 'text'`,
                [conversationId]
            );
            expect(rowsOf<{ n: number }>(rows)[0].n).toBe(1);

            // Idempotent: the second pass has nothing left to take.
            expect(await chat.sweepExpired()).toBe(0);
        });

        it('sweeps a message that has already been reported, and keeps the disclosure', async () =>
        {
            const { left, right, conversationId } = await pair();
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

            await chat.setExpiry(left.id, conversationId, HOUR);

            const said = envelope(left.device, 1, 90);
            await chat.send(left.id, conversationId, left.device, said);

            await db.query(
                `insert into reports (reporter, against, category, message_id, disclosed, disclosed_key, disclosed_at)
                 values ($1, $2, 'harassment', $3, 'what was said', 'the-key', now())`,
                [right.id, left.id, said.id]
            );

            // The FIRST reported disappearing message used to wedge the sweep for the whole
            // deployment: the delete nulled `message_id`, the all-or-none CHECK refused the row, and
            // the statement raised 23514 every minute forever - so nothing expired again, anywhere.
            expect(await chat.sweepExpired()).toBe(1);

            // The disclosure outlives the message, which is the point: expiry must not become a way
            // to destroy the evidence in a report already filed.
            const rows = await db.query('select message_id, disclosed from reports where reporter = $1', [right.id]);
            const report = rowsOf<{ message_id: string | null; disclosed: string }>(rows)[0];

            expect(report.message_id).toBeNull();
            expect(report.disclosed).toBe('what was said');
        });

        it('cannot be reported once it is gone', async () =>
        {
            const { left, right, conversationId } = await pair();
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

            await chat.setExpiry(left.id, conversationId, HOUR);

            const said = envelope(left.device, 1, 90);
            await chat.send(left.id, conversationId, left.device, said);

            // A message that has run out is not a message a report can disclose. Franking proves
            // what was said; it does not resurrect something both sides agreed would be deleted.
            expect(await chat.frankedMessage(conversationId, said.id)).toBeNull();
        });

        it('does not reach back when the room setting changes', async () =>
        {
            const { left, right, conversationId } = await pair();
            await epochs.mint(left.id, conversationId, await mintOf(left.device, [left.device, right.device]));

            await chat.send(left.id, conversationId, left.device, permanent(left.device, 1));
            await chat.setExpiry(left.id, conversationId, HOUR);

            // The message was sealed with its own expiry signed into it. Turning the setting on
            // afterwards changes what is said NEXT and cannot shorten what was already said.
            const page = await chat.messages(right.id, conversationId, null);
            expect(page.messages).toHaveLength(1);
            expect(page.messages[0].expires_at).toBeNull();
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
