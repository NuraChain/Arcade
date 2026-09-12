import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import GameCard from '../src/components/games/game-card.component.azeroth';
import { gameArt, gameArtSet } from '../src/components/games/art.ts';
import { GAMES } from '../src/data/games.ts';
import { dataset, resetDataset } from '../src/data/mock/index.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

let clock: ManualClock;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(400_000);
    setRuntime({ clock, seed: 11 });
    resetDataset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'demo',
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
        people: dataset().people.map((person) => ({ who: person.id, state: 'online' as const, since: 0 }))
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
    it('offers both widths of every card so a phone never downloads the hero', () =>
    {
        for (const game of GAMES)
        {
            expect(gameArt(game.id, 640)).toBe(`/art/games/${ game.id }-640.webp`);
            expect(gameArtSet(game.id)).toBe(`/art/games/${ game.id }-640.webp 640w, /art/games/${ game.id }-1280.webp 1280w`);
        }
    });
});

describe('GameCard', () =>
{
    it('links to the game and quick-plays without leaving through the link', () =>
    {
        const onQuickPlay = vi.fn();
        const Stub = (): HTMLElement => document.createElement('div');
        const table: Route[] = [{ path: '/app', component: Stub, children: [{ path: 'games/:slug', component: Stub }] }];
        const router = createRouter({ routes: table, history: createMemoryHistory('/app'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => GameCard({ game: GAMES[0], onQuickPlay }) }) as Rendered);
        expect(container.querySelector('img')?.getAttribute('srcset')).toContain('hokm-640.webp 640w');
        const button = container.querySelector('button')!;
        fire(button, 'click');
        expect(onQuickPlay).toHaveBeenCalledWith('hokm');
    });
});
