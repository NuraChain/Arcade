/**
 * Asking a browser to be woken, and telling the server where to knock.
 *
 * Everything here is about the SUBSCRIPTION, never about content: a push from this product has no
 * payload at all, so there is nothing to encrypt on the way in and nothing to decrypt on the way
 * out. `p256dh` and `auth` are sent because a subscription has them and the standard says a sender
 * holds them; this one never uses them.
 *
 * The worker's url is fixed (`/push-worker.js`) rather than bundled, because a service worker's
 * url IS its identity - a hashed filename would register a new worker on every deploy while the
 * old one kept running.
 */

const WORKER = '/push-worker.js';

export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

export interface PushSubscriptionKeys
{
    endpoint: string;
    p256dh: string;
    auth: string;
}

export function pushSupported(): boolean
{
    return typeof navigator !== 'undefined'
        && 'serviceWorker' in navigator
        && typeof window !== 'undefined'
        && 'PushManager' in window
        && 'Notification' in window;
}

/**
 * The VAPID key, as the browser wants it.
 *
 * `PushManager.subscribe` takes the raw 65-byte uncompressed point as a `Uint8Array`, not the
 * base64url the server publishes, and it is specific about the length.
 */
export function decodeKey(base64url: string): ArrayBuffer
{
    const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4));

    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1)
    {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
}

const encodeKey = (buffer: ArrayBuffer | null): string =>
{
    if (buffer === null)
    {
        return '';
    }
    let binary = '';
    for (const byte of new Uint8Array(buffer))
    {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** What a live subscription looks like on the wire. */
export function keysOf(subscription: PushSubscription): PushSubscriptionKeys
{
    return {
        endpoint: subscription.endpoint,
        p256dh: encodeKey(subscription.getKey('p256dh')),
        auth: encodeKey(subscription.getKey('auth'))
    };
}

export async function currentSubscription(): Promise<PushSubscription | null>
{
    if (!pushSupported())
    {
        return null;
    }
    const registration = await navigator.serviceWorker.getRegistration(WORKER);
    return registration === undefined ? null : await registration.pushManager.getSubscription();
}

/**
 * Registers the worker and subscribes, asking for permission on the way.
 *
 * `userVisibleOnly` is not optional in any browser that ships this, and it is the right promise
 * anyway: every push this product sends results in a visible notice, because a silent push is a
 * wake-up nobody asked for.
 *
 * Returns null when the person says no. That is an answer, and the caller stores nothing.
 */
export async function subscribe(vapidKey: string): Promise<PushSubscriptionKeys | null>
{
    if (!pushSupported() || vapidKey === '')
    {
        return null;
    }

    if (await Notification.requestPermission() !== 'granted')
    {
        return null;
    }

    const registration = await navigator.serviceWorker.register(WORKER);
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(vapidKey)
    });

    return keysOf(subscription);
}

/** Gives the subscription up at the browser. The server is told separately, by the caller. */
export async function unsubscribe(): Promise<string | null>
{
    const subscription = await currentSubscription();
    if (subscription === null)
    {
        return null;
    }

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    return endpoint;
}
