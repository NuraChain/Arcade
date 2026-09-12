import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { frankContext } from '../src/domains/chat/envelope.ts';
import { createFranking, discloses } from '../src/domains/chat/franking.ts';

/**
 * Franking, as the server performs it.
 *
 * This needs no database: it is a MAC and a comparison, and the interesting claims are all about
 * what the MAC refuses. Everything here is a way somebody could abuse the report button on a
 * product whose server cannot read a conversation - fabricating a message, editing one before
 * showing it, or lifting a real one into a context it never appeared in.
 *
 * The stakes are worth stating plainly. Without franking, "they sent me this" is an assertion
 * anybody can make about anybody, and moderation has no way to tell. A report button backed by
 * nothing is not a safety feature; it is a weapon handed to whoever is most willing to lie.
 */

const franking = createFranking('a-development-session-secret');

const context = {
    conversationId: 'c-1',
    messageId: 'm-1',
    senderAccountId: 'u-sender',
    senderDeviceId: 'd-sender',
    clientAt: 1_700_000_000_000,
    commitment: 'the-commitment'
};

describe('the server frank', () =>
{
    it('holds for the context it was made over', () =>
    {
        expect(franking.holds(context, franking.frank(context))).toBe(true);
    });

    it('does not carry to another message, sender, device, conversation or time', () =>
    {
        const frank = franking.frank(context);

        // Each of these is a real thing a hostile reporter would try: showing a message that was
        // said somewhere else, or by somebody else, or at another time, and claiming it as this one.
        expect(franking.holds({ ...context, messageId: 'm-2' }, frank)).toBe(false);
        expect(franking.holds({ ...context, senderAccountId: 'u-other' }, frank)).toBe(false);
        expect(franking.holds({ ...context, senderDeviceId: 'd-other' }, frank)).toBe(false);
        expect(franking.holds({ ...context, conversationId: 'c-2' }, frank)).toBe(false);
        expect(franking.holds({ ...context, clientAt: 1_600_000_000_000 }, frank)).toBe(false);
        expect(franking.holds({ ...context, commitment: 'another-commitment' }, frank)).toBe(false);
    });

    it('cannot be produced without the key', () =>
    {
        const elsewhere = createFranking('a-different-session-secret');

        // The whole value of a frank is that a reporter cannot make one. If a second server with a
        // different secret could, so could anybody who guessed one.
        expect(franking.holds(context, elsewhere.frank(context))).toBe(false);
    });

    it('refuses a frank of the wrong shape rather than throwing', () =>
    {
        expect(franking.holds(context, '')).toBe(false);
        expect(franking.holds(context, 'not-a-mac')).toBe(false);
    });

    it('is a MAC over the context string and nothing else', () =>
    {
        // Pinned against an independent computation, so a change to `frankContext` - a reordered
        // field, a different separator - is a change this test notices rather than one that
        // silently invalidates every frank ever issued.
        const key = Buffer.from(hkdfSync(
            'sha256',
            Buffer.from('a-development-session-secret', 'utf8'),
            Buffer.alloc(0),
            Buffer.from('nura-e2ee/v1 franking', 'utf8'),
            32
        ));

        const expected = createHmac('sha256', key).update(frankContext(context), 'utf8').digest('base64url');

        expect(franking.frank(context)).toBe(expected);
    });
});

describe('a disclosure', () =>
{
    const key = randomBytes(32).toString('base64url');

    const commitmentOf = (frankingKey: string, text: string): string =>
        createHmac('sha256', Buffer.from(frankingKey, 'base64url')).update(text, 'utf8').digest('base64url');

    it('checks out for the words it was made over', () =>
    {
        const commitment = commitmentOf(key, 'meet me at the table');

        expect(discloses(key, 'meet me at the table', commitment)).toBe(true);
    });

    it('refuses a single character changed', () =>
    {
        const commitment = commitmentOf(key, 'meet me at the table');

        // The one attack this mechanism exists to stop: a real message, shown with different words.
        expect(discloses(key, 'meet me at the tab1e', commitment)).toBe(false);
        expect(discloses(key, 'meet me at the table ', commitment)).toBe(false);
        expect(discloses(key, '', commitment)).toBe(false);
    });

    it('refuses a different key', () =>
    {
        const commitment = commitmentOf(key, 'see you there');

        expect(discloses(randomBytes(32).toString('base64url'), 'see you there', commitment)).toBe(false);
    });

    it('refuses malformed input rather than throwing', () =>
    {
        expect(discloses('', 'anything', 'anything')).toBe(false);
        expect(discloses(key, 'anything', '')).toBe(false);
    });

    it('works over text in any language, because the commitment is over bytes', () =>
    {
        const said = 'شب‌بخیر — یک دست دیگر؟';
        const commitment = commitmentOf(key, said);

        expect(discloses(key, said, commitment)).toBe(true);

        // The same sentence with one Persian character changed. Byte length is not character
        // length, and a comparison that got that wrong would accept this.
        expect(discloses(key, 'شب‌بخیر — یک دست دیگز؟', commitment)).toBe(false);
    });
});
