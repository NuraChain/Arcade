import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import GamesPage from '../src/pages/app/games.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { establishAccount, server } from './fake-api.ts';

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
    const page = GamesPage as unknown as () => HTMLElement;
    const table: Route[] = [{ path: '/app/games', component: page }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/games'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: page }) as Rendered);

    await settle();
    return container;
};

const open = async (path: string) =>
{
    const page = GamesPage as unknown as () => HTMLElement;
    const table: Route[] = [{ path: '/app/games', component: page }];
    const router = createRouter({ routes: table, history: createMemoryHistory(path), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: page }) as Rendered);

    await settle();
    return { container, router };
};

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
    resetRuntime();
});

describe('the games page', () =>
{
    const lead = (container: HTMLElement) => container.querySelector('h1')?.parentElement?.querySelector('p')?.textContent?.trim();

    it.each(['en', 'fa'] as const)('says nothing of games still being built while none is, in %s', async (language) =>
    {
        useLocale().setLocale(language);
        server.games = ['hokm', 'poker', 'backgammon', 'ludo', 'chess'].map((id) => summary(id, 'available'));
        useCatalogue().reset();

        const container = await show();

        await vi.waitFor(() => expect(useCatalogue().loading()).toBe(false), { timeout: 4000 });

        expect(container.querySelectorAll('ul li article')).toHaveLength(5);

        expect(lead(container)).toBe(useLocale().t('games.lead'));
    });

    it('says so on the page once one of them is', async () =>
    {
        server.games = ['hokm', 'poker', 'backgammon', 'ludo', 'chess'].map((id) => summary(id, id === 'poker' ? 'coming-soon' : 'available'));
        useCatalogue().reset();

        const container = await show();

        await vi.waitFor(() => expect(useCatalogue().loading()).toBe(false), { timeout: 4000 });

        expect(container.querySelectorAll('ul li article')).toHaveLength(5);

        await vi.waitFor(() => expect(lead(container), 'a game still being built goes unsaid').toBe(`${ useLocale().t('games.lead') } ${ useLocale().t('games.leadSoon') }`), { timeout: 4000 });
    });

    it('lays two cards to a row at a phone\'s width and keeps a game\'s words for a card wide enough to read them', async () =>
    {
        server.games = ['hokm', 'poker', 'backgammon', 'ludo', 'chess'].map((id) => summary(id, 'available'));
        useCatalogue().reset();

        const container = await show();

        await vi.waitFor(() => expect(useCatalogue().loading()).toBe(false), { timeout: 4000 });

        expect(container.querySelectorAll('ul li article')).toHaveLength(5);

        const grid = container.querySelector('ul li article')!.closest('ul')!;
        const words = container.querySelector('ul li article p');

        expect(grid.className.split(' '), 'a phone gets one card to a row').toContain('grid-cols-2');
        expect([...grid.querySelectorAll(':scope > li')].every((one) => one.classList.contains('@container')), 'a card cannot ask how wide it is').toBe(true);
        expect(words?.className.split(' ')).toEqual(['hidden', 'text-ui-sm', 'text-muted', '@[13rem]:line-clamp-2']);
    });

    describe('the kind of game chosen', () =>
    {
        const games = () => ['hokm', 'poker', 'backgammon', 'ludo', 'chess'].map((id) => Object.assign({}, summary(id, 'available'), { category: id === 'hokm' || id === 'poker' ? 'cards' : 'board' }));

        const chip = (container: HTMLElement, key: 'games.filter.all' | 'games.category.cards' | 'games.category.board') =>
            [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((one) => one.textContent?.includes(useLocale().t(key)))!;

        it('is read from the address, so a reload and Back come back to it', async () =>
        {
            server.games = games();
            useCatalogue().reset();

            const { container } = await open('/app/games?category=board');

            await vi.waitFor(() => expect(useCatalogue().loading()).toBe(false), { timeout: 4000 });

            expect(container.querySelectorAll('ul li article')).toHaveLength(3);
            expect(chip(container, 'games.category.board').getAttribute('aria-pressed')).toBe('true');
            expect(chip(container, 'games.filter.all').getAttribute('aria-pressed')).toBe('false');
        });

        it('is written into the address with replace, and All takes it out', async () =>
        {
            server.games = games();
            useCatalogue().reset();

            const { container, router } = await open('/app/games');

            await vi.waitFor(() => expect(useCatalogue().loading()).toBe(false), { timeout: 4000 });

            chip(container, 'games.category.cards').click();
            await settle();

            expect(router.location().fullPath).toBe('/app/games?category=cards');
            expect(router.location().navigationKind).toBe('replace');
            expect(container.querySelectorAll('ul li article')).toHaveLength(2);

            chip(container, 'games.filter.all').click();
            await settle();

            expect(router.location().fullPath).toBe('/app/games');
            expect(container.querySelectorAll('ul li article')).toHaveLength(5);
        });

        it('shows every game for a kind it does not have', async () =>
        {
            server.games = games();
            useCatalogue().reset();

            const { container } = await open('/app/games?category=chess');

            await vi.waitFor(() => expect(useCatalogue().loading()).toBe(false), { timeout: 4000 });

            expect(container.querySelectorAll('ul li article')).toHaveLength(5);
            expect(chip(container, 'games.filter.all').getAttribute('aria-pressed')).toBe('true');
        });
    });
});
