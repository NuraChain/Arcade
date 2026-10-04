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

describe('who the headline says won', () =>
{
    const hokm = (players: MatchView['players']) => ({
        ...finished,
        game: 'hokm',
        seats: players.length,
        players,
        view: {
            kind: 'hokm',
            phase: 'tricks',
            hakem: 0,
            dealer: players.length - 1,
            turn: 0,
            lead: 0,
            hand: [],
            plays: [],
            trick: [],
            seats: players.map((player) => ({ seat: player.seat, side: player.side ?? player.seat, held: 0, tricks: 0, out: false })),
            points: players.length === 4 ? [7, 3] : players.map(() => 0),
            target: 7,
            round: 4,
            needed: 7
        }
    } as MatchView);

    const headline = (container: HTMLElement) => container.querySelector('p[aria-live]')?.textContent?.trim();

    const partners = hokm([
        { seat: 0, who: 'alex', timeouts: 0, result: 'won', side: 0, place: 1 },
        { seat: 1, who: 'omid.k', timeouts: 0, result: 'lost', side: 1, place: 2 },
        { seat: 2, who: 'sara.k', timeouts: 0, result: 'won', side: 0, place: 1 },
        { seat: 3, who: 'reza.t', timeouts: 0, result: 'lost', side: 1, place: 2 }
    ]);

    it('tells the partner of the first winner that they won too', () =>
    {
        const container = renderTest(() => MatchResult({ match: partners, mine: 2 }) as Rendered).container;

        expect(headline(container)).toBe('You won.');
    });

    it('tells the second survivor of a three-handed forfeit that they won', () =>
    {
        const forfeited = hokm([
            { seat: 0, who: 'alex', timeouts: 0, result: 'won', side: 0, place: 1 },
            { seat: 1, who: 'omid.k', timeouts: 0, result: 'won', side: 1, place: 2 },
            { seat: 2, who: 'sara.k', timeouts: 0, result: 'abandoned', side: 2, place: 3 }
        ]);

        const container = renderTest(() => MatchResult({ match: forfeited, mine: 1 }) as Rendered).container;

        expect(headline(container)).toBe('You won.');
        expect(container.textContent).not.toContain('alex won');
    });

    it('names every winner to somebody who did not win, in both languages', () =>
    {
        const english = renderTest(() => MatchResult({ match: partners, mine: 1 }) as Rendered).container;

        expect(headline(english)).toBe(useLocale().plural('match.won.them', 2, { names: useLocale().list(['alex', 'sara.k']) }));
        expect(headline(english)).toContain('alex and sara.k');

        cleanup();
        useLocale().setLocale('fa');

        const persian = renderTest(() => MatchResult({ match: partners }) as Rendered).container;

        expect(headline(persian)).toBe(useLocale().plural('match.won.them', 2, { names: useLocale().list(['alex', 'sara.k']) }));
        expect(useLocale().plural('match.won.them', 2, { names: 'x' })).not.toBe(useLocale().plural('match.won.them', 1, { names: 'x' }));
    });
});

describe('a Sit & Go, read by place', () =>
{
    const places = [3, 1, 6, 2, 5, 4];

    const sitAndGo = {
        ...finished,
        game: 'poker',
        seats: 6,
        mine: undefined,
        winner: 1,
        players: places.map((place, seat) => ({
            seat,
            who: `p${ seat }`,
            timeouts: 0,
            result: place === 1 ? 'won' : 'lost',
            side: seat,
            place
        })),
        view: {
            kind: 'poker',
            street: 'preflop',
            hand: 40,
            button: 0,
            board: [],
            pot: 0,
            pots: [],
            seats: places.map((place, seat) => ({ seat, stack: place === 1 ? 9000 : 0, bet: 0, folded: false, allIn: false, out: place !== 1 })),
            blinds: { small: 50, big: 100, level: 4, next: 10 },
            hole: []
        }
    } as MatchView;

    it('lists the seats from first to last, each with its place', () =>
    {
        const container = renderTest(() => MatchResult({ match: sitAndGo }) as Rendered).container;
        const rows = [...container.querySelectorAll('li')];

        expect(rows.map((row) => row.textContent?.match(/p\d/)?.[0])).toEqual(['p1', 'p3', 'p0', 'p5', 'p4', 'p2']);
        expect(rows.map((row) => row.querySelector('[data-place]')?.textContent?.trim())).toEqual(['1st', '2nd', '3rd', '4th', '5th', '6th']);
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

    it('keeps the swing and the rating apart with a drawn dot, never a character a Persian zero looks like', () =>
    {
        const container = renderTest(() => MatchResult({ match: voided, mine: 0 }) as Rendered).container;
        const row = [...container.querySelectorAll('li')].find((one) => one.textContent?.includes('1,184'))!;

        expect(row.textContent).not.toContain('·');
        expect(row.textContent).toContain('−16');
        expect(row.querySelector('[aria-hidden="true"].rounded-full')).not.toBeNull();
    });

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

    it('says the game ended too early to count, and that only whoever stopped is rated', () =>
    {
        const container = renderTest(() => MatchResult({ match: voided, mine: 0 }) as Rendered).container;

        expect(container.textContent).toContain('Ended too early to count.');
        expect(container.textContent).toContain('It counts only against whoever stopped playing.');
        expect(container.textContent).not.toContain('The table emptied');
        expect(container.textContent).not.toContain('no rating moved');
    });

    it('says the same in Persian', () =>
    {
        useLocale().setLocale('fa');
        const container = renderTest(() => MatchResult({ match: voided, mine: 0 }) as Rendered).container;

        expect(container.textContent).toContain(useLocale().t('match.over.void'));
        expect(container.textContent).toContain(useLocale().t('match.over.voidLead'));
        expect(useLocale().t('match.over.void')).not.toBe('match.over.void');
        expect(useLocale().t('match.over.voidLead')).not.toBe('match.over.voidLead');
    });

    it('tells a player whose own seat did not count, in a game somebody else won', () =>
    {
        const partly = {
            ...finished,
            seats: 4,
            outcome: 'won',
            winner: 0,
            players: [
                { seat: 0, who: 'alex', timeouts: 0, result: 'won', ratingBefore: 1200, ratingAfter: 1216 },
                { seat: 1, who: 'omid.k', timeouts: 0, result: 'abandoned', ratingBefore: 1200, ratingAfter: 1184 },
                { seat: 2, who: 'sara.k', timeouts: 0, result: 'won', ratingBefore: 1200, ratingAfter: 1216 },
                { seat: 3, who: 'reza.t', timeouts: 0, result: 'void' }
            ]
        } as MatchView;

        const english = renderTest(() => MatchResult({ match: partly, mine: 3 }) as Rendered).container;

        expect(english.textContent).toContain('This one did not count for you: your rating and streak are as they were.');
        expect(english.textContent).not.toContain('Ended too early to count.');

        cleanup();
        useLocale().setLocale('fa');

        const persian = renderTest(() => MatchResult({ match: partly, mine: 3 }) as Rendered).container;

        expect(persian.textContent).toContain(useLocale().t('match.over.voidMine'));
        expect(useLocale().t('match.over.voidMine')).not.toBe('match.over.voidMine');

        cleanup();
        useLocale().setLocale('en');

        const winner = renderTest(() => MatchResult({ match: partly, mine: 0 }) as Rendered).container;

        expect(winner.textContent).not.toContain('did not count for you');
    });
});
