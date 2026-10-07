import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import HomePage from '../src/pages/app/home.page.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRecord } from '../src/stores/record.store.ts';
import type { MatchHistoryEntry } from '../src/api.ts';
import { client, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

const voided: MatchHistoryEntry = {
    id: 'match-void',
    game: 'ludo',
    finishedAt: new Date(4000).toISOString(),
    result: 'void',
    players: ['alex', 'sara.k']
};

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

    it('keeps the tables the reader sits at, and shows what changed at one, when the list is read again', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 4 }, []);
        const container = await show();
        const rows = () => [...container.querySelectorAll('section[aria-labelledby="home-continue"] li')];

        await vi.waitFor(() => expect(rows()).toHaveLength(1), { timeout: 4000 });

        const row = rows()[0];
        const first = lobby.seated()[0];
        const reads = server.calls.filter((one) => one === 'tables.mine').length;

        const held = server.tables.find((one) => one.id === id)!;

        held.chairs[1].who = 'sara.k';
        held.taken = 2;
        await lobby.refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'tables.mine').length, 'the list was not read again').toBeGreaterThan(reads);
        expect(lobby.seated()[0], 'the list came back as the same object').not.toBe(first);
        expect(rows()[0], 'the row was drawn again').toBe(row);
        expect(row.textContent, 'a chair that filled is not on the row that was kept').toContain('2/4');
    });

    it('says where finished games will appear instead of drawing an empty box', async () =>
    {
        const container = await show();

        expect(container.textContent).toContain('Games you finish show up here');
    });

    it('says a game that never counted did not count', async () =>
    {
        server.history = [voided];
        const container = await show();

        expect(container.textContent).toContain('A game of Ludo did not count');
    });

    it('says it in Persian too', async () =>
    {
        useLocale().setLocale('fa');
        server.history = [voided];
        const container = await show();

        expect(container.textContent).toContain('یک بازی منچ حساب نشد');
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

    it('spins on its quick play button while a seat is being found, says so, and sends one request for two presses', async () =>
    {
        useLobby().reset();

        const container = await show();
        const hero = container.querySelector<HTMLElement>('section[aria-labelledby="home-hero"]')!;
        const button = [...hero.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'Quick play')!;
        const tables = client.tables as unknown as Record<string, (input: unknown) => Promise<unknown>>;
        const real = tables.quick;
        const answers: (() => void)[] = [];

        tables.quick = async (input) =>
        {
            await new Promise<void>((resolve) =>
            {
                answers.push(resolve);
            });

            return await real(input);
        };

        try
        {
            expect(button.getAttribute('aria-busy')).not.toBe('true');

            fire(button, 'click');
            fire(button, 'click');
            await settle();

            expect(button.getAttribute('aria-busy')).toBe('true');
            expect(button.getAttribute('aria-disabled')).toBe('true');
            expect(hero.querySelector('[role="status"]')?.textContent).toBe('Finding you a seat');
            expect(answers).toHaveLength(1);

            answers[0]();
            await settle();

            expect(server.tables).toHaveLength(1);
            expect(button.getAttribute('aria-busy'), 'the button was let go before the table’s page had arrived').toBe('true');

            useLobby().open(server.tables[0].id);
            await settle();

            expect(button.getAttribute('aria-busy')).not.toBe('true');
            expect(hero.querySelector('[role="status"]')?.textContent).toBe('');
        }
        finally
        {
            tables.quick = real;
            useLobby().reset();
        }
    });
});
