import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import GameHero from '../src/components/games/game-hero.component.azeroth';
import GameTile from '../src/components/games/game-tile.component.azeroth';
import CreateGamePage from '../src/pages/app/create-game.page.azeroth';
import GamePage from '../src/pages/app/game.page.azeroth';
import GamesPage from '../src/pages/app/games.page.azeroth';
import LeaderboardPage from '../src/pages/app/leaderboard.page.azeroth';
import { GAMES, type GameId } from '../src/data/games.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { establishAccount, server } from './fake-api.ts';
import { halfwayOut } from './leaving.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Status = 'available' | 'coming-soon' | 'disabled';

const settle = async () =>
{
    for (let i = 0; i < 8; i += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const summary = (id: string, status: Status): unknown => ({
    id,
    slug: id,
    nameKey: `game.${ id }.name`,
    blurbKey: `game.${ id }.blurb`,
    categoryKey: 'games.filter.cards',
    category: 'cards',
    minPlayers: 2,
    maxPlayers: 4,
    status,
    rules: { seats: [2, 4], modes: ['live'], targets: [], stakes: 'none', partners: 'none', hasCube: false, hasBlinds: false }
});

const catalogue = async (statuses: Partial<Record<GameId, Status>>) =>
{
    server.games = GAMES.map((game) => summary(game.id, statuses[game.id] ?? 'available'));
    useCatalogue().reset();
    await vi.waitFor(() => expect(useCatalogue().loading()).toBe(false), { timeout: 4000 });
};

const routed = async (path: string, routes: Route[]) =>
{
    const router = createRouter({ routes, history: createMemoryHistory(path), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const alone = async (draw: () => unknown) =>
{
    const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: draw as () => HTMLElement }) as HTMLElement);

    await settle();
    return container;
};

const game = (id: GameId) => GAMES.find((one) => one.id === id)!;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5000), seed: 4 });
    useLocale().setLocale('en');
    server.reset();
    useCatalogue().reset();
    useSession().establish(establishAccount());
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    resetRuntime();
});

describe('a game the staff paused, as a player sees it', () =>
{
    it('says Paused on its tile, where a game still coming says it is coming', async () =>
    {
        await catalogue({ poker: 'disabled', backgammon: 'coming-soon' });

        expect((await alone(() => GameTile({ game: game('poker') }))).textContent).toContain('Paused');

        cleanup();

        const coming = await alone(() => GameTile({ game: game('backgammon') }));

        expect(coming.textContent).toContain('Coming soon');
        expect(coming.textContent).not.toContain('Paused');
    });

    it('says on its page that it is paused and that the games on it are played to their end, and offers no play', async () =>
    {
        await catalogue({ poker: 'disabled' });

        const container = await alone(() => GameHero({ game: game('poker'), onQuickPlay: () => undefined }));

        expect(container.textContent).toContain(useLocale().t('games.pausedLead'));
        expect(container.textContent).not.toContain(useLocale().t('games.soonLead'));
        expect(container.textContent).not.toContain(useLocale().t('app.nav.quickPlay'));
    });

    it('offers no table to open while it is paused, and says why', async () =>
    {
        await catalogue({ poker: 'disabled' });

        const container = await routed('/app/games/poker/create', [{ path: '/app/games/:slug/create', component: () => CreateGamePage({}) as unknown as HTMLElement }]);

        expect(container.querySelector('form')).toBeNull();
        expect(container.textContent).toContain('Paused');
        expect(container.textContent).toContain(useLocale().t('games.pausedLead'));
    });

    it('says on the games page that a paused game says so, beside a game still being built', async () =>
    {
        const lead = (root: HTMLElement) => root.querySelector('h1')?.parentElement?.querySelector('p')?.textContent?.trim();

        await catalogue({ poker: 'disabled' });

        let container = await routed('/app/games', [{ path: '/app/games', component: () => GamesPage({}) as unknown as HTMLElement }]);

        expect(lead(container)).toBe(`${ useLocale().t('games.lead') } ${ useLocale().t('games.leadPaused') }`);

        cleanup();
        await catalogue({ poker: 'disabled', backgammon: 'coming-soon' });
        container = await routed('/app/games', [{ path: '/app/games', component: () => GamesPage({}) as unknown as HTMLElement }]);

        expect(lead(container)).toBe(`${ useLocale().t('games.lead') } ${ useLocale().t('games.leadSoon') } ${ useLocale().t('games.leadPaused') }`);
    });

    it('keeps the board of a paused game on the leaderboard, and leaves out one still coming', async () =>
    {
        await catalogue({ hokm: 'disabled', poker: 'coming-soon' });

        const container = await routed('/app/leaderboard', [{ path: '/app/leaderboard', component: () => LeaderboardPage({}) as unknown as HTMLElement }]);

        expect([...container.querySelectorAll('[aria-label="Choose a game"] button')].map((one) => one.textContent?.trim())).toEqual(['Hokm', 'Backgammon', 'Ludo']);
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        await catalogue({ poker: 'disabled' });

        expect((await alone(() => GameTile({ game: game('poker') }))).textContent).toContain('متوقف');
    });
});

describe('a game\'s pages while they are being left', () =>
{
    it('keep the game they were built for, and never say there is no such game', async () =>
    {
        await catalogue({});

        const name = useLocale().t(game('ludo').nameKey);
        const pages: [string, Route][] = [
            ['/app/games/ludo', { path: '/app/games/:slug', component: () => GamePage({}) as unknown as HTMLElement }],
            ['/app/games/ludo/create', { path: '/app/games/:slug/create', component: () => CreateGamePage({}) as unknown as HTMLElement }]
        ];

        for (const [at, route] of pages)
        {
            const container = await halfwayOut([route], at, (root) => root.textContent?.includes(name) === true);

            expect(container.textContent, at).toContain(name);
            expect(container.textContent, at).not.toContain(useLocale().t('game.notFound'));
            cleanup();
        }
    });
});
