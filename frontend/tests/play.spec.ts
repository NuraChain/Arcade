import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, createSignal, type Route } from 'azerothjs';

/** The handles this suite seats. A presence frame names people, and these are the people. */
const SEATED = ['alex', 'sara.k', 'reza.t', 'mina', 'nima.f', 'leila.a'];

import GameCard from '../src/components/games/game-card.component.azeroth';
import PlayHeader from '../src/components/games/play-header.component.azeroth';
import TableChat from '../src/components/games/table-chat.component.azeroth';
import TableDock from '../src/components/games/table-dock.component.azeroth';
import TableMenu from '../src/components/games/table-menu.component.azeroth';
import TurnClock from '../src/components/games/turn-clock.component.azeroth';
import WatchBoard from '../src/components/games/watch-board.component.azeroth';
import { BOARDS } from '../src/components/games/boards.ts';
import type { MatchView, MatchWatch } from '../src/api.ts';
import ChatPage from '../src/pages/app/chat.page.azeroth';
import PlayPage from '../src/pages/app/play.page.azeroth';
import { gameArt, gameIcon } from '../src/components/games/art.ts';
import { GAMES } from '../src/data/games.ts';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import type { MessageKey } from '../src/locales/en.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { IDLE_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useConnection } from '../src/stores/connection.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { UNREACHED_MS, setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { leaveLead } from '../src/lib/open-table.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const chunk = vi.hoisted(() => ({ asked: 0 }));

const sheetSize = vi.hoisted(() => ({ forced: null as null | { pad: number; height: number }, fold: null as null | boolean }));

vi.mock('../src/lib/sheet-room.ts', async (real) =>
{
    const actual = await real<typeof import('../src/lib/sheet-room.ts')>();

    return {
        ...actual,
        watchSheet: (arena: HTMLElement, sheet: HTMLElement, settle: (size: { pad: number; height: number } | null) => void) =>
        {
            if (sheetSize.forced === null)
            {
                return actual.watchSheet(arena, sheet, settle);
            }

            settle(sheetSize.forced);
            return () => undefined;
        },
        watchFold: (arena: HTMLElement, settle: (fold: boolean) => void) =>
        {
            if (sheetSize.fold === null)
            {
                return actual.watchFold(arena, settle);
            }

            settle(sheetSize.fold);
            return () => undefined;
        }
    };
});

vi.mock('../src/components/games/match-board.component.azeroth', () =>
{
    chunk.asked += 1;
    throw new Error('Failed to fetch dynamically imported module');
});

let clock: ManualClock;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(400_000);
    setRuntime({ clock, seed: 11 });
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

    // Matchmaking seats the people the socket says are here, so the test has to fill the room.
    socket.deliver({
        v: 1,
        t: 'presence',
        n: 1,
        full: true,
        people: SEATED.map((who) => ({ who, state: 'online' as const, since: 0 }))
    });

    useCatalogue().reset();
});

afterEach(() =>
{
    cleanup();
    useRealtime().reset();
});

describe('game artwork', () =>
{
    it('draws every game as one vector scene and one vector icon, sharp at any width', () =>
    {
        for (const game of GAMES)
        {
            expect(gameArt(game.id)).toBe(`/art/games/${ game.id }.svg`);
            expect(gameIcon(game.id)).toBe(`/art/games/${ game.id }-icon.svg`);
        }
    });
});

describe('GameCard', () =>
{
    const settle = async () =>
    {
        for (let i = 0; i < 6; i += 1)
        {
            await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
    };

    const summary = (id: string, status: 'available' | 'coming-soon'): unknown => ({
        id,
        slug: id,
        nameKey: `game.${ id }.name`,
        blurbKey: `game.${ id }.blurb`,
        categoryKey: 'games.filter.cards',
        category: 'cards',
        minPlayers: 2,
        maxPlayers: 8,
        status,
        rules: { seats: [2, 4, 6, 8], modes: ['live'], targets: [], stakes: 'play-money', partners: 'none', hasCube: false, hasBlinds: true }
    });

    const shown = (id: string) =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const table: Route[] = [{ path: '/app', component: Stub, children: [{ path: 'games/:slug', component: Stub }] }];
        const router = createRouter({ routes: table, history: createMemoryHistory('/app'), scroll: false });
        const game = GAMES.find((one) => one.id === id)!;
        const { container } = renderTest(() => RouterProvider({ router, children: () => GameCard({ game }) }) as Rendered);

        return { container, router };
    };

    const mount = (id: string) => shown(id).container;

    it('opens the game from its Play now, as its picture and its name do, and looks for no table', async () =>
    {
        const { container, router } = shown('hokm');
        await settle();

        expect(container.querySelector('img')?.getAttribute('src')).toBe('/art/games/hokm.svg');
        expect(container.querySelector('button'), 'a card leads to the game: nothing on it acts by itself').toBeNull();

        const play = [...container.querySelectorAll('a')].find((one) => one.textContent?.trim() === 'Play now');

        expect(play, 'the card says Play now').toBeDefined();
        expect(play!.getAttribute('href')).toBe('/app/games/hokm');
        expect(play!.getAttribute('aria-label')).toBe('Play now: Hokm');
        expect([...container.querySelectorAll('a')].map((one) => one.getAttribute('href'))).toEqual(['/app/games/hokm', '/app/games/hokm', '/app/games/hokm']);

        const asked = server.calls.length;

        play!.click();
        await settle();

        expect(router.location().pathname).toBe('/app/games/hokm');
        expect(server.calls.slice(asked), 'pressing Play now on a card looked for a table').not.toContain('tables.quick');
        expect(useLobby().finding()).toEqual([]);
    });

    it('names the game in Persian on the same control', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = shown('hokm');
        await settle();

        const play = [...container.querySelectorAll('a')].find((one) => one.textContent?.trim() === useLocale().t('games.play'));

        expect(play?.getAttribute('aria-label')).toBe(useLocale().t('games.playGame', { game: useLocale().t(GAMES.find((one) => one.id === 'hokm')!.nameKey) }));
        expect(play?.getAttribute('aria-label')).not.toBe('Play now: Hokm');
    });

    it('offers no play and no Live pill for a game the server says is still coming', async () =>
    {
        server.games = [summary('poker', 'coming-soon')];
        server.live = [{ game: 'poker', playing: 5, tables: 1 }];
        useCatalogue().reset();
        const container = mount('poker');
        await settle();

        expect(container.textContent).not.toContain('Live');
        const button = container.querySelector('button')!;
        expect(button.disabled).toBe(true);
        expect(button.textContent).toContain('Coming soon');
        expect(container.textContent, 'a game that cannot be played yet says Play now').not.toContain('Play now');
    });

    it('holds its call to action until the catalogue has answered', () =>
    {
        useCatalogue().reset();
        const container = mount('poker');

        expect(container.querySelector('button'), 'a Play button before the answer could be one the server refuses').toBeNull();
        expect(container.textContent, 'a Play now before the answer could lead to a game that is not open yet').not.toContain('Play now');
        expect(container.textContent).not.toContain('Live');
    });
});

describe('PlayHeader', () =>
{
    const table = (id: string, game: string, extra: Record<string, unknown> = {}) => ({
        id,
        code: id.toUpperCase(),
        game,
        seats: 4,
        mode: 'turns',
        privacy: 'public',
        target: 7,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        status: 'playing',
        chairs: [],
        taken: 4,
        createdAt: '2026-09-22T00:00:00.000Z',
        ...extra
    }) as never;

    const mount = (current: never, others: never[], compact = false): HTMLElement =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const routes: Route[] = [{ path: '/app', component: Stub, children: [{ path: 'play/:id', component: Stub }] }];
        const router = createRouter({ routes, history: createMemoryHistory('/app/play/one'), scroll: false });
        return renderTest(() => RouterProvider({ router, children: () => PlayHeader({ table: current, others, compact }) }) as Rendered).container;
    };

    it('keeps only the tables waiting on the reader when compact, each a named switch in the title row, with the count still spoken', () =>
    {
        const container = mount(table('one', 'hokm'), [table('two', 'ludo', { yourTurn: true }), table('three', 'hokm', { yourTurn: false }), table('four', 'poker', { yourTurn: true })], true);
        const links = [...container.querySelectorAll('nav a')] as HTMLAnchorElement[];

        expect(links.map((link) => link.getAttribute('href'))).toEqual(['/app/play/two', '/app/play/four']);
        expect(links[0].textContent).toContain('Ludo');
        expect(links[0].textContent).toContain('TWO');
        expect(links[0].textContent).toContain('Your go');
        expect(links[0].querySelector('.sr-only')).not.toBeNull();
        expect(container.querySelector('nav')!.classList.contains('order-1')).toBe(true);
        expect(container.querySelector('nav p')?.textContent).toContain('2');
        expect(container.querySelector('nav p')?.textContent).toContain('waiting on you');
    });

    it('puts the tables waiting on the reader first, so the signal is never scrolled out of a row that overflows', () =>
    {
        const container = mount(table('one', 'hokm'), [table('two', 'ludo', { yourTurn: false }), table('three', 'hokm', { yourTurn: true }), table('four', 'poker'), table('five', 'backgammon', { yourTurn: true })]);
        const links = [...container.querySelectorAll('nav a')].map((link) => link.getAttribute('href'));

        expect(links).toEqual(['/app/play/three', '/app/play/five', '/app/play/two', '/app/play/four']);
    });

    it('draws nothing for the other tables when compact and none of them is waiting', () =>
    {
        const container = mount(table('one', 'hokm'), [table('two', 'ludo', { yourTurn: false })], true);

        expect(container.querySelector('nav')).toBeNull();
    });

    it('names the game and its pace, and says nothing about other tables when there are none', () =>
    {
        const container = mount(table('one', 'hokm'), []);

        expect(container.querySelector('h1')?.textContent).toBe('Hokm');
        expect(container.textContent).toContain('Turn-based');
        expect(container.querySelector('nav')).toBeNull();
    });

    it('says a table has a call only when it has one', () =>
    {
        const said = useLocale().t('voice.tableHas');

        expect(mount(table('one', 'hokm'), []).textContent).not.toContain(said);
        expect(mount(table('one', 'hokm', { voice: 'off' }), []).textContent).not.toContain(said);
        expect(mount(table('one', 'hokm', { voice: 'table' }), []).textContent).toContain(said);
    });

    it('says two against two in place of a head count where partners sit', () =>
    {
        const format = useLocale().t('create.format.teams');
        const count = useLocale().plural('common.players', 4);
        const sided = mount(table('one', 'hokm', { teams: true }), []).querySelector('h1 + p')?.textContent ?? '';

        expect(sided).toContain(format);
        expect(sided).not.toContain(count);

        const apart = mount(table('one', 'ludo'), []).querySelector('h1 + p')?.textContent ?? '';

        expect(apart).toContain(count);
        expect(apart).not.toContain(format);
    });

    it('offers every other table as a switch, and marks the ones waiting on the reader', () =>
    {
        const container = mount(table('one', 'hokm'), [table('two', 'ludo', { yourTurn: true }), table('three', 'hokm', { yourTurn: false })]);
        const links = [...container.querySelectorAll('nav a')] as HTMLAnchorElement[];

        expect(links.map((link) => link.getAttribute('href'))).toEqual(['/app/play/two', '/app/play/three']);
        expect(links[0].textContent).toContain('Your go');
        expect(links[1].textContent).not.toContain('Your go');
        expect(container.querySelector('nav p')?.textContent).toContain('waiting on you');
    });

    it('says the same words in Persian whether one table is waiting or several', () =>
    {
        const locale = useLocale();
        locale.setLocale('fa');

        expect(locale.plural('play.tables.waiting', 1)).toBe(locale.plural('play.tables.waiting', 2));
        locale.setLocale('en');
    });

    it('says at the table that the connection dropped, in place of the pace, and that moves still go', async () =>
    {
        const live = useRealtime();
        const stopLive = live.start();
        const stopLink = useConnection().start();
        socket.accept();

        const container = mount(table('one', 'hokm'), []);
        expect(container.querySelector('[role="status"]')).toBeNull();

        socket.drop();
        await Promise.resolve();

        expect(container.querySelector('[role="status"]')?.textContent).toContain('Your moves still go through');
        expect(container.textContent).not.toContain('Turn-based');

        stopLink();
        stopLive();
    });

    it('tells two tables of one game apart by their codes', () =>
    {
        const container = mount(table('one', 'hokm'), [table('two', 'ludo'), table('three', 'ludo')]);
        const names = ([...container.querySelectorAll('nav a')] as HTMLAnchorElement[]).map((link) => link.textContent?.trim() ?? '');

        expect(names[0]).toContain('TWO');
        expect(names[1]).toContain('THREE');
        expect(names[0]).not.toBe(names[1]);
    });
});

describe('TurnClock', () =>
{
    it('says its sentence in the reader’s own direction rather than forcing it left to right', () =>
    {
        useLocale().setLocale('fa');
        const { container } = renderTest(() => TurnClock({ remainingMs: 23 * 3600 * 1000, over: false }) as Rendered);
        const said = container.querySelector('span > span:last-child');

        expect(said?.textContent).toContain('ساعت');
        expect(container.querySelector('.tally')).toBeNull();
        useLocale().setLocale('en');
    });

    it('says the turn is being played for them once the time is up, rather than showing a zero', () =>
    {
        const { container } = renderTest(() => TurnClock({ remainingMs: 0, over: false }) as Rendered);

        expect(container.textContent).toContain('Playing for them');
    });

    it('counts from when the answer arrived, not from the device clock', () =>
    {
        const { container } = renderTest(() => TurnClock({ remainingMs: 20_000, over: false }) as Rendered);

        expect(container.textContent).toContain('20');
    });

    it('draws nothing once the game is over', () =>
    {
        const { container } = renderTest(() => TurnClock({ remainingMs: 0, over: true }) as Rendered);

        expect(container.textContent?.trim()).toBe('');
    });
});

describe('PlayPage', () =>
{
    const settle = async () =>
    {
        for (let i = 0; i < 12; i += 1)
        {
            await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
    };

    afterEach(() =>
    {
        useLobby().reset();
        useDevice().override(null);
    });

    it('keeps the table it switched to once the page it left has finished leaving', async () =>
    {
        useDevice().override('phone');
        const lobby = useLobby();
        const first = await lobby.host('ludo', defaultTable('ludo'), []);
        const second = await lobby.host('ludo', defaultTable('ludo'), []);
        const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
        const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ first }`), scroll: false });
        const { container } = renderTest(() =>
            RouterProvider({
                router,
                children: () => Routes({ transition: () => 'page-forward', transitionDuration: 60 })
            }) as Rendered);
        await settle();
        expect(lobby.openId()).toBe(first);

        router.navigate(`/app/play/${ second }`);
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 150));
        await settle();

        expect(lobby.openId()).toBe(second);
        expect(lobby.table()?.id).toBe(second);
        expect(container.textContent).not.toContain('No such table');
    });

    it('says there is no such table when there is none, and offers the games rather than a retry', async () =>
    {
        const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/app/play/nobody-opened-this'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

        await vi.waitFor(() => expect(server.calls).toContain('tables.view'), { timeout: 4000 });
        await settle();

        expect(container.textContent).toContain(useLocale().t('play.notFound'));
        expect(container.textContent).not.toContain(useLocale().t('state.errorTitle'));
        expect(container.querySelector('a[href="/app/games"]')).not.toBeNull();
    });

    it('says the board could not load, and offers to try again, when its chunk will not come', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', defaultTable('ludo'), []);
        server.tables.find((one) => one.id === id)!.matchId = 'match-1';
        const matches = client.matches as unknown as Record<string, unknown>;
        matches.view = async () => ({
            id: 'match-1',
            tableId: id,
            game: 'ludo',
            rev: 1,
            seats: 4,
            players: [],
            turn: 0,
            mine: 0,
            startedAt: new Date(400_000).toISOString(),
            view: { kind: 'ludo' }
        });
        const asked = chunk.asked;

        try
        {
            const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(chunk.asked).toBe(asked + 1), { timeout: 4000 });
            await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

            expect(container.querySelector('[aria-busy="true"]')).toBeNull();
            const alert = container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain(useLocale().t('state.errorTitle'));
            expect(chunk.asked).toBe(asked + 1);

            fire(alert!.querySelector('button')!, 'click');

            await vi.waitFor(() => expect(chunk.asked).toBe(asked + 2), { timeout: 4000 });
            await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

            expect(chunk.asked).toBe(asked + 2);
            expect(container.querySelector('[role="alert"]')).not.toBeNull();
        }
        finally
        {
            delete matches.view;
        }
    });

    it('says a game it has no board for cannot be drawn here, rather than drawing an empty ludo plate', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', defaultTable('ludo'), []);
        server.tables.find((one) => one.id === id)!.matchId = 'match-2';
        const matches = client.matches as unknown as Record<string, unknown>;
        matches.view = async () => ({
            id: 'match-2',
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
        const asked = chunk.asked;

        try
        {
            const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('match.cannotDraw')), { timeout: 4000 });

            expect(chunk.asked).toBe(asked);
            expect(container.querySelector('[aria-busy="true"]')).toBeNull();
        }
        finally
        {
            delete matches.view;
        }
    });

    describe('a chair while a game is being played', () =>
    {
        const sitDown = (container: HTMLElement) =>
            [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('play.table.sitDown'));

        const watchingAt = async () =>
        {
            const id = await useLobby().host('ludo', defaultTable('ludo'), []);
            const held = server.tables.find((one) => one.id === id)!;

            delete held.chairs[0].who;
            held.chairs[1].who = 'sara.k';

            return held;
        };

        const opened = (id: string) =>
        {
            const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });

            return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered).container;
        };

        it('is not offered to somebody watching, however many chairs are empty', async () =>
        {
            const held = await watchingAt();
            held.matchId = 'live-1';
            const container = opened(held.id);

            await vi.waitFor(() => expect(container.textContent).toContain(held.code), { timeout: 4000 });
            await settle();

            expect(held.taken).toBeLessThan(held.seats);
            expect(sitDown(container)).toBeUndefined();
        });

        it('says a game began first when the claim is refused for that', async () =>
        {
            const held = await watchingAt();
            useToasts().reset();
            const container = opened(held.id);

            await vi.waitFor(() => expect(sitDown(container)).toBeDefined(), { timeout: 4000 });

            held.matchId = 'live-2';
            fire(sitDown(container)!, 'click');

            await vi.waitFor(() => expect(useToasts().items().map((one) => one.text)).toContain(useLocale().t('play.table.playing')), { timeout: 4000 });
            expect(held.chairs.some((chair) => chair.who === 'alex')).toBe(false);
        });
    });

    describe('a start, a chair or a close the server refuses', () =>
    {
        const pressable = (container: HTMLElement, key: MessageKey) =>
            [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t(key));

        const said = () => useToasts().items().map((one) => [one.kind, one.text]);

        const opened = (id: string) =>
        {
            const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });

            return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered).container;
        };

        const hosting = async (ready: boolean) =>
        {
            const id = await useLobby().host('backgammon', defaultTable('backgammon'), []);
            const held = server.tables.find((one) => one.id === id)!;

            held.chairs[0].ready = ready;
            held.chairs[1].who = 'sara.k';
            held.chairs[1].ready = ready;
            useToasts().reset();

            const container = opened(id);

            await vi.waitFor(() => expect(pressable(container, ready ? 'match.start' : 'play.close.confirm')).toBeDefined(), { timeout: 4000 });

            return { container, held };
        };

        const swapped = async (verb: string, stand: () => Promise<unknown>, run: () => Promise<void>) =>
        {
            const tables = client.tables as unknown as Record<string, unknown>;
            const real = tables[verb];

            tables[verb] = stand;

            try
            {
                await run();
            }
            finally
            {
                tables[verb] = real;
            }
        };

        const closing = async (container: HTMLElement) =>
        {
            fire(pressable(container, 'play.close.confirm')!, 'click');

            await vi.waitFor(() => expect(useOverlay().top()).not.toBeNull(), { timeout: 4000 });

            useOverlay().close(useOverlay().top()!.id, true);
        };

        afterEach(() =>
        {
            useOverlay().reset();
            useLocale().setLocale('en');

            for (const one of server.tables)
            {
                delete one.matchId;
            }
        });

        it.each(['en', 'fa'] as const)('says everybody has to be ready when somebody stopped being ready before the start arrived, in %s', async (language) =>
        {
            useLocale().setLocale(language);

            const { container, held } = await hosting(true);

            held.chairs[1].ready = false;
            fire(pressable(container, 'match.start')!, 'click');

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('tables.refused.not-ready')]]), { timeout: 4000 });

            expect(server.calls).toContain('tables.start');
            expect(said()[0][1]).not.toBe(useLocale().t('state.errorLead'));
        });

        it('says a chair is empty when somebody stood up before the start arrived', async () =>
        {
            const { container, held } = await hosting(true);

            delete held.chairs[1].who;
            held.chairs[1].ready = false;
            fire(pressable(container, 'match.start')!, 'click');

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('tables.refused.chairs-empty')]]), { timeout: 4000 });
        });

        it('still says to check the connection when the start never arrived', async () =>
        {
            const { container } = await hosting(true);

            await swapped('start', async () =>
            {
                throw new TypeError('Failed to fetch');
            }, async () =>
            {
                fire(pressable(container, 'match.start')!, 'click');

                await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('state.errorLead')]]), { timeout: 4000 });
            });
        });

        it('says the table has closed to somebody who reaches for a chair too late', async () =>
        {
            const id = await useLobby().host('ludo', defaultTable('ludo'), []);
            const held = server.tables.find((one) => one.id === id)!;

            delete held.chairs[0].who;
            held.chairs[1].who = 'sara.k';
            useToasts().reset();

            const container = opened(id);

            await vi.waitFor(() => expect(pressable(container, 'play.table.sitDown')).toBeDefined(), { timeout: 4000 });

            held.status = 'closed';
            fire(pressable(container, 'play.table.sitDown')!, 'click');

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('tables.refused.table-closed')]]), { timeout: 4000 });
        });

        it('says the table has closed to a host who switches voice too late, and otherwise only that voice could not be changed', async () =>
        {
            const { container, held } = await hosting(false);
            const voice = () => container.querySelector<HTMLButtonElement>(`button[aria-label="${ useLocale().t('voice.hostOn') }"]`)!;

            held.status = 'closed';
            fire(voice(), 'click');

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('tables.refused.table-closed')]]), { timeout: 4000 });

            useToasts().reset();

            await swapped('voice', async () =>
            {
                throw new TypeError('Failed to fetch');
            }, async () =>
            {
                fire(voice(), 'click');

                await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('voice.switchFailed')]]), { timeout: 4000 });
            });

            expect(held.voice).toBe('off');
        });

        it('switches the call on for the whole table and off again, and says each', async () =>
        {
            const { container, held } = await hosting(false);
            const button = (key: 'voice.hostOn' | 'voice.hostOff') =>
                container.querySelector<HTMLButtonElement>(`button[aria-label="${ useLocale().t(key) }"]`);
            const press = (key: 'voice.hostOn' | 'voice.hostOff') => fire(button(key)!, 'click');

            press('voice.hostOn');
            await vi.waitFor(() => expect(said()).toContainEqual(['success', useLocale().t('voice.turnedOn')]), { timeout: 4000 });
            expect(held.voice).toBe('table');

            useToasts().reset();
            await vi.waitFor(() => expect(button('voice.hostOff')).not.toBeNull(), { timeout: 4000 });

            press('voice.hostOff');
            await vi.waitFor(() => expect(said()).toContainEqual(['success', useLocale().t('voice.turnedOff')]), { timeout: 4000 });
            expect(held.voice).toBe('off');
        });

        it('says a game is still being played only when that is why the table would not close', async () =>
        {
            const { container, held } = await hosting(false);

            held.matchId = 'live-close';
            await closing(container);

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('play.close.refused')]]), { timeout: 4000 });

            expect(held.status).not.toBe('closed');
        });

        it('says only that it did not go through when a close fails for any other reason, and stays at the table', async () =>
        {
            const { container, held } = await hosting(false);

            for (const failure of [new ApiError(500, 'internal', 'Something went wrong.', undefined), new TypeError('Failed to fetch')])
            {
                useToasts().reset();

                await swapped('close', async () =>
                {
                    throw failure;
                }, async () =>
                {
                    await closing(container);

                    await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('common.actionFailed')]]), { timeout: 4000 });
                });

                useOverlay().reset();
            }

            expect(useLobby().openId()).toBe(held.id);
            expect(pressable(container, 'play.close.confirm')).toBeDefined();
        });
    });

    describe('somebody the host took out of a chair', () =>
    {
        const sitDown = (container: HTMLElement) =>
            [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('play.table.sitDown'));

        const lobbyOf = (container: HTMLElement) => container.querySelector<HTMLElement>(`section[aria-label="${ useLocale().t('play.title.lobby') }"]`);

        const saying = (container: HTMLElement, key: MessageKey) =>
            [...container.querySelectorAll<HTMLElement>('p')].find((one) => one.textContent?.trim() === useLocale().t(key));

        const said = () => useToasts().items().map((one) => [one.kind, one.text]);

        const guestAt = async (privacy: 'public' | 'invite') =>
        {
            const id = await useLobby().host('ludo', { ...defaultTable('ludo'), privacy }, []);
            const held = server.tables.find((one) => one.id === id)!;

            held.host = 'sara.k';
            held.chairs[0].who = 'sara.k';
            held.chairs[1].who = 'alex';
            await useLobby().refresh();

            return held;
        };

        const takenOut = (held: { id: string; chairs: { who?: string; ready: boolean }[] }) =>
        {
            delete held.chairs[1].who;
            held.chairs[1].ready = false;
            server.keptOut[held.id] = ['alex'];
        };

        const opened = (id: string) =>
        {
            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            return { container, router };
        };

        afterEach(() =>
        {
            useOverlay().reset();
            useToasts().reset();
            useLocale().setLocale('en');
        });

        it.each(['en', 'fa'] as const)('is told so on the table’s page without a reload, in %s, and is offered no seat there', async (language) =>
        {
            useLocale().setLocale(language);

            const held = await guestAt('public');
            const { container } = opened(held.id);

            await vi.waitFor(() => expect(lobbyOf(container)).not.toBeNull(), { timeout: 4000 });

            const heading = container.querySelector('h1');

            takenOut(held);
            await useLobby().refresh();
            await settle();

            expect(saying(container, 'play.table.removed'), 'the page does not say the host took the reader out').toBeDefined();
            expect(saying(container, 'play.table.watching')).toBeUndefined();
            expect(sitDown(container), 'a seat is offered to somebody who would be refused it').toBeUndefined();
            expect(lobbyOf(container)).toBeNull();
            expect(container.querySelector('h1')).toBe(heading);
            expect(useLocale().t('play.table.removed')).not.toBe(useLocale().t('play.table.watching'));
        });

        it('is offered the seat again in the same panel once the host has invited them, and can take it', async () =>
        {
            const held = await guestAt('public');

            takenOut(held);

            const { container } = opened(held.id);

            await vi.waitFor(() => expect(saying(container, 'play.table.removed')).toBeDefined(), { timeout: 4000 });

            const sentence = saying(container, 'play.table.removed')!;

            expect(sitDown(container)).toBeUndefined();

            server.keptOut[held.id] = [];
            held.chairs[1].invited = 'alex';
            await useLobby().refresh();
            await settle();

            expect(container.contains(sentence), 'the panel was drawn again to change what it says').toBe(true);
            expect(sentence.textContent?.trim()).toBe(useLocale().t('play.table.watching'));
            expect(sitDown(container)).toBeDefined();

            fire(sitDown(container)!, 'click');

            await vi.waitFor(() => expect(held.chairs[1].who).toBe('alex'), { timeout: 4000 });
        });

        it('is told why in words when a chair is refused on a page that still offered one, and is offered none after that', async () =>
        {
            const held = await guestAt('public');

            delete held.chairs[1].who;
            await useLobby().refresh();

            const { container } = opened(held.id);

            await vi.waitFor(() => expect(sitDown(container)).toBeDefined(), { timeout: 4000 });

            useToasts().reset();
            server.keptOut[held.id] = ['alex'];
            fire(sitDown(container)!, 'click');

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('tables.refused.kept-out')]]), { timeout: 4000 });
            await vi.waitFor(() => expect(sitDown(container)).toBeUndefined(), { timeout: 4000 });

            expect(saying(container, 'play.table.removed')).toBeDefined();
            expect(held.chairs.some((chair) => chair.who === 'alex')).toBe(false);
            expect(useLocale().t('tables.refused.kept-out')).not.toBe(useLocale().t('common.actionFailed'));
        });

        it('is shown no table where it was one by invitation, and asks nothing more about it', async () =>
        {
            const held = await guestAt('invite');
            const { container } = opened(held.id);

            await vi.waitFor(() => expect(lobbyOf(container)).not.toBeNull(), { timeout: 4000 });

            takenOut(held);
            server.calls = [];
            await useLobby().refresh();
            await useLobby().refresh();
            await settle();

            expect(container.textContent).toContain(useLocale().t('play.notFound'));
            expect(saying(container, 'play.table.removed')).toBeUndefined();
            expect(server.calls).not.toContain('tables.view');
        });

        it('sees that table again, from the page that said there was none, by following the host’s invitation to it', async () =>
        {
            const held = await guestAt('invite');
            const { container, router } = opened(held.id);

            await vi.waitFor(() => expect(lobbyOf(container)).not.toBeNull(), { timeout: 4000 });

            takenOut(held);
            await useLobby().refresh();
            await settle();

            expect(container.textContent).toContain(useLocale().t('play.notFound'));

            server.keptOut[held.id] = [];
            held.chairs[1].invited = 'alex';
            router.navigate(`/app/play/${ held.id }`);

            await vi.waitFor(() => expect(sitDown(container)).toBeDefined(), { timeout: 4000 });

            expect(container.textContent).not.toContain(useLocale().t('play.notFound'));
            expect(saying(container, 'play.table.watching')).toBeDefined();
        });
    });

    describe('what leaving says', () =>
    {
        const at = (finishedAt: string | undefined, result: string | undefined) =>
            ({ finishedAt, mine: 0, players: [{ seat: 0, result }, { seat: 1 }] }) as unknown as Parameters<typeof leaveLead>[0];

        it('warns a player still in a live game that leaving forfeits it', () =>
        {
            expect(leaveLead(at(undefined, undefined), 2)).toBe('play.leave.forfeit');
        });

        it('tells a player who already gave up that the chair stays empty until the game ends', () =>
        {
            expect(leaveLead(at(undefined, 'abandoned'), 2)).toBe('play.leave.locked');
        });

        it('offers the chair back once the game is over, and closes an empty table', () =>
        {
            expect(leaveLead(at('2026-10-04T12:00:00Z', 'won'), 2)).toBe('play.leave.lead');
            expect(leaveLead(null, 2)).toBe('play.leave.lead');
            expect(leaveLead(null, 1)).toBe('play.leave.last');
        });
    });

    describe('a leave, and whether it may forfeit', () =>
    {
        const control = (container: HTMLElement, key: MessageKey) =>
            [...container.querySelectorAll('button')].find((one) =>
                one.getAttribute('aria-label') === useLocale().t(key) || one.textContent?.trim() === useLocale().t(key));

        const said = () => useToasts().items().map((one) => [one.kind, one.text]);

        const left = () => server.calls.filter((call) => call.startsWith('tables.leave'));

        const game = (tableId: string) => ({
            id: `live-${ tableId }`,
            tableId,
            game: 'backgammon',
            rev: 4,
            seats: 2,
            players: [
                { seat: 0, who: 'alex', timeouts: 0 },
                { seat: 1, who: 'sara.k', timeouts: 0 }
            ],
            turn: 1,
            mine: 0,
            startedAt: new Date(400_000).toISOString(),
            view: {
                kind: 'backgammon',
                phase: 'roll',
                turn: 1,
                dice: [],
                seats: [0, 1].map((seat) => ({ seat, checkers: Array.from({ length: 26 }, () => 0), pips: 0, score: 0 })),
                cubed: false,
                cube: 1,
                doubling: false,
                crawford: false,
                target: 1,
                round: 1
            }
        } as MatchView);

        const gaveUp = (tableId: string) => ({
            id: `live-${ tableId }`,
            tableId,
            game: 'poker',
            rev: 9,
            seats: SEATED.length,
            players: SEATED.map((who, seat) => ({ seat, who, timeouts: 0, ...(seat === 0 ? { result: 'abandoned' } : {}) })),
            turn: 1,
            mine: 0,
            startedAt: new Date(400_000).toISOString(),
            view: {
                kind: 'poker',
                street: 'preflop',
                hand: 2,
                button: 5,
                turn: 1,
                board: [],
                pot: 30,
                pots: [{ amount: 30, eligible: [1, 2, 3, 4, 5] }],
                seats: SEATED.map((_, seat) => ({ seat, stack: seat === 0 ? 0 : 1500, bet: 0, folded: seat === 0, allIn: false, out: seat === 0 })),
                blinds: { small: 10, big: 20, level: 1, next: 9 },
                hole: []
            }
        } as MatchView);

        const begins = (held: { id: string; matchId?: string }, live = game) =>
        {
            held.matchId = `live-${ held.id }`;
            (client.matches as unknown as Record<string, unknown>).view = async () => live(held.id);
        };

        const opened = async (held: (typeof server.tables)[number], playing: boolean) =>
        {
            useToasts().reset();

            const routes: Route[] = [
                { path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement },
                { path: '/app/games', component: (): HTMLElement => document.createElement('main') }
            ];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ held.id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(container.querySelector('.table-stage') !== null).toBe(playing), { timeout: 4000 });
            await vi.waitFor(() => expect(control(container, 'play.lobby.leave')).toBeDefined(), { timeout: 4000 });

            server.calls = [];

            return { container, held, router };
        };

        const seatedAt = async (playing: boolean) =>
        {
            const id = await useLobby().host('backgammon', defaultTable('backgammon'), []);
            const held = server.tables.find((one) => one.id === id)!;

            held.chairs[1].who = 'sara.k';

            if (playing)
            {
                begins(held);
            }

            return await opened(held, playing);
        };

        const resignedAt = async () =>
        {
            const id = await useLobby().host('poker', { ...defaultTable('poker'), seats: SEATED.length }, []);
            const held = server.tables.find((one) => one.id === id)!;

            for (const chair of held.chairs)
            {
                chair.who = SEATED[chair.seat];
            }

            begins(held, gaveUp);
            server.outOfGame[`live-${ id }`] = ['alex'];

            return await opened(held, true);
        };

        const asked = async (container: HTMLElement) =>
        {
            fire(control(container, 'play.lobby.leave')!, 'click');

            await vi.waitFor(() => expect(useOverlay().top()).not.toBeNull(), { timeout: 4000 });

            return useOverlay().top()!;
        };

        afterEach(() =>
        {
            useOverlay().reset();
            useLocale().setLocale('en');
            delete (client.matches as unknown as Record<string, unknown>).view;
            server.outOfGame = {};

            for (const one of server.tables)
            {
                delete one.matchId;
            }
        });

        it('says the chair goes back to somebody waiting in the lobby, and leaves without agreeing to forfeit', async () =>
        {
            const { container, held, router } = await seatedAt(false);
            const sheet = await asked(container);

            expect(sheet.props.lead).toBe(useLocale().t('play.leave.lead'));

            useOverlay().close(sheet.id, true);

            await vi.waitFor(() => expect(router.location().pathname).toBe('/app/games'), { timeout: 4000 });

            expect(left()).toEqual(['tables.leave']);
            expect(held.chairs[0].who).toBeUndefined();
            expect(said()).toEqual([]);
        });

        it('says leaving forfeits to somebody with a game on the board, and agrees to it only then', async () =>
        {
            const { container, held, router } = await seatedAt(true);
            const sheet = await asked(container);

            expect(sheet.props.lead).toBe(useLocale().t('play.leave.forfeit'));

            useOverlay().close(sheet.id, true);

            await vi.waitFor(() => expect(router.location().pathname).toBe('/app/games'), { timeout: 4000 });

            expect(left()).toEqual(['tables.leave:forfeit']);
            expect(held.chairs[0].who).toBeUndefined();
        });

        it('says the game goes on without somebody who already gave it up, and lets them go without agreeing to forfeit', async () =>
        {
            const { container, held, router } = await resignedAt();
            const sheet = await asked(container);

            expect(sheet.props.lead).toBe(useLocale().t('play.leave.locked'));

            useOverlay().close(sheet.id, true);

            await vi.waitFor(() => expect(router.location().pathname).toBe('/app/games'), { timeout: 4000 });

            expect(left()).toEqual(['tables.leave']);
            expect(held.chairs[0].who).toBeUndefined();
            expect(said()).toEqual([]);
        });

        it.each([
            ['en', 'You are out of this game.', 'The board you see is at least 30 seconds behind the one they are playing on.'],
            ['fa', 'از این بازی بیرون رفتی.', 'صفحه‌ای که می‌بینی دست‌کم ۳۰ ثانیه عقب‌تر']
        ] as const)('tells somebody who gave up that they are watching the rest from behind, in %s', async (language, out, behind) =>
        {
            useLocale().setLocale(language);

            const { container } = await resignedAt();
            const told = container.querySelector('[data-gone]');

            expect(told?.textContent).toContain(out);
            expect(told?.textContent).toContain(behind);
            expect(told?.getAttribute('role')).toBe('status');
        });

        it('does not offer to give up a second time to somebody who already has', async () =>
        {
            const { container } = await resignedAt();

            expect(control(container, 'match.resign')).toBeUndefined();
            expect(control(container, 'play.lobby.leave')).toBeDefined();
        });

        it('says neither to somebody still playing, who is offered the way out', async () =>
        {
            const { container } = await seatedAt(true);

            expect(container.querySelector('[data-gone]')).toBeNull();
            expect(control(container, 'match.resign')).toBeDefined();
        });

        it('says neither to somebody still playing at a table where somebody else has given up', async () =>
        {
            const theirs = (tableId: string) =>
            {
                const live = gaveUp(tableId);
                const view = live.view as { seats: { seat: number; stack: number; folded: boolean; out: boolean }[] };

                return {
                    ...live,
                    players: live.players.map((player) => ({ seat: player.seat, who: player.who, timeouts: 0, ...(player.seat === 2 ? { result: 'abandoned' } : {}) })),
                    view: { ...view, seats: view.seats.map((seat) => ({ ...seat, stack: seat.seat === 2 ? 0 : 1500, folded: seat.seat === 2, out: seat.seat === 2 })) }
                } as MatchView;
            };

            const id = await useLobby().host('poker', { ...defaultTable('poker'), seats: SEATED.length }, []);
            const held = server.tables.find((one) => one.id === id)!;

            for (const chair of held.chairs)
            {
                chair.who = SEATED[chair.seat];
            }

            begins(held, theirs);

            const { container } = await opened(held, true);

            expect(container.querySelector('[data-gone]')).toBeNull();
            expect(control(container, 'match.resign')).toBeDefined();
        });

        it('sends nothing when the sheet is turned down', async () =>
        {
            const { container, held, router } = await seatedAt(true);
            const sheet = await asked(container);

            useOverlay().close(sheet.id, false);
            await settle();

            expect(left()).toEqual([]);
            expect(held.chairs[0].who).toBe('alex');
            expect(router.location().pathname).toBe(`/app/play/${ held.id }`);
        });

        it.each(['en', 'fa'] as const)('says the game has just started, keeps the chair and shows the board, when it began while the sheet was open, in %s', async (language) =>
        {
            useLocale().setLocale(language);

            const { container, held, router } = await seatedAt(false);
            const sheet = await asked(container);

            expect(sheet.props.lead).toBe(useLocale().t('play.leave.lead'));

            begins(held);
            useOverlay().close(sheet.id, true);

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('play.leave.started')]]), { timeout: 4000 });
            await vi.waitFor(() => expect(container.querySelector('.table-stage')).not.toBeNull(), { timeout: 4000 });

            expect(left()).toEqual(['tables.leave']);
            expect(held.chairs[0].who).toBe('alex');
            expect(router.location().pathname).toBe(`/app/play/${ held.id }`);
            expect(useLobby().openId()).toBe(held.id);
            expect((await asked(container)).props.lead).toBe(useLocale().t('play.leave.forfeit'));
        });

        it('says only that it did not go through when the leave never arrived, and stays at the table', async () =>
        {
            const { container, held, router } = await seatedAt(false);
            const tables = client.tables as unknown as Record<string, unknown>;
            const real = tables.leave;

            tables.leave = async () =>
            {
                throw new TypeError('Failed to fetch');
            };

            try
            {
                useOverlay().close((await asked(container)).id, true);

                await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('common.actionFailed')]]), { timeout: 4000 });
            }
            finally
            {
                tables.leave = real;
            }

            expect(held.chairs[0].who).toBe('alex');
            expect(router.location().pathname).toBe(`/app/play/${ held.id }`);
            expect(control(container, 'play.lobby.leave')).toBeDefined();
        });
    });

    describe('a table that is read again', () =>
    {
        const lobbyOf = (container: HTMLElement) => container.querySelector<HTMLElement>(`section[aria-label="${ useLocale().t('play.title.lobby') }"]`);

        const opened = async (viewer = 'alex') =>
        {
            const lobby = useLobby();
            const id = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 4, privacy: 'public' }, []);

            server.me = viewer;

            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(container.querySelector('h1')).not.toBeNull(), { timeout: 4000 });
            await settle();

            return { id, container, lobby, held: server.tables.find((one) => one.id === id)! };
        };

        afterEach(() =>
        {
            server.me = 'alex';
        });

        it('keeps what it has drawn: the same heading, the same lobby and the same chat panel', async () =>
        {
            const { container, lobby } = await opened();

            await vi.waitFor(() => expect(lobbyOf(container)).not.toBeNull(), { timeout: 4000 });
            await vi.waitFor(() => expect(container.querySelector('.table-card, .table-sheet')).not.toBeNull(), { timeout: 4000 });

            const heading = container.querySelector('h1');
            const seats = lobbyOf(container);
            const panel = container.querySelector('.table-card, .table-sheet');
            const views = server.calls.filter((one) => one === 'tables.view').length;

            await lobby.refresh();
            await settle();

            expect(server.calls.filter((one) => one === 'tables.view').length).toBeGreaterThan(views);
            expect(container.querySelector('h1')).toBe(heading);
            expect(lobbyOf(container)).toBe(seats);
            expect(container.querySelector('.table-card, .table-sheet')).toBe(panel);
        });

        it('still shows what changed, without drawing the page again: a chair that filled, a call that was switched on', async () =>
        {
            const { container, lobby, held } = await opened();

            await vi.waitFor(() => expect(lobbyOf(container)).not.toBeNull(), { timeout: 4000 });

            const seats = lobbyOf(container)!;
            const said = useLocale().t('voice.tableHas');

            expect(seats.textContent).toContain(useLocale().plural('play.lobby.emptySeats', 3));
            expect(container.querySelector('header')?.textContent).not.toContain(said);

            held.chairs[1] = { seat: 1, who: 'sara.k', ready: false, host: false };
            held.voice = 'table';
            await lobby.refresh();
            await settle();

            expect(lobbyOf(container)).toBe(seats);
            expect(seats.textContent).toContain(useLocale().plural('play.lobby.emptySeats', 2));
            expect(container.querySelector('header')?.textContent).toContain(said);
        });

        it('gives a visitor the board in place of the invitation to sit when a game starts, and keeps the header it had', async () =>
        {
            const { container, lobby, held } = await opened('omid.k');
            const sit = useLocale().t('play.table.sitDown');

            await vi.waitFor(() => expect(container.textContent).toContain(sit), { timeout: 4000 });

            const heading = container.querySelector('h1');

            held.matchId = 'match-9';
            await lobby.refresh();
            await settle();

            expect(container.textContent).not.toContain(sit);
            expect(container.querySelector('h1')).toBe(heading);

            delete held.matchId;
            await lobby.refresh();
            await settle();

            expect(container.textContent).toContain(sit);
            expect(container.querySelector('h1')).toBe(heading);
        });

        it('draws the board somebody is watching, a while behind, once the page has fetched it', async () =>
        {
            const { container, lobby, held } = await opened('omid.k');

            const seated = ['alex', 'sara.k', 'reza.t', 'mina'];
            const colours = ['red', 'green', 'yellow', 'blue'];

            server.watches['match-9'] = {
                match: {
                    id: 'match-9',
                    tableId: held.id,
                    game: 'ludo',
                    rev: 3,
                    seats: 4,
                    players: seated.map((who, seat) => ({ seat, who, side: seat })),
                    turn: 0,
                    startedAt: new Date(400_000).toISOString(),
                    view: {
                        kind: 'ludo',
                        moves: [],
                        controls: 0,
                        seats: colours.map((colour, seat) => ({ seat, colour, tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })), home: 0, out: false, side: seat }))
                    }
                },
                behind: 30,
                delay: 30,
                live: true
            };
            held.matchId = 'match-9';
            await lobby.refresh();

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('watch.title')), { timeout: 4000 });

            expect(server.calls).toContain('matches.watch');
            expect(container.textContent).not.toContain(useLocale().t('play.table.sitDown'));
        });

        it('draws no board for a game the server will not show, and keeps the page', async () =>
        {
            const { container, lobby, held } = await opened('omid.k');
            const heading = container.querySelector('h1');

            held.matchId = 'match-nobody-kept';
            await lobby.refresh();

            await vi.waitFor(() => expect(server.calls).toContain('matches.watch'), { timeout: 4000 });
            await settle();

            expect(container.textContent).not.toContain(useLocale().t('watch.title'));
            expect(container.querySelector('h1')).toBe(heading);
        });

        it('opens the sheet that invites a friend when the host presses an empty chair', async () =>
        {
            const { container } = await opened();

            await vi.waitFor(() => expect(lobbyOf(container)).not.toBeNull(), { timeout: 4000 });

            const chair = [...lobbyOf(container)!.querySelectorAll<HTMLButtonElement>('button')]
                .find((one) => one.textContent?.includes(useLocale().t('play.lobby.open')))!;

            expect(useOverlay().top()).toBeNull();

            fire(chair, 'click');

            await vi.waitFor(() => expect(useOverlay().top()).not.toBeNull(), { timeout: 4000 });

            expect(useOverlay().top()!.label).toBe(useLocale().t('play.lobby.invite'));

            useOverlay().close(useOverlay().top()!.id, true);
        });

        it('says the table has closed when it does, and draws nothing of it', async () =>
        {
            const { container, lobby, held } = await opened();

            await vi.waitFor(() => expect(lobbyOf(container)).not.toBeNull(), { timeout: 4000 });

            held.status = 'closed';
            await lobby.refresh();
            await settle();

            expect(lobbyOf(container)).toBeNull();
            expect(container.textContent).toContain(useLocale().t('play.closed'));
        });
    });

    describe('the socket of somebody waiting for a game', () =>
    {
        let visibility: DocumentVisibilityState = 'visible';

        const hidden = (forMs: number) =>
        {
            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
            clock.advance(forMs);
        };

        const opened = async (patch: Partial<ReturnType<typeof defaultTable>>, viewer = 'alex', ready = true) =>
        {
            const id = await useLobby().host('ludo', { ...defaultTable('ludo'), privacy: 'public', ...patch }, []);

            server.tables.find((one) => one.id === id)!.chairs[0].ready = ready;
            server.me = viewer;
            await useLobby().refresh();

            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(container.querySelector('h1')).not.toBeNull(), { timeout: 4000 });
            await settle();

            return server.tables.find((one) => one.id === id)!;
        };

        beforeEach(async () =>
        {
            server.reset();
            useLobby().reset();
            await settle();
            visibility = 'visible';
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
        });

        afterEach(() =>
        {
            delete (document as { visibilityState?: unknown }).visibilityState;
            server.me = 'alex';
        });

        it('is kept through a hidden tab while they sit ready at a live table that has not started', async () =>
        {
            await opened({});

            hidden(IDLE_MS * 3);

            expect(socket.closed, 'a hidden tab dropped a waiting player’s socket').toEqual([]);
        });

        it('is let go for somebody sitting there who is not ready', async () =>
        {
            await opened({}, 'alex', false);

            hidden(IDLE_MS + 1000);

            expect(socket.closed, 'a seat that is not waiting for a game kept its socket').toHaveLength(1);
        });

        it('is let go a minute after a finished game has taken their readiness back, in a tab that was already hidden', async () =>
        {
            const held = await opened({});

            hidden(IDLE_MS * 3);
            held.chairs[0].ready = false;
            await useLobby().refresh();
            await settle();

            expect(socket.closed).toEqual([]);

            clock.advance(IDLE_MS - 1000);

            expect(socket.closed).toEqual([]);

            clock.advance(2000);

            expect(socket.closed).toHaveLength(1);
        });

        it('is kept after they have left the page, for as long as they still sit ready at that table', async () =>
        {
            await opened({});

            cleanup();
            await settle();
            hidden(IDLE_MS * 3);

            expect(socket.closed, 'somebody looking for a game lost their socket by looking at another page').toEqual([]);
        });

        it('is kept by a search from wherever it was made, with no table page ever opened, and let go once the chair is given back', async () =>
        {
            const id = await useLobby().quick('ludo');

            await settle();
            hidden(IDLE_MS * 3);

            expect(socket.closed).toEqual([]);

            await useLobby().leave(id, false);
            await settle();
            clock.advance(IDLE_MS + 1000);

            expect(socket.closed, 'a chair that was given back still held the socket').toHaveLength(1);
        });

        it('is kept while a live game of theirs is on, whatever page they are on', async () =>
        {
            const held = await opened({}, 'alex', false);

            cleanup();
            held.matchId = 'match-on';
            await useLobby().refresh();
            await settle();
            hidden(IDLE_MS * 3);

            expect(socket.closed).toEqual([]);

            delete held.matchId;
            await useLobby().refresh();
            await settle();
            clock.advance(IDLE_MS + 1000);

            expect(socket.closed).toHaveLength(1);
        });

        it('is let go at a table that plays a move a day, ready or not', async () =>
        {
            await opened({ mode: 'turns' });

            hidden(IDLE_MS + 1000);

            expect(socket.closed).toHaveLength(1);
        });

        it('is let go for somebody only looking at the table', async () =>
        {
            await opened({}, 'omid.k');

            hidden(IDLE_MS + 1000);

            expect(socket.closed).toHaveLength(1);
        });

        it('is let go at a table played a turn a day', async () =>
        {
            await opened({ mode: 'turns' });

            hidden(IDLE_MS + 1000);

            expect(socket.closed).toHaveLength(1);
        });

        it('is let go once the table has closed', async () =>
        {
            const held = await opened({});

            held.status = 'closed';
            await useLobby().refresh();
            await settle();
            hidden(IDLE_MS + 1000);

            expect(socket.closed).toHaveLength(1);
        });
    });

    describe('joining the call without being asked', () =>
    {
        const microphone = { stop: () => undefined } as unknown as MediaStreamTrack;
        const granted = { getTracks: () => [microphone], getAudioTracks: () => [microphone] } as unknown as MediaStream;
        let stop: () => void = () => undefined;

        const asked = () => socket.sent.filter((frame) => frame.t === 'voice').map((frame) => (frame.t === 'voice' && frame.on ? 'on' : 'off'));

        const seated = async () =>
        {
            const lobby = useLobby();
            const id = await lobby.host('ludo', { ...defaultTable('ludo'), voice: 'table' }, []);
            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });

            renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);
            await vi.waitFor(() => expect(useVoice().table()).toBe(id), { timeout: 4000 });
            await settle();

            return id;
        };

        beforeEach(() =>
        {
            useSettings().reset();
            useSettings().update({ voiceAutoJoin: true });
            setVoiceMedia(() => ({ getUserMedia: async () => granted }) as unknown as MediaDevices);
            setVoiceCall(() => ({
                setMic: async () => undefined,
                setMuted: () => undefined,
                sync: () => undefined,
                receive: async () => undefined,
                setVolume: () => undefined,
                setSink: () => undefined,
                close: () => undefined
            }));
            useVoice().reset();
            stop = useVoice().start();
        });

        afterEach(() =>
        {
            stop();
            useVoice().reset();
            setVoiceCall(null);
            setVoiceMedia(null);
            useSettings().reset();
        });

        it('joins once, and stays out when the reader leaves', async () =>
        {
            await seated();

            expect(asked()).toEqual(['on']);

            useVoice().leave();
            await settle();

            expect(useVoice().table()).toBeNull();
            expect(asked()).toEqual(['on', 'off']);
        });

        it('does not take the call back from another tab of the reader that took it', async () =>
        {
            const id = await seated();

            socket.deliver({ v: 1, t: 'voice', n: 9, table: id, joined: false, mine: '', peers: [] });
            await settle();

            expect(useVoice().table()).toBeNull();
            expect(asked()).toEqual(['on']);
        });

        it('joins again when the host turns voice off and back on', async () =>
        {
            const id = await seated();

            await useLobby().setVoice(id, 'off');
            await vi.waitFor(() => expect(useVoice().table()).toBeNull(), { timeout: 4000 });
            await useLobby().setVoice(id, 'table');
            await vi.waitFor(() => expect(useVoice().table()).toBe(id), { timeout: 4000 });

            expect(asked()).toEqual(['on', 'off', 'on']);
        });
    });

    describe('the offer to join the call', () =>
    {
        const microphone = { stop: () => undefined } as unknown as MediaStreamTrack;
        const granted = { getTracks: () => [microphone], getAudioTracks: () => [microphone] } as unknown as MediaStream;
        let stop: () => void = () => undefined;

        const offers = () => useToasts().items().filter((toast) => toast.dedupe?.startsWith('voice-offer-') === true);

        const seated = async () =>
        {
            const lobby = useLobby();
            const id = await lobby.host('ludo', { ...defaultTable('ludo'), voice: 'table' }, []);
            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const drawn = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(offers()).toHaveLength(1), { timeout: 4000 });
            await settle();

            return { id, drawn };
        };

        beforeEach(() =>
        {
            useSettings().reset();
            useToasts().reset();
            setVoiceMedia(() => ({ getUserMedia: async () => granted }) as unknown as MediaDevices);
            setVoiceCall(() => ({
                setMic: async () => undefined,
                setMuted: () => undefined,
                sync: () => undefined,
                receive: async () => undefined,
                setVolume: () => undefined,
                setSink: () => undefined,
                close: () => undefined
            }));
            useVoice().reset();
            stop = useVoice().start();
        });

        afterEach(() =>
        {
            stop();
            useVoice().reset();
            setVoiceCall(null);
            setVoiceMedia(null);
            useSettings().reset();
            useToasts().reset();
        });

        it('is taken back when the host turns voice off, and made again when it comes back on', async () =>
        {
            const { id } = await seated();

            await useLobby().setVoice(id, 'off');
            await settle();

            expect(offers(), 'the page still offered a call the table no longer has').toHaveLength(0);

            await useLobby().setVoice(id, 'table');
            await vi.waitFor(() => expect(offers()).toHaveLength(1), { timeout: 4000 });
        });

        it('is taken back once the reader is in the call', async () =>
        {
            const { id } = await seated();

            await useVoice().join(id);
            await vi.waitFor(() => expect(useVoice().table()).toBe(id), { timeout: 4000 });
            await settle();

            expect(offers(), 'the page still offered a call the reader is in').toHaveLength(0);
        });

        it('does not follow the reader off the page', async () =>
        {
            const { drawn } = await seated();

            drawn.unmount();
            await settle();

            expect(offers(), 'a Join button for the call of a table the reader has left').toHaveLength(0);
        });

        it('lets somebody in the call stop hearing everybody from the table\'s sheet, where a phone\'s bar has no room for it', async () =>
        {
            const { id, drawn } = await seated();

            drawn.unmount();
            await useVoice().join(id);
            await vi.waitFor(() => expect(useVoice().table()).toBe(id), { timeout: 4000 });

            const container = renderTest(() => TableDock({ voice: id }) as Rendered).container;
            const menu = () => [...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === 'This table')!;

            fire(menu(), 'click');

            const first = useOverlay().top()!;

            expect(first.props.deaf).toBe(false);
            (first.props.onDeafen as () => void)();
            useOverlay().close(first.id, undefined);

            expect(useVoice().deaf()).toBe(true);

            fire(menu(), 'click');

            expect(useOverlay().top()!.props.deaf).toBe(true);

            useOverlay().reset();
        });

        it('offers no such thing from the sheet to somebody who is not in the call', async () =>
        {
            const { id, drawn } = await seated();

            drawn.unmount();

            const container = renderTest(() => TableDock({ voice: id }) as Rendered).container;

            fire([...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === 'This table')!, 'click');

            expect(useOverlay().top()!.props.onDeafen).toBeUndefined();
            expect(useOverlay().top()!.props.deaf).toBeUndefined();

            useOverlay().reset();
        });

        it('keeps the name on the button that joins the call when the button is only its icon', async () =>
        {
            const { id, drawn } = await seated();

            drawn.unmount();

            const container = renderTest(() => TableDock({ voice: id }) as Rendered).container;
            const join = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Join voice')!;
            const word = [...join.querySelectorAll('span')].find((one) => one.textContent?.trim() === 'Join voice')!;

            expect(word.className).toContain('sr-only');
            expect(word.className).toContain('@md:not-sr-only');
        });
    });

    describe('where a toast is drawn at a table', () =>
    {
        const at = async (posture: 'phone' | 'sidebar', railOpen: boolean) =>
        {
            useDevice().override(posture);
            useSettings().update({ railOpen });

            const lobby = useLobby();
            const id = await lobby.host('ludo', defaultTable('ludo'), []);
            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const drawn = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(useLobby().table()?.id).toBe(id), { timeout: 4000 });
            await settle();

            return drawn;
        };

        beforeEach(() =>
        {
            useSettings().reset();
            useToasts().reset();
        });

        afterEach(() =>
        {
            useDevice().override(null);
            useSettings().reset();
            useToasts().reset();
        });

        it('is at the top on a phone, where the bottom is the reader’s hand and the chat, and back where it was once the page is left', async () =>
        {
            expect(useToasts().lifted()).toBe(false);

            const drawn = await at('phone', false);

            expect(useToasts().lifted(), 'a toast at a phone’s table lay over the hand').toBe(true);

            drawn.unmount();
            await settle();

            expect(useToasts().lifted(), 'the page took the toasts’ place with it').toBe(false);
        });

        it('keeps its corner on a wide screen until the chat is open there, and takes it back when the chat is closed', async () =>
        {
            await at('sidebar', false);

            expect(useToasts().lifted()).toBe(false);

            useSettings().update({ railOpen: true });
            await settle();

            expect(useToasts().lifted(), 'a toast lay over the field somebody was typing in').toBe(true);

            useSettings().update({ railOpen: false });
            await settle();

            expect(useToasts().lifted()).toBe(false);
        });
    });

    describe('somebody the call cannot reach', () =>
    {
        const microphone = { stop: () => undefined } as unknown as MediaStreamTrack;
        const granted = { getTracks: () => [microphone], getAudioTracks: () => [microphone] } as unknown as MediaStream;
        let stop: () => void = () => undefined;
        let link: (who: string, state: 'connecting' | 'connected' | 'failed' | null) => void = () => undefined;

        const told = () => useToasts().items().filter((toast) => toast.dedupe?.startsWith('voice-unreached-') === true);

        const calling = async () =>
        {
            const lobby = useLobby();
            const id = await lobby.host('ludo', { ...defaultTable('ludo'), voice: 'table' }, []);
            const routes: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const drawn = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(useVoice().table()).toBe(id), { timeout: 4000 });
            await settle();

            return drawn;
        };

        beforeEach(() =>
        {
            useSettings().reset();
            useSettings().update({ voiceAutoJoin: true });
            useToasts().reset();
            setVoiceMedia(() => ({ getUserMedia: async () => granted }) as unknown as MediaDevices);
            setVoiceCall((deps) =>
            {
                link = deps.onLink;

                return {
                    setMic: async () => undefined,
                    setMuted: () => undefined,
                    sync: () => undefined,
                    receive: async () => undefined,
                    setVolume: () => undefined,
                    setSink: () => undefined,
                    close: () => undefined
                };
            });
            useVoice().reset();
            stop = useVoice().start();
        });

        afterEach(() =>
        {
            stop();
            useVoice().reset();
            setVoiceCall(null);
            setVoiceMedia(null);
            useSettings().reset();
            useToasts().reset();
        });

        it('is named in words once the wait is over, and the words are taken back when the line connects', async () =>
        {
            await calling();

            usePeople().want(['sara.k']);
            await vi.waitFor(() => expect(usePeople().byHandle('sara.k')).not.toBeNull(), { timeout: 4000 });

            link('sara.k', 'connecting');
            clock.advance(UNREACHED_MS - 1);
            await settle();
            expect(told(), 'the page gave up on a call it was still placing').toHaveLength(0);

            clock.advance(1);
            await settle();

            expect(told().map((toast) => [toast.kind, toast.text, toast.detail]), 'a second line a toast cuts short held half of what it says').toEqual([[
                'warning',
                useLocale().t('voice.unreached', { name: 'Sara Kamali' }),
                null
            ]]);

            link('sara.k', 'failed');
            link('sara.k', 'connecting');
            await settle();
            expect(told(), 'another try said it all again').toHaveLength(1);

            link('sara.k', 'connected');
            await settle();
            expect(told(), 'the page still said it could not reach somebody it is talking to').toHaveLength(0);
        });

        it('says it of each person by themselves, and does not follow the reader off the page', async () =>
        {
            const drawn = await calling();

            link('sara.k', 'connecting');
            link('reza.t', 'failed');
            clock.advance(UNREACHED_MS);
            await settle();

            expect(told().map((toast) => toast.dedupe).sort()).toEqual(['voice-unreached-reza.t', 'voice-unreached-sara.k']);

            link('reza.t', null);
            await settle();
            expect(told().map((toast) => toast.dedupe)).toEqual(['voice-unreached-sara.k']);

            drawn.unmount();
            await settle();
            expect(told(), 'the words outlived the table they were about').toHaveLength(0);
        });
    });

    describe('playing again once a game is over', () =>
    {
        const over = (tableId: string) => ({
            id: `over-${ tableId }`,
            tableId,
            game: 'backgammon',
            rev: 40,
            seats: 2,
            players: [
                { seat: 0, who: 'alex', timeouts: 0, result: 'won' },
                { seat: 1, who: 'sara.k', timeouts: 0, result: 'lost' }
            ],
            turn: 0,
            mine: 0,
            winner: 0,
            outcome: 'won',
            startedAt: new Date(400_000).toISOString(),
            finishedAt: new Date(900_000).toISOString(),
            view: {
                kind: 'backgammon',
                phase: 'move',
                turn: 0,
                dice: [],
                seats: [0, 1].map((seat) => ({ seat, checkers: Array.from({ length: 26 }, () => 0), pips: 0, score: seat === 0 ? 1 : 0 })),
                cubed: false,
                cube: 1,
                doubling: false,
                crawford: false,
                target: 1,
                round: 1
            }
        } as MatchView);

        const pressable = (container: HTMLElement, label: string) =>
            [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

        const finishedAt = async (otherSaidAgain: boolean) =>
        {
            const lobby = useLobby();
            const id = await lobby.host('backgammon', defaultTable('backgammon'), []);
            const held = server.tables.find((one) => one.id === id)!;

            held.chairs[1].who = 'sara.k';
            held.matchId = `over-${ id }`;
            usePeople().remember([{ id: 'sara.k', handle: 'sara.k', displayName: 'Sara Kamali', bio: '', hue: 340, isMinor: false }]);
            (client.matches as unknown as Record<string, unknown>).view = async () => over(id);

            const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(pressable(container, 'Play again')).toBeDefined(), { timeout: 4000 });

            delete held.matchId;
            held.chairs[1].ready = otherSaidAgain;
            await lobby.refresh();
            await settle();
            server.calls = [];

            return { container, held };
        };

        afterEach(() =>
        {
            delete (client.matches as unknown as Record<string, unknown>).view;
        });

        it('says ready when Play again is pressed, starts nothing while somebody has not, and says who', async () =>
        {
            const { container, held } = await finishedAt(false);

            fire(pressable(container, 'Play again')!, 'click');

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().t('match.rematch.waiting', { names: 'Sara Kamali' })), { timeout: 4000 });

            expect(server.calls).toContain('tables.ready');
            expect(server.calls).not.toContain('tables.start');
            expect(held.chairs[0].ready).toBe(true);
            expect(pressable(container, 'Play again')).toBeUndefined();
            expect(pressable(container, 'Start the game')).toBeUndefined();
        });

        it('starts the next game when the last player at the table presses Play again', async () =>
        {
            const { container, held } = await finishedAt(true);

            fire(pressable(container, 'Play again')!, 'click');

            await vi.waitFor(() => expect(server.calls).toContain('tables.start'), { timeout: 4000 });

            const ready = server.calls.indexOf('tables.ready');

            expect(ready).toBeGreaterThanOrEqual(0);
            expect(ready).toBeLessThan(server.calls.indexOf('tables.start'));
            expect(held.chairs[0].ready).toBe(true);
        });

        it('says a chair is free once the other player has left', async () =>
        {
            const { container, held } = await finishedAt(false);

            delete held.chairs[1].who;
            await useLobby().refresh();

            await vi.waitFor(() => expect(container.textContent).toContain(useLocale().plural('match.rematch.empty', 1)), { timeout: 4000 });
        });
    });

    it('draws a spectated game with its own board, and one it cannot draw as exactly that', () =>
    {
        const watching = (game: string) => ({
            match: {
                id: 'watched',
                tableId: 'somewhere',
                game,
                rev: 3,
                seats: 2,
                players: [],
                turn: 0,
                startedAt: new Date(400_000).toISOString(),
                view: { kind: 'ludo', moves: [], controls: 0, seats: [] }
            },
            behind: 30,
            delay: 30,
            live: true
        } as MatchWatch);

        const { container } = renderTest(() => WatchBoard({ watch: watching('chess') }) as Rendered);

        expect(container.textContent).toContain(useLocale().t('match.cannotDraw'));
        expect(container.textContent).toContain(useLocale().t('watch.title'));
        expect(Object.keys(BOARDS).sort()).toEqual(['backgammon', 'hokm', 'ludo', 'poker']);
    });

    it('is the same for a conversation replaced by another one while it leaves', async () =>
    {
        const chat = useChat();
        const table: Route[] = [{ path: '/app/chats/:id', component: (): HTMLElement => ChatPage() as HTMLElement }];
        const router = createRouter({ routes: table, history: createMemoryHistory('/app/chats/conv-a'), scroll: false });
        renderTest(() =>
            RouterProvider({
                router,
                children: () => Routes({ transition: () => 'page-forward', transitionDuration: 60 })
            }) as Rendered);
        await settle();
        expect(chat.openId()).toBe('conv-a');

        router.navigate('/app/chats/conv-b');
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 150));
        await settle();

        expect(chat.openId()).toBe('conv-b');
        chat.closeThread();
    });
});

describe('TableChat', () =>
{
    const settle = async () =>
    {
        for (let i = 0; i < 12; i += 1)
        {
            await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
    };

    afterEach(() =>
    {
        useChat().closeThread();
    });

    it('closes the thread it opened when it goes', async () =>
    {
        const chat = useChat();
        const { unmount } = renderTest(() => TableChat({ conversationId: 'conv-a' }) as Rendered);
        await settle();
        expect(chat.openId()).toBe('conv-a');

        unmount();

        expect(chat.openId()).toBe('');
    });

    it('leaves alone a thread somebody else opened after it', async () =>
    {
        const chat = useChat();
        const { unmount } = renderTest(() => TableChat({ conversationId: 'conv-a' }) as Rendered);
        await settle();

        chat.openThread('conv-b');
        unmount();

        expect(chat.openId()).toBe('conv-b');
    });
});

describe('the messenger', () =>
{
    const settle = async () =>
    {
        for (let step = 0; step < 10; step += 1)
        {
            await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
    };

    afterEach(() =>
    {
        useDevice().override(null);
        useChat().closeThread();
    });

    let router: ReturnType<typeof createRouter>;

    const open = async (posture: 'phone' | 'sidebar') =>
    {
        useDevice().override(posture);
        const table: Route[] = [{ path: '/app/chats/:id', component: (): HTMLElement => ChatPage() as HTMLElement }];
        router = createRouter({ routes: table, history: createMemoryHistory('/app/chats/conv-a'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);
        await settle();
        return container;
    };

    it('keeps the conversation list beside the open thread on a desktop, with the open one marked', async () =>
    {
        const container = await open('sidebar');
        const pane = container.querySelector('aside[aria-label="Chats"]');

        expect(pane).not.toBeNull();
        await vi.waitFor(() => expect(pane!.querySelectorAll('li a').length).toBeGreaterThan(0), { timeout: 4000 });

        fire([...pane!.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Direct')!, 'click');
        await settle();
        const target = pane!.querySelector('li a')!.getAttribute('href')!;
        router.navigate(target);
        await settle();

        const after = container.querySelector('aside[aria-label="Chats"]')!;
        const chosen = [...after.querySelectorAll('[aria-selected="true"]')].map((one) => one.textContent?.trim());

        expect(chosen).toContain('Direct');
        expect(after.querySelector('a.bg-raised')?.getAttribute('href')).toBe(target);
    });

    it('gives a phone the thread alone', async () =>
    {
        const container = await open('phone');

        expect(container.querySelector('aside[aria-label="Chats"]')).toBeNull();
    });

    it('keeps every line it has drawn when the thread is read again', async () =>
    {
        const thread = server.conversations.find((row) => server.messages.filter((one) => one.conversationId === row.id && one.kind === 'text').length > 1);

        expect(thread, 'the fixtures hold a thread of two lines or more').toBeDefined();
        useDevice().override('phone');

        const table: Route[] = [{ path: '/app/chats/:id', component: (): HTMLElement => ChatPage() as HTMLElement }];
        const here = createRouter({ routes: table, history: createMemoryHistory(`/app/chats/${ thread!.id }`), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router: here, children: () => Routes({}) }) as Rendered);
        const lines = () => [...container.querySelectorAll('[data-message]')];

        await vi.waitFor(() => expect(lines().length).toBeGreaterThan(1), { timeout: 4000 });

        const drawn = lines();
        const reads = server.calls.filter((one) => one === 'chat.messages').length;

        await useChat().refresh();
        await settle();

        expect(server.calls.filter((one) => one === 'chat.messages').length, 'the thread was not read again').toBeGreaterThan(reads);

        const after = lines();

        expect(after).toHaveLength(drawn.length);

        for (const [at, line] of after.entries())
        {
            expect(line, `line ${ at + 1 } was drawn again`).toBe(drawn[at]);
        }
    });
});

describe('the table’s chat and its controls', () =>
{
    const settle = async () =>
    {
        for (let step = 0; step < 10; step += 1)
        {
            await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
    };

    afterEach(() =>
    {
        useLobby().reset();
        useDevice().override(null);
        useSettings().update({ railOpen: true });
        sheetSize.forced = null;
        sheetSize.fold = null;

        for (const one of server.tables)
        {
            delete one.yourTurn;
        }
    });

    const headerEndsAt = (bottom: number) =>
    {
        const real = HTMLElement.prototype.getBoundingClientRect;

        return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement)
        {
            return this.tagName === 'HEADER'
                ? { bottom, top: 8, height: bottom - 8, left: 0, right: 844, width: 844, x: 0, y: 8, toJSON: () => ({}) } as DOMRect
                : real.call(this);
        });
    };

    const open = async (posture: 'phone' | 'rail' | 'sidebar') =>
    {
        useDevice().override(posture);
        const id = await useLobby().host('ludo', defaultTable('ludo'), []);
        const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
        const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);
        await settle();
        return container;
    };

    const button = (container: HTMLElement, name: string): HTMLElement | undefined =>
        [...container.querySelectorAll('button')].find((one) =>
            one.getAttribute('aria-label') === name || one.textContent?.trim() === name);

    const found = async (container: HTMLElement, name: string) =>
    {
        await vi.waitFor(() => expect(button(container, name)).toBeDefined(), { timeout: 4000 });

        return button(container, name)!;
    };

    const rail = (container: HTMLElement): HTMLElement | null => container.querySelector('.table-card:not(.hidden)');

    const pill = (container: HTMLElement): HTMLElement | null => container.querySelector('.table-pill');

    it('floats the chat as a card on a wide screen, tucks it into a pill, and brings it back', async () =>
    {
        useSettings().update({ railOpen: false });
        const container = await open('sidebar');

        expect(rail(container)).toBeNull();
        expect(pill(container)).not.toBeNull();

        fire(pill(container)!, 'click');
        await settle();

        expect(rail(container)).not.toBeNull();
        expect(pill(container)).toBeNull();
        expect(useSettings().settings().railOpen).toBe(true);

        fire(await found(container, 'Hide chat'), 'click');
        await settle();

        expect(rail(container)).toBeNull();
        expect(pill(container)).not.toBeNull();
        expect(useSettings().settings().railOpen).toBe(false);
    });

    it('widens the floating chat and narrows it again', async () =>
    {
        useSettings().update({ railOpen: true });
        const container = await open('sidebar');

        expect(rail(container)!.className).toContain('w-[min(23rem');

        fire(await found(container, 'Make the chat bigger'), 'click');
        await settle();

        expect(rail(container)!.className).toContain('w-[min(30rem');

        fire(await found(container, 'Make the chat smaller'), 'click');
        await settle();

        expect(rail(container)!.className).toContain('w-[min(23rem');
    });

    it('lists who is sitting at the table beside the chat, one row per taken chair', async () =>
    {
        useSettings().update({ railOpen: true });
        const container = await open('sidebar');

        fire(await found(container, 'Players'), 'click');
        await settle();

        const rows = [...rail(container)!.querySelectorAll('ul[aria-label="Players"] > li')];

        expect(rows).toHaveLength(useLobby().table()!.chairs.filter((chair) => chair.who !== undefined).length);
        expect(rows[0].textContent).toContain('You');

        fire(await found(container, 'Chat'), 'click');
        await settle();

        expect(rail(container)!.querySelector('ul[aria-label="Players"]')).toBeNull();
        expect(rail(container)!.querySelector('textarea')).not.toBeNull();
    });

    const screen = (width: number, height: number) =>
    {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
        useDevice().start();
        window.dispatchEvent(new Event('resize'));
    };

    afterEach(() =>
    {
        screen(1024, 768);
        useDevice().stop();
    });

    it('opens the chat on a phone turned sideways only when asked, as a sheet down the side, and the header makes room beside it', async () =>
    {
        screen(844, 390);
        useSettings().update({ railOpen: true });
        const waiting = await useLobby().host('hokm', defaultTable('hokm'), []);
        server.tables.find((one) => one.id === waiting)!.yourTurn = true;
        const container = await open('rail');
        const header = (): HTMLElement => container.querySelector('header')!;

        expect(rail(container)).toBeNull();
        expect(container.querySelector('.table-sheet:not(.hidden)')).toBeNull();

        fire(await found(container, 'Show chat'), 'click');
        await settle();

        const sheet = container.querySelector<HTMLElement>('.table-sheet:not(.hidden)')!;

        expect(sheet.className).toContain('inset-y-0');
        expect(sheet.className).toContain('w-[min(23rem,60vw)]');
        expect(sheet.className).not.toContain('h-[var(--sheet-h,48dvh)]');
        expect(container.querySelector('[class*="pb-[var(--sheet"]')).toBeNull();
        expect(container.querySelector('[data-sheet]')).toBeNull();
        expect(header().className).toContain('pe-[min(23rem,60vw)]');
        expect(button(header(), 'Show chat')).toBeUndefined();
        expect(header().querySelector('nav.play-others')!.classList.contains('order-1')).toBe(true);
        expect([...header().querySelectorAll('nav.play-others a')].map((link) => link.getAttribute('href'))).toEqual([`/app/play/${ waiting }`]);
        expect(header().querySelector('nav.play-others p')!.textContent).toContain('waiting on you');

        fire(await found(sheet, 'Hide chat'), 'click');
        await settle();

        expect(header().className).not.toContain('pe-[');
        expect(button(header(), 'Show chat')).toBeDefined();
    });

    it('floats the chat beside the board in a landscape window with height to spare, and makes room for it', async () =>
    {
        screen(1000, 700);
        useSettings().update({ railOpen: true });
        const container = await open('rail');

        expect(rail(container)).not.toBeNull();
        expect(container.querySelector('[class*="pe-[24.5rem]"]')).not.toBeNull();
    });

    it('opens the chat as the bottom sheet on an upright tablet, where a floating card would cover the board', async () =>
    {
        screen(800, 1100);
        useSettings().update({ railOpen: true });
        const container = await open('rail');

        expect(rail(container)).toBeNull();
        expect(pill(container)).toBeNull();

        fire(await found(container, 'Show chat'), 'click');
        await settle();

        expect(container.querySelector('.table-sheet')!.className).toContain('h-[var(--sheet-h,48dvh)]');
    });

    it('opens the chat over the table on a phone, half the screen first, and can take all of it', async () =>
    {
        const container = await open('phone');

        expect(container.querySelector('.table-sheet:not(.hidden)')).toBeNull();

        fire(button(container, 'Show chat')!, 'click');
        await settle();

        expect(container.querySelector('.table-sheet')!.className).toContain('h-[var(--sheet-h,48dvh)]');
        await vi.waitFor(() => expect(button(container, 'Make the chat bigger')).toBeDefined(), { timeout: 5000 });

        const edge = headerEndsAt(62);

        fire(await found(container, 'Make the chat bigger'), 'click');
        await settle();

        expect(container.querySelector('.table-sheet')!.className).toContain('top-[calc(var(--head,0.5rem)+0.25rem)]');
        expect(container.querySelector('.table-sheet')!.className).not.toContain('h-[var(--sheet-h,48dvh)]');
        await vi.waitFor(() => expect(container.querySelector<HTMLElement>('.table-sheet')!.parentElement!.style.getPropertyValue('--head')).toBe('62px'), { timeout: 2000 });
        edge.mockRestore();

        fire(await found(container, 'Hide chat'), 'click');
        await settle();

        expect(container.querySelector('.table-sheet:not(.hidden)')).toBeNull();
        expect(button(container, 'Show chat')).not.toBeUndefined();
    });

    it('folds the other tables into the title row while the chat takes the bottom of a phone, keeping the ones waiting on the reader', async () =>
    {
        const waiting = await useLobby().host('hokm', defaultTable('hokm'), []);
        await useLobby().host('backgammon', defaultTable('backgammon'), []);
        server.tables.find((one) => one.id === waiting)!.yourTurn = true;

        const container = await open('phone');
        const others = (): HTMLElement | null => container.querySelector('nav.play-others');
        const links = (): HTMLAnchorElement[] => [...container.querySelectorAll<HTMLAnchorElement>('nav.play-others a')];

        await vi.waitFor(() => expect(links().length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
        const all = links().length;
        expect(container.querySelector('[data-sheet]')).toBeNull();

        fire(button(container, 'Show chat')!, 'click');
        await settle();

        expect(container.querySelector('[data-sheet="half"]')).not.toBeNull();
        expect(container.querySelector('[data-sheet="half"]')!.className).toContain('pb-[var(--sheet,48dvh)]');
        expect(others()!.classList.contains('order-1')).toBe(true);
        expect(others()!.classList.contains('basis-full')).toBe(false);
        expect(links().map((link) => link.getAttribute('href'))).toEqual([`/app/play/${ waiting }`]);
        expect(links()[0].textContent).toContain('Hokm');
        expect(links()[0].textContent).toContain('Your go');
        expect(others()!.querySelector('p')!.textContent).toContain('waiting on you');

        fire(await found(container, 'Hide chat'), 'click');
        await settle();

        expect(container.querySelector('[data-sheet]')).toBeNull();
        expect(links()).toHaveLength(all);
        expect(others()!.classList.contains('basis-full')).toBe(true);
    });

    it('lays the chat over the bar on a phone too short for it and the board, and leaves the board its floor above it', async () =>
    {
        const waiting = await useLobby().host('hokm', defaultTable('hokm'), []);
        server.tables.find((one) => one.id === waiting)!.yourTurn = true;
        sheetSize.forced = { pad: 148, height: 192 };

        const container = await open('phone');
        const links = (): HTMLAnchorElement[] => [...container.querySelectorAll<HTMLAnchorElement>('nav.play-others a')];

        await vi.waitFor(() => expect(links().length).toBeGreaterThanOrEqual(1), { timeout: 4000 });

        fire(button(container, 'Show chat')!, 'click');
        await settle();

        const arena = container.querySelector<HTMLElement>('[data-sheet]')!;
        const sheet = container.querySelector<HTMLElement>('.table-sheet:not(.hidden)')!;

        await found(sheet, 'Hide chat');

        expect(arena.dataset.sheet).toBe('over');
        expect(arena.className).toContain('pb-[var(--sheet,48dvh)]');
        expect(sheet.className).toContain('h-[var(--sheet-h,48dvh)]');
        expect(sheet.className).not.toContain('top-[');
        expect(sheet.parentElement!.style.getPropertyValue('--sheet')).toBe('148px');
        expect(sheet.parentElement!.style.getPropertyValue('--sheet-h')).toBe('192px');
        expect(button(container, 'Make the chat bigger')).toBeDefined();
        expect(container.querySelector('nav.play-others')!.classList.contains('order-1')).toBe(true);
        expect(links().some((link) => link.getAttribute('href') === `/app/play/${ waiting }` && (link.textContent ?? '').includes('Your go'))).toBe(true);

        fire(button(sheet, 'Hide chat')!, 'click');
        await settle();

        expect(container.querySelector('[data-sheet]')).toBeNull();
        expect(container.querySelector('.table-sheet:not(.hidden)')).toBeNull();
    });

    it('keeps the half sheet the room the board can spare, and writes it where the sheet and the arena both read it', async () =>
    {
        sheetSize.forced = { pad: 262, height: 262 };

        const container = await open('phone');

        fire(button(container, 'Show chat')!, 'click');
        await settle();

        const arena = container.querySelector<HTMLElement>('[data-sheet]')!;

        expect(arena.dataset.sheet).toBe('half');
        expect(arena.className).toContain('pb-[var(--sheet,48dvh)]');
        expect(arena.parentElement!.style.getPropertyValue('--sheet')).toBe('262px');
        expect(arena.parentElement!.style.getPropertyValue('--sheet-h')).toBe('262px');
        expect(container.querySelector('.table-sheet')!.className).toContain('h-[var(--sheet-h,48dvh)]');
    });

    it('folds the other tables into the title row with the chat closed when the board would otherwise fall under its floor', async () =>
    {
        const waiting = await useLobby().host('hokm', defaultTable('hokm'), []);
        await useLobby().host('backgammon', defaultTable('backgammon'), []);
        server.tables.find((one) => one.id === waiting)!.yourTurn = true;
        sheetSize.fold = true;

        const container = await open('phone');
        const links = (): HTMLAnchorElement[] => [...container.querySelectorAll<HTMLAnchorElement>('nav.play-others a')];

        await vi.waitFor(() => expect(links().map((link) => link.getAttribute('href'))).toEqual([`/app/play/${ waiting }`]), { timeout: 4000 });

        expect(container.querySelector('[data-sheet]')).toBeNull();
        expect(container.querySelector('nav.play-others')!.classList.contains('order-1')).toBe(true);
        expect(container.querySelector('nav.play-others p')!.textContent).toContain('waiting on you');
    });

    it('gathers the table’s tools into one sheet on a phone, and gives up only after it has closed', () =>
    {
        useSettings().update({ sound: false });
        const close = vi.fn();
        const resign = vi.fn();
        const container = renderTest(() => TableMenu({ overlayId: 'menu', close, code: 'XD6H9N', full: false, onResign: resign }) as Rendered).container;
        const labels = [...container.querySelectorAll('ul button')].map((one) => one.textContent?.trim());

        expect(labels).toEqual([
            'Turn sound on',
            'Hide what I can play',
            'Stop saying what a move does',
            'Turn the rules coach off',
            'Copy the table code XD6H9N',
            'Give up'
        ]);

        fire([...container.querySelectorAll('ul button')][3] as HTMLElement, 'click');

        expect(useSettings().settings().hintRules).toBe(false);
        expect(close).toHaveBeenCalledTimes(1);
        expect(resign).not.toHaveBeenCalled();

        fire([...container.querySelectorAll('ul button')][5] as HTMLElement, 'click');

        expect(close).toHaveBeenCalledTimes(2);
        expect(resign).toHaveBeenCalledTimes(1);
    });

    it('offers no giving up in the sheet when there is no game', () =>
    {
        const container = renderTest(() => TableMenu({ overlayId: 'menu', close: vi.fn(), code: 'XD6H9N', full: false }) as Rendered).container;

        expect(container.textContent).not.toContain('Give up');
    });

    it.each([
        [false, 'Stop hearing everybody'],
        [true, 'Hear everybody again']
    ] as const)('offers the hearing of a call in the sheet to somebody in one (deaf: %s)', (deaf, label) =>
    {
        const close = vi.fn();
        const deafen = vi.fn();
        const container = renderTest(() => TableMenu({ overlayId: 'menu', close, code: 'XD6H9N', full: false, deaf, onDeafen: deafen }) as Rendered).container;
        const entry = [...container.querySelectorAll('ul button')].find((one) => one.textContent?.trim() === label);

        expect(entry, [...container.querySelectorAll('ul button')].map((one) => one.textContent?.trim()).join(' | ')).toBeDefined();

        fire(entry as HTMLElement, 'click');

        expect(deafen).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('offers nothing about hearing in the sheet to somebody who is not in a call', () =>
    {
        const container = renderTest(() => TableMenu({ overlayId: 'menu', close: vi.fn(), code: 'XD6H9N', full: false }) as Rendered).container;

        expect(container.textContent).not.toContain('hearing everybody');
        expect(container.textContent).not.toContain('Hear everybody');
    });

    it('offers leaving the table from the sheet once a game is on the board, last of all', () =>
    {
        const close = vi.fn();
        const leave = vi.fn();
        const container = renderTest(() => TableMenu({ overlayId: 'menu', close, code: 'XD6H9N', full: false, onResign: vi.fn(), onLeave: leave }) as Rendered).container;
        const entries = [...container.querySelectorAll('ul button')];

        expect(entries.map((one) => one.textContent?.trim()).slice(-2)).toEqual(['Give up', 'Leave table']);

        fire(entries[entries.length - 1] as HTMLElement, 'click');

        expect(close).toHaveBeenCalledTimes(1);
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('offers leaving in the dock only when the page passes it', () =>
    {
        const leave = vi.fn();

        expect(button(renderTest(() => TableDock({}) as Rendered).container, 'Leave table')).toBeUndefined();

        const withIt = renderTest(() => TableDock({ onLeave: leave }) as Rendered).container;
        fire(button(withIt, 'Leave table')!, 'click');

        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('offers giving up in the dock only when there is a game to give up', () =>
    {
        const resign = vi.fn();
        const without = renderTest(() => TableDock({}) as Rendered).container;

        expect(button(without, 'Give up')).toBeUndefined();

        const withIt = renderTest(() => TableDock({ onResign: resign }) as Rendered).container;
        fire(button(withIt, 'Give up')!, 'click');

        expect(resign).toHaveBeenCalledTimes(1);
    });

    it('keeps the host\'s voice switch, and whoever is on it, when it is pressed', () =>
    {
        const [voice, setVoice] = createSignal(true);
        const container = renderTest(() => TableDock({
            get hostVoice()
            {
                return voice();
            },
            onHostVoice: () => setVoice(!voice())
        }) as Rendered).container;
        const control = button(container, 'Turn voice off for this table')!;

        control.focus();
        fire(control, 'click');

        expect(button(container, 'Turn voice on for this table'), 'the switch was drawn again').toBe(control);
        expect(document.activeElement).toBe(control);
        expect(control.getAttribute('aria-pressed')).toBe('false');

        fire(control, 'click');

        expect(button(container, 'Turn voice off for this table')).toBe(control);
        expect(control.getAttribute('aria-pressed')).toBe('true');
    });
});
