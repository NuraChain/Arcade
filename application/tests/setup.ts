import { vi } from 'vitest';

import { createFakeSource } from './fake-realtime.ts';
import { setRealtimeSource } from '../src/stores/realtime.store.ts';
import { setKeyStore } from '../src/lib/device-keys.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

setRealtimeSource(createFakeSource());

const fake = await import('./fake-api.ts');

/**
 * The keys of whoever the fake server is signed in as, followed live.
 *
 * A spec changes who it is by assigning `server.me`, and the device has to follow - otherwise
 * signing in as somebody else would leave the browser holding the previous person's keys and every
 * message would open as `unknown-sender`. Resolving through `server.me` on every call rather than
 * installing a store per person is what makes that automatic.
 *
 * The product's own store needs IndexedDB, which this environment does not have. That is exactly
 * why `setKeyStore` exists, and it is the same seam a browser in a private mode falls through.
 */
setKeyStore({
    available: () => true,

    async load()
    {
        const device = fake.fixtureDevice(fake.server.me);

        return device === null
            ? null
            : { id: device.id, exchangeKey: device.exchangeKey, signingKey: device.signingKey };
    },

    async secrets()
    {
        return fake.fixtureDevice(fake.server.me)?.secrets ?? null;
    },

    async mint()
    {
        throw new Error('The fixture key store holds the fixture devices and does not mint.');
    },

    async forget()
    {
        return undefined;
    }
});
