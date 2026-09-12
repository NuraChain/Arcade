import type { Device } from '../api.ts';

/**
 * What a device row IS, from the point of view of the person reading the list.
 *
 * These four degraded states are built and rendered before anything is sealed, deliberately. A
 * state that arrives with the feature is a state nobody has ever seen; a state that ships first is
 * one the screen has already had to accommodate.
 *
 * - `ready`    live, confirmed, and its id matches its keys. Nothing to say.
 * - `pending`  live but unconfirmed, and it is NOT this browser. Somebody has to look at it and
 *              decide, and that somebody is reading this list.
 * - `waiting`  live but unconfirmed, and it IS this browser. The same database fact, the opposite
 *              sentence: there is nothing to do here except wait for another device.
 * - `locked`   revoked. Its keys are burned and can never be enrolled again.
 * - `tampered` its id does not match the keys published beside it. Never rendered as a device;
 *              it is an alarm, and the only offered action is to revoke it.
 */
export type DeviceState = 'ready' | 'pending' | 'waiting' | 'locked' | 'tampered';

/**
 * What THIS browser can do, which is a different question from what any row says.
 *
 * - `unsupported` no WebCrypto or no IndexedDB. An insecure origin, or a private mode that
 *                 refuses storage. Nothing here will work and the panel says so rather than
 *                 offering a button that fails.
 * - `absent`      no keys here yet.
 * - `waiting`     enrolled, and one of the other devices has not vouched for it.
 * - `ready`       enrolled and confirmed.
 */
export type Readiness = 'unsupported' | 'absent' | 'waiting' | 'ready';

/**
 * `verified` is the client's own re-derivation of the id from the published keys, which is why it
 * is a parameter rather than a field: it is the one thing about a device that does not come from
 * the server.
 */
export function deviceState(device: Device, options: { current: string | null; verified: boolean }): DeviceState
{
    // Verification first, and before revocation, because a row that does not add up is not a
    // trustworthy statement about anything - including about being revoked.
    if (!options.verified)
    {
        return 'tampered';
    }
    if (device.revoked)
    {
        return 'locked';
    }
    if (device.confirmed)
    {
        return 'ready';
    }
    return device.id === options.current ? 'waiting' : 'pending';
}

export function readinessOf(options: {
    supported: boolean;
    current: string | null;
    devices: readonly Device[];
}): Readiness
{
    if (!options.supported)
    {
        return 'unsupported';
    }

    const mine = options.devices.find((device) => device.id === options.current);
    if (options.current === null || mine === undefined || mine.revoked)
    {
        return 'absent';
    }

    return mine.confirmed ? 'ready' : 'waiting';
}
