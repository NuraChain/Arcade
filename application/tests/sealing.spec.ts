import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { recipientList } from '../../server/src/domains/chat/envelope.ts';
import { setKeyStore } from '../src/lib/device-keys.ts';
import { currentEpoch, forgetSigners } from '../src/lib/sealing.ts';
import { forgetArchive } from '../src/services/chat.source.ts';
import { createApiSource, type ChatScope } from '../src/services/chat.source.ts';
import type { Message } from '../src/data/chat.ts';
import { server, fixtureDevice } from './fake-api.ts';
import { heldKeyStore, makeDevice, TEST_ACCOUNTS, type TestDevice } from './keys.ts';

/**
 * What the browser REFUSES, which is the only half of this worth testing.
 *
 * A scheme that seals and opens its own output proves very little; `crypto.spec.ts` covers that
 * ground against the maths. This file is about the protocol: the order the checks happen in, and
 * every state where the server hands over something that does not add up. Each test below is a way
 * a hostile - or merely broken - server could get a client to seal to the wrong people or render
 * somebody's name over words they did not write.
 *
 * It drives `chat.source.ts` directly, because that is the seam where the sealing lives and the
 * store above it is deliberately unaware that any of this happens.
 */

const THREAD = 'c-sealed';

const scope: ChatScope = { me: 'alex', blocked: [] };

let mine: TestDevice;
let theirs: TestDevice;

/** A SECOND device of the same person, attested by the same wallet. A legitimate new phone. */
let theirSecond: TestDevice;

/** A device attested by somebody else's wallet entirely. What an injected device looks like. */
let stranger: TestDevice;

const said = (text: string): Message => ({
    id: '',
    conversationId: THREAD,
    from: 'alex',
    kind: 'text',
    text,
    at: 1_700_000_000_000,
    ref: null
});

/** One direct thread, both sides provable, nothing said yet. */
function arrange(options: { theirKind?: 'wallet' | 'guest' } = {}): void
{
    server.reset();
    server.me = 'alex';
    server.sealDevice = mine.id;

    server.conversations = [{
        id: THREAD,
        kind: 'direct',
        members: ['alex', 'sara.k'],
        pinned: false,
        unread: 0
    }];

    server.messages = [];
    server.epochs = {};

    server.conversationDevices = {
        [THREAD]: {
            members: [
                { accountId: 'u-alex', handle: 'alex', kind: 'wallet', address: mine.address, devices: [mine.peer] },
                {
                    accountId: 'u-sara.k',
                    handle: 'sara.k',
                    kind: options.theirKind ?? 'wallet',
                    ...(options.theirKind === 'guest' ? {} : { address: theirs.address }),
                    devices: options.theirKind === 'guest' ? [] : [theirs.peer]
                }
            ]
        }
    };

    setKeyStore(heldKeyStore(mine));
    forgetSigners();
}

beforeEach(async () =>
{
    mine ??= await makeDevice(TEST_ACCOUNTS.alex);
    theirs ??= await makeDevice(TEST_ACCOUNTS.other);
    theirSecond ??= await makeDevice(TEST_ACCOUNTS.other);
    stranger ??= await makeDevice(TEST_ACCOUNTS.third);

    arrange();
});

afterAll(() =>
{
    // Put back the store `setup.ts` installed, or whatever runs next in this file's worker inherits
    // a browser holding somebody else's device.
    setKeyStore(heldKeyStore(fixtureDevice('alex')));
});

describe('sealing a thread for the first time', () =>
{
    it('mints an epoch wrapped to every verified device, and reads its own message back', async () =>
    {
        const source = createApiSource();

        await source.post(said('one more before bed?'));

        const epoch = server.epochs[THREAD][0];
        expect(epoch.epoch).toBe(1);
        expect(epoch.recipients).toBe(recipientList([mine.id, theirs.id]));
        expect(Object.keys(epoch.keys).sort()).toEqual([mine.id, theirs.id].sort());

        const stored = server.messages[0];
        expect(stored.body).not.toContain('bed');
        expect(stored.senderDeviceId).toBe(mine.id);
        expect(stored.senderAccountId).toBe('u-alex');

        const thread = await source.thread(THREAD, scope, new AbortController().signal);
        expect(thread).toHaveLength(1);
        expect(thread[0].text).toBe('one more before bed?');
        expect(thread[0].locked).toBeUndefined();
    });

    it('refuses to seal at all when the other side has no provable device', async () =>
    {
        arrange({ theirKind: 'guest' });

        const outcome = await currentEpoch(THREAD, 'alex');

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.failure).toBe('not-sealable');
        expect(outcome.ok === false && outcome.blocked?.handle).toBe('sara.k');

        // The failure travels as data now, not as a sentence: the page that catches it maps it to
        // the one honest line for THIS reason, instead of a generic shrug that blamed nobody.
        await expect(createApiSource().post(said('hello?'))).rejects.toMatchObject({
            failure: 'not-sealable',
            blocked: { handle: 'sara.k' }
        });
        expect(server.messages).toHaveLength(0);
    });
});

describe('what the client refuses from the server', () =>
{
    it('refuses a device attested by somebody other than the member', async () =>
    {
        const source = createApiSource();
        await source.post(said('first'));

        // A device the server injected into sara.k's list. Its id hashes its keys, its enrolment
        // message names that id, and its signature recovers to the address printed beside it -
        // every check `verifyPeerDevice` makes on its own passes, because all four values came from
        // the same response. What gives it away is that the address is not the wallet sara.k signs
        // in with, and that is a value the product publishes and shows.
        server.conversationDevices[THREAD].members[1].devices.push(stranger.peer);
        forgetSigners();

        const outcome = await currentEpoch(THREAD, 'alex');

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.failure).toBe('not-sealable');
        expect(outcome.ok === false && outcome.blocked?.state).toBe('tampered');

        // One bad device condemns the whole list: the good one is not quietly used beside it.
        expect(outcome.ok === false && outcome.blocked?.devices).toEqual([]);
        expect(server.epochs[THREAD]).toHaveLength(1);
    });

    it('refuses an epoch signed for a set that does not include a device the server lists', async () =>
    {
        const source = createApiSource();
        await source.post(said('first'));

        // A server that shows the client one device list and hands it an epoch committing to
        // another. The signature is real, it simply does not cover what this client was shown.
        const epoch = server.epochs[THREAD][0];
        epoch.recipients = recipientList([mine.id, theirs.id, theirSecond.id]);
        epoch.keys[theirSecond.id] = { ephemeralKey: 'x', wrapped: 'y' };

        forgetSigners();
        server.conversationDevices[THREAD].members[1].devices.push(theirSecond.peer);

        const outcome = await currentEpoch(THREAD, 'alex');

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.failure).toBe('recipients-mismatch');
    });

    it('will not open a message signed by a device nobody in the thread vouches for', async () =>
    {
        const source = createApiSource();
        await source.post(said('mine'));

        server.messages[0].senderDeviceId = stranger.id;
        forgetSigners();

        const thread = await source.thread(THREAD, scope, new AbortController().signal);

        expect(thread[0].locked).toBe('unknown-sender');
        expect(thread[0].text).toBe('');
    });

    it('shows the author the SIGNATURE names, not the one the row claims', async () =>
    {
        const source = createApiSource();
        await source.post(said('mine'));

        // `from` is an unsigned column. Rendering it would make the name over a message the
        // server's to choose; the account uuid in the AAD is what the signature covers, and the
        // handle is resolved from that.
        server.messages[0].from = 'sara.k';
        forgetSigners();

        const thread = await source.thread(THREAD, scope, new AbortController().signal);

        expect(thread[0].locked).toBeUndefined();
        expect(thread[0].from).toBe('alex');
    });

    it('dates a message by what its sender signed, not by when the row landed', async () =>
    {
        const source = createApiSource();
        await source.post(said('on time'));

        const signed = Date.parse(server.messages[0].clientAt ?? '');

        // `at` is the server's `created_at` and is bound by nothing. The reader uses `clientAt`,
        // which is in the AAD - so re-dating a message means breaking its signature.
        server.messages[0].at = new Date(1_600_000_000_000).toISOString();
        forgetSigners();

        const thread = await source.thread(THREAD, scope, new AbortController().signal);

        expect(thread[0].locked).toBeUndefined();
        expect(thread[0].at).toBe(signed);
    });

    it('will not open a message re-attributed to another account', async () =>
    {
        const source = createApiSource();
        await source.post(said('mine'));

        // The device that signed it belongs to `u-alex`, and the row now claims somebody else.
        // Both halves are on the wire and the reader compares them.
        server.messages[0].senderAccountId = 'u-sara.k';
        forgetSigners();

        const thread = await source.thread(THREAD, scope, new AbortController().signal);
        expect(thread[0].locked).toBe('unknown-sender');
    });

    it('will not open a message whose ciphertext was edited', async () =>
    {
        const source = createApiSource();
        await source.post(said('the real thing'));

        const body = server.messages[0].body ?? '';
        server.messages[0].body = `${ body.slice(0, -2) }${ body.endsWith('AA') ? 'BB' : 'AA' }`;
        forgetSigners();

        const thread = await source.thread(THREAD, scope, new AbortController().signal);
        expect(thread[0].locked).toBe('bad-signature');
    });

    it('will not open a message re-dated after it was signed', async () =>
    {
        const source = createApiSource();
        await source.post(said('at the time'));

        server.messages[0].clientAt = new Date(1_600_000_000_000).toISOString();
        forgetSigners();

        const thread = await source.thread(THREAD, scope, new AbortController().signal);
        expect(thread[0].locked).toBe('bad-signature');
    });

    it('says no-epoch-key for an epoch this device was never a recipient of', async () =>
    {
        const source = createApiSource();
        await source.post(said('before'));

        // What a device that joined after a rotation sees: the row is there, the epoch is there,
        // and there is no wrapped key with its name on it. That is a state, not a failure.
        delete server.epochs[THREAD][0].keys[mine.id];
        forgetSigners();

        const thread = await createApiSource().thread(THREAD, scope, new AbortController().signal);
        expect(thread[0].locked).toBe('no-epoch-key');
    });
});

describe('what leaves the browser when somebody signs out', () =>
{
    it('drops every message it had decrypted, so the next account cannot search them', async () =>
    {
        const source = createApiSource();

        await source.post(said('something private'));
        await source.thread(THREAD, scope, new AbortController().signal);

        expect(source.archive(scope).map((one) => one.text)).toContain('something private');

        // Surrendering the KEYS is not enough, and that gap was real: a browser keeps what it has
        // already opened in memory, sign-out is a client-side navigation with no reload, and signing
        // in as somebody else does not replace the module holding it. The next person at the
        // keyboard signed in as themselves, opened search, and read the last person's messages
        // without needing a key at all - the plaintext outlived the keys that produced it.
        forgetArchive();

        expect(source.archive(scope)).toEqual([]);
    });

    it('will not hand one account the messages another opened', async () =>
    {
        const source = createApiSource();

        await source.post(said('for alex only'));
        await source.thread(THREAD, scope, new AbortController().signal);

        // Belt to `forgetArchive`'s braces. If a source somehow outlives the account it was filled
        // for, it answers nothing rather than handing one person's messages to another.
        expect(source.archive({ me: 'sara.k', blocked: [] })).toEqual([]);
        expect(source.archive(scope)).toHaveLength(1);
    });

    it('forgets a message that runs out while it is sitting in the archive', async () =>
    {
        const source = createApiSource();

        await source.post(said('not for long'));
        await source.thread(THREAD, scope, new AbortController().signal);

        expect(source.archive(scope)).toHaveLength(1);

        // A message that expires while it is held is never read again - the server stops returning
        // it - so nothing comes back to evict it. Filtering on the way OUT is what stops it staying
        // findable by its words for as long as the tab is open.
        server.messages[0].expiresAt = new Date(1_600_000_000_000).toISOString();
        forgetSigners();

        await source.thread(THREAD, scope, new AbortController().signal);
        expect(source.archive(scope)).toEqual([]);
    });
});

describe('rotation', () =>
{
    it('mints the next epoch when the room changes, and both are readable', async () =>
    {
        const source = createApiSource();
        await source.post(said('under one'));

        // A second device appears on the other side - a real one, attested by the same wallet. The
        // eligible set moved, so the next thing said has to be sealed to a set that includes it.
        server.conversationDevices[THREAD].members[1].devices.push(theirSecond.peer);
        forgetSigners();

        await source.post(said('under two'));

        expect(server.epochs[THREAD]).toHaveLength(2);
        expect(server.epochs[THREAD][1].recipients).toBe(recipientList([mine.id, theirs.id, theirSecond.id]));

        const thread = await source.thread(THREAD, scope, new AbortController().signal);

        expect(thread.map((one) => one.text)).toEqual(['under one', 'under two']);
        expect(thread.every((one) => one.locked === undefined)).toBe(true);
    });

    it('starts this device sequence again inside the new epoch', async () =>
    {
        const source = createApiSource();
        await source.post(said('one'));
        expect(server.messages[0].seq).toBe(1);

        server.conversationDevices[THREAD].members[1].devices.push(theirSecond.peer);
        forgetSigners();

        await source.post(said('two'));

        // Different epoch, so the counter is a different counter. Sharing one across epochs would
        // make a message's position meaningless the first time anybody rotated.
        expect(server.messages[1].epoch).toBe(2);
        expect(server.messages[1].seq).toBe(1);
    });

    it('takes up an epoch somebody else minted rather than minting a competing one', async () =>
    {
        // Exactly what the far end would have written: an epoch this client did not mint, signed
        // for the set it can see. It has to adopt it, not replace it - two clients each insisting
        // on their own key is a conversation that splits in half.
        const other = createApiSource();
        await other.post(said('theirs'));

        const first = server.epochs[THREAD][0];
        forgetSigners();

        const outcome = await currentEpoch(THREAD, 'alex');

        expect(outcome.ok).toBe(true);
        expect(server.epochs[THREAD]).toHaveLength(1);
        expect(server.epochs[THREAD][0].epoch).toBe(first.epoch);
        expect(outcome.ok === true && outcome.epoch).toBe(1);
    });
});

describe('replies, reactions and deletions, all inside the seal', () =>
{
    it('carries a reply and a forward inside the ciphertext, where the server cannot edit them', async () =>
    {
        const source = createApiSource();
        await source.post(said('first'));
        const first = server.messages[0].id;

        await source.post({ ...said('second'), reply: first, forwarded: true });

        const stored = server.messages[1];
        expect(stored.body).not.toContain(first);

        const thread = await source.thread(THREAD, scope, new AbortController().signal);
        expect(thread[1].text).toBe('second');
        expect(thread[1].reply).toBe(first);
        expect(thread[1].forwarded).toBe(true);
        expect(thread[1].plain).toContain('"reply"');
    });

    it('opens a reaction on its target, and drops one the server moved onto another message', async () =>
    {
        const source = createApiSource();
        await source.post(said('one'));
        await source.post(said('two'));
        const [one, two] = server.messages;

        await source.react(THREAD, 'alex', one.id, '👍', 1_700_000_000_500, 0);

        const reacted = await source.thread(THREAD, scope, new AbortController().signal);
        expect(reacted[0].reactions).toEqual([{ id: expect.any(String), from: 'alex', emoji: '👍' }]);

        const moved = one.reactions!.map((reaction) => ({ ...reaction, target: two.id }));
        one.reactions = [];
        two.reactions = moved;
        forgetSigners();

        const after = await source.thread(THREAD, scope, new AbortController().signal);
        expect(after[0].reactions).toBeUndefined();
        expect(after[1].reactions).toBeUndefined();
    });

    it('turns a deleted message into a tombstone and drops its words from the archive', async () =>
    {
        const source = createApiSource();
        await source.post(said('regrettable'));
        const id = server.messages[0].id;

        await source.thread(THREAD, scope, new AbortController().signal);
        expect(source.archive(scope).map((message) => message.text)).toContain('regrettable');

        await source.remove(THREAD, id);

        const thread = await source.thread(THREAD, scope, new AbortController().signal);
        expect(thread.map((message) => message.kind)).toEqual(['deleted']);
        expect(source.archive(scope).map((message) => message.text)).not.toContain('regrettable');
    });
});
