import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import { RAIL } from '../src/components/app/nav-items.ts';
import LeaderboardPage from '../src/pages/app/leaderboard.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { routes } from '../src/routes.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { establishAccount, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

const settle = async () =>
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
    rules: { seats: [2, 4], modes: ['live'], targets: [], stakes: 'none', partners: 'none', hasCube: false, hasBlinds: false }
});

const show = async () =>
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
    useSession().establish(establishAccount());
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

    it('opens what can be done about somebody on the board at a press on their row', async () =>
    {
        server.standings = [
            { handle: 'sara.k', person: { handle: 'sara.k', displayName: 'Sara Kamali', hue: 340 }, rating: 1620, played: 40, won: 24, rank: 1, xp: 5200 },
            { handle: 'mina', person: { handle: 'mina', displayName: 'Mina Sadeghi', hue: 280 }, rating: 1480, played: 31, won: 15, rank: 2, xp: 3900 }
        ];
        useOverlay().reset();

        const container = await show();
        const rows = () => [...container.querySelectorAll<HTMLButtonElement>('ol > li > button')];

        await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 4000 });

        const mina = rows().find((one) => one.textContent?.includes('Mina Sadeghi'))!;

        expect(rows().every((one) => one.getAttribute('aria-haspopup') === 'dialog'), 'a row does not say it opens something').toBe(true);
        expect(rows().every((one) => one.type === 'button' && !one.hasAttribute('role')), 'a row is not a button to a screen reader').toBe(true);

        fire(mina, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].props).toMatchObject({ personId: 'mina' });
        useOverlay().reset();
    });

    it('marks the reader\'s own row, and nobody else\'s', async () =>
    {
        server.standings = [
            { handle: 'sara.k', person: { handle: 'sara.k', displayName: 'Sara Kamali', hue: 340 }, rating: 1620, played: 40, won: 24, rank: 1, xp: 5200 },
            { handle: 'alex', person: { handle: 'alex', displayName: 'Alex Morgan', hue: 32 }, rating: 1500, played: 22, won: 12, rank: 2, xp: 4100 }
        ];

        const container = await show();
        const rows = () => [...container.querySelectorAll<HTMLElement>('ol > li')];
        const marked = (row: HTMLElement) => [...row.querySelectorAll('span')].some((one) => one.textContent === useLocale().t('common.you') && !one.classList.contains('hidden'));

        await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 4000 });

        expect(rows().map(marked), 'the reader has to look for themselves').toEqual([false, true]);
        expect(rows().map((row) => row.classList.contains('bg-accent/8'))).toEqual([false, true]);
    });

    it('says a board nobody is on yet is empty, not that it failed to load', async () =>
    {
        const container = await show();

        expect(container.textContent).toContain('Nobody has finished a game here yet in this stretch.');
        expect(container.textContent).not.toContain('Could not load the leaderboard.');
    });

    describe('the game and the stretch of time chosen', () =>
    {
        const at = async (path: string) =>
        {
            const page = LeaderboardPage as unknown as () => HTMLElement;
            const table: Route[] = [{ path: '/app/leaderboard', component: page }];
            const router = createRouter({ routes: table, history: createMemoryHistory(path), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: page }) as Rendered);

            await settle();
            return { container, router };
        };

        const game = (container: HTMLElement, name: string) =>
            [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Choose a game"] button')].find((button) => button.textContent?.includes(name))!;

        const stretch = (container: HTMLElement, key: 'board.today' | 'board.month') =>
            [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button[aria-pressed]')].find((button) => button.textContent?.trim() === useLocale().t(key))!;

        it('opens on the game and the stretch of time the address names', async () =>
        {
            const { container } = await at('/app/leaderboard?game=ludo&window=today');

            expect(game(container, 'Ludo').getAttribute('aria-pressed')).toBe('true');
            expect(stretch(container, 'board.today').getAttribute('aria-pressed')).toBe('true');
            expect(server.boardsAsked).toEqual(['ludo today']);
        });

        it('writes each into the address with replace, and keeps the one that did not change', async () =>
        {
            const { container, router } = await at('/app/leaderboard');

            fire(game(container, 'Ludo'), 'click');
            await settle();

            expect(router.location().fullPath).toBe('/app/leaderboard?game=ludo');
            expect(router.location().navigationKind).toBe('replace');

            fire(stretch(container, 'board.today'), 'click');
            await settle();

            expect(router.location().fullPath).toBe('/app/leaderboard?game=ludo&window=today');

            fire(game(container, 'Hokm'), 'click');
            await settle();

            expect(router.location().fullPath, 'another game took the stretch of time back to a month').toBe('/app/leaderboard?game=hokm&window=today');
            expect(stretch(container, 'board.today').getAttribute('aria-pressed')).toBe('true');
            expect(server.boardsAsked.at(-1)).toBe('hokm today');

            fire(stretch(container, 'board.month'), 'click');
            await settle();

            expect(router.location().fullPath).toBe('/app/leaderboard?game=hokm');
        });

        it('shows the first game and a month for words it does not have', async () =>
        {
            const { container } = await at('/app/leaderboard?game=chess&window=decade');

            expect(game(container, 'Hokm').getAttribute('aria-pressed')).toBe('true');
            expect(stretch(container, 'board.month').getAttribute('aria-pressed')).toBe('true');
            expect(server.boardsAsked).toEqual(['hokm month']);
        });
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
