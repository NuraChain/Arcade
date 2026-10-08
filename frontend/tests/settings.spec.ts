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
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { establishAccount, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async () =>
{
    for (let i = 0; i < 8; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const show = async (component: () => HTMLElement, at: string) =>
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
 * Editing the profile, which is two requests and has to say which of them failed.
 *
 * The display name and the bio are simply STORED; the @handle is CLAIMED against a unique index and
 * can come back 409. Sending them as one request would produce a half-success with nothing on the
 * screen able to say which half - so the handle goes first, and a refusal leaves the rest unwritten
 * with the value still in the box.
 */
describe('the profile sheet', () =>
{
    const fill = (container: HTMLElement, id: string, value: string) =>
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
        const close = (value?: unknown) =>
        {
            closedWith = value === true;
        };

        return await show(
            (() => ProfileSheet({ overlayId: 'profile-test', close })) as unknown as () => HTMLElement,
            '/app/me'
        );
    };

    const press = (container: HTMLElement, label: string) =>
    {
        const button = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith(label));
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    it('writes the name and the bio, and adopts what the server answers with', async () =>
    {
        useSession().establish(establishAccount());

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
        useSession().establish(establishAccount());
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
        useSession().establish(establishAccount());
        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const switchFor = (label: string) =>
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

describe('the safety lists', () =>
{
    it('keep the lines that say nobody is blocked, muted or reported when they are read again', async () =>
    {
        useSession().establish(establishAccount());

        const container = await show(SettingsPage as unknown as () => HTMLElement, '/app/me/settings');
        const lineOf = (text: string) => [...container.querySelectorAll('p')].find((one) => one.textContent?.trim() === text) ?? null;
        const lines = () => [
            lineOf(useLocale().t('settings.safety.blockedEmpty')),
            lineOf(useLocale().t('settings.safety.mutedEmpty')),
            lineOf(useLocale().t('report.empty'))
        ];

        await vi.waitFor(() => expect(lines().every((one) => one !== null)).toBe(true), { timeout: 4000 });

        const drawn = lines();
        const reads = server.calls.filter((one) => one === 'social.graph').length;

        await useSocial().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'social.graph').length, 'the lists were not read again').toBeGreaterThan(reads);
        expect(lines()[0], 'the line about blocks was drawn again').toBe(drawn[0]);
        expect(lines()[1], 'the line about mutes was drawn again').toBe(drawn[1]);
        expect(lines()[2], 'the line about reports was drawn again').toBe(drawn[2]);
    });
});
