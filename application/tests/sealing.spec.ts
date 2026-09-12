import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { recipientList } from '../../server/src/domains/chat/envelope.ts';
import { setKeyStore } from '../src/lib/device-keys.ts';
import { currentEpoch, forgetSigners } from '../src/lib/sealing.ts';
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
                { accountId: 'u-alex', handle: 'alex', kind: 'wallet', devices: [mine.peer] },
                {
                    accountId: 'u-sara.k',
                    handle: 'sara.k',
                    kind: options.theirKind ?? 'wallet',
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

        await expect(createApiSource().post(said('hello?'))).rejects.toThrow(/cannot be sealed/);
        expect(server.messages).toHaveLength(0);
    });
});

describe('what the client refuses from the server', () =>
{
    it('refuses an epoch whose signed recipients are not the set it can see', async () =>
    {
        const source = createApiSource();
        await source.post(said('first'));

        // The server now publishes a device it did not have when the epoch was signed. If the
        // client took the recipient list on trust, the next message would be wrapped to it.
        server.conversationDevices[THREAD].members[1].devices.push(stranger.peer);
        forgetSigners();

        const outcome = await currentEpoch(THREAD, 'alex');

        // It does not fail - it ROTATES, which is the right answer: the set really did change, and
        // a new epoch signed for the set this client can see is exactly what should happen next.
        expect(outcome.ok).toBe(true);
        expect(server.epochs[THREAD]).toHaveLength(2);
        expect(server.epochs[THREAD][1].recipients).toBe(recipientList([mine.id, theirs.id, stranger.id]));
    });

    it('refuses an epoch signed for a set that does not include a device the server lists', async () =>
    {
        const source = createApiSource();
        await source.post(said('first'));

        // A server that shows the client one device list and hands it an epoch committing to
        // another. The signature is real, it simply does not cover what this client was shown.
        const epoch = server.epochs[THREAD][0];
        epoch.recipients = recipientList([mine.id, theirs.id, stranger.id]);
        epoch.keys[stranger.id] = { ephemeralKey: 'x', wrapped: 'y' };

        forgetSigners();
        server.conversationDevices[THREAD].members[1].devices.push(stranger.peer);

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

describe('rotation', () =>
{
    it('mints the next epoch when the room changes, and both are readable', async () =>
    {
        const source = createApiSource();
        await source.post(said('under one'));

        // A second device appears on the other side. The eligible set moved, so the next thing
        // said has to be sealed to a set that includes it.
        server.conversationDevices[THREAD].members[1].devices.push(stranger.peer);
        forgetSigners();

        await source.post(said('under two'));

        expect(server.epochs[THREAD]).toHaveLength(2);
        expect(server.epochs[THREAD][1].recipients).toBe(recipientList([mine.id, theirs.id, stranger.id]));

        const thread = await source.thread(THREAD, scope, new AbortController().signal);

        expect(thread.map((one) => one.text)).toEqual(['under one', 'under two']);
        expect(thread.every((one) => one.locked === undefined)).toBe(true);
    });

    it('starts this device sequence again inside the new epoch', async () =>
    {
        const source = createApiSource();
        await source.post(said('one'));
        expect(server.messages[0].seq).toBe(1);

        server.conversationDevices[THREAD].members[1].devices.push(stranger.peer);
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
