import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import FairPlayPanel from '../src/components/games/fair-play-panel.component.azeroth';
import GameCard from '../src/components/games/game-card.component.azeroth';
import LobbyPanel from '../src/components/games/lobby-panel.component.azeroth';
import ResultPanel, { durationText } from '../src/components/games/result-panel.component.azeroth';
import RollLog from '../src/components/games/roll-log.component.azeroth';
import { gameArt, gameArtSet } from '../src/components/games/art.ts';
import { GAMES } from '../src/data/games.ts';
import { dataset, resetDataset } from '../src/data/mock/index.ts';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { TIMING } from '../src/lib/matchmaking.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const noop = (): void => undefined;

let clock: ManualClock;

const settle = async (): Promise<void> =>
{
    await Promise.resolve();
    await Promise.resolve();
};

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
    useSettings().reset();
    useLobby().reset();
});

afterEach(() =>
{
    cleanup();
    useLobby().reset();
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

describe('FairPlayPanel', () =>
{
    it('promises a roll log for dice games and a checkable shuffle for card games', () =>
    {
        const locale = useLocale();
        const dice = renderTest(() => FairPlayPanel({ game: 'backgammon' }) as Rendered);
        expect(dice.container.textContent).toContain(locale.t('game.fairPlay.dice'));
        expect(dice.container.textContent).not.toContain(locale.t('game.fairPlay.deal'));
        dice.unmount();

        const cards = renderTest(() => FairPlayPanel({ game: 'hokm' }) as Rendered);
        expect(cards.container.textContent).toContain(locale.t('game.fairPlay.deal'));
        expect(cards.container.textContent).toContain(locale.t('game.fairPlay.practice'));
        cards.unmount();

        const poker = renderTest(() => FairPlayPanel({ game: 'poker' }) as Rendered);
        expect(poker.container.textContent).toContain(locale.t('games.stakes.playMoneyHint'));
    });
});

describe('LobbyPanel', () =>
{
    it('shows one seat per seat, names the host, and offers the practice fill only to the host', async () =>
    {
        const lobby = useLobby();
        lobby.host('hokm', { ...defaultTable('hokm'), seats: 4 }, ['sara.k']);
        const locale = useLocale();

        const { container } = renderTest(() => LobbyPanel({ onInvite: noop, onCopyLink: noop, onLeave: noop }) as Rendered);
        await settle();

        expect(container.querySelectorAll('ul[aria-label="Seats"] > li').length).toBe(4);
        expect(container.textContent).toContain(locale.t('play.lobby.host'));
        expect(container.textContent).toContain(locale.t('play.lobby.invited'));
        expect(container.textContent).toContain(locale.t('play.lobby.fill'));
        expect(container.textContent).toContain(locale.plural('play.lobby.emptySeats', 3));
    });

    it('flips me to ready and starts the countdown once every seat is ready', async () =>
    {
        const lobby = useLobby();
        lobby.quick('backgammon');
        for (let step = 0; step < 120 && lobby.phase() !== 'lobby'; step += 1)
        {
            clock.advance(250);
        }
        expect(lobby.phase()).toBe('lobby');
        clock.advance(5000);

        const { container } = renderTest(() => LobbyPanel({ onInvite: noop, onCopyLink: noop, onLeave: noop }) as Rendered);
        await settle();

        const ready = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('I’m ready'))!;
        expect(ready).toBeDefined();
        fire(ready, 'click');
        await settle();

        expect(lobby.phase()).toBe('starting');
        expect(container.textContent).toContain(useLocale().t('play.starting.lead'));
    });
});

describe('RollLog', () =>
{
    it('stays folded until asked, then lists every roll with its verification code', async () =>
    {
        const rolls = [
            { turn: 1, playerId: 'alex', dice: [3, 5] as [number, number] },
            { turn: 2, playerId: 'sara.k', dice: [6, 1] as [number, number] }
        ];
        const onCopy = vi.fn();
        const { container } = renderTest(() => RollLog({ rolls, verification: 'ABC123-4F2', onCopy }) as Rendered);
        await settle();

        const toggle = container.querySelector('button[aria-controls="roll-log-body"]')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('#roll-log-body')).toBeNull();

        fire(toggle as HTMLElement, 'click');
        await settle();

        expect(container.querySelectorAll('#roll-log-body ol > li').length).toBe(2);
        expect(container.textContent).toContain('ABC123-4F2');
        const copy = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Copy code'))!;
        fire(copy, 'click');
        expect(onCopy).toHaveBeenCalledWith('ABC123-4F2');
    });
});

describe('ResultPanel', () =>
{
    it('spells a duration in minutes and seconds', () =>
    {
        const locale = useLocale();
        const plural = (key: 'common.minutes' | 'common.seconds', count: number): string => locale.plural(key, count);
        expect(durationText(31_000, plural)).toBe('31 s');
        expect(durationText(95_000, plural)).toBe('1 min 35 s');
    });

    it('names the winner, ranks every seat, and offers a rematch with no cooldown', async () =>
    {
        const lobby = useLobby();
        lobby.quick('backgammon');
        for (let step = 0; step < 120 && lobby.phase() !== 'lobby'; step += 1)
        {
            clock.advance(250);
        }
        clock.advance(5000);
        lobby.ready(true);
        clock.advance(TIMING.countdown * 1000 + 100);
        expect(lobby.phase()).toBe('playing');
        lobby.finishNow();
        expect(lobby.phase()).toBe('result');

        const onRematch = vi.fn();
        const { container } = renderTest(() => ResultPanel({
            onRematch,
            onAgain: noop,
            onBack: noop,
            onShare: noop,
            onCopyCode: noop
        }) as Rendered);
        await settle();

        expect(container.querySelectorAll('ol > li').length).toBe(2);
        expect(container.textContent).toContain('Backgammon');
        expect(container.querySelector('#roll-log-body, button[aria-controls="roll-log-body"]')).not.toBeNull();

        const rematch = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Rematch'))!;
        fire(rematch, 'click');
        expect(onRematch).toHaveBeenCalled();
    });
});
