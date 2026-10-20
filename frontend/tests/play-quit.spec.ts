import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import type { MatchView } from '../src/api.ts';
import PlayPage from '../src/pages/app/play.page.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { resetChunks } from '../src/lib/chunks.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const SEATED = ['alex', 'sara.k', 'reza.t', 'mina'];

const COLOURS = ['red', 'green', 'yellow', 'blue'];

const matches = client.matches as unknown as Record<string, unknown>;

const walkedOut = (tableId: string) => ({
    id: `live-${ tableId }`,
    tableId,
    game: 'ludo',
    rev: 9,
    seats: 4,
    players: SEATED.map((who, seat) => ({ seat, who, timeouts: 0, ...(seat === 0 ? { result: 'abandoned', exit: 'left' } : {}) })),
    turn: 1,
    mine: 0,
    startedAt: new Date(400_000).toISOString(),
    view: {
        kind: 'ludo',
        moves: [],
        controls: 1,
        seats: COLOURS.map((colour, seat) => ({ seat, colour, tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })), home: 0, out: seat === 0, side: seat }))
    }
} as MatchView);

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 11 });
    sessionStorage.clear();
    resetChunks();
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    socket.deliver({ v: 1, t: 'presence', n: 1, full: true, people: SEATED.map((who) => ({ who, state: 'online' as const, since: 0 })) });
    useCatalogue().reset();
});

afterEach(() =>
{
    cleanup();
    useBoard().close();
    useRealtime().reset();
    delete matches.view;
    vi.restoreAllMocks();
});

describe('a chair given up from somewhere else, at a board that is on the page', () =>
{
    it('lets a ludo board go without telling it that its game is gone: one board is left, the watcher\'s, and nothing on the page throws', async () =>
    {
        const thrown: unknown[] = [];
        const caught = (event: ErrorEvent | PromiseRejectionEvent) => thrown.push('reason' in event ? event.reason : event.error);
        const complaints = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        window.addEventListener('error', caught);
        window.addEventListener('unhandledrejection', caught);

        try
        {
            const id = await useLobby().host('ludo', { ...defaultTable('ludo'), seats: 4, privacy: 'public' }, []);
            const held = server.tables.find((one) => one.id === id)!;

            for (const chair of held.chairs)
            {
                chair.who = SEATED[chair.seat];
            }

            held.matchId = `live-${ id }`;
            matches.view = async () => walkedOut(id);
            server.outOfGame[held.matchId] = ['alex'];

            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(container.querySelector('.table-stage .ludo-frame')).not.toBeNull(), { timeout: 8000 });

            expect(container.querySelector('[data-gone]')).not.toBeNull();

            const { mine: _theirs, ...watched } = walkedOut(id);

            server.watches[held.matchId] = { match: watched, behind: 30, delay: 30, live: true };
            delete held.chairs[0].who;
            await useLobby().refresh();

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('watch.title')), { timeout: 8000 });
            await vi.waitFor(() => expect(container.querySelector('.table-stage .ludo-frame'), 'the watcher was never shown the board').not.toBeNull(), { timeout: 8000 });

            expect(thrown, 'the board was told its game was gone while it was still on the page').toEqual([]);
            expect(complaints.mock.calls.map((call) => String(call[0])), 'something on the page complained while the board was let go').toEqual([]);
            expect(container.querySelector('[data-gone]'), 'the board of a chair they no longer hold stayed on the page').toBeNull();
            expect(container.querySelectorAll('.table-stage'), 'the game is drawn twice, once as theirs and once as a watcher\'s').toHaveLength(1);
            expect(useBoard().match(), 'the board of a game they are no longer in is still held').toBeNull();
        }
        finally
        {
            window.removeEventListener('error', caught);
            window.removeEventListener('unhandledrejection', caught);
        }
    });
});
