import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

/** The handles this suite seats. A presence frame names people, and these are the people. */
const SEATED = ['alex', 'sara.k', 'reza.t', 'mina', 'nima.f', 'leila.a'];

import GameCard from '../src/components/games/game-card.component.azeroth';
import { gameArt, gameIcon } from '../src/components/games/art.ts';
import { GAMES } from '../src/data/games.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

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
