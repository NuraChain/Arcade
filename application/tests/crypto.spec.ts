import { describe, it, expect } from 'vitest';

import { messageAad, type MessageAad } from '../../server/src/domains/chat/envelope.ts';
import {
    checkConfirmation,
    commitmentOf,
    confirmationOf,
    mintEpochKey,
    mintFrankingKey,
    openText,
    sealText,
    signRecipients,
    unwrapEpochKey,
    verifyRecipients,
    wrapEpochKey
} from '../src/lib/crypto.ts';
import { makeDevice, TEST_ACCOUNTS, type TestDevice } from './keys.ts';

/**
 * The maths of `nura-e2ee/v1`, exercised against itself.
 *
 * Every "refuses" test below is an attack this format exists to stop, written as the thing a
 * hostile server would actually do with the row it is holding: re-date a message, re-attribute it,
 * move it into another conversation, swap the ciphertext, add a device to the recipient list. The
 * positive tests are worth much less than these - a scheme that seals and opens its own output is
 * the easy half.
 *
 * The devices are real: real P-256 keypairs, non-extractable, and a real wallet signature over a
 * real EIP-4361 message. Nothing here is stubbed, because a stub would only prove this file agrees
 * with itself.
 */

const conversation = 'c-1a2b3c';

let alice: TestDevice;
let bob: TestDevice;
let mallory: TestDevice;

const devices = async (): Promise<void> =>
{
    alice ??= await makeDevice(TEST_ACCOUNTS.alex);
    bob ??= await makeDevice(TEST_ACCOUNTS.other);
    mallory ??= await makeDevice(TEST_ACCOUNTS.third);
};

/**
 * Commits to the words about to be sealed.
 *
 * The commitment is in the AAD, so it has to be computed BEFORE the seal and has to cover the text
 * that seal contains - a stale one is exactly the malformed message `openText` is meant to refuse,
 * and every test below would fail for that reason rather than its own.
 */
const commitTo = async (text: string): Promise<void> =>
{
    commitment = await commitmentOf(FRANK, text);
};

/**
 * One franking key for the suite, minted the way a real send mints one.
 *
 * Fixed within a run so a commitment made before sealing still covers the message afterwards, and a
 * REAL key rather than a readable string: the key is carried in the first 32 bytes of the plaintext
 * and read back out by length, so anything shorter is silently mixed with the words. That is not a
 * hypothetical - it is what this constant was on the first attempt, and every open failed as
 * `tampered` with nothing pointing at the length.
 */
const FRANK = mintFrankingKey();

let commitment: string;

const aadFor = (overrides: Partial<MessageAad> = {}): MessageAad => ({
    conversationId: conversation,
    epoch: 1,
    seq: 1,
    messageId: '3f1c4a2e-0000-4000-8000-000000000001',
    senderAccountId: 'u-alex',
    senderDeviceId: alice.id,
    kind: 'text',
    clientAt: 1_700_000_000_000,
    commitment,
    expiresAt: 0,
    ...overrides
});

describe('wrapping an epoch key', () =>
{
    it('the recipient can open it and nobody else can', async () =>
    {
        await devices();

        const key = mintEpochKey();
        const wrap = await wrapEpochKey(key, conversation, 1, bob);

        expect(await unwrapEpochKey(bob.secrets, bob.id, conversation, 1, wrap))
            .toEqual(key);

        // Mallory holds a perfectly good private key. It is simply not the one this was addressed
        // to, and the derived secret is therefore a different secret.
        expect(await unwrapEpochKey(mallory.secrets, bob.id, conversation, 1, wrap)).toBeNull();
    });

    it('refuses a wrap replayed into a different epoch', async () =>
    {
        await devices();

        const key = mintEpochKey();
        const wrap = await wrapEpochKey(key, conversation, 4, bob);

        // The derivation binds the epoch, so a server that moved this wrap from epoch 4 to epoch 5
        // - to roll a conversation back onto a key somebody's revoked device still holds - produces
        // something the recipient cannot open at all.
        expect(await unwrapEpochKey(bob.secrets, bob.id, conversation, 5, wrap)).toBeNull();
    });

    it('refuses a wrap replayed into a different conversation', async () =>
    {
        await devices();

        const key = mintEpochKey();
        const wrap = await wrapEpochKey(key, conversation, 1, bob);

        expect(await unwrapEpochKey(bob.secrets, bob.id, 'c-somewhere-else', 1, wrap)).toBeNull();
    });
});

describe('the key check value', () =>
{
    it('accepts the key it was made with and refuses any other', async () =>
    {
        const key = mintEpochKey();
        const other = mintEpochKey();

        const confirmation = await confirmationOf(key, conversation, 1);

        expect(await checkConfirmation(key, conversation, 1, confirmation)).toBe(true);
        expect(await checkConfirmation(other, conversation, 1, confirmation)).toBe(false);
    });

    it('is bound to its own conversation and epoch', async () =>
    {
        const key = mintEpochKey();
        const confirmation = await confirmationOf(key, conversation, 1);

        expect(await checkConfirmation(key, conversation, 2, confirmation)).toBe(false);
        expect(await checkConfirmation(key, 'c-elsewhere', 1, confirmation)).toBe(false);
    });
});

describe('sealing a message', () =>
{
    it('opens back into what was typed', async () =>
    {
        await devices();

        const key = mintEpochKey();

        await commitTo('شب‌بخیر — یک دست دیگر؟');

        const aad = aadFor();
        const sealed = await sealText(key, alice.secrets, aad, 'شب‌بخیر — یک دست دیگر؟', FRANK);

        expect(sealed.body).not.toContain('شب');

        // The franking key comes back with the words, because whoever can read a message is whoever
        // can report it. The server holds only the commitment and can do neither.
        expect(await openText(key, alice.signingKey, aad, sealed))
            .toEqual({ text: 'شب‌بخیر — یک دست دیگر؟', frankingKey: FRANK });
    });

    it('refuses a message re-dated after it was written', async () =>
    {
        await devices();

        const key = mintEpochKey();
        await commitTo('on my way');
        const sealed = await sealText(key, alice.secrets, aadFor(), 'on my way', FRANK);

        const moved = await openText(key, alice.signingKey, aadFor({ clientAt: 1_600_000_000_000 }), sealed);

        expect(moved).toEqual({ failure: 'bad-signature' });
    });

    it('refuses a message re-attributed to another account', async () =>
    {
        await devices();

        const key = mintEpochKey();
        await commitTo('that was me');
        const sealed = await sealText(key, alice.secrets, aadFor(), 'that was me', FRANK);

        expect(await openText(key, alice.signingKey, aadFor({ senderAccountId: 'u-someone' }), sealed))
            .toEqual({ failure: 'bad-signature' });
    });

    it('refuses a message moved into another conversation', async () =>
    {
        await devices();

        const key = mintEpochKey();
        await commitTo('see you there');
        const sealed = await sealText(key, alice.secrets, aadFor(), 'see you there', FRANK);

        expect(await openText(key, alice.signingKey, aadFor({ conversationId: 'c-elsewhere' }), sealed))
            .toEqual({ failure: 'bad-signature' });
    });

    it('refuses a message relabelled as a line the server authored', async () =>
    {
        await devices();

        const key = mintEpochKey();
        await commitTo('nothing to see');
        const sealed = await sealText(key, alice.secrets, aadFor(), 'nothing to see', FRANK);

        expect(await openText(key, alice.signingKey, aadFor({ kind: 'system' }), sealed))
            .toEqual({ failure: 'bad-signature' });
    });

    it('refuses a signature from another device of the conversation', async () =>
    {
        await devices();

        const key = mintEpochKey();

        // Bob holds the epoch key too - that is what an epoch key IS - so encryption alone would
        // say only "somebody in this room wrote this". The per-message signature is what makes the
        // difference between that and "alice wrote this".
        await commitTo('alice would never say this');
        const forged = await sealText(key, bob.secrets, aadFor(), 'alice would never say this', FRANK);

        expect(await openText(key, alice.signingKey, aadFor(), forged))
            .toEqual({ failure: 'bad-signature' });
    });

    it('refuses ciphertext that was edited', async () =>
    {
        await devices();

        const key = mintEpochKey();
        await commitTo('yes');
        const sealed = await sealText(key, alice.secrets, aadFor(), 'yes', FRANK);

        const flipped = `${ sealed.body.slice(0, -2) }${ sealed.body.endsWith('AA') ? 'BB' : 'AA' }`;

        expect(await openText(key, alice.signingKey, aadFor(), { ...sealed, body: flipped }))
            .toEqual({ failure: 'bad-signature' });
    });

    it('says no-key rather than bad-signature when the key is simply the wrong one', async () =>
    {
        await devices();

        const key = mintEpochKey();
        const other = mintEpochKey();
        await commitTo('later');
        const sealed = await sealText(key, alice.secrets, aadFor(), 'later', FRANK);

        // The signature still checks out: this message is exactly what its sender wrote. What is
        // wrong is that this device is holding a different epoch's key, and the product has to be
        // able to say which of those two things happened.
        expect(await openText(other, alice.signingKey, aadFor(), sealed))
            .toEqual({ failure: 'no-key' });
    });

    it('the AAD is the same string on both sides of the wire', () =>
    {
        const aad = {
            conversationId: 'c-1',
            epoch: 2,
            seq: 3,
            messageId: 'm-4',
            senderAccountId: 'u-5',
            senderDeviceId: 'd-6',
            kind: 'text',
            clientAt: 7,
            commitment: 'c-8',
            expiresAt: 9
        };

        // Field order is part of the format. A reordering here would verify against nothing, and
        // the symptom would be every message on earth failing with no error that named the cause.
        expect(messageAad(aad).split(String.fromCharCode(0x1f)))
            .toEqual(['nura-e2ee/v1', 'msg', 'c-1', '2', '3', 'm-4', 'u-5', 'd-6', 'text', '7', 'c-8', '9']);
    });
});

describe('the recipient commitment', () =>
{
    const KCV = 'a-key-check-value';

    it('verifies for the set that was signed and for no other', async () =>
    {
        await devices();

        const recipients = [alice.id, bob.id].sort();
        const signature = await signRecipients(alice.secrets, conversation, 1, alice.id, recipients, KCV);

        expect(await verifyRecipients(alice, conversation, 1, recipients, KCV, signature)).toBe(true);

        // A server that wrapped its own device in beside the real ones.
        expect(await verifyRecipients(alice, conversation, 1, [...recipients, mallory.id].sort(), KCV, signature))
            .toBe(false);

        // A server that withheld a device, to keep somebody out of their own conversation.
        expect(await verifyRecipients(alice, conversation, 1, [alice.id], KCV, signature)).toBe(false);
    });

    it('refuses an epoch whose KEY is not the one the minter vouched for', async () =>
    {
        await devices();

        const recipients = [alice.id, bob.id].sort();
        const signature = await signRecipients(alice.secrets, conversation, 1, alice.id, recipients, KCV);

        // This is the break the commitment shipped without. Every input to a wrap and to a key check
        // value is public, so a server can mint its own key, wrap it to one targeted recipient and
        // compute a matching tag - leaving the genuine recipient signature untouched. Before the
        // confirmation was signed, that recipient verified a real signature over a real set,
        // unwrapped the server's key, checked it against the server's own tag, and sealed everything
        // it typed under a key the server had chosen.
        expect(await verifyRecipients(alice, conversation, 1, recipients, 'a-tag-the-server-made', signature))
            .toBe(false);
    });

    it('does not carry from one epoch or one conversation to another', async () =>
    {
        await devices();

        const recipients = [alice.id, bob.id].sort();
        const signature = await signRecipients(alice.secrets, conversation, 1, alice.id, recipients, KCV);

        expect(await verifyRecipients(alice, conversation, 2, recipients, KCV, signature)).toBe(false);
        expect(await verifyRecipients(alice, 'c-elsewhere', 1, recipients, KCV, signature)).toBe(false);
    });

    it('cannot be attributed to a device that did not make it', async () =>
    {
        await devices();

        const recipients = [alice.id, bob.id].sort();
        const signature = await signRecipients(alice.secrets, conversation, 1, alice.id, recipients, KCV);

        expect(await verifyRecipients(mallory, conversation, 1, recipients, KCV, signature)).toBe(false);
    });

    it('the ORDER of the recipients does not change the commitment', async () =>
    {
        await devices();

        const signature = await signRecipients(alice.secrets, conversation, 1, alice.id, [bob.id, alice.id], KCV);

        // Two honest clients holding one set must produce one string, or half of them would refuse
        // an epoch that is perfectly correct.
        expect(await verifyRecipients(alice, conversation, 1, [alice.id, bob.id], KCV, signature)).toBe(true);
    });
});
