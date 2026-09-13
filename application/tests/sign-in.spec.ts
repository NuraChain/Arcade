import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import SignInPage from '../src/pages/sign-in.page.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async (): Promise<void> =>
{
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));
};

const open = (): { container: HTMLElement; at: () => string } =>
{
    const router = createRouter({
        routes: [
            { path: '/sign-in', component: SignInPage },
            { path: '/app', component: (): HTMLElement => document.createElement('div') }
        ],
        history: createMemoryHistory('/sign-in'),
        scroll: false
    });
    const { container } = renderTest(() => RouterProvider({ router, children: () => SignInPage({}) }) as Rendered);
    return { container, at: () => router.location().pathname };
};

const nameBox = (container: HTMLElement): HTMLInputElement =>
    container.querySelector<HTMLInputElement>('#sign-in-name')!;

const guestButton = (container: HTMLElement): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find((button) => button.getAttribute('type') === 'submit')!;

const type = async (container: HTMLElement, value: string): Promise<void> =>
{
    const box = nameBox(container);
    box.value = value;
    fire(box, 'input');
    await settle();
};

const send = async (container: HTMLElement): Promise<void> =>
{
    fire(container.querySelector('form')!, 'submit');
    await settle();
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

describe('guest sign-in', () =>
{
    /**
     * The regression this file exists for.
     *
     * `enter` set `pending` and awaited with no `try`. `client.auth.guest` throws on any non-2xx,
     * so a 429 from the rate limiter - a documented live condition on `/api` - left the button
     * `loading` forever with the `pending` guard blocking every retry. The page had to be reloaded
     * to sign in at all, on the path CLAUDE.md calls the actual onboarding for most people.
     *
     * Asserting the button recovers is the whole point: a spec that only checked the error copy
     * would pass against the broken version, because the copy was never the part that was stuck.
     */
    it('gives the button back when the server refuses, so a second try is possible', async () =>
    {
        const { container, at } = open();
        await settle();

        server.refuse = 'guest-unreachable';
        await type(container, 'Alex');
        await send(container);

        expect(at()).toBe('/sign-in');
        expect(guestButton(container).getAttribute('aria-busy')).toBe('false');
        expect(guestButton(container).disabled).toBe(false);
        expect(container.textContent).toContain('That did not work');

        server.refuse = null;
        await send(container);
        expect(at()).toBe('/app');
    });

    it('says the name was turned down rather than offering to retry it forever', async () =>
    {
        const { container } = open();
        await settle();

        server.refuse = 'guest-reserved';
        await type(container, 'Alex');
        await send(container);

        expect(container.textContent).toContain('turned down');
        expect(guestButton(container).disabled).toBe(false);
    });

    /**
     * `...` is three characters and folds to no handle at all; `admin` is perfectly well shaped and
     * reserved. Both used to satisfy this form's own length check and be refused by the server,
     * which is the round trip that had nothing to catch it. The client runs the server's own
     * `checkHandle` so neither leaves the browser.
     */
    it('refuses locally what the server would refuse remotely, without asking it', async () =>
    {
        const { container } = open();
        await settle();

        await type(container, '...');
        await send(container);
        expect(container.textContent).toContain('at least three letters or digits');
        expect(server.calls).not.toContain('auth.guest');

        await type(container, 'admin');
        await send(container);
        expect(container.textContent).toContain('kept for the product itself');
        expect(server.calls).not.toContain('auth.guest');
    });

    it('signs in and leaves when the name is good', async () =>
    {
        const { container, at } = open();
        await settle();

        await type(container, 'Sara K');
        await send(container);

        expect(server.calls).toContain('auth.guest');
        expect(at()).toBe('/app');
    });
});
