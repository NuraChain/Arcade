import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import WatchPage from '../src/pages/app/watch.page.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async () =>
{
    for (let i = 0; i < 8; i += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const show = async () =>
{
    const page = WatchPage as unknown as () => HTMLElement;
    const table: Route[] = [{ path: '/app/watch', component: page }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/watch'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: page }) as Rendered);
    await settle();
    return container;
};

const row = (id: string, game: string): (typeof server.watching)[number] => ({
    id,
    code: id.slice(0, 6),
    game,
    seats: 2,
    players: ['sara.k', 'omid.k'],
    startedAt: new Date(4000).toISOString()
});

const reads = () => server.calls.filter((call) => call === 'tables.watchable').length;

const pulse = (n: number, watching: string) =>
    socket.deliver({ v: 1, t: 'pulse', n, games: [], watching });

const connected = async () =>
{
    useCatalogue().start();
    useRealtime().start();
    socket.accept();
    clock.advance(NUDGE_WINDOW_MS);
    await settle();
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(5000);
    setRuntime({ clock, seed: 4 });
    useLocale().setLocale('en');
    server.reset();
    socket.reset();
    useRealtime().reset();
    useCatalogue().reset();
});

afterEach(() =>
{
    cleanup();
    useCatalogue().stop();
    useRealtime().reset();
});

describe('the live games page', () =>
{
    it('lists every game being played at a public table, each a way in to watch it', async () =>
    {
        server.watching = [row('table-hokm', 'hokm'), row('table-ludo', 'ludo')];

        const container = await show();
        const links = [...container.querySelectorAll<HTMLAnchorElement>('a')].filter((one) => one.textContent?.trim() === 'Watch');

        expect(links.map((one) => one.getAttribute('href'))).toEqual(['/app/play/table-hokm', '/app/play/table-ludo']);
    });

    it('adds a game that has started the moment the socket says the list has changed, and keeps the rows it had', async () =>
    {
        server.watching = [row('table-hokm', 'hokm'), row('table-ludo', 'ludo')];
        await connected();
        pulse(3, 'two-games-on');

        const container = await show();
        const list = container.querySelector('ul');
        const listed = [...container.querySelectorAll('ul > li')];
        const before = reads();

        expect(listed).toHaveLength(2);

        server.watching = [...server.watching, row('table-poker', 'poker')];
        pulse(4, 'three-games-on');
        await settle();

        const after = [...container.querySelectorAll('ul > li')];

        expect(reads()).toBe(before + 1);
        expect(container.querySelector('ul')).toBe(list);
        expect(after).toHaveLength(3);
        expect(after.slice(0, 2)).toEqual(listed);
    });

    it('does not read its list again for a pulse that only moved a number', async () =>
    {
        server.watching = [row('table-hokm', 'hokm')];
        await connected();
        pulse(3, 'one-game-on');

        const container = await show();
        const before = reads();

        pulse(4, 'one-game-on');
        pulse(5, 'one-game-on');
        await settle();

        expect(reads()).toBe(before);
        expect(container.querySelectorAll('ul > li')).toHaveLength(1);
    });

    it('does not read its list on a timer any more', async () =>
    {
        server.watching = [row('table-hokm', 'hokm')];
        await connected();
        pulse(3, 'one-game-on');
        await show();

        const before = reads();

        clock.advance(10 * 60_000);
        await settle();

        expect(reads()).toBe(before);
    });

    it('reads its list again whenever everything is rung and there is no socket to say what changed', async () =>
    {
        server.watching = [row('table-hokm', 'hokm')];
        useRealtime().start();

        const container = await show();
        const before = reads();

        server.watching = [...server.watching, row('table-ludo', 'ludo')];
        useRealtime().ring();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(reads()).toBe(before + 1);
        expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    });

    it('leaves the reading to the pulse when a socket that came back rings everything', async () =>
    {
        server.watching = [row('table-hokm', 'hokm')];
        await connected();
        pulse(3, 'one-game-on');
        await show();

        const before = reads();

        useRealtime().ring();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(reads()).toBe(before);
    });

    it('goes on saying how long ago a game started without reading anything', async () =>
    {
        server.watching = [{ ...row('table-hokm', 'hokm'), startedAt: new Date(clock.now() - 60_000).toISOString() }];
        await connected();
        pulse(3, 'one-game-on');

        const container = await show();
        const before = reads();

        expect(container.textContent).toContain('1 minute ago');

        clock.advance(4 * 60_000);
        await settle();

        expect(container.textContent).toContain('5 minutes ago');
        expect(reads()).toBe(before);
    });

    it('never says a game started in the future: one that began after the page was opened started now', async () =>
    {
        server.watching = [{ ...row('table-hokm', 'hokm'), startedAt: new Date(clock.now() - 120_000).toISOString() }];
        await connected();
        pulse(3, 'one-game-on');

        const container = await show();

        clock.advance(30_000);
        server.watching = [{ ...row('table-ludo', 'ludo'), startedAt: new Date(clock.now() - 2000).toISOString() }, ...server.watching];
        pulse(4, 'two-games-on');
        await settle();

        const [newest, older] = [...container.querySelectorAll('ul > li')].map((one) => one.textContent ?? '');

        expect(newest).toContain('started now');
        expect(newest).not.toMatch(/started in /);
        expect(older).toContain('2 minutes ago');
    });

    it('does not say so either when this browser’s clock is behind the server’s', async () =>
    {
        server.watching = [{ ...row('table-hokm', 'hokm'), startedAt: new Date(clock.now() + 5 * 60_000).toISOString() }];

        const container = await show();

        expect(container.textContent).toContain('started now');
        expect(container.textContent).not.toMatch(/started in /);
    });

    it('narrows the list to one game and says so when nobody is playing it', async () =>
    {
        server.watching = [row('table-hokm', 'hokm')];

        const container = await show();
        const poker = [...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Poker'));

        fire(poker!, 'click');
        await settle();

        expect(container.textContent).toContain('Nobody is playing at an open table right now.');
        expect(server.calls.filter((call) => call === 'tables.watchable').length).toBeGreaterThanOrEqual(2);
    });
});
