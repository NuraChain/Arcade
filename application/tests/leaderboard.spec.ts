import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import { RAIL } from '../src/components/app/nav-items.ts';
import LeaderboardPage from '../src/pages/app/leaderboard.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { routes } from '../src/routes.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
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

const summary = (id: string, status: 'available' | 'coming-soon'): unknown => ({
    id,
    slug: id,
    nameKey: `game.${ id }.name`,
    blurbKey: `game.${ id }.blurb`,
    categoryKey: 'games.filter.cards',
    category: 'cards',
    minPlayers: 2,
    maxPlayers: 4,
    status,
    rules: { seats: [2, 4], modes: ['live'], targets: [], stakes: 'none', partners: false, hasCube: false, hasBlinds: false }
});

const show = async (): Promise<HTMLElement> =>
{
    const page = LeaderboardPage as unknown as () => HTMLElement;
    const table: Route[] = [{ path: '/app/leaderboard', component: page }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/leaderboard'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: page }) as Rendered);
    await settle();
    return container;
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5000), seed: 4 });
    useLocale().setLocale('en');
    server.reset();
    server.games = [summary('hokm', 'available'), summary('poker', 'coming-soon'), summary('backgammon', 'coming-soon'), summary('ludo', 'available')];
    useCatalogue().reset();
    await useAccount().signIn('Alex');
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
});

describe('the leaderboard page', () =>
{
    it('offers only the games a board can exist for, and shows the first one', async () =>
    {
        const container = await show();
        const choices = [...container.querySelectorAll('[aria-label="Choose a game"] button')].map((button) => button.textContent?.trim());

        expect(choices).toEqual(['Hokm', 'Ludo']);
        expect(container.querySelector('[aria-label="Choose a game"] button[aria-pressed="true"]')?.textContent).toContain('Hokm');
        expect(server.calls).toContain('catalogue.leaderboard');
    });

    it('moves to another game’s board when that game is chosen', async () =>
    {
        const container = await show();
        const before = server.calls.filter((call) => call === 'catalogue.leaderboard').length;
        const ludo = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Choose a game"] button')].find((button) => button.textContent?.includes('Ludo'))!;

        fire(ludo, 'click');
        await settle();

        expect(ludo.getAttribute('aria-pressed')).toBe('true');
        expect(server.calls.filter((call) => call === 'catalogue.leaderboard').length).toBeGreaterThan(before);
    });

    it('points every sidebar destination at a route that exists', () =>
    {
        const declared = routes.flatMap((route) => (route.children ?? []).map((child) => `${ route.path }${ child.path === '' ? '' : `/${ child.path }` }`));
        for (const item of RAIL)
        {
            expect(declared).toContain(item.to);
        }
    });
});
