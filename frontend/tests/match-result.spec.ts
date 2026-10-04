import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import MatchResult from '../src/components/games/match-result.component.azeroth';
import { rematchOf, type Rematch } from '../src/components/games/boards.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import type { MatchView, TableSummary } from '../src/api.ts';

type Rendered = HTMLElement;

const finished: MatchView = {
    id: 'match-done',
    tableId: 'table-done',
    game: 'backgammon',
    rev: 40,
    seats: 2,
    players: [
        { seat: 0, who: 'alex', timeouts: 0, result: 'won' },
        { seat: 1, who: 'omid.k', timeouts: 0, result: 'lost' }
    ],
    turn: 0,
    mine: 0,
    startedAt: new Date(400_000).toISOString(),
    finishedAt: new Date(900_000).toISOString(),
    outcome: 'won',
    winner: 0,
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
} as MatchView;

const table = (chairs: TableSummary['chairs'], extra: Partial<TableSummary> = {}): TableSummary => ({
    id: 'table-done',
    code: 'done1',
    game: 'backgammon',
    seats: chairs.length,
    mode: 'live',
    privacy: 'public',
    target: 1,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: false,
    status: 'ready',
    chairs,
    taken: chairs.filter((chair) => chair.who !== undefined).length,
    mine: 0,
    createdAt: new Date(0).toISOString(),
    ...extra
});

const buttons = (container: HTMLElement) =>
    [...container.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '');

const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === label) as HTMLButtonElement | undefined;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 7 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('the result panel, asking for the next game', () =>
{
    const mount = (rematch: () => Rematch | undefined, onAgain?: () => void) =>
        renderTest(() => MatchResult({
            match: finished,
            mine: 0,
            onAgain,
            get rematch()
            {
                return rematch();
            }
        }) as Rendered).container;

    it('offers Play again to a player who has not said so yet, and asks for it when pressed', () =>
    {
        const onAgain = vi.fn();
        const container = mount(() => ({ ready: false, waiting: ['omid.k'], empty: 0 }), onAgain);

        fire(button(container, 'Play again')!, 'click');

        expect(onAgain).toHaveBeenCalledTimes(1);
        expect(container.textContent).not.toContain('Waiting for');
    });

    it('says who it is waiting for once this player is ready, with nothing left to press', () =>
    {
        const container = mount(() => ({ ready: true, waiting: ['omid.k', 'sara.k'], empty: 0 }), vi.fn());

        expect(button(container, 'Play again')).toBeUndefined();
        expect(button(container, 'Start the game')).toBeUndefined();
        expect(container.textContent).toContain(useLocale().t('match.rematch.waiting', { names: useLocale().list(['omid.k', 'sara.k']) }));
    });

    it('offers Start once everybody is ready and no game has begun, and asks for it when pressed', () =>
    {
        const onAgain = vi.fn();
        const container = mount(() => ({ ready: true, waiting: [], empty: 0 }), onAgain);

        expect(button(container, 'Play again')).toBeUndefined();
        fire(button(container, 'Start the game')!, 'click');

        expect(onAgain).toHaveBeenCalledTimes(1);
    });

    it('says a chair is free rather than waiting on nobody, ready or not', () =>
    {
        const [state, setState] = createSignal<Rematch>({ ready: false, waiting: [], empty: 1 });
        const container = mount(state, vi.fn());

        expect(container.textContent).toContain(useLocale().plural('match.rematch.empty', 1));
        expect(button(container, 'Play again')).toBeDefined();

        setState({ ready: true, waiting: [], empty: 1 });

        expect(container.textContent).toContain(useLocale().plural('match.rematch.empty', 1));
        expect(button(container, 'Play again')).toBeUndefined();
        expect(button(container, 'Start the game')).toBeUndefined();
    });

    it('moves from Play again to waiting to Start as the table answers', () =>
    {
        const [state, setState] = createSignal<Rematch>({ ready: false, waiting: ['omid.k'], empty: 0 });
        const container = mount(state, vi.fn());

        expect(buttons(container)).toContain('Play again');

        setState({ ready: true, waiting: ['omid.k'], empty: 0 });
        expect(buttons(container)).not.toContain('Play again');
        expect(container.textContent).toContain('Waiting for');

        setState({ ready: true, waiting: [], empty: 0 });
        expect(buttons(container)).toContain('Start the game');
        expect(container.textContent).not.toContain('Waiting for');
    });

    it('offers a spectator nothing to press', () =>
    {
        const container = mount(() => undefined);

        expect(buttons(container)).not.toContain('Play again');
        expect(buttons(container)).not.toContain('Start the game');
    });
});

describe('what the next game waits on, read off the chairs', () =>
{
    it('names everybody else who has not said again, and whether this player has', () =>
    {
        expect(rematchOf(table([
            { seat: 0, who: 'alex', ready: true, host: true },
            { seat: 1, who: 'omid.k', ready: false, host: false },
            { seat: 2, who: 'sara.k', ready: true, host: false },
            { seat: 3, who: 'reza.t', ready: false, host: false }
        ]))).toEqual({ ready: true, waiting: ['omid.k', 'reza.t'], empty: 0 });
    });

    it('counts the chairs somebody left', () =>
    {
        expect(rematchOf(table([
            { seat: 0, who: 'alex', ready: false, host: true },
            { seat: 1, ready: false, host: false }
        ]))).toEqual({ ready: false, waiting: [], empty: 1 });
    });

    it('trusts no readiness from a table that still says the game is running', () =>
    {
        expect(rematchOf(table([
            { seat: 0, who: 'alex', ready: true, host: true },
            { seat: 1, who: 'omid.k', ready: true, host: false }
        ], { matchId: 'match-done', status: 'playing' }))).toEqual({ ready: false, waiting: [], empty: 0 });
    });
});

describe('a seat the match never judged', () =>
{
    const voided = {
        ...finished,
        outcome: 'abandoned',
        winner: undefined,
        players: [
            { seat: 0, who: 'alex', timeouts: 0, result: 'void' },
            { seat: 1, who: 'omid.k', timeouts: 0, result: 'abandoned', ratingBefore: 1200, ratingAfter: 1184 }
        ]
    } as MatchView;

    const mine = (container: HTMLElement) =>
        [...container.querySelectorAll('li')].find((one) => one.textContent?.includes(useLocale().t('match.you')));

    it('reads No contest', () =>
    {
        const container = renderTest(() => MatchResult({ match: voided, mine: 0 }) as Rendered).container;

        expect(mine(container)?.textContent).toContain('No contest');
    });

    it('reads it in Persian too', () =>
    {
        useLocale().setLocale('fa');
        const container = renderTest(() => MatchResult({ match: voided, mine: 0 }) as Rendered).container;

        expect(mine(container)?.textContent).toContain('بی‌نتیجه');
    });
});
