import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

/** The handles this suite seats. A presence frame names people, and these are the people. */
const SEATED = ['alex', 'sara.k', 'reza.t', 'mina', 'nima.f', 'leila.a'];

import GameCard from '../src/components/games/game-card.component.azeroth';
import PlayHeader from '../src/components/games/play-header.component.azeroth';
import TableChat from '../src/components/games/table-chat.component.azeroth';
import TableDock from '../src/components/games/table-dock.component.azeroth';
import TableMenu from '../src/components/games/table-menu.component.azeroth';
import TurnClock from '../src/components/games/turn-clock.component.azeroth';
import ChatPage from '../src/pages/app/chat.page.azeroth';
import PlayPage from '../src/pages/app/play.page.azeroth';
import { gameArt, gameIcon } from '../src/components/games/art.ts';
import { GAMES } from '../src/data/games.ts';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const chunk = vi.hoisted(() => ({ asked: 0 }));

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
    const settle = async (): Promise<void> =>
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
        rules: { seats: [2, 4, 6, 8], modes: ['live'], targets: [], stakes: 'play-money', partners: false, hasCube: false, hasBlinds: true }
    });

    const mount = (id: string, onQuickPlay: (game: string) => void): HTMLElement =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const table: Route[] = [{ path: '/app', component: Stub, children: [{ path: 'games/:slug', component: Stub }] }];
        const router = createRouter({ routes: table, history: createMemoryHistory('/app'), scroll: false });
        const game = GAMES.find((one) => one.id === id)!;
        return renderTest(() => RouterProvider({ router, children: () => GameCard({ game, onQuickPlay }) }) as Rendered).container;
    };

    it('links to the game and quick-plays without leaving through the link', async () =>
    {
        const onQuickPlay = vi.fn();
        const container = mount('hokm', onQuickPlay);
        await settle();

        expect(container.querySelector('img')?.getAttribute('src')).toBe('/art/games/hokm.svg');
        const button = container.querySelector('button')!;
        fire(button, 'click');
        expect(onQuickPlay).toHaveBeenCalledWith('hokm');
    });

    it('offers no play and no Live pill for a game the server says is still coming', async () =>
    {
        server.games = [summary('poker', 'coming-soon')];
        server.live = [{ game: 'poker', playing: 5, tables: 1 }];
        useCatalogue().reset();
        const onQuickPlay = vi.fn();
        const container = mount('poker', onQuickPlay);
        await settle();

        expect(container.textContent).not.toContain('Live');
        const button = container.querySelector('button')!;
        expect(button.disabled).toBe(true);
        expect(button.textContent).toContain('Coming soon');
        fire(button, 'click');
        expect(onQuickPlay).not.toHaveBeenCalled();
    });

    it('holds its call to action until the catalogue has answered', () =>
    {
        useCatalogue().reset();
        const container = mount('poker', vi.fn());

        expect(container.querySelector('button'), 'a Play button before the answer could be one the server refuses').toBeNull();
        expect(container.textContent).not.toContain('Live');
    });
});

describe('PlayHeader', () =>
{
    const table = (id: string, game: string, extra: Record<string, unknown> = {}): never => ({
        id,
        code: id.toUpperCase(),
        game,
        seats: 4,
        mode: 'turns',
        privacy: 'public',
        target: 7,
        cube: false,
        blinds: 'low',
        status: 'playing',
        chairs: [],
        taken: 4,
        createdAt: '2026-09-22T00:00:00.000Z',
        ...extra
    }) as never;

    const mount = (current: never, others: never[]): HTMLElement =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const routes: Route[] = [{ path: '/app', component: Stub, children: [{ path: 'play/:id', component: Stub }] }];
        const router = createRouter({ routes, history: createMemoryHistory('/app/play/one'), scroll: false });
        return renderTest(() => RouterProvider({ router, children: () => PlayHeader({ table: current, others }) }) as Rendered).container;
    };

    it('names the game and its pace, and says nothing about other tables when there are none', () =>
    {
        const container = mount(table('one', 'hokm'), []);

        expect(container.querySelector('h1')?.textContent).toBe('Hokm');
        expect(container.textContent).toContain('Turn-based');
        expect(container.querySelector('nav')).toBeNull();
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
        const deadline = new Date(Date.now() + 23 * 3600 * 1000).toISOString();
        const { container } = renderTest(() => TurnClock({ deadline, over: false }) as Rendered);
        const said = container.querySelector('span > span:last-child');

        expect(said?.textContent).toContain('ساعت');
        expect(container.querySelector('.tally')).toBeNull();
        useLocale().setLocale('en');
    });

    it('draws nothing once the game is over', () =>
    {
        const { container } = renderTest(() => TurnClock({ deadline: new Date().toISOString(), over: true }) as Rendered);

        expect(container.textContent?.trim()).toBe('');
    });
});

describe('PlayPage', () =>
{
    const settle = async (): Promise<void> =>
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

        try
        {
            const table: Route[] = [{ path: '/app/play/:id', component: (): HTMLElement => PlayPage() as HTMLElement }];
            const router = createRouter({ routes: table, history: createMemoryHistory(`/app/play/${ id }`), scroll: false });
            const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

            await vi.waitFor(() => expect(chunk.asked).toBe(1), { timeout: 4000 });
            await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

            expect(container.querySelector('[aria-busy="true"]')).toBeNull();
            const alert = container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain(useLocale().t('state.errorTitle'));
            expect(chunk.asked).toBe(1);

            fire(alert!.querySelector('button')!, 'click');

            await vi.waitFor(() => expect(chunk.asked).toBe(2), { timeout: 4000 });
            await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });

            expect(chunk.asked).toBe(2);
            expect(container.querySelector('[role="alert"]')).not.toBeNull();
        }
        finally
        {
            delete matches.view;
        }
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
    const settle = async (): Promise<void> =>
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

describe('the table’s chat and its controls', () =>
{
    const settle = async (): Promise<void> =>
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
    });

    const open = async (posture: 'phone' | 'sidebar'): Promise<HTMLElement> =>
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

    const rail = (container: HTMLElement): HTMLElement | null => container.querySelector('aside.border-s');

    it('docks the chat beside the table on a wide screen, and hides it and brings it back', async () =>
    {
        const container = await open('sidebar');

        expect(rail(container)).not.toBeNull();
        expect(button(container, 'Show chat')).toBeUndefined();

        fire(button(container, 'Hide chat')!, 'click');
        await settle();

        expect(rail(container)).toBeNull();
        expect(useSettings().settings().railOpen).toBe(false);

        fire(button(container, 'Show chat')!, 'click');
        await settle();

        expect(rail(container)).not.toBeNull();
    });

    it('widens the docked chat and narrows it again', async () =>
    {
        const container = await open('sidebar');

        expect(rail(container)!.className).toContain('w-[var(--social-w)]');

        fire(button(container, 'Make the chat bigger')!, 'click');
        await settle();

        expect(rail(container)!.className).toContain('w-[min(30rem,40vw)]');

        fire(button(container, 'Make the chat smaller')!, 'click');
        await settle();

        expect(rail(container)!.className).toContain('w-[var(--social-w)]');
    });

    it('lists who is sitting at the table beside the chat, one row per taken chair', async () =>
    {
        const container = await open('sidebar');

        fire(button(container, 'Players')!, 'click');
        await settle();

        const rows = [...rail(container)!.querySelectorAll('ul[aria-label="Players"] > li')];

        expect(rows).toHaveLength(useLobby().table()!.chairs.filter((chair) => chair.who !== undefined).length);
        expect(rows[0].textContent).toContain('You');

        fire(button(container, 'Chat')!, 'click');
        await settle();

        expect(rail(container)!.querySelector('ul[aria-label="Players"]')).toBeNull();
        expect(rail(container)!.querySelector('textarea')).not.toBeNull();
    });

    it('opens the chat over the table on a phone, half the screen first, and can take all of it', async () =>
    {
        const container = await open('phone');

        expect(container.querySelector('.table-sheet')).toBeNull();

        fire(button(container, 'Show chat')!, 'click');
        await settle();

        expect(container.querySelector('.table-sheet')!.className).toContain('h-[48dvh]');

        fire(button(container, 'Make the chat bigger')!, 'click');
        await settle();

        expect(container.querySelector('.table-sheet')!.className).toContain('top-3');

        fire(button(container, 'Hide chat')!, 'click');
        await settle();

        expect(container.querySelector('.table-sheet')).toBeNull();
        expect(button(container, 'Show chat')).not.toBeUndefined();
    });

    it('gathers the table’s tools into one sheet on a phone, and gives up only after it has closed', () =>
    {
        useSettings().update({ sound: false });
        const close = vi.fn();
        const resign = vi.fn();
        const container = renderTest(() => TableMenu({ overlayId: 'menu', close, code: 'XD6H9N', full: false, onResign: resign }) as Rendered).container;
        const labels = [...container.querySelectorAll('ul button')].map((one) => one.textContent?.trim());

        expect(labels).toEqual(['Turn sound on', 'Copy the table code XD6H9N', 'Give up']);

        fire([...container.querySelectorAll('ul button')][2] as HTMLElement, 'click');

        expect(close).toHaveBeenCalledTimes(1);
        expect(resign).toHaveBeenCalledTimes(1);
    });

    it('offers no giving up in the sheet when there is no game', () =>
    {
        const container = renderTest(() => TableMenu({ overlayId: 'menu', close: vi.fn(), code: 'XD6H9N', full: false }) as Rendered).container;

        expect(container.textContent).not.toContain('Give up');
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
});
