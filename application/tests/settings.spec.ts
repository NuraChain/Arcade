import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import SettingsPage from '../src/pages/app/settings.page.azeroth';
import MePage from '../src/pages/app/me.page.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async (): Promise<void> =>
{
    for (let i = 0; i < 8; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const show = async (component: () => HTMLElement, at: string): Promise<HTMLElement> =>
{
    const table: Route[] = [{ path: at, component }];
    const router = createRouter({ routes: table, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: component }) as Rendered);
    await settle();
    return container;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(5000);
    setRuntime({ clock, seed: 2 });
    useLocale().setLocale('en');
    server.reset();
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
});

/**
 * The guest half of these two pages, which no gate had ever rendered.
 *
 * `tools/qa` tours the 640-cell matrix signed in as `dana.w`, a WALLET fixture, and the seal pass
 * signs in with a wallet too - so every control behind `!account.isWallet()` shipped without once
 * being drawn. That is the same structural blind spot recorded for the sealing's `ready` branch,
 * and it is why the wallet fixtures exist at all; this is the same story from the other end.
 *
 * What it hid: a PRIMARY button reading "Connect a wallet", sitting above a "Sign out" button and
 * carrying the identical handler. There is no wallet-link route on this server - `/auth/wallet`
 * mints a NEW user from the address and never reads the session - and a guest handle is claimed by
 * INSERT, so signing out of a guest account is the end of it. The button destroyed the account
 * while promising, in the card that steered people to it, that everything would follow them.
 */
describe('a guest seat', () =>
{
    it('is never offered a wallet button that signs it out instead', async () =>
    {
        await useAccount().signIn('Alex');
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');

        expect(container.textContent).toContain('Guest seat');
        expect(container.textContent).not.toContain('Connect a wallet');

        const signOut = [...container.querySelectorAll('button')]
            .filter((button) => button.textContent?.trim() === 'Sign out');
        expect(signOut.length).toBe(1);
    });

    it('is told the seat ends at sign-out rather than that it moves', async () =>
    {
        await useAccount().signIn('Alex');
        const container = await show(MePage as unknown as () => HTMLElement, '/app/me');

        expect(container.textContent).toContain('This seat is this browser');
        expect(container.textContent).toContain('no way back into a guest account');
        expect(container.textContent).not.toContain('follow you to any device');
    });
});
