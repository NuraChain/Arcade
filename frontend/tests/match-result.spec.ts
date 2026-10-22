import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import MatchResult from '../src/components/games/match-result.component.azeroth';
import TableResult, { RESULT_OUT, RESULT_WAIT } from '../src/components/games/table-result.component.azeroth';
import { rematchOf, type Rematch } from '../src/components/games/boards.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
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
    voice: 'off',
    teams: false,
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
            needed: 7,
            full: 13
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

    const sides = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('ul')].map((list) => ({
        says: list.getAttribute('aria-label'),
        seats: [...list.querySelectorAll('li')].length
    }));

    it('lists a game two sides played as two sides, the winners first, and calls the reader\'s own theirs', () =>
    {
        const won = renderTest(() => MatchResult({ match: partners, mine: 2 }) as Rendered).container;

        expect(sides(won)).toEqual([{ says: 'Your team', seats: 2 }, { says: 'Opponents', seats: 2 }]);
        expect(won.querySelector('ul')!.textContent).toContain('You');
        expect(won.querySelector('ul')!.textContent).toContain('alex');

        cleanup();

        const lost = renderTest(() => MatchResult({ match: partners, mine: 1 }) as Rendered).container;

        expect(sides(lost)).toEqual([{ says: 'Opponents', seats: 2 }, { says: 'Your team', seats: 2 }]);
    });

    it('numbers the sides for somebody watching, who has none', () =>
    {
        const container = renderTest(() => MatchResult({ match: partners }) as Rendered).container;

        expect(sides(container)).toEqual([{ says: 'Team 1', seats: 2 }, { says: 'Team 2', seats: 2 }]);
    });

    it('names the sides in Persian', () =>
    {
        useLocale().setLocale('fa');

        const container = renderTest(() => MatchResult({ match: partners, mine: 0 }) as Rendered).container;

        expect(sides(container).map((one) => one.says)).toEqual([useLocale().t('team.yours'), useLocale().t('team.theirs')]);
        expect(useLocale().t('team.yours')).not.toBe('Your team');
    });

    it('keeps one list with nothing over it when every seat played for itself', () =>
    {
        const container = renderTest(() => MatchResult({ match: finished, mine: 0 }) as Rendered).container;

        expect(sides(container)).toEqual([{ says: null, seats: 2 }]);
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

    it('says a game Nura\'s team ended, and that it counts for nobody, in place of the words for one that ended too early', () =>
    {
        const ended = { ...voided, voided: true, players: voided.players.map((one) => ({ seat: one.seat, who: one.who, timeouts: 0, result: 'void' as const })) } as MatchView;
        const container = renderTest(() => MatchResult({ match: ended, mine: 0 }) as Rendered).container;

        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Nura’s team ended this game.');
        expect(container.querySelector('[data-staffed]')?.textContent).toBe('It counts for nobody: no rating moved and nobody earned anything from it.');
        expect(container.textContent).not.toContain('Ended too early to count.');
        expect(container.textContent).not.toContain('It counts only against whoever stopped playing.');
        expect(container.textContent).not.toContain('This one did not count for you');
    });

    it('says it in Persian', () =>
    {
        useLocale().setLocale('fa');
        const ended = { ...voided, voided: true, players: voided.players.map((one) => ({ seat: one.seat, who: one.who, timeouts: 0, result: 'void' as const })) } as MatchView;
        const container = renderTest(() => MatchResult({ match: ended, mine: 0 }) as Rendered).container;

        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('تیم نورا این بازی رو تموم کرد.');
        expect(container.querySelector('[data-staffed]')?.textContent).toBe('برای هیچ‌کس حساب نمی‌شه: ریتینگ کسی عوض نشد و کسی هم چیزی ازش نگرفت.');
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

describe('how a seat that left the game is said to have gone', () =>
{
    const ended = (exit?: 'resign' | 'left' | 'timeout') => ({
        ...finished,
        outcome: 'won',
        players: [
            { seat: 0, who: 'alex', timeouts: 0, result: 'won' },
            { seat: 1, who: 'omid.k', timeouts: 0, result: 'abandoned', ...(exit === undefined ? {} : { exit }) }
        ]
    }) as MatchView;

    const theirs = (container: HTMLElement) =>
        [...container.querySelectorAll('li')].find((one) => one.textContent?.includes('omid.k'))?.textContent ?? '';

    beforeEach(() =>
    {
        cleanup();
        useLocale().setLocale('en');
    });

    afterEach(() => cleanup());

    it.each([
        ['resign', 'Gave up'],
        ['timeout', 'Timeout'],
        ['left', 'Left']
    ] as const)('says %s in the result as %s', (exit, words) =>
    {
        const container = renderTest(() => MatchResult({ match: ended(exit), mine: 0 }) as Rendered).container;

        expect(theirs(container)).toContain(words);
    });

    it('says Left for a seat that came without the way it went', () =>
    {
        const container = renderTest(() => MatchResult({ match: ended(), mine: 0 }) as Rendered).container;

        expect(theirs(container)).toContain('Left');
        expect(theirs(container)).not.toContain('Gave up');
    });

    it('says it in Persian, in the words the plates use', () =>
    {
        useLocale().setLocale('fa');

        expect(theirs(renderTest(() => MatchResult({ match: ended('resign'), mine: 0 }) as Rendered).container)).toContain('تسلیم شد');
        cleanup();
        expect(theirs(renderTest(() => MatchResult({ match: ended('timeout'), mine: 0 }) as Rendered).container)).toContain('وقت تمام');
        cleanup();
        expect(theirs(renderTest(() => MatchResult({ match: ended('left'), mine: 0 }) as Rendered).container)).toContain('ترک کرد');
        cleanup();
        expect(theirs(renderTest(() => MatchResult({ match: ended(), mine: 0 }) as Rendered).container)).toContain('ترک کرد');

        useLocale().setLocale('en');
    });

    it('never says a seat that won gave up, whatever else its row carries', () =>
    {
        const match = {
            ...finished,
            outcome: 'won',
            players: [
                { seat: 0, who: 'alex', timeouts: 0, result: 'won', exit: 'resign' },
                { seat: 1, who: 'omid.k', timeouts: 0, result: 'lost', exit: 'timeout' }
            ]
        } as MatchView;
        const rows = [...renderTest(() => MatchResult({ match, mine: 0 }) as Rendered).container.querySelectorAll('li')].map((one) => one.textContent ?? '');

        expect(rows.some((row) => row.includes('Won'))).toBe(true);
        expect(rows.some((row) => row.includes('Lost'))).toBe(true);
        expect(rows.join(' ')).not.toContain('Gave up');
        expect(rows.join(' ')).not.toContain('Timeout');
    });
});

describe('the result, laid over a board', () =>
{
    it('stands on a card of its own, with the way back to the board outside it', () =>
    {
        const container = renderTest(() => TableResult({ match: finished, shown: true, mine: 0 }) as Rendered).container;
        const card = container.querySelector('.table-result .table-result-card');

        expect(card).not.toBeNull();
        expect(card!.textContent).toContain('You won.');
        expect(card!.querySelectorAll('li')).toHaveLength(2);
        expect(button(container, 'See the board')!.closest('.table-result-card')).toBeNull();
    });

    it('gives the board back when asked, and the result back after it', () =>
    {
        const container = renderTest(() => TableResult({ match: finished, shown: true, mine: 0 }) as Rendered).container;

        fire(button(container, 'See the board')!, 'click');

        expect(container.querySelector('.table-result')).toBeNull();
        expect(container.querySelector('.table-result-card')).toBeNull();
        expect(buttons(container)).toEqual(['Show the result']);

        fire(button(container, 'Show the result')!, 'click');

        expect(container.querySelector('.table-result .table-result-card')!.textContent).toContain('You won.');
        expect(container.querySelector('.table-result-tab')).toBeNull();
    });
});

describe('how long a table may keep a result waiting', () =>
{
    it('is longer than the longest ending a table plays at its own pace, and is still a bound', () =>
    {
        const SIX_ALL_IN_BEFORE_THE_FLOP = 9400;

        expect(RESULT_WAIT).toBeGreaterThanOrEqual(SIX_ALL_IN_BEFORE_THE_FLOP + 2000);
        expect(RESULT_WAIT).toBeLessThanOrEqual(15_000);
    });
});

describe('the result, leaving the table it stood over', () =>
{
    interface Sight
    {
        match: MatchView;
        shown: boolean;
        mine?: number;
        busy?: boolean;
        rematch?: Rematch;
    }

    const { finishedAt: _finishedAt, outcome: _outcome, winner: _winner, ...begun } = finished;
    const next = { ...begun, id: 'match-next', rev: 1, players: finished.players.map(({ result: _result, ...one }) => one) } as MatchView;
    const over: Sight = { match: finished, shown: true, mine: 0, busy: true, rematch: { ready: true, waiting: [], empty: 0 } };
    const again: Sight = { match: next, shown: false, mine: 1 };

    const seated = (first: Sight, hooks: { onStand?: (stands: boolean) => void; onAgain?: () => void } = {}) =>
    {
        const [now, set] = createSignal(first);
        const { container, unmount } = renderTest(() => TableResult({
            get match()
            {
                return now().match;
            },
            get shown()
            {
                return now().shown;
            },
            get mine()
            {
                return now().mine;
            },
            get busy()
            {
                return now().busy;
            },
            get rematch()
            {
                return now().rematch;
            },
            onStand: hooks.onStand,
            onAgain: hooks.onAgain
        }) as Rendered);

        return { container, set, unmount };
    };

    const elapse = (ms: number) => (runtime().clock as ManualClock).advance(ms);

    const card = (container: HTMLElement) => container.querySelector<HTMLElement>('.table-result');

    const tab = (container: HTMLElement) => container.querySelector<HTMLElement>('.table-result-tab');

    it('is not on the table at all while a game is being played at it', () =>
    {
        const { container } = seated({ ...again, mine: 0 });

        expect([card(container), tab(container)]).toEqual([null, null]);

        elapse(RESULT_OUT);

        expect([card(container), tab(container)]).toEqual([null, null]);
    });

    it('goes over the time it took to come when another game takes the table, and cannot be pressed on its way', () =>
    {
        const onAgain = vi.fn();
        const { container, set } = seated(over, { onAgain });
        const stood = card(container);

        expect([stood?.hasAttribute('data-leaving'), stood?.hasAttribute('inert')]).toEqual([false, false]);

        set(again);

        expect(card(container), 'the card was built again to be taken away').toBe(stood);
        expect([stood?.getAttribute('data-leaving'), stood?.hasAttribute('inert')], 'a card on its way out could still be pressed, or was not marked as leaving').toEqual(['true', true]);

        elapse(RESULT_OUT - 1);

        expect(card(container), 'the card was taken away before it had faded').toBe(stood);

        elapse(1);

        expect([card(container), tab(container)]).toEqual([null, null]);
        expect(onAgain).not.toHaveBeenCalled();
    });

    it('goes telling of the game it was about, as it stood when that game was the one on the table', () =>
    {
        const { container, set } = seated(over, { onAgain: vi.fn() });
        const start = () => [...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Start the game'));

        expect(start()?.getAttribute('aria-busy')).toBe('true');

        set(again);

        expect(container.querySelector('.table-result-card')?.textContent, 'the card told of the game that had only just begun, or from the chair of the next game').toContain('You won.');
        expect(container.querySelectorAll('.table-result-card li'), 'the rows of the game it was about were taken off it').toHaveLength(2);
        expect(start()?.getAttribute('aria-busy'), 'the press that began the next game was shown as not made').toBe('true');

        set({ ...again, match: { ...next, rev: 2 }, busy: false, rematch: { ready: false, waiting: ['omid.k'], empty: 0 } });

        expect(container.querySelector('.table-result-card')?.textContent).toContain('You won.');
        expect(start()?.getAttribute('aria-busy')).toBe('true');
        expect(button(container, 'Play again'), 'a card on its way out offered the next game again').toBeUndefined();
    });

    it('is taken away at once when the game it tells of is still the one on the table', () =>
    {
        const stands: boolean[] = [];
        const { container, set } = seated(over, { onStand: (now) => stands.push(now) });

        set({ ...over, shown: false });

        expect([card(container), tab(container)], 'a table still showing how its game ended had the result fading over it').toEqual([null, null]);
        expect(stands).toEqual([true, false]);

        set(over);

        expect(card(container)?.hasAttribute('data-leaving')).toBe(false);
        expect(stands).toEqual([true, false, true]);
    });

    it('stands again at once, whole, when the next game is over before it has gone', () =>
    {
        const { container, set } = seated(over);
        const ended = { ...finished, id: 'match-next', players: [{ seat: 0, who: 'alex', timeouts: 0, result: 'lost' }, { seat: 1, who: 'omid.k', timeouts: 0, result: 'won' }], winner: 1 } as MatchView;

        set(again);
        elapse(RESULT_OUT - 40);
        set({ match: ended, shown: true, mine: 0 });

        expect([card(container)?.hasAttribute('data-leaving'), card(container)?.hasAttribute('inert')]).toEqual([false, false]);
        expect(container.querySelector('.table-result-card')?.textContent).toContain('omid.k won.');

        elapse(RESULT_OUT);

        expect(card(container), 'the count that was taking the old card away took the new one').not.toBeNull();
    });

    it('goes as the tab it was folded to, and is a whole card the next time there is a result', () =>
    {
        const { container, set } = seated(over);

        fire(button(container, 'See the board')!, 'click');
        set(again);

        expect([card(container), tab(container)?.getAttribute('data-leaving'), tab(container)?.hasAttribute('inert')]).toEqual([null, 'true', true]);

        elapse(RESULT_OUT);

        expect([card(container), tab(container)]).toEqual([null, null]);

        set({ ...again, match: { ...next, finishedAt: new Date(950_000).toISOString(), outcome: 'won', winner: 0 } as MatchView, shown: true, mine: 0 });

        expect(tab(container), 'the next result came folded away because the last one had been').toBeNull();
        expect(card(container)).not.toBeNull();
    });

    it('never tells of a game that is not over, whatever it is asked to show', () =>
    {
        const { container } = seated({ ...again, shown: true });

        expect([card(container), tab(container)]).toEqual([null, null]);
    });

    it('goes when the next game is on the table, even while the board still asks for the last result to be shown', () =>
    {
        const stands: boolean[] = [];
        const { container, set } = seated(over, { onStand: (now) => stands.push(now) });
        const stood = card(container);

        set({ ...again, shown: true });

        expect([card(container), stood?.getAttribute('data-leaving')], 'the card was kept standing over a game that had only just begun').toEqual([stood, 'true']);
        expect(container.querySelector('.table-result-card')?.textContent, 'the card told of the game that had only just begun').toContain('You won.');

        set(again);
        elapse(RESULT_OUT - 1);

        expect(card(container), 'a board that asked late took the card away at once').toBe(stood);

        elapse(1);

        expect(card(container)).toBeNull();
        expect(stands).toEqual([true, false]);
    });

    it('tells the board when it stands over the table, and only when it has gone that it no longer does', () =>
    {
        const stands: boolean[] = [];
        const { set } = seated(over, { onStand: (now) => stands.push(now) });

        expect(stands).toEqual([true]);

        set(again);

        expect(stands, 'the board was told the table was clear while the card was still fading over it').toEqual([true]);

        elapse(RESULT_OUT);

        expect(stands).toEqual([true, false]);
    });

    it('tells a board that seats it during a game that nothing stands there', () =>
    {
        const stands: boolean[] = [];

        seated(again, { onStand: (now) => stands.push(now) });

        expect(stands).toEqual([false]);
    });

    it('leaves nothing counting when the table itself is taken away under it', () =>
    {
        const { set, unmount } = seated(over);

        set(again);

        expect((runtime().clock as ManualClock).pending()).toBe(1);

        unmount();

        expect((runtime().clock as ManualClock).pending()).toBe(0);
    });
});
