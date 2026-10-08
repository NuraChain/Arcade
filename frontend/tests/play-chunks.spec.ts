import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import PlayPage from '../src/pages/app/play.page.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { resetChunks } from '../src/lib/chunks.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const asked = vi.hoisted(() => ({ lobby: 0, watch: 0 }));

vi.mock('../src/components/games/lobby-panel.component.azeroth', () =>
{
    asked.lobby += 1;
    throw new Error('Failed to fetch dynamically imported module');
});

vi.mock('../src/components/games/watch-board.component.azeroth', () =>
{
    asked.watch += 1;
    throw new Error('Failed to fetch dynamically imported module');
});

let reloads = 0;

let answering = false;

const reloaded = () =>
{
    reloads += 1;
};

const settle = async () =>
{
    for (let i = 0; i < 12; i += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const tables = client.tables as unknown as Record<string, (input: unknown) => Promise<unknown>>;

const view = tables.view;

const held = () =>
{
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => open = resolve);

    tables.view = async (input) =>
    {
        await gate;

        return await view(input);
    };

    return () => open();
};

const page = (id: string) =>
{
    const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered).container;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    reloads = 0;
    answering = false;
    setRuntime({ clock: manualClock(400_000), seed: 11, reload: reloaded });
    sessionStorage.clear();
    resetChunks();
    vi.stubGlobal('fetch', async () =>
    {
        if (!answering)
        {
            throw new TypeError('Failed to fetch');
        }

        return { status: 200 };
    });
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        isMinor: false
    });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    useCatalogue().reset();
    useLobby().reset();
});

afterEach(() =>
{
    tables.view = view;
    server.me = 'alex';
    cleanup();
    useLobby().reset();
    useRealtime().reset();
    vi.unstubAllGlobals();
});

describe('a watcher\'s board, fetched when somebody is watching', () =>
{
    const watched = async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 4, privacy: 'public' }, []);
        const table = server.tables.find((one) => one.id === id)!;

        server.watches['match-9'] = {
            match: {
                id: 'match-9',
                tableId: id,
                game: 'ludo',
                rev: 3,
                seats: 4,
                players: [],
                turn: 0,
                startedAt: new Date(400_000).toISOString(),
                view: { kind: 'ludo', moves: [], controls: 0, seats: [] }
            },
            behind: 30,
            delay: 30,
            live: true
        };
        table.matchId = 'match-9';
        server.me = 'omid.k';

        return id;
    };

    afterEach(() =>
    {
        delete server.watches['match-9'];
    });

    it('says it could not be loaded when it will not come and the server is not answering, and loads the page again once it is asked to and the server is back', async () =>
    {
        const before = asked.watch;
        const container = page(await watched());

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

        const alert = container.querySelector('[role="alert"]')!;

        expect(asked.watch).toBe(before + 1);
        expect(reloads).toBe(0);

        fire(alert.querySelector('button')!, 'click');
        await settle();

        expect(reloads).toBe(0);
        expect(asked.watch).toBe(before + 1);
        expect(container.querySelector('[role="alert"]')).toBe(alert);

        await useLobby().refresh();
        await settle();

        expect(asked.watch).toBe(before + 1);
        expect(container.querySelector('[role="alert"]')).toBe(alert);

        answering = true;
        fire(alert.querySelector('button')!, 'click');

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 4000 });
    });

    it('loads the page again by itself when the server answers, and draws no complaint on the way', async () =>
    {
        answering = true;

        const container = page(await watched());

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 4000 });
        await settle();

        expect(container.querySelector('[role="alert"]')).toBeNull();
    });
});

describe('the waiting room of a table, fetched when it is wanted', () =>
{
    it('is asked for as the page opens for somebody known to be sitting there, before the table has answered', async () =>
    {
        const id = await useLobby().host('ludo', defaultTable('ludo'), []);

        await vi.waitFor(() => expect(useLobby().seated().some((one) => one.id === id)).toBe(true), { timeout: 4000 });

        const release = held();
        const before = asked.lobby;
        const container = page(id);

        await vi.waitFor(() => expect(asked.lobby).toBe(before + 1), { timeout: 4000 });

        expect(container.querySelector('h1')).toBeNull();

        release();

        await vi.waitFor(() => expect(container.querySelector('h1')).not.toBeNull(), { timeout: 4000 });
        await settle();

        expect(asked.lobby).toBe(before + 1);
    });

    it('waits for the table when nothing yet says the reader sits there, and is asked for once', async () =>
    {
        const listed = tables.mine;
        const known = await useLobby().host('ludo', defaultTable('ludo'), []);
        const id = 'not-listed-yet';

        server.tables.find((one) => one.id === known)!.id = id;
        tables.mine = async () => await new Promise(() => undefined);

        try
        {
            const release = held();
            const before = asked.lobby;
            const container = page(id);

            await settle();

            expect(asked.lobby).toBe(before);

            release();

            await vi.waitFor(() => expect(asked.lobby).toBe(before + 1), { timeout: 4000 });
            await settle();

            expect(container.querySelector('h1')).not.toBeNull();
            expect(asked.lobby).toBe(before + 1);
        }
        finally
        {
            tables.mine = listed;
        }
    });

    it('says it could not be loaded when it will not come and the server is not answering, keeps the table\'s header, and loads the page again once it is asked to and the server is back', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', defaultTable('ludo'), []);
        const before = asked.lobby;
        const container = page(id);

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

        const heading = container.querySelector('h1');
        const alert = container.querySelector('[role="alert"]')!;

        expect(heading).not.toBeNull();
        expect(alert.textContent).toContain(useLocale().t('state.errorTitle'));
        expect(asked.lobby).toBe(before + 1);
        expect(reloads).toBe(0);

        server.tables.find((one) => one.id === id)!.chairs[1] = { seat: 1, who: 'sara.k', ready: false, host: false };
        await lobby.refresh();
        await settle();

        expect(asked.lobby).toBe(before + 1);
        expect(container.querySelector('[role="alert"]')).toBe(alert);

        fire(alert.querySelector('button')!, 'click');
        await settle();

        expect(reloads).toBe(0);
        expect(asked.lobby).toBe(before + 1);
        expect(container.querySelector('[role="alert"]')).toBe(alert);
        expect(container.querySelector('h1')).toBe(heading);

        answering = true;
        fire(alert.querySelector('button')!, 'click');

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 4000 });
    });

    it('loads the page again by itself when the server answers, and draws no complaint on the way', async () =>
    {
        answering = true;

        const container = page(await useLobby().host('ludo', defaultTable('ludo'), []));

        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 4000 });
        await settle();

        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('is never asked for at a table with a game on, before the game has been fetched or after', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', defaultTable('ludo'), []);
        const matches = client.matches as unknown as Record<string, unknown>;
        let hand = (_match: unknown): void => undefined;

        server.tables.find((one) => one.id === id)!.matchId = 'match-7';
        await lobby.refresh();
        matches.view = async () => await new Promise((resolve) => hand = resolve);

        try
        {
            const before = asked.lobby;
            const container = page(id);

            await vi.waitFor(() => expect(container.querySelector('h1')).not.toBeNull(), { timeout: 4000 });
            await settle();

            expect(asked.lobby).toBe(before);

            hand({
                id: 'match-7',
                tableId: id,
                game: 'chess',
                rev: 1,
                seats: 2,
                players: [],
                turn: 0,
                mine: 0,
                startedAt: new Date(400_000).toISOString(),
                view: { kind: 'ludo' }
            });

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('match.cannotDraw')), { timeout: 4000 });

            expect(asked.lobby).toBe(before);
        }
        finally
        {
            delete matches.view;
        }
    });

    it('takes the complaint back once a game is on the board, where no waiting room is wanted', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', defaultTable('ludo'), []);
        const container = page(id);

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

        const matches = client.matches as unknown as Record<string, unknown>;

        matches.view = async () => ({
            id: 'match-7',
            tableId: id,
            game: 'chess',
            rev: 1,
            seats: 2,
            players: [],
            turn: 0,
            mine: 0,
            startedAt: new Date(400_000).toISOString(),
            view: { kind: 'ludo' }
        });

        try
        {
            server.tables.find((one) => one.id === id)!.matchId = 'match-7';
            await lobby.refresh();

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('match.cannotDraw')), { timeout: 4000 });

            expect(container.querySelector('[role="alert"]')).toBeNull();
        }
        finally
        {
            delete matches.view;
        }
    });
});
