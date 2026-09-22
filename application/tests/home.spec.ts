import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import HomePage from '../src/pages/app/home.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRecord } from '../src/stores/record.store.ts';
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
    const Stub = (): HTMLElement => document.createElement('div');
    const table: Route[] = [{ path: '/app', component: HomePage as unknown as () => HTMLElement, children: [{ path: 'games/:slug', component: Stub }] }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: HomePage as unknown as () => HTMLElement }) as Rendered);
    await settle();
    return container;
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5000), seed: 3 });
    useLocale().setLocale('en');
    server.reset();
    useCatalogue().reset();
    useRecord().reset();
    await useAccount().signIn('Alex');
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
    useLocale().setLocale('en');
});

describe('the home page', () =>
{
    it('leads with the design’s two-line headline, the second line in the accent', async () =>
    {
        const container = await show();
        const heading = container.querySelector('h1')!;

        expect(heading.textContent).toContain('Play something');
        expect(heading.querySelector('.text-accent')?.textContent).toBe('amazing today');
    });

    it('says the count the server really has, and calls it people at the tables rather than online', async () =>
    {
        server.live = [{ game: 'hokm', playing: 7, tables: 2 }, { game: 'ludo', playing: 5, tables: 1 }];
        useCatalogue().reset();
        const container = await show();

        expect(container.textContent).toContain('12');
        expect(container.textContent).toContain('people at the tables right now');
        expect(container.textContent).not.toMatch(/online now/i);
    });

    it('draws no continue-playing section for somebody sitting nowhere', async () =>
    {
        const container = await show();

        expect(container.textContent).not.toContain('Continue playing');
    });

    it('says where finished games will appear instead of drawing an empty box', async () =>
    {
        const container = await show();

        expect(container.textContent).toContain('Games you finish show up here');
    });

    it('offers every game as a tile that opens its page', async () =>
    {
        const container = await show();
        const tiles = [...container.querySelectorAll('a[href^="/app/games/"]')].map((link) => link.getAttribute('href'));

        for (const slug of ['/app/games/ludo', '/app/games/hokm', '/app/games/backgammon', '/app/games/poker'])
        {
            expect(tiles).toContain(slug);
        }
    });

    it('reads the headline in Persian with its accent word kept in the accent', async () =>
    {
        useLocale().setLocale('fa');
        const container = await show();

        expect(container.querySelector('h1 .text-accent')?.textContent).toBe('به‌یادماندنی');
    });
});
