import { createHash } from 'node:crypto';

/**
 * A device's identity, derived from the keys it holds.
 *
 * ```
 * deviceId = base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)
 * ```
 *
 * The point is what the server CANNOT do. An id that is issued by the server is an id the server
 * can mint for keys it made up, wrap an epoch key to, and read; an id that is a hash of the public
 * keys can only be claimed by whoever published those exact keys. So enrolment recomputes this and
 * refuses a mismatch - the id is a claim the caller makes and this is the check, not a formality.
 *
 * It is also why the client re-derives every id in the device list: a server that swapped one
 * device's keys for its own would produce a row whose id no longer matches its keys, and the
 * browser can see that without asking anyone.
 *
 * 22 base64url characters is 132 bits of the digest. Truncating is deliberate - the whole 43 is
 * unreadable in a list and this is a value people compare across two screens - and 132 bits is far
 * past any collision anybody can search for.
 */

export const DEVICE_ID_LENGTH = 22;

const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

export function isDeviceId(value: string): boolean
{
    return DEVICE_ID.test(value);
}

/**
 * Both keys arrive as base64url of their DER SubjectPublicKeyInfo, which is what
 * `crypto.subtle.exportKey('spki', …)` produces. The digest is over the raw BYTES in that order,
 * never over the strings: a client that encoded with padding and a server that did not would
 * otherwise disagree about the same two keys.
 */
export function deviceIdFrom(exchangeKey: string, signingKey: string): string
{
    const exchange = Buffer.from(exchangeKey, 'base64url');
    const signing = Buffer.from(signingKey, 'base64url');

    return createHash('sha256')
        .update(Buffer.concat([exchange, signing]))
        .digest('base64url')
        .slice(0, DEVICE_ID_LENGTH);
}

/** Whether a claimed id really belongs to the keys published beside it. */
export function deviceIdMatches(id: string, exchangeKey: string, signingKey: string): boolean
{
    return isDeviceId(id) && deviceIdFrom(exchangeKey, signingKey) === id;
}
