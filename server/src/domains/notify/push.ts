import { createSign, createPrivateKey } from 'node:crypto';

/**
 * Web Push, with nothing in it.
 *
 * A push in this product carries NO PAYLOAD. That is the privacy answer and it is also why this
 * file is forty lines instead of four hundred: a payload would have to be encrypted to the
 * subscription's `p256dh`/`auth` keys with HKDF and AES128GCM, and an encrypted payload of a
 * message this server will not be able to read under `nura-e2ee/v1` is a contradiction anyway.
 *
 * What is left is the VAPID half: a JWT signed with ES256 that says who is sending and where to,
 * so the push service can identify the sender and rate-limit it. The browser wakes the service
 * worker with an empty `push` event, the worker shows a generic notice, and the CONTENT comes
 * from the api when the person opens the app - over a session they are already authorised on.
 *
 * `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are optional. With neither set this is inert and
 * `sendPush` refuses rather than pretending: a product that silently drops notifications is worse
 * than one that plainly does not have them yet.
 */

export interface VapidKeys
{
    /** Base64url of the uncompressed P-256 public point. The browser subscribes with this. */
    publicKey: string;

    /** Base64url of the raw P-256 private scalar. */
    privateKey: string;

    /** `mailto:` or an https origin. The push service uses it to contact whoever is sending. */
    subject: string;
}

const base64url = (input: Buffer): string => input.toString('base64url');

/**
 * The DER wrapper a raw P-256 scalar needs before Node will import it as a key.
 *
 * `crypto.createPrivateKey` takes PKCS#8, and VAPID keys are published as the raw 32-byte
 * scalar - so the scalar is dropped into a fixed PKCS#8 prologue for `prime256v1`. The prologue
 * is constant because the curve is.
 */
function privateKeyFrom(raw: string): ReturnType<typeof createPrivateKey>
{
    const scalar = Buffer.from(raw, 'base64url');
    if (scalar.length !== 32)
    {
        throw new Error('A VAPID private key is 32 bytes.');
    }

    const prologue = Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex');
    return createPrivateKey({ key: Buffer.concat([prologue, scalar]), format: 'der', type: 'pkcs8' });
}

/** ES256 wants the raw 64-byte (r‖s) form; Node signs to DER. */
function joseFrom(der: Buffer): Buffer
{
    let offset = 2;
    if (der[1] & 0x80)
    {
        offset += der[1] & 0x7f;
    }

    const read = (): Buffer =>
    {
        const length = der[offset + 1];
        const value = der.subarray(offset + 2, offset + 2 + length);
        offset += 2 + length;
        return value.length > 32 ? value.subarray(value.length - 32) : Buffer.concat([Buffer.alloc(32 - value.length), value]);
    };

    return Buffer.concat([read(), read()]);
}

/**
 * The signed token a push service checks before it accepts anything.
 *
 * `aud` is the ORIGIN of the endpoint and nothing more: the path identifies the subscription and
 * is none of the push service's business at this layer. `exp` is deliberately short - twelve
 * hours is the standard's ceiling and there is no reason to sit near it.
 */
export function vapidToken(endpoint: string, keys: VapidKeys, now: number): string
{
    const audience = new URL(endpoint).origin;

    const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = base64url(Buffer.from(JSON.stringify({
        aud: audience,
        exp: Math.floor(now / 1000) + 60 * 60,
        sub: keys.subject
    })));

    const signer = createSign('SHA256');
    signer.update(`${ header }.${ claims }`);
    const signature = base64url(joseFrom(signer.sign(privateKeyFrom(keys.privateKey))));

    return `${ header }.${ claims }.${ signature }`;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/**
 * Wakes one browser. No body, no headers about what happened, nothing to read off the wire.
 *
 * 404 and 410 mean the subscription is over - the browser was reinstalled, the permission was
 * revoked, the endpoint expired - and the caller retires the row rather than retrying forever.
 */
export async function sendPush(endpoint: string, keys: VapidKeys, now: number, fetcher = fetch): Promise<PushOutcome>
{
    let response: Response;
    try
    {
        response = await fetcher(endpoint, {
            method: 'POST',
            headers: {
                'TTL': '3600',
                'Content-Length': '0',
                'Urgency': 'normal',
                'Authorization': `vapid t=${ vapidToken(endpoint, keys, now) }, k=${ keys.publicKey }`
            }
        });
    }
    catch
    {
        return 'failed';
    }

    if (response.status === 404 || response.status === 410)
    {
        return 'gone';
    }
    return response.ok ? 'sent' : 'failed';
}
