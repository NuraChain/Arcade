import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { batch, createSignal } from 'azerothjs';

import BackgammonBoard from '../src/components/games/backgammon-board.component.azeroth';
import {
    BAR_LEFT,
    BAR_WIDTH,
    FIELD_LEFT,
    FIELD_RIGHT,
    FRAME,
    HEIGHT,
    MIDDLE,
    POINT_WIDTH,
    TRAY,
    TRAY_LEFT,
    WIDTH,
    columnOf,
    pointAt
} from '../src/game/backgammon-layout.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS, useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { MatchView } from '../src/api.ts';

type Rendered = HTMLElement;

type Backgammon = Extract<MatchView['view'], { kind: 'backgammon' }>;

type Played = Extract<MatchEvent['log'], { kind: 'backgammon' }>['moves'][number];

const START = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

const match = (view: Partial<Backgammon>, mine: number | null = 0, over: Partial<MatchView> = {}): MatchView => ({
    id: 'match-bg',
    tableId: 'table-bg',
    game: 'backgammon',
    rev: 4,
    seats: 2,
    players: [0, 1].map((seat) => ({ seat, who: seat === 0 ? 'dana.w' : 'omid.k', timeouts: 0 })) as MatchView['players'],
    turn: 0,
    ...(mine === null ? {} : { mine }),
    startedAt: new Date(400_000).toISOString(),
    view: {
        kind: 'backgammon',
        phase: 'move',
        turn: 0,
        dice: [6, 1],
        seats: [0, 1].map((seat) => ({ seat, checkers: [...START], pips: 167, score: 0 })),
        cubed: true,
        cube: 1,
        doubling: false,
        crawford: false,
        target: 3,
        round: 1,
        ...view
    },
    ...over
});

const row = (points: Record<number, number>): number[] =>
    Array.from({ length: 26 }, (_, point) => points[point] ?? 0);

const position = (mine: Record<number, number>, theirs: Record<number, number>): Backgammon['seats'] => [
    { seat: 0, checkers: row(mine), pips: 0, score: 0 },
    { seat: 1, checkers: row(theirs), pips: 0, score: 0 }
];

const happened = (rev: number, seat: number, moves: Played[]): MatchEvent => ({ rev, seat, at: '', log: { kind: 'backgammon', moves } });

const lit = (container: HTMLElement) =>
    container.querySelectorAll('.bg-layer .man[data-lit]').length;

const note = (container: HTMLElement) =>
    container.querySelector('[role="note"]')?.textContent ?? null;

const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === label || one.textContent?.trim() === label) as HTMLButtonElement;

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const elapse = async (ms: number) =>
{
    const clock = runtime().clock as ManualClock;

    for (let left = ms; left > 0; left -= 10)
    {
        clock.advance(Math.min(10, left));
        await flush();
    }

    await flush();
};

const still = (match: MatchView) => renderTest(() => BackgammonBoard({ match, events: NO_EVENTS }) as Rendered);

const live = async (first: MatchView) =>
{
    const [current, setCurrent] = createSignal(first);
    const [told, setTold] = createSignal<EventBatch>(NO_EVENTS);
    const view = renderTest(() => BackgammonBoard({
        get match()
        {
            return current();
        },
        get events()
        {
            return told();
        }
    }) as Rendered);

    await flush();

    return {
        ...view,
        current,
        move: (next: MatchView) => setCurrent(next),
        tell: (next: MatchView, events: MatchEvent[], over: Partial<EventBatch> = {}) => batch(() =>
        {
            setCurrent(next);
            setTold((held) => ({ seq: held.seq + 1, id: next.id, events, live: true, jump: false, ...over }));
        })
    };
};

const stageOf = (container: HTMLElement) => container.querySelector('.table-stage') as HTMLElement;

const men = (container: HTMLElement) => container.querySelectorAll('.bg-layer .man');

const dice = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.bg-layer .bgt-dice > .die3d')].map((die) => die.dataset.face);

const cube = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-layer .bgt-cube');

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useSettings().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('the backgammon board geometry', () =>
{
    it('fills the width exactly: field, bar, frame and the tray beside it', () =>
    {
        expect(FIELD_LEFT + POINT_WIDTH * 12 + BAR_WIDTH).toBeCloseTo(FIELD_RIGHT);
        expect(FIELD_RIGHT + FRAME + TRAY + FRAME).toBe(WIDTH);
        expect(TRAY_LEFT).toBe(FIELD_RIGHT + FRAME);
    });

    it('lays the points out the way a board is printed: my home bottom right, theirs top right', () =>
    {
        expect(columnOf(1)).toEqual({ x: FIELD_RIGHT - POINT_WIDTH, row: 'bottom' });
        expect(columnOf(12)).toEqual({ x: FIELD_LEFT, row: 'bottom' });
        expect(columnOf(13)).toEqual({ x: FIELD_LEFT, row: 'top' });
        expect(columnOf(24)).toEqual({ x: FIELD_RIGHT - POINT_WIDTH, row: 'top' });
        expect(columnOf(7).x + POINT_WIDTH).toBeCloseTo(BAR_LEFT);
    });

    it('finds the point under a finger for every point, the bar and the tray', () =>
    {
        for (let point = 1; point <= 24; point += 1)
        {
            const column = columnOf(point);

            expect(pointAt(column.x + POINT_WIDTH / 2, column.row === 'top' ? 100 : 700), `point ${ point }`).toBe(point);
        }

        expect(pointAt(BAR_LEFT + BAR_WIDTH / 2, 400)).toBe('bar');
        expect(pointAt(TRAY_LEFT + TRAY / 2, 700)).toBe('tray');
        expect(pointAt(2, 400)).toBeNull();
    });
});

describe('BackgammonBoard', () =>
{
    it('offers every first hop of the opening 6-1 and nothing else', () =>
    {
        const { container } = still(match({}));
        const offered = [...container.querySelectorAll('ul[aria-label="Moves you can make"] button')].map((one) => one.getAttribute('aria-label'));

        expect(offered).toEqual(expect.arrayContaining([
            'Move a checker from 24 to 18',
            'Move a checker from 13 to 7',
            'Move a checker from 8 to 7',
            'Move a checker from 6 to 5',
            'Move a checker from 24 to 23'
        ]));
        expect(offered).not.toContain('Move a checker from 13 to 12');
    });

    it('stages a whole turn one checker at a time, and sends it only when it is complete', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = still(match({}));
        const confirm = () => button(container, 'Play the move');

        expect(confirm().disabled).toBe(true);

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        expect(confirm().disabled).toBe(true);

        fire(button(container, 'Move a checker from 8 to 7'), 'click');
        expect(confirm().disabled).toBe(false);
        expect(container.querySelector('ul[aria-label="Moves you can make"]')).toBeNull();

        fire(confirm(), 'click');

        expect(play).toHaveBeenCalledWith({ kind: 'backgammon', verb: 'move', hops: [{ from: 13, to: 7 }, { from: 8, to: 7 }] });
    });

    it('takes a staged hop back with undo', () =>
    {
        const { container } = still(match({}));
        const undo = () => button(container, 'Undo');

        expect(undo().disabled).toBe(true);

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        expect(undo().disabled).toBe(false);
        expect(button(container, 'Move a checker from 7 to 6')).toBeDefined();

        fire(undo(), 'click');
        expect(undo().disabled).toBe(true);
        expect(button(container, 'Move a checker from 7 to 6')).toBeUndefined();
    });

    it('keeps a half-staged turn through a re-read of the same board, and drops it once the board moves', async () =>
    {
        const { container, current, move } = await live(match({}));
        const undo = () => button(container, 'Undo');

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        move({ ...current() });
        expect(undo().disabled).toBe(false);

        move({ ...current(), rev: current().rev + 1 });
        expect(undo().disabled).toBe(true);
    });

    it('offers roll and a double before the dice are thrown, and sends each as its verb', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = still(match({ phase: 'roll', dice: [], doubling: true }));

        fire(button(container, 'Roll'), 'click');
        fire(button(container, 'Double to 2'), 'click');

        expect(play.mock.calls.map((call) => call[0])).toEqual([
            { kind: 'backgammon', verb: 'roll' },
            { kind: 'backgammon', verb: 'double' }
        ]);
    });

    it('asks the player a double is offered to whether they take it, and nobody else', () =>
    {
        const asked = still(match({ phase: 'double', turn: 0, dice: [] }));

        expect(button(asked.container, 'Take at 2')).toBeDefined();
        expect(button(asked.container, 'Give up this game')).toBeDefined();
        asked.unmount();

        const waiting = still(match({ phase: 'double', turn: 1, dice: [] }));

        expect(button(waiting.container, 'Take at 2')).toBeUndefined();
        expect(waiting.container.textContent).toContain('Waiting for');
    });

    it('draws a spectator the board and gives them nothing to press', () =>
    {
        const { container } = still(match({}, null));

        expect(container.querySelector('svg')).not.toBeNull();
        expect(container.querySelectorAll('button').length).toBe(0);
    });

    it('draws the board left to right in every language, because it is a printed object', () =>
    {
        useLocale().setLocale('fa');
        const { container } = still(match({}));

        expect(container.querySelector('svg')?.parentElement?.className).toContain('[direction:ltr]');
        useLocale().setLocale('en');
    });

    it('keeps the controls the nodes they were when a hop is staged and when the board is read again', async () =>
    {
        const { container, current, move } = await live(match({}));
        const undo = button(container, 'Undo');
        const confirm = button(container, 'Play the move');
        const said = container.querySelector('[aria-live="polite"]');
        const kept = button(container, 'Move a checker from 24 to 23');

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        await flush();

        expect(button(container, 'Undo')).toBe(undo);
        expect(button(container, 'Play the move')).toBe(confirm);
        expect(button(container, 'Move a checker from 24 to 23')).toBe(kept);

        move({ ...current() });
        await flush();

        expect(button(container, 'Undo')).toBe(undo);
        expect(container.querySelector('[aria-live="polite"]')).toBe(said);
        expect(document.contains(confirm)).toBe(true);
    });

    it('counts the moves left of a double beside its dice, and counts nothing when no double is on the table', async () =>
    {
        const left = (container: HTMLElement) => container.querySelector('.bg-layer .bgt-dice > .bgt-left')?.textContent ?? null;
        const waiting = still(match({ phase: 'roll', dice: [] }));

        await flush();
        expect(left(waiting.container)).toBeNull();
        waiting.unmount();

        const plain = still(match({ dice: [6, 1] }));

        await flush();
        expect(left(plain.container)).toBeNull();
        plain.unmount();

        const { container } = still(match({ dice: [3, 3] }));

        await flush();
        expect(left(container)).toBe('×4');

        fire(button(container, 'Move a checker from 13 to 10'), 'click');
        await flush();

        expect(left(container)).toBe('×3');
        expect(container.querySelector('.bg-left'), 'the page still draws a count of its own over the board').toBeNull();
    });
});

describe('the backgammon table on the page', () =>
{
    const theirs = () => match({ turn: 1, dice: [6, 1] }, 0, { turn: 1 });

    const answered = () => match({ turn: 0, dice: [3, 2], seats: position({ 6: 5, 8: 3, 13: 5, 24: 2 }, { 6: 5, 7: 2, 8: 2, 13: 4, 24: 2 }) }, 0, { rev: 5 });

    const theirMove = () => [happened(5, 1, [
        { e: 'move', seat: 1, from: 13, to: 7, die: 6, hit: false },
        { e: 'move', seat: 1, from: 8, to: 7, die: 1, hit: false },
        { e: 'roll', seat: 0, dice: [3, 2] }
    ])];

    it('lays the checkers, the dice and the cube on the table once it is on the page', async () =>
    {
        const { container } = await live(match({}));

        expect(men(container)).toHaveLength(30);
        expect(dice(container)).toEqual(['6', '1']);
        expect(cube(container)?.textContent).toBe('64');
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });

    it('plays what the other player did, says it is busy while it does, and ends on the new board', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, tell } = await live(theirs());

        animate.mockClear();
        tell(answered(), theirMove());
        await flush();

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(stageOf(container).getAttribute('data-rev')).toBe('5');
        expect(animate.mock.contexts.some((one) => (one as Element).classList.contains('man'))).toBe(true);
        expect(dice(container)).toEqual(['6', '1']);

        await elapse(4000);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(dice(container)).toEqual(['3', '2']);
        expect(men(container)).toHaveLength(30);
    });

    it('still has its dice and its cube after the tab was hidden and shown again', async () =>
    {
        const { container, tell } = await live(theirs());
        const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        tell(answered(), theirMove());
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        hidden.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(dice(container)).toEqual(['3', '2']);
        expect(cube(container)?.isConnected).toBe(true);
        expect(cube(container)?.style.display).toBe('');
        expect(men(container)).toHaveLength(30);
    });

    it('draws the next match at the same table with its own dice and cube', async () =>
    {
        const { container, tell, move } = await live(theirs());

        tell(answered(), theirMove());
        await elapse(200);

        move(match({ dice: [5, 2] }, 1, { id: 'match-next', rev: 1 }));
        await flush();

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(dice(container)).toEqual(['5', '2']);
        expect(cube(container)?.isConnected).toBe(true);
        expect(men(container)).toHaveLength(30);
        expect(container.querySelectorAll('.bg-layer .man[data-tone="dark"]')).toHaveLength(15);
    });

    it('does not move the reader\'s own checkers a second time when the server answers', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('now');

        const animate = vi.spyOn(Element.prototype, 'animate');
        const moved = () => animate.mock.contexts.filter((one) => (one as Element).classList.contains('man')).length;
        const { container, tell } = await live(match({}));

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        fire(button(container, 'Move a checker from 8 to 7'), 'click');
        await elapse(2000);

        const staged = moved();

        expect(staged).toBeGreaterThanOrEqual(2);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);

        const kept = container.querySelector('.bg-layer .man');

        fire(button(container, 'Play the move'), 'click');
        tell(match({ turn: 1, dice: [4, 2], seats: position({ 6: 5, 7: 2, 8: 2, 13: 4, 24: 2 }, { 6: 5, 8: 3, 13: 5, 24: 2 }) }, 0, { rev: 5, turn: 1 }), [happened(5, 0, [
            { e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false },
            { e: 'move', seat: 0, from: 8, to: 7, die: 1, hit: false },
            { e: 'roll', seat: 1, dice: [4, 2] }
        ])]);
        await flush();

        expect(stageOf(container).hasAttribute('data-presenting'), 'the other player\'s roll is not being thrown').toBe(true);

        await elapse(3000);

        expect(document.contains(kept), 'the reader\'s own move was not recognised: the table was drawn again from nothing').toBe(true);
        expect(moved()).toBe(staged);
        expect(dice(container)).toEqual(['4', '2']);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });

    it('moves the checker the reader staged at once, even while the other player\'s move is still playing', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, tell } = await live(theirs());

        tell(answered(), theirMove());
        await elapse(100);
        animate.mockClear();

        fire(button(container, 'Move a checker from 13 to 10'), 'click');
        await elapse(700);

        expect(dice(container)).toEqual(['3', '2']);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(true);

        await elapse(1500);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(button(container, 'Undo').disabled).toBe(false);
    });

    it('plays the one turn it read to catch up, and goes straight to the board when it missed several', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const moved = () => animate.mock.contexts.some((one) => (one as Element).classList.contains('man'));
        const one = await live(theirs());

        animate.mockClear();
        one.tell(answered(), theirMove(), { live: false });
        await flush();

        expect(stageOf(one.container).getAttribute('data-presenting')).toBe('true');
        expect(moved()).toBe(true);
        one.unmount();

        const many = await live(theirs());

        animate.mockClear();
        many.tell(match({ turn: 0, dice: [5, 2], seats: position({ 6: 5, 8: 3, 10: 1, 11: 1, 13: 3, 24: 2 }, { 6: 5, 7: 2, 8: 2, 13: 4, 16: 2 }) }, 0, { rev: 10 }), [
            happened(5, 1, [{ e: 'move', seat: 1, from: 13, to: 7, die: 6, hit: false }, { e: 'move', seat: 1, from: 8, to: 7, die: 1, hit: false }]),
            happened(6, 0, [{ e: 'roll', seat: 0, dice: [3, 2] }]),
            happened(7, 0, [{ e: 'move', seat: 0, from: 13, to: 10, die: 3, hit: false }, { e: 'move', seat: 0, from: 13, to: 11, die: 2, hit: false }]),
            happened(8, 1, [{ e: 'roll', seat: 1, dice: [4, 4] }]),
            happened(9, 1, [
                { e: 'move', seat: 1, from: 24, to: 20, die: 4, hit: false },
                { e: 'move', seat: 1, from: 24, to: 20, die: 4, hit: false },
                { e: 'move', seat: 1, from: 20, to: 16, die: 4, hit: false },
                { e: 'move', seat: 1, from: 20, to: 16, die: 4, hit: false }
            ]),
            happened(10, 0, [{ e: 'roll', seat: 0, dice: [5, 2] }])
        ], { live: false });
        await flush();

        expect(stageOf(many.container).hasAttribute('data-presenting')).toBe(false);
        expect(moved()).toBe(false);
        expect(dice(many.container)).toEqual(['5', '2']);
        expect(men(many.container)).toHaveLength(30);
    });

    it('shows the result only once the table has played what ended the game', async () =>
    {
        const ending = match({ turn: 1, dice: [1, 4], seats: position({ 6: 15 }, { 1: 1, 0: 14 }) }, 0, { turn: 1 });
        const ended = match({ turn: 1, dice: [], phase: 'roll', seats: position({ 6: 15 }, { 0: 15 }) }, 0, {
            rev: 5,
            finishedAt: new Date(401_000).toISOString(),
            players: [
                { seat: 0, who: 'dana.w', timeouts: 0, result: 'lost' },
                { seat: 1, who: 'omid.k', timeouts: 0, result: 'won' }
            ] as MatchView['players']
        });
        const { container, tell } = await live(ending);

        tell(ended, [happened(5, 1, [
            { e: 'move', seat: 1, from: 1, to: 0, die: 1, hit: false },
            { e: 'game', seat: 1, how: 'single', points: 1, cube: 1 },
            { e: 'finish', seat: 1 }
        ])]);
        await flush();

        expect(container.querySelector('.table-result')).toBeNull();

        await elapse(2000);

        expect(container.querySelector('.table-result')).not.toBeNull();
        expect(dice(container)).toEqual([]);
    });

    it('slides to a board that moved with nothing said, as somebody watching sees it', async () =>
    {
        const { container, move } = await live(match({ turn: 1, dice: [6, 1] }, null, { turn: 1 }));

        move(match({ turn: 0, dice: [3, 2], seats: position({ 6: 5, 8: 3, 13: 5, 24: 2 }, { 6: 5, 7: 2, 8: 2, 13: 4, 24: 2 }) }, null, { rev: 5 }));
        await flush();

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');

        await elapse(1500);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(dice(container)).toEqual(['3', '2']);
    });
});

describe('the backgammon helpers', () =>
{
    const blot = (mine: number | null = 0) => match({ dice: [5, 3], seats: position({ 13: 1, 1: 14 }, { 17: 1, 6: 14 }) }, mine);

    it('lights the checkers that can move, and stops when the switch is off without taking a move away', async () =>
    {
        const { container } = still(match({}));

        await flush();

        expect(lit(container)).toBeGreaterThan(0);

        useSettings().update({ hintMoves: false });

        expect(lit(container)).toBe(0);
        expect(button(container, 'Move a checker from 13 to 7')).toBeDefined();
    });

    it('says a hop hits a blot, in its name and on its face, until the switch is off', () =>
    {
        const { container } = still(blot());
        const hitting = button(container, 'Move a checker from 13 to 8 and hit the blot there');

        expect(hitting).toBeDefined();
        expect(hitting.textContent).toContain('Hit');
        expect(button(container, 'Move a checker from 13 to 10')).toBeDefined();

        useSettings().update({ hintOutcome: false });

        const plain = button(container, 'Move a checker from 13 to 8');

        expect(plain).toBeDefined();
        expect(plain.textContent).not.toContain('Hit');
        expect(button(container, 'Move a checker from 13 to 8 and hit the blot there')).toBeUndefined();
    });

    it('says a hop enters from the bar', () =>
    {
        const { container } = still(match({ dice: [5, 3], seats: position({ 25: 1, 6: 14 }, { 6: 15 }) }));

        expect(button(container, 'Enter a checker from the bar on 20')).toBeDefined();
        expect(note(container)).toContain('comes back in first');
    });

    it('coaches the rule that matters, and goes quiet when the coach is off', () =>
    {
        const { container } = still(match({ dice: [3, 3] }));

        expect(note(container)).toContain('A double plays four times');

        useSettings().update({ hintRules: false });

        expect(note(container)).toBeNull();
    });

    it('explains the double to the player it was offered to', () =>
    {
        const { container } = still(match({ phase: 'double', turn: 0, dice: [], cube: 2 }));

        expect(note(container)).toContain('goes on at 4');
    });

    it('gives the player who doubled no tip while they wait for the answer', () =>
    {
        const { container } = still(match({ phase: 'double', turn: 1, dice: [], cube: 2 }));

        expect(note(container)).toBeNull();
    });

    it('gives a spectator no tip and no outcome, because they have no move', () =>
    {
        const doubles = still(match({ dice: [3, 3] }, null));

        expect(note(doubles.container)).toBeNull();
        doubles.unmount();

        const watching = still(blot(null));

        expect(note(watching.container)).toBeNull();
        expect(watching.container.textContent).not.toContain('Hit');
    });
});

describe('moves made on the table itself', () =>
{
    const zone = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-layer .bgt-dice')!;

    const tapDice = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-layer .bgt-dice > .bgt-hit')!.click();

    const tapPoint = (container: HTMLElement, point: number | 'bar' | 'tray', type = 'pointerup') =>
    {
        const svg = container.querySelector('svg') as SVGSVGElement;
        const column = typeof point === 'number' ? columnOf(point) : null;
        const x = column === null ? (point === 'bar' ? BAR_LEFT + BAR_WIDTH / 2 : TRAY_LEFT + TRAY / 2) : column.x + POINT_WIDTH / 2;
        const y = column === null || column.row === 'bottom' ? 700 : 100;

        svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) });
        svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }));
    };

    const stagedOn = (container: HTMLElement) => button(container, 'Play the move').getAttribute('aria-disabled') !== 'true' && !button(container, 'Play the move').disabled;

    it('keeps every button for a move in the panel a keyboard opens, and none of them on show', async () =>
    {
        const rolling = await live(match({ phase: 'roll', dice: [], doubling: true }));
        const moving = await live(match({}));

        for (const container of [rolling.container, moving.container])
        {
            const buttons = [...container.querySelectorAll('.table-stage button')];

            expect(buttons.length).toBeGreaterThan(0);

            for (const one of buttons)
            {
                expect(one.closest('.bg-keys.sr-only'), one.textContent ?? '').not.toBeNull();
            }

            expect(container.querySelector('.bg-keys')?.parentElement, 'the panel sits where something clips it').toBe(stageOf(container));
        }
    });

    it('takes no room from the board for words: the sentences are a screen reader\'s, and only the tip is drawn', async () =>
    {
        const { container } = await live(match({ dice: [3, 3] }));
        const bar = container.querySelector('.table-bar') as HTMLElement;
        const drawn = [...bar.children].filter((one) => !one.classList.contains('sr-only'));

        expect(container.querySelector('[aria-live="polite"]')?.classList.contains('sr-only')).toBe(true);
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('You rolled 3 and 3. Move your checkers.');
        expect(bar.textContent).toContain('Match to 3');
        expect(drawn.map((one) => one.getAttribute('role'))).toEqual(['note']);
    });

    it('puts the clock on the plate of whoever is on turn', async () =>
    {
        const mine = await live(match({}, 0, { remainingMs: 20_000 }));
        const rows = (container: HTMLElement) => [...container.querySelectorAll('.bg-plate')].filter((row) => row.querySelector('.bg-clock') !== null);

        expect(rows(mine.container).length).toBeGreaterThan(0);
        expect(rows(mine.container).every((row) => row.classList.contains('table-hand') || row.hasAttribute('data-me'))).toBe(true);
        expect(mine.container.querySelector('.table-bar .bg-clock')).toBeNull();
        mine.unmount();

        const theirs = await live(match({ turn: 1 }, 0, { turn: 1, remainingMs: 20_000 }));

        expect(rows(theirs.container).length).toBeGreaterThan(0);
        expect(rows(theirs.container).some((row) => row.classList.contains('table-hand') || row.hasAttribute('data-me'))).toBe(false);
    });

    it('rolls when the dice lying on the table are tapped, and shakes them until the answer comes', async () =>
    {
        let answer: (outcome: 'now' | 'failed') => void = () => undefined;
        const play = vi.spyOn(useBoard(), 'play').mockImplementation(async () => await new Promise((resolve) =>
        {
            answer = resolve;
        }));
        const { container } = await live(match({ phase: 'roll', dice: [], doubling: false }));

        expect(dice(container)).toHaveLength(2);
        expect(container.querySelectorAll('.bgt-dice > .die3d[data-blank]')).toHaveLength(2);
        expect(zone(container).dataset.live).toBe('roll');
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Your turn. Roll the dice.');

        tapDice(container);

        expect(play.mock.calls.map((call) => call[0])).toEqual([{ kind: 'backgammon', verb: 'roll' }]);
        expect(zone(container).hasAttribute('data-shake')).toBe(true);

        answer('failed');
        await flush();

        expect(zone(container).hasAttribute('data-shake')).toBe(false);
        expect(zone(container).dataset.live).toBe('roll');
    });

    it('plays the turn when the dice are tapped once the move is whole, and does nothing before that', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({}));

        tapDice(container);

        expect(zone(container).hasAttribute('data-live')).toBe(false);
        expect(play).not.toHaveBeenCalled();

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        fire(button(container, 'Move a checker from 8 to 7'), 'click');
        await elapse(2000);

        expect(zone(container).dataset.live).toBe('done');
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('That is your whole move. Play it, or undo to change it.');

        tapDice(container);

        expect(play.mock.calls.map((call) => call[0])).toEqual([{ kind: 'backgammon', verb: 'move', hops: [{ from: 13, to: 7 }, { from: 8, to: 7 }] }]);
    });

    it('asks before a double is offered: the cube opens the question, and only its answer sends anything', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({ phase: 'roll', dice: [], doubling: true }));
        const ask = () => container.querySelector<HTMLElement>('.bg-ask');

        expect(cube(container)?.hasAttribute('data-live')).toBe(true);
        expect(ask()).toBeNull();

        cube(container)!.click();
        await flush();

        expect(play).not.toHaveBeenCalled();
        expect(ask()?.textContent).toContain('Offer a double to 2?');

        fire(button(ask()!, 'Not now'), 'click');
        await flush();

        expect(ask()).toBeNull();
        expect(play).not.toHaveBeenCalled();

        cube(container)!.click();
        await flush();
        fire(button(ask()!, 'Double to 2'), 'click');
        await flush();

        expect(play.mock.calls.map((call) => call[0])).toEqual([{ kind: 'backgammon', verb: 'double' }]);
        expect(ask()).toBeNull();
    });

    it('leaves the cube alone when no double may be offered', async () =>
    {
        const { container } = await live(match({ phase: 'roll', dice: [], doubling: false }));

        expect(cube(container)?.hasAttribute('data-live')).toBe(false);

        cube(container)!.click();
        await flush();

        expect(container.querySelector('.bg-ask')).toBeNull();
    });

    it('puts the answer to a double on the board in front of the player it was offered to, and of nobody else', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const asked = await live(match({ phase: 'double', turn: 0, dice: [] }));
        const ask = asked.container.querySelector<HTMLElement>('.table-surface .bg-ask')!;

        expect(ask.textContent).toContain('doubles to 2.');
        expect(ask.getAttribute('dir')).toBe('ltr');

        fire(button(ask, 'Take at 2'), 'click');

        expect(play.mock.calls.map((call) => call[0])).toEqual([{ kind: 'backgammon', verb: 'take' }]);
        asked.unmount();

        const waiting = await live(match({ phase: 'double', turn: 1, dice: [] }));

        expect(waiting.container.querySelector('.bg-ask')).toBeNull();
        waiting.unmount();

        const watching = await live(match({ phase: 'double', turn: 0, dice: [] }, null));

        expect(watching.container.querySelector('.bg-ask')).toBeNull();
    });

    it('moves a checker that is tapped, and takes it back when it is tapped again', async () =>
    {
        const { container } = await live(match({}));
        const undoing = () => !(button(container, 'Undo').disabled || button(container, 'Undo').getAttribute('aria-disabled') === 'true');

        tapPoint(container, 24);
        await flush();

        expect(undoing(), 'a checker with two ways to go was moved by the first tap').toBe(false);
        expect(container.querySelectorAll('.bg-layer .bgt-mark')).toHaveLength(2);
        expect(container.querySelectorAll('.bg-layer .man[data-held]')).toHaveLength(1);

        tapPoint(container, 18);
        await elapse(1200);

        expect(undoing()).toBe(true);
        expect(container.querySelectorAll('.bg-layer .man[data-back]'), 'a checker with nowhere further to go was not marked as one a tap takes back').toHaveLength(1);

        tapPoint(container, 8);
        await elapse(1200);

        expect(stagedOn(container)).toBe(true);
        expect(container.querySelectorAll('.bg-layer .man[data-back]')).toHaveLength(1);

        tapPoint(container, 7);
        await elapse(1200);

        expect(stagedOn(container)).toBe(false);
        expect(undoing()).toBe(true);

        tapPoint(container, 18);
        await elapse(1200);

        expect(undoing()).toBe(false);
        expect(container.querySelectorAll('.bg-layer .man[data-back]')).toHaveLength(0);
    });

    it('offers the way back beside the ways on when the checker last moved could also go further', async () =>
    {
        const { container } = await live(match({ dice: [3, 3] }));
        const backs = () => container.querySelectorAll('.bg-layer .bgt-mark[data-back]').length;
        const left = () => container.querySelector('.bg-layer .bgt-left')?.textContent ?? null;

        fire(button(container, 'Move a checker from 13 to 10'), 'click');
        await elapse(1200);

        expect(left()).toBe('×3');
        expect(container.querySelectorAll('.bg-layer .man[data-back]'), 'a checker that can go on was marked as only going back').toHaveLength(0);

        tapPoint(container, 10);
        await flush();

        expect(left(), 'the tap moved the checker on instead of asking').toBe('×3');
        expect(backs()).toBe(1);
        expect(container.querySelectorAll('.bg-layer .man[data-held]')).toHaveLength(1);

        tapPoint(container, 13);
        await elapse(1200);

        expect(left()).toBe('×4');
        expect(backs()).toBe(0);
    });

    it('lifts a checker the moment it is pressed, and puts it down when the press is let go elsewhere', async () =>
    {
        const { container } = await live(match({}));
        const held = () => container.querySelectorAll('.bg-layer .man[data-held]').length;

        tapPoint(container, 13, 'pointerdown');

        expect(held()).toBe(1);

        tapPoint(container, 13, 'pointerleave');

        expect(held()).toBe(0);

        tapPoint(container, 1, 'pointerdown');

        expect(held(), 'a point with nothing to move lifted a checker').toBe(0);
    });

    it('keeps a tapped checker lifted until it takes off, when its move has to wait behind another', async () =>
    {
        const { container } = await live(match({}));
        const held = () => container.querySelectorAll('.bg-layer .man[data-held]').length;

        tapPoint(container, 13);
        await flush();
        tapPoint(container, 8);
        await flush();

        expect(held(), 'the second checker did nothing until the first had landed').toBe(1);

        await elapse(1600);

        expect(held()).toBe(0);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(zone(container).dataset.live).toBe('done');
    });

    it('moves the reader along its own moves when they are made from the keyboard', async () =>
    {
        const { container } = await live(match({}));
        const first = button(container, 'Move a checker from 13 to 7');

        first.focus();
        fire(first, 'click');
        await flush();

        expect((document.activeElement as HTMLElement | null)?.closest('[data-key="hops"]'), 'the reader was dropped onto the page').not.toBeNull();

        fire(button(container, 'Move a checker from 8 to 7'), 'click');
        await flush();

        expect(document.activeElement).toBe(button(container, 'Play the move'));

        fire(button(container, 'Undo'), 'click');
        await flush();

        expect((document.activeElement as HTMLElement | null)?.closest('[data-key="hops"]')).not.toBeNull();
    });

    it('puts the reader on their first move after a roll made from the keyboard, and leaves a tap on the dice where it was', async () =>
    {
        const table = await live(match({ phase: 'roll', dice: [], doubling: false }));
        const rolled = () => table.tell(match({}, 0, { rev: 5 }), [happened(5, 0, [{ e: 'roll', seat: 0, dice: [6, 1] }])]);

        vi.spyOn(useBoard(), 'play').mockImplementation(async () =>
        {
            rolled();

            return 'now';
        });

        button(table.container, 'Roll').focus();
        fire(button(table.container, 'Roll'), 'click');
        await flush();

        expect((document.activeElement as HTMLElement | null)?.closest('[data-key="hops"]'), 'the reader was dropped onto the page when Roll went').not.toBeNull();
        table.unmount();

        const tapped = await live(match({ phase: 'roll', dice: [], doubling: false }));

        vi.spyOn(useBoard(), 'play').mockImplementation(async () =>
        {
            tapped.tell(match({}, 0, { rev: 5 }), [happened(5, 0, [{ e: 'roll', seat: 0, dice: [6, 1] }])]);

            return 'now';
        });

        tapDice(tapped.container);
        await flush();

        expect(document.activeElement?.closest('.bg-keys') ?? null, 'a tap on the table opened the keyboard\'s panel').toBeNull();
    });

    describe('a checker that is dragged', () =>
    {
        const spotXY = (point: number | 'bar' | 'tray') =>
        {
            const column = typeof point === 'number' ? columnOf(point) : null;

            return {
                x: column === null ? (point === 'bar' ? BAR_LEFT + BAR_WIDTH / 2 : TRAY_LEFT + TRAY / 2) : column.x + POINT_WIDTH / 2,
                y: column === null || column.row === 'bottom' ? 700 : 100
            };
        };

        const pointer = (container: HTMLElement, type: string, x: number, y: number, over: PointerEventInit = {}) =>
        {
            const svg = container.querySelector('svg') as SVGSVGElement;

            svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) });
            svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 3, ...over }));
        };

        const dragged = (container: HTMLElement, from: number | 'bar' | 'tray', to: number | 'bar' | 'tray') =>
        {
            const start = spotXY(from);
            const end = spotXY(to);

            pointer(container, 'pointerdown', start.x, start.y);
            pointer(container, 'pointermove', start.x + 30, start.y + (start.y > MIDDLE ? -30 : 30));
            pointer(container, 'pointermove', end.x, end.y);
            pointer(container, 'pointerup', end.x, end.y);
        };

        const carried = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.bg-layer .man[data-carried]')];

        const marks = (container: HTMLElement) => container.querySelectorAll('.bg-layer .bgt-mark').length;

        const held = (container: HTMLElement) => container.querySelectorAll('.bg-layer .man[data-held]').length;

        const undoing = (container: HTMLElement) => !(button(container, 'Undo').disabled || button(container, 'Undo').getAttribute('aria-disabled') === 'true');

        it('carries the checker with the pointer once it has moved far enough, and marks where it can be put down', async () =>
        {
            const { container } = await live(match({ dice: [3, 2] }));
            const start = spotXY(13);

            pointer(container, 'pointerdown', start.x, start.y);
            pointer(container, 'pointermove', start.x + 3, start.y + 3);

            expect(carried(container), 'a press that barely moved became a drag').toEqual([]);
            expect(held(container)).toBe(1);

            pointer(container, 'pointermove', 400, 410);
            await flush();

            expect(carried(container)).toHaveLength(1);
            expect(held(container), 'the next checker on the point was lifted as well').toBe(0);
            expect(marks(container)).toBe(3);

            const before = carried(container)[0].style.translate;

            pointer(container, 'pointermove', 520, 300);

            expect(carried(container)[0].style.translate).not.toBe(before);
        });

        it('makes the move when the checker is let go on a point it can reach', async () =>
        {
            const { container } = await live(match({}));

            dragged(container, 13, 7);
            await flush();

            expect(undoing(container)).toBe(true);
            expect(carried(container)).toEqual([]);

            await elapse(1200);

            expect(marks(container)).toBe(0);
            expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        });

        it('puts the checker back when it is let go where it cannot go, and moves nothing', async () =>
        {
            const { container } = await live(match({}));

            dragged(container, 13, 1);
            await elapse(600);

            expect(undoing(container)).toBe(false);
            expect(carried(container)).toEqual([]);
            expect(marks(container)).toBe(0);
            expect(held(container)).toBe(0);
        });

        it('does not take a checker carried away and brought back for a tap', async () =>
        {
            const { container } = await live(match({}));

            dragged(container, 13, 13);
            await elapse(600);

            expect(undoing(container), 'a checker with one way to go was moved by being put back').toBe(false);
            expect(carried(container)).toEqual([]);

            tapPoint(container, 13);
            await elapse(1200);

            expect(undoing(container)).toBe(true);
        });

        it('takes the last move back when its checker is dragged to where it came from', async () =>
        {
            const { container } = await live(match({}));

            fire(button(container, 'Move a checker from 13 to 7'), 'click');
            await elapse(1200);

            expect(undoing(container)).toBe(true);

            dragged(container, 7, 13);
            await elapse(1200);

            expect(undoing(container)).toBe(false);
            expect(carried(container)).toEqual([]);
        });

        it('makes both hops when a checker is let go on a point only both dice reach', async () =>
        {
            const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
            const { container } = await live(match({}));

            dragged(container, 13, 6);
            await elapse(2400);

            expect(zone(container).dataset.live).toBe('done');

            tapDice(container);

            expect(play.mock.calls.map((call) => call[0])).toEqual([{ kind: 'backgammon', verb: 'move', hops: [{ from: 13, to: 7 }, { from: 7, to: 6 }] }]);
        });

        it('makes both hops for a tap on that point as well', async () =>
        {
            const { container } = await live(match({ dice: [3, 2] }));

            tapPoint(container, 13);
            await flush();

            expect(marks(container)).toBe(3);

            tapPoint(container, 8);
            await elapse(2400);

            expect(zone(container).dataset.live).toBe('done');
        });

        it('does not guess between two ways there that are different plays', async () =>
        {
            const { container } = await live(match({ dice: [5, 3], seats: position({ 13: 1, 1: 14 }, { 17: 1, 6: 14 }) }));
            const start = spotXY(13);
            const end = spotXY(5);

            pointer(container, 'pointerdown', start.x, start.y);
            pointer(container, 'pointermove', 400, 410);
            await flush();

            expect(marks(container)).toBe(2);

            pointer(container, 'pointerup', end.x, end.y);
            await elapse(600);

            expect(undoing(container)).toBe(false);
            expect(carried(container)).toEqual([]);
        });

        it('puts the checker back when the browser takes the gesture away, and takes the next drag', async () =>
        {
            const { container } = await live(match({}));
            const start = spotXY(13);

            pointer(container, 'pointerdown', start.x, start.y);
            pointer(container, 'pointermove', 400, 410);
            pointer(container, 'pointercancel', 400, 410);
            await elapse(600);

            expect(carried(container)).toEqual([]);
            expect(undoing(container)).toBe(false);
            expect(marks(container)).toBe(0);

            dragged(container, 13, 7);
            await flush();

            expect(undoing(container), 'the board took no drag after one was cancelled').toBe(true);
        });

        it('carries one checker at a time: a second finger moves nothing', async () =>
        {
            const { container } = await live(match({}));
            const start = spotXY(13);
            const other = spotXY(8);

            pointer(container, 'pointerdown', start.x, start.y);
            pointer(container, 'pointermove', 400, 410);
            pointer(container, 'pointerdown', other.x, other.y, { pointerId: 9 });
            pointer(container, 'pointermove', 600, 300, { pointerId: 9 });
            pointer(container, 'pointerup', other.x, other.y, { pointerId: 9 });
            await flush();

            expect(carried(container)).toHaveLength(1);
            expect(undoing(container)).toBe(false);
        });

        it('holds the checker above a finger, where it can be seen, and drops it where it is shown', async () =>
        {
            const mouse = await live(match({}));
            const start = spotXY(13);
            const over7 = { x: columnOf(7).x + POINT_WIDTH / 2, y: MIDDLE + 40 };

            pointer(mouse.container, 'pointerdown', start.x, start.y, { pointerType: 'mouse' });
            pointer(mouse.container, 'pointermove', 400, 410, { pointerType: 'mouse' });

            const under = carried(mouse.container)[0].style.translate;

            pointer(mouse.container, 'pointermove', over7.x, over7.y, { pointerType: 'mouse' });
            pointer(mouse.container, 'pointerup', over7.x, over7.y, { pointerType: 'mouse' });
            await flush();

            expect(undoing(mouse.container)).toBe(true);
            mouse.unmount();

            const finger = await live(match({}));

            pointer(finger.container, 'pointerdown', start.x, start.y, { pointerType: 'touch' });
            pointer(finger.container, 'pointermove', 400, 410, { pointerType: 'touch' });

            expect(carried(finger.container)[0].style.translate, 'the checker sat under the finger').not.toBe(under);

            pointer(finger.container, 'pointermove', over7.x, over7.y, { pointerType: 'touch' });
            pointer(finger.container, 'pointerup', over7.x, over7.y, { pointerType: 'touch' });
            await flush();

            expect(undoing(finger.container), 'the checker was shown over the top row and was played on the bottom one').toBe(false);
        });

        it('plays a checker where it is shown when the finger under it is at the very edge of the board', async () =>
        {
            const { container } = await live(match({}));
            const start = spotXY(24);
            const edge = { x: columnOf(18).x + POINT_WIDTH / 2, y: 60 };

            pointer(container, 'pointerdown', start.x, start.y, { pointerType: 'touch' });
            pointer(container, 'pointermove', edge.x, 200, { pointerType: 'touch' });
            pointer(container, 'pointermove', edge.x, edge.y, { pointerType: 'touch' });
            pointer(container, 'pointerup', edge.x, edge.y, { pointerType: 'touch' });
            await flush();

            expect(undoing(container), 'a checker drawn on the point under the finger was refused').toBe(true);
        });

        it('takes a checker let go just over the frame for the point it is drawn on, and one let go well off the board for a change of mind', async () =>
        {
            const near = await live(match({}));
            const start = spotXY(13);
            const x = columnOf(7).x + POINT_WIDTH / 2;

            pointer(near.container, 'pointerdown', start.x, start.y);
            pointer(near.container, 'pointermove', x, 600);
            pointer(near.container, 'pointermove', x, HEIGHT + 10);
            pointer(near.container, 'pointerup', x, HEIGHT + 10);
            await flush();

            expect(undoing(near.container)).toBe(true);
            near.unmount();

            const far = await live(match({}));

            pointer(far.container, 'pointerdown', start.x, start.y);
            pointer(far.container, 'pointermove', x, 600);
            pointer(far.container, 'pointermove', x, HEIGHT + 200);
            pointer(far.container, 'pointerup', x, HEIGHT + 200);
            await elapse(600);

            expect(undoing(far.container), 'a checker carried off the table was played on the nearest point').toBe(false);
            expect(carried(far.container)).toEqual([]);
        });

        it('starts over when a new first pointer goes down on a carry that never ended', async () =>
        {
            const { container } = await live(match({}));
            const start = spotXY(13);
            const other = spotXY(8);

            pointer(container, 'pointerdown', start.x, start.y);
            pointer(container, 'pointermove', 400, 410);

            expect(carried(container)).toHaveLength(1);

            pointer(container, 'pointerdown', other.x, other.y, { pointerId: 11, isPrimary: true });
            await elapse(600);

            expect(carried(container), 'a checker stayed in a hand that had gone').toEqual([]);
            expect(held(container)).toBe(1);

            pointer(container, 'pointerup', other.x, other.y, { pointerId: 11, isPrimary: true });
            await flush();

            expect(marks(container), 'the board took no press after a carry that never ended').toBe(2);
        });

        it('takes the gesture from the page only while there is a checker to carry', async () =>
        {
            const moving = await live(match({}));
            const board = (container: HTMLElement) => container.querySelector('svg')!;

            expect(board(moving.container).classList.contains('touch-none')).toBe(true);
            expect(board(moving.container).closest('[data-drags]'), 'a checker carried from the edge of the screen would swipe the page away').not.toBeNull();
            moving.unmount();

            const waiting = await live(match({ turn: 1 }, 0, { turn: 1 }));

            expect(board(waiting.container).classList.contains('touch-none')).toBe(false);
            expect(board(waiting.container).classList.contains('touch-manipulation')).toBe(true);
            expect(board(waiting.container).closest('[data-drags]')).toBeNull();
        });
    });
});
