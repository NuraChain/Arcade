import type { Device } from '../api.ts';

/**
 * What a device row IS, from the point of view of the person reading the list.
 *
 * A browser is live the moment it enrols; nothing waits to be vouched for.
 *
 * - `ready`    live, and its id matches its keys. Nothing to say.
 * - `locked`   revoked. Its keys are burned and can never be enrolled again.
 * - `tampered` its id does not match the keys published beside it. Never rendered as a device;
 *              it is an alarm, and the only offered action is to revoke it.
 */
export type DeviceState = 'ready' | 'locked' | 'tampered';

/**
 * What THIS browser can do, which is a different question from what any row says.
 *
 * - `unsupported` no WebCrypto or no IndexedDB. An insecure origin, or a private mode that
 *                 refuses storage. Nothing here will work and the panel says so rather than
 *                 offering a button that fails.
 * - `absent`      no keys here yet.
 * - `ready`       enrolled.
 */
export type Readiness = 'unsupported' | 'absent' | 'ready';

/**
 * `verified` is the client's own re-derivation of the id from the published keys, which is why it
 * is a parameter rather than a field: it is the one thing about a device that does not come from
 * the server.
 */
export function deviceState(device: Device, options: { verified: boolean }): DeviceState
{
    // Verification first, and before revocation, because a row that does not add up is not a
    // trustworthy statement about anything - including about being revoked.
    if (!options.verified)
    {
        return 'tampered';
    }
    return device.revoked ? 'locked' : 'ready';
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
    return options.current === null || mine === undefined || mine.revoked ? 'absent' : 'ready';
}
