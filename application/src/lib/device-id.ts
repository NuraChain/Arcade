export const DEVICE_ID_LENGTH = 22;

const SHAPE = /^[A-Za-z0-9_-]{22}$/;

export function isDeviceId(value: string): boolean
{
    return SHAPE.test(value);
}

export function fromBase64Url(value: string): Uint8Array
{
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4));

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
    {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export function toBase64Url(bytes: Uint8Array): string
{
    let binary = '';
    for (const byte of bytes)
    {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Whether this browser can do any of this at all. False on an insecure origin, and in some private modes. */
export function cryptoAvailable(): boolean
{
    return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined';
}

/**
 * A device's id, derived from the keys it holds.
 *
 * ```
 * deviceId = base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)
 * ```
 *
 * The server computes exactly this from the keys an enrolment publishes and refuses a mismatch,
 * so an id can only be claimed by whoever holds those keys. `server/src/domains/device/id.ts` is
 * the other half, and `tests/devices.spec.ts` runs both over the same vectors - two independent
 * implementations of one formula are two chances to disagree, and the test is what stops them.
 */
export async function deviceIdFrom(exchangeKey: string, signingKey: string): Promise<string>
{
    const exchange = fromBase64Url(exchangeKey);
    const signing = fromBase64Url(signingKey);

    const joined = new Uint8Array(exchange.length + signing.length);
    joined.set(exchange, 0);
    joined.set(signing, exchange.length);

    const digest = await crypto.subtle.digest('SHA-256', joined);
    return toBase64Url(new Uint8Array(digest)).slice(0, DEVICE_ID_LENGTH);
}

/**
 * Whether a device the SERVER sent really is the device its keys describe.
 *
 * This is the client's half of the self-certifying id, and it is not ceremony. A server that
 * swapped somebody's exchange key for its own - so that PR 12 would wrap an epoch key it could
 * unwrap - would produce a row whose id no longer matches its keys. The browser can see that on
 * its own, without trusting anybody, and a row that fails this is rendered as `tampered` and never
 * as a device.
 */
export async function deviceVerifies(device: { id: string; exchangeKey: string; signingKey: string }): Promise<boolean>
{
    if (!isDeviceId(device.id))
    {
        return false;
    }

    try
    {
        return await deviceIdFrom(device.exchangeKey, device.signingKey) === device.id;
    }
    catch
    {
        // Malformed base64, a key that is not a key: unverifiable is not verified.
        return false;
    }
}
