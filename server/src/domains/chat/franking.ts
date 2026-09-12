import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { frankContext, type FrankContext } from './envelope.ts';

/**
 * The server's half of franking: one MAC on the way in, one check on the way out.
 *
 * This is the only place in `nura-e2ee/v1` where the server holds a key that matters, and it is
 * worth being precise about what that key can and cannot do. It cannot decrypt anything. It cannot
 * read a commitment, because a commitment is an HMAC under a key sealed inside the message. What it
 * can do is prove, later, that a particular pair of words and key really did pass through here -
 * and refuse to make that proof for anything that did not.
 *
 * **The key is derived from `SESSION_SECRET` rather than being its own variable.** This deployment
 * already holds exactly one root secret and documents why; a second one is a second thing to set, a
 * second thing to rotate, and a second thing to get wrong. HKDF with a distinct label gives an
 * independent key from the same root, and the label is what stops a franking MAC ever being
 * mistakable for a session signature.
 *
 * One consequence, stated rather than discovered: **rotating `SESSION_SECRET` invalidates every
 * frank.** Old messages stay readable - the franks are not part of the sealing - but they stop
 * being reportable, because the proof they carried was made under a key that no longer exists.
 * Separating the two secrets would fix that and is the right change the day rotation is a real
 * procedure rather than a paragraph.
 */

const LABEL = 'nura-e2ee/v1 franking';

export function createFranking(secret: string)
{
    const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(LABEL, 'utf8'), 32));

    const mac = (context: FrankContext): string =>
        createHmac('sha256', key).update(frankContext(context), 'utf8').digest('base64url');

    return {
        /** Stamps a message on its way in. The server learns nothing from it and never could. */
        frank: mac,

        /**
         * Whether this server really did see this exact message.
         *
         * Constant time, because the comparison is against a MAC and `===` on a MAC leaks its
         * prefix to anybody willing to file a few thousand reports.
         */
        holds(context: FrankContext, frank: string): boolean
        {
            const made = Buffer.from(mac(context));
            const given = Buffer.from(frank);

            return made.length === given.length && timingSafeEqual(made, given);
        }
    };
}

export type Franking = ReturnType<typeof createFranking>;

/**
 * Whether a disclosed plaintext really is what the commitment was made over.
 *
 * The reporter supplies the words and the key; this recomputes the commitment and compares it to
 * the one the sender published. A reporter who changed a single character produces a different
 * commitment and the report is refused - which is the entire reason the mechanism exists.
 */
export function discloses(frankingKey: string, text: string, commitment: string): boolean
{
    let made: Buffer;

    try
    {
        made = createHmac('sha256', Buffer.from(frankingKey, 'base64url')).update(text, 'utf8').digest();
    }
    catch
    {
        return false;
    }

    const given = Buffer.from(commitment, 'base64url');
    return made.length === given.length && timingSafeEqual(made, given);
}
