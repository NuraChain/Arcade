import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import WatchPage from '../src/pages/app/watch.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

const settle = async (): Promise<void> =>
{
    for (let i = 0; i < 8; i += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const show = async (): Promise<HTMLElement> =>
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

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5000), seed: 4 });
    useLocale().setLocale('en');
    server.reset();
});

afterEach(() => cleanup());

describe('the live games page', () =>
{
    it('lists every game being played at a public table, each a way in to watch it', async () =>
    {
        server.watching = [row('table-hokm', 'hokm'), row('table-ludo', 'ludo')];

        const container = await show();
        const links = [...container.querySelectorAll<HTMLAnchorElement>('a')].filter((one) => one.textContent?.trim() === 'Watch');

        expect(links.map((one) => one.getAttribute('href'))).toEqual(['/app/play/table-hokm', '/app/play/table-ludo']);
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
