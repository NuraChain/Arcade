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
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const asked = vi.hoisted(() => ({ watch: 0 }));

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
        kind: 'guest',
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
