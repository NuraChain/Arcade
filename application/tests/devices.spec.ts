import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import { deviceIdFrom as serverDeviceIdFrom } from '../../server/src/domains/device/id.ts';
import type { Device } from '../src/api.ts';
import DeviceRow from '../src/components/app/device-row.component.azeroth';
import KeyNotice from '../src/components/app/key-notice.component.azeroth';
import TrustBadge from '../src/components/app/trust-badge.component.azeroth';
import { deviceIdFrom, deviceVerifies, isDeviceId, toBase64Url } from '../src/lib/device-id.ts';
import { resetKeyStore, setKeyStore, type DeviceKeys, type KeyStore } from '../src/lib/device-keys.ts';
import { deviceState, readinessOf, type DeviceState } from '../src/lib/device-state.ts';
import { useDevices } from '../src/stores/devices.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { server } from './fake-api.ts';
import '../src/locales/app-catalogue.ts';

const settle = async (): Promise<void> =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

/** Real P-256 keys. The thing being hashed is a DER SPKI, so made-up bytes would prove less. */
async function realKeys(): Promise<{ exchangeKey: string; signingKey: string }>
{
    const exchange = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);

    return {
        exchangeKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', exchange.publicKey))),
        signingKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', signing.publicKey)))
    };
}

async function realDevice(overrides: Partial<Device> = {}): Promise<Device>
{
    const keys = await realKeys();
    return {
        id: await deviceIdFrom(keys.exchangeKey, keys.signingKey),
        label: 'A browser',
        ...keys,
        attested: 'server',
        confirmed: true,
        revoked: false,
        createdAt: new Date(1_700_000_000_000).toISOString(),
        ...overrides
    };
}

/**
 * A key store with no IndexedDB behind it.
 *
 * The test environment has none, and neither does a browser in some private modes - which is why
 * the real store is behind this seam in the first place rather than being called directly.
 */
function fakeKeyStore(options: { available?: boolean } = {}): KeyStore & { minted: number }
{
    let held: DeviceKeys | null = null;

    return {
        minted: 0,
        available: () => options.available ?? true,
        async load()
        {
            return held;
        },

        // Nothing in this spec seals anything, and a fake that HELD private keys would be a fake
        // that could be mistaken for the real store. It answers the question and holds nothing.
        async secrets()
        {
            return null;
        },
        async mint()
        {
            this.minted += 1;
            const keys = await realKeys();
            held = { id: await deviceIdFrom(keys.exchangeKey, keys.signingKey), ...keys };
            return held;
        },
        async forget()
        {
            held = null;
        }
    };
}

let keys: ReturnType<typeof fakeKeyStore>;

beforeEach(async () =>
{
    cleanup();
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'guest',
        isMinor: false
    });
    useDevices().reset();

    keys = fakeKeyStore();
    setKeyStore(keys);
    await settle();
});

afterEach(() =>
{
    cleanup();
    resetKeyStore();
    useDevices().reset();
});

describe('a device id is derived, not issued', () =>
{
    it('agrees exactly with the server over real keys', async () =>
    {
        // Two independent implementations of one formula are two chances to disagree. This is the
        // only thing standing between them, and a disagreement would mean every enrolment on one
        // side is refused by the other.
        for (let round = 0; round < 4; round += 1)
        {
            const { exchangeKey, signingKey } = await realKeys();
            expect(await deviceIdFrom(exchangeKey, signingKey)).toBe(serverDeviceIdFrom(exchangeKey, signingKey));
        }
    });

    it('is twenty-two url-safe characters', async () =>
    {
        const { exchangeKey, signingKey } = await realKeys();
        const id = await deviceIdFrom(exchangeKey, signingKey);

        expect(id).toHaveLength(22);
        expect(isDeviceId(id)).toBe(true);
    });

    it('re-derives a listed device and refuses one whose keys were swapped', async () =>
    {
        const device = await realDevice();
        expect(await deviceVerifies(device)).toBe(true);

        const swapped = { ...device, exchangeKey: (await realKeys()).exchangeKey };
        expect(await deviceVerifies(swapped)).toBe(false);
    });

    it('treats an unreadable key as unverified rather than throwing', async () =>
    {
        const device = await realDevice();
        expect(await deviceVerifies({ ...device, exchangeKey: '!!! not base64 !!!' })).toBe(false);
    });
});

describe('what a device row is', () =>
{
    const base = {
        id: 'A'.repeat(22),
        label: '',
        exchangeKey: '',
        signingKey: '',
        attested: 'server' as const,
        confirmed: true,
        revoked: false,
        createdAt: new Date(0).toISOString()
    };

    it('is tampered before it is anything else, even before revoked', () =>
    {
        // A row that does not add up is not a trustworthy statement about being revoked either.
        const state = deviceState({ ...base, revoked: true }, { current: null, verified: false });
        expect(state).toBe('tampered');
    });

    it('reads the same unconfirmed row two different ways depending on who is looking', () =>
    {
        const row = { ...base, confirmed: false };

        expect(deviceState(row, { current: base.id, verified: true })).toBe('waiting');
        expect(deviceState(row, { current: 'other', verified: true })).toBe('pending');
    });

    it('is locked once it has been signed out', () =>
    {
        expect(deviceState({ ...base, revoked: true }, { current: null, verified: true })).toBe('locked');
    });

    it('is ready when it is live, confirmed and adds up', () =>
    {
        expect(deviceState(base, { current: null, verified: true })).toBe('ready');
    });
});

describe('what this browser can do', () =>
{
    const device = (overrides: Partial<Device>): Device => ({
        id: 'mine',
        label: '',
        exchangeKey: '',
        signingKey: '',
        attested: 'server',
        confirmed: true,
        revoked: false,
        createdAt: new Date(0).toISOString(),
        ...overrides
    });

    it('says so plainly when it cannot hold keys at all', () =>
    {
        expect(readinessOf({ supported: false, current: 'mine', devices: [device({})] })).toBe('unsupported');
    });

    it('is absent with no keys, and absent again once its device was signed out', () =>
    {
        expect(readinessOf({ supported: true, current: null, devices: [] })).toBe('absent');
        expect(readinessOf({ supported: true, current: 'mine', devices: [] })).toBe('absent');
        expect(readinessOf({ supported: true, current: 'mine', devices: [device({ revoked: true })] })).toBe('absent');
    });

    it('waits while nothing has vouched for it', () =>
    {
        expect(readinessOf({ supported: true, current: 'mine', devices: [device({ confirmed: false })] })).toBe('waiting');
    });

    it('is ready when it is enrolled and confirmed', () =>
    {
        expect(readinessOf({ supported: true, current: 'mine', devices: [device({})] })).toBe('ready');
    });
});

describe('the devices store', () =>
{
    it('enrols this browser and makes it the first, confirmed, device', async () =>
    {
        const devices = useDevices();
        await devices.enrol('This browser');

        expect(devices.devices()).toHaveLength(1);
        expect(devices.devices()[0].confirmed).toBe(true);
        expect(devices.readiness()).toBe('ready');
        expect(devices.stateOf(devices.devices()[0])).toBe('ready');
    });

    it('leaves the second device waiting, and lets the first vouch for it', async () =>
    {
        const devices = useDevices();
        await devices.enrol('First');

        const other = await realDevice({ confirmed: false, label: 'Second' });
        server.addDevice({ ...other });
        await devices.refresh();

        expect(devices.stateOf(devices.devices().find((one) => one.id === other.id)!)).toBe('pending');

        await devices.confirm(other.id);
        expect(devices.devices().find((one) => one.id === other.id)?.confirmed).toBe(true);
    });

    it('renders a row whose id does not match its keys as tampered', async () =>
    {
        const devices = useDevices();
        const real = await realDevice();

        // The one thing a client can check for itself. A server that swapped this device's
        // exchange key for its own would produce exactly this row.
        server.addDevice({ ...real, exchangeKey: (await realKeys()).exchangeKey });
        await devices.refresh();

        expect(devices.stateOf(devices.devices()[0])).toBe('tampered');
    });

    it('mints fresh keys once when the old ones were burned, and stops there', async () =>
    {
        const devices = useDevices();
        server.refuseEnrol = 'burned';

        await devices.enrol('This browser');

        expect(devices.devices()).toHaveLength(1);
        expect(devices.failure()).toBeNull();

        // Once for the first attempt, once for the replacement. A loop here would be a browser
        // filling somebody's device list with abandoned keys.
        expect(keys.minted).toBe(2);
    });

    it('does nothing at all when this browser cannot hold keys', async () =>
    {
        setKeyStore(fakeKeyStore({ available: false }));
        const devices = useDevices();

        await devices.enrol('This browser');

        expect(devices.devices()).toHaveLength(0);
        expect(devices.failure()).toBe('unsupported');
        expect(devices.readiness()).toBe('unsupported');
    });

    it('reports a refusal rather than recording an unproven device', async () =>
    {
        const devices = useDevices();
        server.refuseEnrol = 'unauthorized';

        await devices.enrol('This browser');

        expect(devices.devices()).toHaveLength(0);
        expect(devices.failure()).toBe('refused');
    });

    it('signs a device out and keeps it in the list as locked', async () =>
    {
        const devices = useDevices();
        await devices.enrol('This browser');

        const id = devices.devices()[0].id;
        await devices.revoke(id);

        expect(devices.devices()).toHaveLength(1);
        expect(devices.stateOf(devices.devices()[0])).toBe('locked');
    });
});

describe('the trust badge', () =>
{
    const render = (component: () => HTMLElement): string =>
        renderTest(component).container.textContent ?? '';

    it('says who vouched, and never says wallet for a device this server asserted', () =>
    {
        useLocale().setLocale('en');

        expect(render(() => TrustBadge({ attested: 'wallet' }) as HTMLElement)).toContain('Wallet');

        cleanup();
        expect(render(() => TrustBadge({ attested: 'contract' }) as HTMLElement)).toContain('Contract wallet');

        cleanup();
        const asserted = render(() => TrustBadge({ attested: 'server' }) as HTMLElement);
        expect(asserted).toContain('This server');
        expect(asserted).not.toContain('Wallet');
    });

    it('follows a language switch, like every other composed sentence', () =>
    {
        useLocale().setLocale('fa');
        expect(render(() => TrustBadge({ attested: 'server' }) as HTMLElement)).toContain('همین سرور');
    });
});

describe('what a degraded state looks like', () =>
{
    const row = async (state: DeviceState, overrides: Partial<Device> = {}): Promise<HTMLElement> =>
    {
        const device = await realDevice(overrides);
        return renderTest(() => DeviceRow({
            device,
            state,
            current: false,
            busy: false,
            onConfirm: () => undefined,
            onRevoke: () => undefined
        }) as HTMLElement).container;
    };

    /** The ACTIONS, not the prose - the lead for `waiting` says the word "confirm" too. */
    const actions = (container: HTMLElement): string[] =>
        [...container.querySelectorAll('button')].map((button) => (button.textContent ?? '').trim());

    it('offers to confirm a device that is waiting for you, and not one waiting for somebody else', async () =>
    {
        expect(actions(await row('pending'))).toContain('Confirm');

        cleanup();
        expect(actions(await row('waiting'))).not.toContain('Confirm');
    });

    it('never draws a trust badge on a row that does not add up', async () =>
    {
        const tampered = await row('tampered', { attested: 'wallet' });

        expect(tampered.textContent).toContain('This does not add up');
        expect(tampered.textContent).not.toContain('Wallet');

        // The only thing offered about a device nobody can identify.
        expect(actions(tampered)).toEqual(['Sign out']);
    });

    it('offers nothing to do about a device that is already signed out', async () =>
    {
        expect(actions(await row('locked'))).toEqual([]);
    });
});

describe('the notice at the top of the panel', () =>
{
    it('has a sentence for every readiness, including the ones nobody sees on a good day', () =>
    {
        useLocale().setLocale('en');

        for (const state of ['unsupported', 'absent', 'waiting', 'ready'] as const)
        {
            cleanup();
            const { container } = renderTest(() => KeyNotice({ state }) as HTMLElement);
            expect((container.textContent ?? '').trim().length).toBeGreaterThan(20);
        }
    });
});
