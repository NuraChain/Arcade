import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import SettingsPage from '../src/pages/app/settings.page.azeroth';
import MePage from '../src/pages/app/me.page.azeroth';
import ProfileSheet from '../src/components/app/profile-sheet.component.azeroth';
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

/**
 * Editing the profile, which is two requests and has to say which of them failed.
 *
 * The display name and the bio are simply STORED; the @handle is CLAIMED against a unique index and
 * can come back 409. Sending them as one request would produce a half-success with nothing on the
 * screen able to say which half - so the handle goes first, and a refusal leaves the rest unwritten
 * with the value still in the box.
 */
describe('the profile sheet', () =>
{
    const fill = (container: HTMLElement, id: string, value: string): void =>
    {
        const field = container.querySelector(`#${ id }`) as HTMLInputElement | HTMLTextAreaElement;
        const proto = Object.getPrototypeOf(field) as object;
        (Object.getOwnPropertyDescriptor(proto, 'value')?.set as (this: unknown, v: string) => void).call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    };

    /** The overlay hands every sheet a `close`; rendered on its own it has to be given one. */
    let closedWith: boolean | null = null;

    const sheet = async (): Promise<HTMLElement> =>
    {
        closedWith = null;
        const close = (value?: unknown): void =>
        {
            closedWith = value === true;
        };

        return await show(
            (() => ProfileSheet({ overlayId: 'profile-test', close })) as unknown as () => HTMLElement,
            '/app/me'
        );
    };

    const press = (container: HTMLElement, label: string): void =>
    {
        const button = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith(label));
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    it('writes the name and the bio, and adopts what the server answers with', async () =>
    {
        await useAccount().signIn('Alex');

        const container = await sheet();

        fill(container, 'profile-name', '  Alexandra  ');
        fill(container, 'profile-bio', '  Plays hokm badly.  ');
        await settle();

        press(container, 'Save');
        await settle();

        expect(server.calls).toContain('auth.profile');

        // Trimmed by the server, and the store took the ANSWER rather than what was typed.
        expect(useAccount().user()?.displayName).toBe('Alexandra');
        expect(useAccount().user()?.bio).toBe('Plays hokm badly.');
        expect(closedWith).toBe(true);
    });

    it('says a handle is taken, and writes nothing else when it is', async () =>
    {
        await useAccount().signIn('Alex');
        server.takenHandles = ['taken'];

        const container = await sheet();
        const before = useAccount().user()?.displayName;

        fill(container, 'profile-name', 'Someone Else');
        fill(container, 'profile-handle', 'taken');
        await settle();

        press(container, 'Save');
        await settle();

        expect(container.textContent).toContain('taken');
        expect(server.calls).toContain('auth.handle');

        // The name was NOT written: the handle is claimed first precisely so a refusal leaves the
        // account whole rather than half-changed.
        expect(server.calls).not.toContain('auth.profile');
        expect(useAccount().user()?.displayName).toBe(before);

        // And the sheet stays OPEN, with the refusal beside the box that caused it.
        expect(closedWith).toBeNull();
    });
});

describe('the notification switches', () =>
{
    it('read the account\'s own mutes and write through the server, so every device agrees', async () =>
    {
        server.mutes = [{ kind: 'notice', id: 'turns' }];
        await useAccount().signIn('Alex');
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const switchFor = (label: string): HTMLElement =>
            [...container.querySelectorAll<HTMLElement>('[role="switch"]')].find((one) => one.querySelector('span span')?.textContent === label)!;

        expect(switchFor('Your turn in a turn-based game').getAttribute('aria-checked')).toBe('false');
        expect(switchFor('Messages').getAttribute('aria-checked')).toBe('true');

        switchFor('Messages').click();
        await settle();

        expect(server.calls).toContain('social.mute');
        expect(server.mutes).toContainEqual({ kind: 'notice', id: 'messages' });
        expect(switchFor('Messages').getAttribute('aria-checked')).toBe('false');
        expect(switchFor('Messages').querySelector('[aria-hidden]')?.className).toContain('bg-line');
    });
});
