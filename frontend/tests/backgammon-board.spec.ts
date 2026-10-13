import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { batch, createSignal } from 'azerothjs';

import BackgammonBoard from '../src/components/games/backgammon-board.component.azeroth';
import { RESULT_OUT, RESULT_WAIT } from '../src/components/games/table-result.component.azeroth';
import WatchBoard from '../src/components/games/watch-board.component.azeroth';
import {
    BAR_LEFT,
    BAR_WIDTH,
    BOTTOM,
    CUBE,
    CUBE_EDGE,
    DICE_X,
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
    patchOf,
    pointAt
} from '../src/game/backgammon-layout.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS, useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { Watched } from '../src/stores/watch.store.ts';
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

const live = async (first: MatchView, heard: EventBatch = NO_EVENTS) =>
{
    const [current, setCurrent] = createSignal(first);
    const [told, setTold] = createSignal<EventBatch>(heard);
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

const zone = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-layer .bgt-dice')!;

const tapDice = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-layer .bgt-dice > .bgt-hit')!.click();

const tapPoint = (container: HTMLElement, point: number | 'bar' | 'tray', type = 'pointerup') =>
{
    const svg = container.querySelector('svg[viewBox="0 0 1000 820"]') as SVGSVGElement;
    const column = typeof point === 'number' ? columnOf(point) : null;
    const x = column === null ? (point === 'bar' ? BAR_LEFT + BAR_WIDTH / 2 : TRAY_LEFT + TRAY / 2) : column.x + POINT_WIDTH / 2;
    const y = column === null || column.row === 'bottom' ? 700 : 100;

    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) });
    svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }));
};

const staged = (container: HTMLElement) => Number(stageOf(container).dataset.staged);

const hop = (container: HTMLElement, from: number | 'bar', to: number | 'tray') =>
{
    const before = staged(container);

    tapPoint(container, from);

    if (staged(container) === before)
    {
        tapPoint(container, to);
    }
};

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

    it('gives every place a checker of the reader\'s can be a patch of the board that is that place and no other', () =>
    {
        const found = [25, ...Array.from({ length: 24 }, (_, index) => 24 - index), 0].map((spot) =>
        {
            const patch = patchOf(spot);
            const corners = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]].map(([across, down]) => pointAt(patch.x + patch.w * across, patch.y + patch.h * down));

            return [spot, [...new Set(corners)]];
        });

        expect(found).toEqual([[25, ['bar']], ...Array.from({ length: 24 }, (_, index) => [24 - index, [24 - index]]), [0, ['tray']]]);
        expect(patchOf(25).y, 'the bar\'s patch is not on the reader\'s half of the bar').toBeGreaterThan(MIDDLE);
        expect(patchOf(0).y, 'the tray\'s patch is not on the reader\'s half of the tray').toBeGreaterThanOrEqual(MIDDLE);
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
    it('lights one checker on every point that can open a 6-1, and none that cannot move', async () =>
    {
        const { container } = await live(match({}));

        expect(lit(container)).toBe(4);
        expect(staged(container)).toBe(0);
    });

    it('keeps a half-staged turn through a re-read of the same board, and drops it once the board moves', async () =>
    {
        const { container, current, move } = await live(match({}));

        hop(container, 13, 7);
        move({ ...current() });

        expect(staged(container)).toBe(1);

        move({ ...current(), rev: current().rev + 1 });

        expect(staged(container)).toBe(0);

        await elapse(2200);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(lit(container), 'the reader was left with nothing to move after the board had settled').toBeGreaterThan(0);
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

        expect(container.querySelector('svg[viewBox="0 0 1000 820"]')).not.toBeNull();
        expect(container.querySelectorAll('button').length).toBe(0);
    });

    it('draws the board left to right in every language, because it is a printed object', () =>
    {
        useLocale().setLocale('fa');
        const { container } = still(match({}));

        expect(container.querySelector('svg[viewBox="0 0 1000 820"]')?.parentElement?.className).toContain('[direction:ltr]');
        useLocale().setLocale('en');
    });

    it('keeps the board, its checkers and the sentence the nodes they were when a hop is staged and the board is read again', async () =>
    {
        const { container, current, move } = await live(match({}));
        const svg = container.querySelector('svg[viewBox="0 0 1000 820"]');
        const said = container.querySelector('[aria-live="polite"]');
        const checkers = [...men(container)];

        hop(container, 13, 7);
        await elapse(1200);

        expect(container.querySelector('svg[viewBox="0 0 1000 820"]')).toBe(svg);
        expect(checkers.every((one) => document.contains(one)), 'a staged hop drew the checkers again').toBe(true);

        move({ ...current() });
        await flush();

        expect(container.querySelector('svg[viewBox="0 0 1000 820"]')).toBe(svg);
        expect(container.querySelector('[aria-live="polite"]')).toBe(said);
        expect(checkers.every((one) => document.contains(one)), 'a re-read drew the checkers again').toBe(true);
        expect(staged(container)).toBe(1);
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

        hop(container, 13, 10);
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

        hop(container, 13, 7);
        hop(container, 8, 7);
        await elapse(2000);

        const flights = moved();

        expect(flights).toBeGreaterThanOrEqual(2);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);

        const kept = container.querySelector('.bg-layer .man');

        tapDice(container);
        tell(match({ turn: 1, dice: [4, 2], seats: position({ 6: 5, 7: 2, 8: 2, 13: 4, 24: 2 }, { 6: 5, 8: 3, 13: 5, 24: 2 }) }, 0, { rev: 5, turn: 1 }), [happened(5, 0, [
            { e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false },
            { e: 'move', seat: 0, from: 8, to: 7, die: 1, hit: false },
            { e: 'roll', seat: 1, dice: [4, 2] }
        ])]);
        await flush();

        expect(stageOf(container).hasAttribute('data-presenting'), 'the other player\'s roll is not being thrown').toBe(true);

        await elapse(3000);

        expect(document.contains(kept), 'the reader\'s own move was not recognised: the table was drawn again from nothing').toBe(true);
        expect(moved()).toBe(flights);
        expect(dice(container)).toEqual(['4', '2']);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });

    it('gives the reader nothing to move while the other player\'s move and their own dice are playing, and then moves a staged checker at once', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const flown = () => animate.mock.contexts.some((one) => (one as Element).classList.contains('man'));
        const { container, tell } = await live(theirs());

        tell(answered(), theirMove());
        await elapse(100);

        expect(lit(container), 'a checker was lit on dice that had not been thrown').toBe(0);
        expect(container.querySelector('svg[viewBox="0 0 1000 820"]')!.hasAttribute('data-drags')).toBe(false);

        await elapse(3400);

        expect(dice(container)).toEqual(['3', '2']);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);

        animate.mockClear();
        hop(container, 13, 10);
        await flush();

        expect(flown(), 'the staged checker waited').toBe(true);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(true);

        await elapse(1500);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(staged(container)).toBe(1);
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

        await elapse(3000);

        expect(container.querySelector('.table-result')).not.toBeNull();
        expect(dice(container)).toEqual([]);
    });

    it('says a seat missed its turn only when the table has shown the turn played for it, and goes on saying so until its next turn has been shown', async () =>
    {
        const missing = (view: MatchView, timeouts: number): MatchView =>
            ({ ...view, players: view.players.map((one) => (one.seat === 1 ? { ...one, timeouts } : one)) as MatchView['players'] });
        const tags = (container: HTMLElement) => [...container.querySelectorAll('.table-plate-tag')].map((one) => one.textContent);
        const once = useLocale().plural('card.missed', 1);
        const missed = await live(theirs());

        missed.tell(missing(answered(), 1), theirMove());
        await flush();

        expect(stageOf(missed.container).getAttribute('data-presenting')).toBe('true');
        expect(tags(missed.container), 'the plate said a turn was missed while the move played for it was still on its way').toEqual([]);

        await elapse(4000);

        expect(stageOf(missed.container).hasAttribute('data-presenting')).toBe(false);
        expect(tags(missed.container)).toEqual([once]);

        missed.unmount();

        const played = await live(missing(theirs(), 1));

        expect(tags(played.container)).toEqual([once]);

        played.tell(answered(), theirMove());
        await flush();

        expect(tags(played.container), 'the plate forgot the missed turn before the turn that mends it had been shown').toEqual([once]);

        await elapse(4000);

        expect(tags(played.container)).toEqual([]);

        played.unmount();

        const level = await live(theirs());

        level.move(missing({ ...theirs(), rev: 5 }, 1));
        await flush();

        expect(stageOf(level.container).hasAttribute('data-presenting')).toBe(false);
        expect(tags(level.container), 'a table with nothing to show first kept the missed turn to itself').toEqual([once]);
    });

    it('is given only so long to show how the game ended', async () =>
    {
        const counts = vi.spyOn(runtime().clock, 'after');
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

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(counts.mock.calls.filter(([ms]) => ms === RESULT_WAIT), 'the table was given as long as it liked to show how the game ended').toHaveLength(1);
    });

    it('is given as long as it likes to show a game that is going on', async () =>
    {
        const counts = vi.spyOn(runtime().clock, 'after');
        const { container } = await live(match({ dice: [6, 1] }, 0, { rev: 1 }), {
            seq: 1,
            id: 'match-bg',
            events: [happened(1, 0, [{ e: 'opening', seat: 0, dice: [6, 1] }])],
            live: true,
            jump: false,
            opens: () => true
        });

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(counts.mock.calls.filter(([ms]) => ms === RESULT_WAIT), 'a game that is going on was given only so long to be shown').toHaveLength(0);
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

    it('tells whoever drew it when it is playing something, when it has finished, and when it is taken down', async () =>
    {
        const heard: boolean[] = [];
        const [current, setCurrent] = createSignal(match({ turn: 1, dice: [6, 1] }, null, { turn: 1 }));
        const view = renderTest(() => BackgammonBoard({
            get match()
            {
                return current();
            },
            events: NO_EVENTS,
            onPresenting: (busy: boolean) =>
            {
                heard.push(busy);
            }
        }) as Rendered);

        await flush();

        expect(heard, 'a board at rest said it was playing').not.toContain(true);

        setCurrent(match({ turn: 0, dice: [3, 2], seats: position({ 6: 5, 8: 3, 13: 5, 24: 2 }, { 6: 5, 7: 2, 8: 2, 13: 4, 24: 2 }) }, null, { rev: 5 }));
        await flush();

        expect(heard.at(-1), 'the board moved and whoever drew it was not told').toBe(true);
        expect(stageOf(view.container).getAttribute('data-presenting')).toBe('true');

        await elapse(1500);

        expect(heard.at(-1)).toBe(false);
        expect(stageOf(view.container).hasAttribute('data-presenting')).toBe(false);

        setCurrent(match({ turn: 1, dice: [4, 1], seats: position({ 6: 5, 8: 3, 13: 5, 24: 2 }, { 6: 5, 8: 3, 13: 5, 24: 2 }) }, null, { rev: 6, turn: 1 }));
        await flush();

        expect(heard.at(-1)).toBe(true);

        const before = heard.length;

        cleanup();

        expect(heard.slice(before), 'a board taken down in the middle of a scene left whoever drew it waiting').toEqual([false]);
    });

    it('is not called over, for somebody watching, before the table has shown how it ended', async () =>
    {
        vi.spyOn(usePeople(), 'want').mockImplementation(async () => undefined);

        const ending = match({ turn: 1, dice: [1, 4], seats: position({ 6: 15 }, { 1: 1, 0: 14 }) }, null, { turn: 1 });
        const ended = match({ turn: 1, dice: [], phase: 'roll', seats: position({ 6: 15 }, { 0: 15 }) }, null, {
            rev: 5,
            finishedAt: new Date(401_000).toISOString(),
            players: [
                { seat: 0, who: 'dana.w', timeouts: 0, result: 'lost' },
                { seat: 1, who: 'omid.k', timeouts: 0, result: 'won' }
            ] as MatchView['players']
        });
        const [watch, setWatch] = createSignal<Watched>({ match: ending, behind: 30, delay: 30, live: true });
        const [told, setTold] = createSignal<EventBatch>(NO_EVENTS);
        const { container } = renderTest(() => WatchBoard({
            get watch()
            {
                return watch();
            },
            get events()
            {
                return told();
            },
            onDone: () => undefined
        }) as Rendered);
        const over = () => container.textContent?.includes(useLocale().t('watch.finished')) ?? false;
        const back = () => [...container.querySelectorAll('button')].some((one) => one.textContent?.trim() === useLocale().t('watch.back'));

        await vi.waitFor(() => expect(container.querySelector('.table-stage')).not.toBeNull(), { timeout: 4000 });
        await flush();

        batch(() =>
        {
            setWatch({ match: ended, behind: 0, delay: 30, live: false });
            setTold({
                seq: 1,
                id: ended.id,
                events: [happened(5, 1, [
                    { e: 'move', seat: 1, from: 1, to: 0, die: 1, hit: false },
                    { e: 'game', seat: 1, how: 'single', points: 1, cube: 1 },
                    { e: 'finish', seat: 1 }
                ])],
                live: true,
                jump: false
            });
        });
        await flush();

        expect(stageOf(container).getAttribute('data-presenting'), 'the end of the game was not played').toBe('true');
        expect(over(), 'the game was called over while its last checker was still in the air').toBe(false);
        expect(back()).toBe(false);
        expect(container.querySelector('.table-result')).toBeNull();

        const clock = runtime().clock as ManualClock;
        let early = 0;

        for (let step = 0; step < 300; step += 1)
        {
            clock.advance(10);
            await flush();

            if ((over() || back()) && stageOf(container).hasAttribute('data-presenting'))
            {
                early += 1;
            }
        }

        expect(early, 'the frame said the game was over under a table still showing it').toBe(0);
        expect(over()).toBe(true);
        expect(back()).toBe(true);
        expect(container.querySelector('.table-result')).not.toBeNull();
    });
});

describe('the opening roll', () =>
{
    const said = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')?.textContent ?? '';

    const begun = (over: Partial<MatchView> = {}) => match({ dice: [6, 1] }, 0, { rev: 1, ...over });

    const opening = (id: string, opens: () => boolean): EventBatch =>
        ({ seq: 1, id, events: [happened(1, 0, [{ e: 'opening', seat: 0, dice: [6, 1] }])], live: true, jump: false, opens });

    it('is thrown for a game opened with the frame that began it, and nothing is told of it until it has landed', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const table = await live(begun(), opening('match-bg', () => true));

        expect(stageOf(table.container).getAttribute('data-presenting')).toBe('true');
        expect(animate.mock.contexts.some((one) => (one as Element).classList.contains('die3d-body')), 'no die was thrown').toBe(true);
        expect(lit(table.container), 'checkers were lit before the opening roll had landed').toBe(0);
        expect(said(table.container)).not.toContain('rolled');
        expect(table.container.querySelector('svg[viewBox="0 0 1000 820"]')!.hasAttribute('data-drags')).toBe(false);

        await elapse(1500);

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(dice(table.container)).toEqual(['6', '1']);
        expect(lit(table.container)).toBeGreaterThan(0);
        expect(said(table.container)).toBe('You rolled 6 and 1. Move your checkers.');
        expect(men(table.container)).toHaveLength(30);
    });

    it('is thrown once: a board drawn again with the same frame has its dice down and says so at once', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const table = await live(begun(), opening('match-bg', () => false));

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(animate.mock.contexts.some((one) => (one as Element).classList.contains('die3d-body'))).toBe(false);
        expect(dice(table.container)).toEqual(['6', '1']);
        expect(lit(table.container)).toBeGreaterThan(0);
        expect(said(table.container)).toBe('You rolled 6 and 1. Move your checkers.');
    });

    it('is thrown for the next game at the same table when the result of the game before has left it, and not under it', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const table = await live(match({ dice: [], phase: 'roll' }, 0, {
            rev: 9,
            finishedAt: new Date(401_000).toISOString(),
            outcome: 'won',
            winner: 0,
            players: [
                { seat: 0, who: 'dana.w', timeouts: 0, result: 'won' },
                { seat: 1, who: 'omid.k', timeouts: 0, result: 'lost' }
            ] as MatchView['players']
        }));
        const next = begun({ id: 'match-next' });
        const result = () => table.container.querySelector('.table-result');
        const thrown = () => animate.mock.contexts.some((one) => (one as Element).classList.contains('die3d-body'));

        expect(result()).not.toBeNull();

        animate.mockClear();
        table.tell(next, [happened(1, 0, [{ e: 'opening', seat: 0, dice: [6, 1] }])], { opens: () => true });
        await flush();

        expect(stageOf(table.container).getAttribute('data-presenting'), 'a table waiting to open behind its result said it was idle').toBe('true');
        expect(result()?.getAttribute('data-leaving'), 'the result of the game before stood over the opening of this one, or was gone in one frame').toBe('true');
        expect(result()?.querySelectorAll('.table-result-card li'), 'the result went telling of a game that had only just begun').toHaveLength(2);
        expect(lit(table.container)).toBe(0);
        expect(said(table.container), 'a sentence about the game before was read out over the opening of this one').toBe('');

        await elapse(RESULT_OUT - 1);

        expect([result() === null, thrown()], 'the dice that open the next game were thrown under the result of the last one').toEqual([false, false]);

        await elapse(1);

        expect([result(), thrown()], 'the dice waited longer than the result took to leave').toEqual([null, true]);

        await elapse(1500);

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(dice(table.container)).toEqual(['6', '1']);
        expect(said(table.container)).toBe('You rolled 6 and 1. Move your checkers.');
    });

    it('names nobody as on turn until the two dice that say who starts have landed', async () =>
    {
        const table = await live(begun({ remainingMs: 20_000 }), opening('match-bg', () => true));
        const worn = () => [...table.container.querySelectorAll('.bg-rail')].map((rail) => [rail.querySelector('.table-plate')?.hasAttribute('data-turn') === true, rail.querySelector('.bg-clock') !== null]);

        expect(worn(), 'who starts was shown while the dice that decide it were in the air').toEqual([[false, false], [false, false]]);

        await elapse(1500);

        expect(worn()).toEqual([[false, false], [true, true]]);
    });

    it('is left alone on a board that is already showing the game: the dice stay where they lie', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const table = await live(begun());

        animate.mockClear();
        table.tell(begun(), [happened(1, 0, [{ e: 'opening', seat: 0, dice: [6, 1] }])], { opens: () => true });
        await flush();

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(animate.mock.contexts.some((one) => (one as Element).classList.contains('die3d-body'))).toBe(false);
        expect(dice(table.container)).toEqual(['6', '1']);
    });
});

describe('a game that ends on the board', () =>
{
    const said = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')?.textContent ?? '';

    const flag = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-layer .bgt-banner');

    const plate = (container: HTMLElement, name: string) =>
        [...container.querySelectorAll<HTMLElement>('.bg-rail')].filter((one) => one.textContent?.includes(name));

    const reads = (container: HTMLElement, name: string, words: string) =>
    {
        const plates = plate(container, name);

        return plates.length > 0 && plates.every((one) => one.textContent?.includes(words));
    };

    const seats = (scoreOne: number): Backgammon['seats'] => [
        { seat: 0, checkers: [...START], pips: 167, score: 0 },
        { seat: 1, checkers: [...START], pips: 167, score: scoreOne }
    ];

    const ending = () => match({ turn: 1, dice: [1, 4], seats: position({ 6: 15 }, { 1: 1, 0: 14 }) }, 0, { turn: 1 });

    const lastHop: Played = { e: 'move', seat: 1, from: 1, to: 0, die: 1, hit: false };

    it('leaves the score and the pips on the plates where the board is, and moves each when the board shows it', async () =>
    {
        const table = await live(ending());

        expect(reads(table.container, 'omid.k', '0 of 3')).toBe(true);
        expect(reads(table.container, 'omid.k', '1 pip')).toBe(true);
        expect(reads(table.container, 'You', '90 pips')).toBe(true);

        table.tell(match({ turn: 0, dice: [5, 2], round: 2, seats: seats(1) }, 0, { rev: 5, turn: 0 }), [happened(5, 1, [
            lastHop,
            { e: 'game', seat: 1, how: 'single', points: 1, cube: 1 },
            { e: 'opening', seat: 0, dice: [5, 2] }
        ])]);
        await flush();

        expect(reads(table.container, 'omid.k', '0 of 3'), 'the point was on the plate before the last checker was off').toBe(true);
        expect(reads(table.container, 'omid.k', '1 pip')).toBe(true);
        expect(reads(table.container, 'You', '90 pips'), 'the next game\'s pips were on the plate under the finished board').toBe(true);

        await elapse(760);

        expect([...flag(table.container)!.children].map((line) => line.textContent)).toEqual(['omid.k wins the game', '1 point']);
        expect(said(table.container)).toBe('omid.k wins the game. 1 point.');
        expect(reads(table.container, 'omid.k', '1 of 3')).toBe(true);
        expect(reads(table.container, 'omid.k', '0 pips')).toBe(true);
        expect(reads(table.container, 'You', '90 pips')).toBe(true);

        await elapse(5500);

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(flag(table.container)).toBeNull();
        expect(reads(table.container, 'omid.k', '167 pips')).toBe(true);
        expect(reads(table.container, 'You', '167 pips')).toBe(true);
        expect(said(table.container)).toBe('You rolled 5 and 2. Move your checkers.');
        expect(dice(table.container)).toEqual(['5', '2']);
    });

    it('says how the game was won when it was more than a single game, and to the winner in the winner\'s words', async () =>
    {
        const table = await live(match({ turn: 0, dice: [1, 4], seats: position({ 1: 1, 0: 14 }, { 20: 15 }), cube: 2, owner: 0, target: 5 }, 0));

        table.tell(match({ turn: 1, dice: [5, 2], round: 2, seats: [{ seat: 0, checkers: [...START], pips: 167, score: 4 }, { seat: 1, checkers: [...START], pips: 167, score: 0 }], target: 5 }, 0, { rev: 5, turn: 1 }), [happened(5, 0, [
            { e: 'move', seat: 0, from: 1, to: 0, die: 1, hit: false },
            { e: 'game', seat: 0, how: 'gammon', points: 4, cube: 2 },
            { e: 'opening', seat: 1, dice: [5, 2] }
        ])]);
        await elapse(760);

        expect([...flag(table.container)!.children].map((line) => line.textContent)).toEqual(['You win the game', 'Gammon, 4 points']);
        expect(said(table.container)).toBe('You win the game. Gammon, 4 points.');
    });

    it('calls the last game on the board before the result of the match is shown', async () =>
    {
        const table = await live(ending());

        table.tell(match({ turn: 1, dice: [], phase: 'roll', seats: [{ seat: 0, checkers: row({ 6: 15 }), pips: 90, score: 0 }, { seat: 1, checkers: row({ 0: 15 }), pips: 0, score: 3 }] }, 0, {
            rev: 5,
            finishedAt: new Date(401_000).toISOString(),
            players: [
                { seat: 0, who: 'dana.w', timeouts: 0, result: 'lost' },
                { seat: 1, who: 'omid.k', timeouts: 0, result: 'won' }
            ] as MatchView['players']
        }), [happened(5, 1, [
            lastHop,
            { e: 'game', seat: 1, how: 'backgammon', points: 3, cube: 1 },
            { e: 'finish', seat: 1 }
        ])]);
        await elapse(760);

        expect([...flag(table.container)!.children].map((line) => line.textContent)).toEqual(['omid.k wins the game', 'Backgammon, 3 points']);
        expect(table.container.querySelector('.table-result'), 'the result of the match stood over the game that was still being called').toBeNull();
        expect(said(table.container), 'the last game of a match was called to nobody who cannot see the banner').toBe('omid.k wins the game. Backgammon, 3 points.');
        expect(reads(table.container, 'omid.k', 'Won'), 'a plate said who had won the match while the game was still being called').toBe(false);
        expect(reads(table.container, 'You', 'Lost')).toBe(false);

        await elapse(2400);

        expect(flag(table.container)).toBeNull();
        expect(table.container.querySelector('.table-result')).not.toBeNull();
        expect(reads(table.container, 'omid.k', 'Won')).toBe(true);
        expect(reads(table.container, 'You', 'Lost')).toBe(true);
    });

    it('holds the tags of a match that ends with nothing to show for only as long as the table takes to clear', async () =>
    {
        const table = await live(match({}));

        table.tell(match({ dice: [] }, 0, {
            rev: 5,
            finishedAt: new Date(401_000).toISOString(),
            players: [
                { seat: 0, who: 'dana.w', timeouts: 0, result: 'won' },
                { seat: 1, who: 'omid.k', timeouts: 0, result: 'abandoned' }
            ] as MatchView['players']
        }), [happened(5, 1, [{ e: 'forfeit', seat: 1, reason: 'resign' }, { e: 'finish', seat: 0 }])]);
        await elapse(900);

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(flag(table.container)).toBeNull();
        expect(reads(table.container, 'You', 'Won')).toBe(true);
        expect(table.container.querySelector('.table-result')).not.toBeNull();
    });

    it('is called in Persian, and read from the right, for a Persian reader', async () =>
    {
        useLocale().setLocale('fa');

        const table = await live(ending());

        table.tell(match({ turn: 0, dice: [5, 2], round: 2, seats: seats(1) }, 0, { rev: 5, turn: 0 }), [happened(5, 1, [
            lastHop,
            { e: 'game', seat: 1, how: 'single', points: 1, cube: 1 },
            { e: 'opening', seat: 0, dice: [5, 2] }
        ])]);
        await elapse(760);

        expect(flag(table.container)!.dir).toBe('rtl');
        expect([...flag(table.container)!.children].map((line) => line.textContent)).toEqual(['omid.k این دست را برد', '۱ امتیاز']);
    });

    it('lets the reader\'s pips fall with the checker they have put down, and come back with it', async () =>
    {
        const table = await live(match({}));

        expect(reads(table.container, 'You', '167 pips')).toBe(true);

        hop(table.container, 13, 7);
        await elapse(1200);

        expect(reads(table.container, 'You', '161 pips')).toBe(true);
        expect(reads(table.container, 'omid.k', '167 pips')).toBe(true);
    });
});

describe('a roll nobody could play', () =>
{
    const said = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')?.textContent ?? '';

    const mark = (container: HTMLElement) => container.querySelector('.bg-layer .bgt-dice > .bgt-pass')?.textContent ?? null;

    it('is said so on the dice and to a screen reader, and the turn that follows is said after it', async () =>
    {
        const table = await live(match({ phase: 'roll', turn: 1, dice: [] }, 0, { turn: 1 }));

        table.tell(match({ turn: 0, dice: [5, 2] }, 0, { rev: 5, turn: 0 }), [happened(5, 1, [
            { e: 'roll', seat: 1, dice: [6, 5] },
            { e: 'pass', seat: 1 },
            { e: 'roll', seat: 0, dice: [5, 2] }
        ])]);
        await elapse(1300);

        expect(mark(table.container)).toBe('No move');
        expect(said(table.container)).toBe('omid.k rolled 6 and 5 and cannot move.');
        expect(lit(table.container), 'the reader was shown what to move while the other player\'s dice were being called unplayable').toBe(0);

        await elapse(3000);

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(mark(table.container)).toBeNull();
        expect(said(table.container)).toBe('You rolled 5 and 2. Move your checkers.');
    });

    it('is said of the reader\'s own dice in the reader\'s own words', async () =>
    {
        const table = await live(match({ phase: 'roll', dice: [], doubling: false }));

        table.tell(match({ turn: 1, dice: [4, 3] }, 0, { rev: 5, turn: 1 }), [happened(5, 0, [
            { e: 'roll', seat: 0, dice: [6, 6] },
            { e: 'pass', seat: 0 },
            { e: 'roll', seat: 1, dice: [4, 3] }
        ])]);
        await elapse(1300);

        expect(mark(table.container)).toBe('No move');
        expect(said(table.container)).toBe('You rolled 6 and 6 and cannot move.');

        await elapse(3000);

        expect(said(table.container)).toBe('omid.k is playing.');
    });

    it('gives way to the turn when nothing was rolled after it', async () =>
    {
        const table = await live(match({ phase: 'roll', turn: 1, dice: [] }, 0, { turn: 1 }));

        table.tell(match({ phase: 'roll', turn: 0, dice: [], doubling: true }, 0, { rev: 5, turn: 0 }), [happened(5, 1, [
            { e: 'roll', seat: 1, dice: [6, 5] },
            { e: 'pass', seat: 1 }
        ])]);
        await elapse(1300);

        expect(said(table.container)).toBe('omid.k rolled 6 and 5 and cannot move.');

        await elapse(2500);

        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
        expect(mark(table.container)).toBeNull();
        expect(said(table.container)).toBe('Your turn. Tap the dice to roll.');
    });

    it('is written and said in Persian to a Persian reader', async () =>
    {
        useLocale().setLocale('fa');

        const table = await live(match({ phase: 'roll', dice: [], doubling: false }));

        table.tell(match({ turn: 1, dice: [4, 3] }, 0, { rev: 5, turn: 1 }), [happened(5, 0, [
            { e: 'roll', seat: 0, dice: [6, 6] },
            { e: 'pass', seat: 0 },
            { e: 'roll', seat: 1, dice: [4, 3] }
        ])]);
        await elapse(1300);

        expect(mark(table.container)).toBe('حرکتی نیست');
        expect(said(table.container)).toBe('تاس‌هایت ۶ و ۶ آمد و حرکتی نداری.');
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

        hop(container, 13, 7);

        expect(staged(container), 'the move went with its light').toBe(1);
    });

    it('coaches a checker on the bar back in before anything else moves', () =>
    {
        const { container } = still(match({ dice: [5, 3], seats: position({ 25: 1, 6: 14 }, { 6: 15 }) }));

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

    it('gives a spectator no tip, because they have no move', () =>
    {
        const doubles = still(match({ dice: [3, 3] }, null));

        expect(note(doubles.container)).toBeNull();
        doubles.unmount();

        const watching = still(blot(null));

        expect(note(watching.container)).toBeNull();
    });
});

describe('a backgammon board played from a keyboard', () =>
{
    const stops = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.bg-cursor > .bg-stop')];

    const named = (container: HTMLElement) => stops(container).map((stop) => stop.getAttribute('aria-label'));

    const keys = (container: HTMLElement) => stops(container).map((stop) => stop.dataset.stop);

    const tabbed = (container: HTMLElement) => stops(container).filter((stop) => stop.tabIndex === 0).map((stop) => stop.dataset.stop);

    const at = (container: HTMLElement, name: string) => stops(container).find((stop) => stop.dataset.stop === name)!;

    const key = async (on: HTMLElement, which: string) =>
    {
        const typed = new KeyboardEvent('keydown', { key: which, bubbles: true, cancelable: true });

        on.dispatchEvent(typed);
        await flush();

        return typed.defaultPrevented;
    };

    const focused = () => (document.activeElement as HTMLElement | null)?.dataset.stop ?? null;

    const asking = (container: HTMLElement) => container.querySelector<HTMLElement>('.bg-ask');

    const blot = position({ 24: 2, 13: 5, 8: 3, 6: 5 }, { 24: 2, 13: 5, 8: 3, 7: 1, 6: 4 });

    it('stands a stop on the dice when the reader is to roll, and one on the cube when they may double', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const plain = await live(match({ phase: 'roll', dice: [], doubling: false }));

        expect(named(plain.container)).toEqual(['The dice. Roll them.']);
        expect([at(plain.container, 'dice').style.left, at(plain.container, 'dice').style.top], 'the stop is not where the dice lie').toEqual([`${ (DICE_X / WIDTH * 100).toFixed(3) }%`, '50%']);
        expect(plain.container.querySelector('.bg-cursor')?.getAttribute('role')).toBe('group');
        expect(plain.container.querySelector('.bg-cursor')?.getAttribute('aria-label')).toBe('The board');
        expect(stops(plain.container).map((stop) => stop.getAttribute('role'))).toEqual(['button']);

        expect(await key(at(plain.container, 'dice'), 'Enter'), 'the page was left to scroll or press something else').toBe(true);
        expect(play.mock.calls.map((call) => call[0])).toEqual([{ kind: 'backgammon', verb: 'roll' }]);
        plain.unmount();

        const doubling = await live(match({ phase: 'roll', dice: [], doubling: true }));

        expect(named(doubling.container)).toEqual(['The dice. Roll them.', 'The cube. Offer a double to 2.']);
        expect(at(doubling.container, 'cube').style.top, 'the stop is not on the cube in the middle').toBe(`${ ((MIDDLE - CUBE / 2) / HEIGHT * 100).toFixed(3) }%`);

        await key(at(doubling.container, 'cube'), ' ');

        expect(doubling.container.querySelector('.bg-ask'), 'the cube was pressed and nothing was asked').not.toBeNull();
        doubling.unmount();

        const held = await live(match({ phase: 'roll', dice: [], doubling: true, cube: 2, owner: 0 }));

        expect(named(held.container)).toEqual(['The dice. Roll them.', 'The cube. Offer a double to 4.']);
        expect(at(held.container, 'cube').style.top, 'the stop is not on the cube the reader holds').toBe(`${ ((BOTTOM - CUBE_EDGE - CUBE / 2) / HEIGHT * 100).toFixed(3) }%`);
    });

    it('comes to the first checker when the dice a key rolled have landed, and to the dice again when the turn comes back', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('now');

        const table = await live(match({ phase: 'roll', dice: [], doubling: false }));

        at(table.container, 'dice').focus();
        await key(at(table.container, 'dice'), 'Enter');

        expect(focused()).toBe('dice');

        table.tell(match({}, 0, { rev: 5 }), [happened(5, 0, [{ e: 'roll', seat: 0, dice: [6, 1] }])]);
        await elapse(2400);

        expect(keys(table.container)).toEqual(['at-24', 'at-13', 'at-8', 'at-6']);
        expect(focused(), 'the dice have landed and the keyboard is nowhere').toBe('at-24');

        table.tell(match({ turn: 1, phase: 'roll', dice: [] }, 0, { rev: 6, turn: 1 }), [happened(6, 0, [{ e: 'move', seat: 0, from: 24, to: 18, die: 6, hit: false }, { e: 'move', seat: 0, from: 6, to: 5, die: 1, hit: false }])]);
        await elapse(2400);

        expect([keys(table.container), focused()]).toEqual([[], null]);

        table.tell(match({ phase: 'roll', dice: [], seats: position({ 24: 1, 18: 1, 13: 5, 8: 3, 6: 4, 5: 1 }, { 24: 2, 13: 5, 8: 3, 6: 5 }) }, 0, { rev: 7 }), []);
        await elapse(2400);

        expect([keys(table.container), focused()], 'the turn came back and the keyboard did not').toEqual([['dice'], 'dice']);
    });

    it('stands a stop on every point with a checker that may move, the farthest first, and says what stands there and what the key does', async () =>
    {
        const { container } = await live(match({}));

        expect(keys(container)).toEqual(['at-24', 'at-13', 'at-8', 'at-6']);
        expect(named(container)).toEqual([
            'Point 24, 2 checkers. Lift one.',
            'Point 13, 5 checkers. Move one to point 7.',
            'Point 8, 3 checkers. Lift one.',
            'Point 6, 5 checkers. Move one to point 5.'
        ]);
    });

    it('says where a checker goes when the key moves it at once: to a point, onto a blot, off the board, in from the bar', async () =>
    {
        const striking = await live(match({ seats: position({ 24: 1, 6: 14 }, { 7: 1, 6: 12, 2: 2 }) }));

        expect(named(striking.container)).toEqual(['Point 24, 1 checker. Move it to point 18 and hit.', 'Point 6, 14 checkers. Move one to point 5.']);

        await key(at(striking.container, 'at-24'), 'Enter');
        await elapse(1200);

        expect(staged(striking.container), 'the stop said the key moves the checker, and it did not').toBe(1);
        striking.unmount();

        const bearing = await live(match({ seats: position({ 1: 2, 0: 13 }, { 1: 1, 0: 14 }) }));

        expect(named(bearing.container)).toEqual(['Point 1, 2 checkers. Bear one off.']);
        bearing.unmount();

        const entering = await live(match({ seats: position({ 25: 1, 6: 14 }, { 13: 2, 6: 12, 1: 1 }) }));

        expect(named(entering.container)).toEqual(['The bar, 1 checker. Bring it in on point 24 and hit.']);
    });

    it('lies each stop over its own point, so the ring round it is round the place that is meant', async () =>
    {
        const { container } = await live(match({}));
        const patch = patchOf(13);
        const drawn = at(container, 'at-13').style;

        expect([drawn.left, drawn.top, drawn.width, drawn.height]).toEqual([
            `${ (patch.x / WIDTH * 100).toFixed(3) }%`,
            `${ (patch.y / HEIGHT * 100).toFixed(3) }%`,
            `${ (patch.w / WIDTH * 100).toFixed(3) }%`,
            `${ (patch.h / HEIGHT * 100).toFixed(3) }%`
        ]);
    });

    it('keeps one stop in the tab order, and walks the others with the arrows, round and round', async () =>
    {
        const { container } = await live(match({}));

        expect(tabbed(container)).toEqual(['at-24']);

        at(container, 'at-24').focus();

        expect(await key(at(container, 'at-24'), 'ArrowRight')).toBe(true);
        expect([focused(), tabbed(container)]).toEqual(['at-13', ['at-13']]);

        const walk = async (which: string) =>
        {
            await key(document.activeElement as HTMLElement, which);

            return focused();
        };

        expect([await walk('ArrowDown'), await walk('ArrowRight'), await walk('ArrowDown')], 'the walk does not go on, past the last stop to the first').toEqual(['at-8', 'at-6', 'at-24']);
        expect([await walk('ArrowLeft'), await walk('ArrowUp'), await walk('ArrowLeft')], 'the walk does not go back, past the first stop to the last').toEqual(['at-6', 'at-8', 'at-13']);
        expect([await walk('End'), await walk('Home'), await walk('ArrowUp')]).toEqual(['at-6', 'at-24', 'at-6']);
        expect(tabbed(container)).toEqual(['at-6']);
        expect(await key(at(container, 'at-6'), 'a'), 'a key that means nothing here was taken from the page').toBe(false);
    });

    it('lifts a checker with Enter, stands the stops on the places it may go, and goes to the first of them', async () =>
    {
        const { container } = await live(match({}));

        at(container, 'at-24').focus();
        await key(at(container, 'at-24'), 'Enter');

        expect(named(container)).toEqual(['Point 24. Put it back.', 'Point 23. Put it down here.', 'Point 18. Put it down here.']);
        expect([focused(), tabbed(container)]).toEqual(['at-23', ['at-23']]);
        expect(staged(container)).toBe(0);
    });

    it('puts it down with Enter, moves a checker that has one place to go without lifting it, and comes to the dice when the move is whole', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({}));

        at(container, 'at-24').focus();
        await key(at(container, 'at-24'), 'Enter');
        await key(at(container, 'at-18'), 'Enter');
        await elapse(1200);

        expect(staged(container)).toBe(1);
        expect(named(container)).toEqual([
            'Point 24, 1 checker. Move it to point 23.',
            'Point 18. Take the last move back.',
            'Point 8, 3 checkers. Move one to point 7.',
            'Point 6, 5 checkers. Move one to point 5.'
        ]);
        expect(focused()).toBe('at-24');

        await key(at(container, 'at-6'), 'Enter');
        await elapse(1200);

        expect(staged(container)).toBe(2);
        expect(named(container)).toEqual(['Point 5. Take the last move back.', 'The dice. Play this move.']);
        expect(focused(), 'the move is whole and the keyboard is not on the dice').toBe('dice');

        await key(at(container, 'dice'), 'Enter');

        expect(play.mock.calls.map((call) => call[0])).toEqual([{ kind: 'backgammon', verb: 'move', hops: [{ from: 24, to: 18 }, { from: 6, to: 5 }] }]);
    });

    it('puts back what is lifted with Escape, and leaves Escape to the page when nothing is', async () =>
    {
        const { container } = await live(match({}));

        at(container, 'at-24').focus();

        expect(await key(at(container, 'at-24'), 'Escape'), 'Escape was taken with nothing lifted').toBe(false);

        await key(at(container, 'at-24'), 'Enter');

        expect(await key(at(container, 'at-23'), 'Escape')).toBe(true);
        expect(keys(container)).toEqual(['at-24', 'at-13', 'at-8', 'at-6']);
        expect(focused()).toBe('at-24');
    });

    it('lets a checker that has just moved go on, or back to where it came from', async () =>
    {
        const { container } = await live(match({ dice: [3, 1] }));

        at(container, 'at-13').focus();
        await key(at(container, 'at-13'), 'Enter');
        await elapse(1200);

        expect(staged(container)).toBe(1);
        expect(focused(), 'the keyboard did not go with a checker that may go on').toBe('at-10');
        expect(at(container, 'at-10').getAttribute('aria-label'), 'a checker that may go on or back is lifted, whatever the stop says').toBe('Point 10, 1 checker. Lift it.');

        await key(at(container, 'at-10'), 'Enter');

        expect(named(container)).toEqual(['Point 13. Take the last move back.', 'Point 10. Put it back.', 'Point 9. Put it down here.']);
        expect(focused(), 'a checker was lifted to go on and the keyboard was put on the stop that takes its move back').toBe('at-9');

        await key(at(container, 'at-13'), 'Enter');
        await elapse(1200);

        expect(staged(container)).toBe(0);
    });

    it('leaves the keyboard where it is when a key could do nothing', async () =>
    {
        const { container } = await live(match({}));

        at(container, 'at-13').focus();
        vi.spyOn(useBoard(), 'busy').mockReturnValue(true);
        await key(at(container, 'at-13'), 'Enter');

        expect([staged(container), focused()]).toEqual([0, 'at-13']);
    });

    it('does a thing once for a key that is held down, and leaves the page none of it', async () =>
    {
        const { container } = await live(match({}));
        const held = (which: string) =>
        {
            const typed = new KeyboardEvent('keydown', { key: which, repeat: true, bubbles: true, cancelable: true });

            (document.activeElement as HTMLElement).dispatchEvent(typed);

            return typed.defaultPrevented;
        };

        at(container, 'at-24').focus();

        expect(held('Enter')).toBe(true);

        await flush();

        expect([keys(container), focused()], 'Enter held down lifted a checker').toEqual([['at-24', 'at-13', 'at-8', 'at-6'], 'at-24']);
        expect(held(' ')).toBe(true);

        await flush();

        expect([keys(container), focused()], 'the space bar held down lifted a checker').toEqual([['at-24', 'at-13', 'at-8', 'at-6'], 'at-24']);

        await key(at(container, 'at-24'), 'Enter');

        expect(held('Escape')).toBe(true);

        await flush();

        expect([keys(container), focused()], 'Escape held down put a checker back').toEqual([['at-24', 'at-23', 'at-18'], 'at-23']);
        expect([held('ArrowRight'), focused()], 'an arrow held down does not walk').toEqual([true, 'at-18']);
    });

    it('puts a lifted checker back from the stop on its own point', async () =>
    {
        const { container } = await live(match({}));

        at(container, 'at-24').focus();
        await key(at(container, 'at-24'), 'Enter');

        expect(named(container)[0]).toBe('Point 24. Put it back.');

        await key(at(container, 'at-23'), 'ArrowLeft');

        expect(focused()).toBe('at-24');

        await key(at(container, 'at-24'), 'Enter');

        expect([keys(container), focused(), staged(container)], 'the stop that says it puts the checker back did not').toEqual([['at-24', 'at-13', 'at-8', 'at-6'], 'at-24', 0]);
    });

    it('hands the keyboard to the question the cube asks, and takes it to the dice when the answer is not now', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({ phase: 'roll', dice: [], doubling: true }));

        at(container, 'cube').focus();
        await key(at(container, 'cube'), 'Enter');

        const ask = asking(container)!;

        expect([ask.getAttribute('role'), ask.getAttribute('tabindex'), document.getElementById(ask.getAttribute('aria-labelledby') ?? '')?.textContent]).toEqual(['group', '-1', 'Offer a double to 2?']);
        expect(document.activeElement, 'the question was asked and the keyboard was left on the cube').toBe(ask);
        expect([await key(ask, 'Tab'), asking(container) === ask], 'a key that answers nothing answered').toEqual([false, true]);
        expect(await key(ask, 'Escape'), 'Escape was left to the page').toBe(true);
        expect([asking(container), focused()], 'the question went and the keyboard went nowhere').toEqual([null, 'dice']);

        await key(at(container, 'dice'), 'ArrowRight');
        await key(at(container, 'cube'), ' ');

        const not = button(asking(container)!, 'Not now');

        not.focus();
        await key(not, 'Enter');
        fire(not, 'click');
        await flush();

        expect([asking(container), focused()]).toEqual([null, 'dice']);
        expect(play).not.toHaveBeenCalled();
    });

    it('hands the keyboard to the answer when the other side doubles, for a reader who is using it and has it nowhere else', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('now');

        const mine = match({ phase: 'roll', dice: [], doubling: false });
        const theirs = match({ turn: 1, phase: 'roll', dice: [] }, 0, { rev: 5, turn: 1 });
        const doubled = match({ phase: 'double', dice: [] }, 0, { rev: 6 });
        const using = await live(mine);

        at(using.container, 'dice').focus();
        await key(at(using.container, 'dice'), 'Enter');
        using.tell(theirs, []);
        await elapse(1200);

        expect(focused()).toBeNull();

        using.tell(doubled, []);
        await elapse(1200);

        const ask = asking(using.container)!;

        expect([ask.getAttribute('role'), ask.getAttribute('tabindex')]).toEqual(['group', '-1']);
        expect(document.getElementById(ask.getAttribute('aria-labelledby') ?? '')?.textContent).toContain('doubles to 2.');
        expect(document.activeElement, 'the other side doubled and the keyboard was left nowhere').toBe(ask);
        expect(await key(ask, 'Escape'), 'Escape answered a double nobody may leave unanswered').toBe(false);
        expect(asking(using.container)).toBe(ask);

        cleanup();

        const byHand = await live(theirs);

        byHand.tell(doubled, []);
        await elapse(1200);

        expect([asking(byHand.container) === null, document.activeElement === document.body], 'somebody playing by hand was given the keyboard').toEqual([false, true]);

        cleanup();

        const elsewhere = await live(mine);
        const field = document.body.appendChild(document.createElement('input'));

        at(elsewhere.container, 'dice').focus();
        await key(at(elsewhere.container, 'dice'), 'Enter');
        field.focus();
        elsewhere.tell(theirs, []);
        await elapse(1200);
        elsewhere.tell(doubled, []);
        await elapse(1200);

        expect([asking(elsewhere.container) === null, document.activeElement === field], 'somebody typing somewhere else was taken to the board').toEqual([false, true]);

        field.remove();
    });

    it('follows a reader who answered with a key to the dice when the turn comes back, and not one who answered by hand', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('now');

        const doubled = match({ phase: 'double', dice: [] });
        const theirs = match({ turn: 1, phase: 'roll', dice: [], cube: 2, owner: 0 }, 0, { rev: 5, turn: 1 });
        const mine = match({ phase: 'roll', dice: [], cube: 2, owner: 0 }, 0, { rev: 6 });
        const answered = async (by: 'key' | 'hand') =>
        {
            const table = await live(doubled);
            const take = button(asking(table.container)!, 'Take at 2');

            take.focus();
            await key(take, 'Tab');

            if (by === 'hand')
            {
                take.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            }

            fire(take, 'click');
            table.tell(theirs, []);
            await elapse(1200);
            table.tell(mine, []);
            await elapse(1200);

            const on = [keys(table.container), focused()];

            cleanup();

            return on;
        };

        expect(await answered('key'), 'the turn came back and the keyboard did not').toEqual([['dice'], 'dice']);
        expect(await answered('hand'), 'somebody answering by hand was given a ring they did not ask for').toEqual([['dice'], null]);
    });

    it('takes the last move back from the checker that made it', async () =>
    {
        const { container } = await live(match({}));

        at(container, 'at-24').focus();
        await key(at(container, 'at-24'), 'Enter');
        await key(at(container, 'at-18'), 'Enter');
        await elapse(1200);
        await key(at(container, 'at-18'), 'Enter');
        await elapse(1200);

        expect(staged(container)).toBe(0);
        expect(keys(container)).toEqual(['at-24', 'at-13', 'at-8', 'at-6']);
        expect(focused()).toBe('at-24');
    });

    it('says where a checker would be hit, where one comes in from the bar, and where one is borne off', async () =>
    {
        const hitting = await live(match({ seats: blot }));

        at(hitting.container, 'at-24').focus();
        await key(at(hitting.container, 'at-24'), 'Enter');

        expect(named(hitting.container)).toEqual(['Point 24. Put it back.', 'Point 23. Put it down here.', 'Point 18. Put it down here and hit.']);
        hitting.unmount();

        const barred = await live(match({ seats: position({ 25: 1, 24: 1, 13: 5, 8: 3, 6: 5 }, { 24: 2, 13: 5, 8: 3, 6: 5 }) }));

        expect(named(barred.container)).toEqual(['The bar, 1 checker. Bring it in on point 24.']);
        barred.unmount();

        const choosing = await live(match({ dice: [2, 1], seats: position({ 25: 2, 13: 5, 8: 3, 6: 5 }, { 24: 2, 13: 5, 8: 3, 6: 5 }) }));

        expect(named(choosing.container)).toEqual(['The bar, 2 checkers. Bring one in.']);

        at(choosing.container, 'at-25').focus();
        await key(at(choosing.container, 'at-25'), 'Enter');

        expect(named(choosing.container)).toEqual(['The bar. Put it back.', 'Point 24. Put it down here.', 'Point 23. Put it down here.']);
        choosing.unmount();

        const home = await live(match({ seats: position({ 6: 15 }, { 1: 1, 0: 14 }) }));

        at(home.container, 'at-6').focus();
        await key(at(home.container, 'at-6'), 'Enter');

        expect(named(home.container)).toEqual(['Point 6. Put it back.', 'Point 5. Put it down here.', 'Bear it off.']);
    });

    it('uses a stop for a press that came from no pointer, and leaves a pointer\'s press to the board under it', async () =>
    {
        const { container } = await live(match({}));

        at(container, 'at-24').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        await flush();

        expect(keys(container), 'a pointer pressed a stop').toEqual(['at-24', 'at-13', 'at-8', 'at-6']);

        at(container, 'at-24').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        await flush();

        expect(keys(container)).toEqual(['at-24', 'at-23', 'at-18']);
    });

    it('does not take the keyboard to the board after a move made by hand, even from somebody who had been using it', async () =>
    {
        const { container } = await live(match({}));

        hop(container, 13, 7);
        await elapse(1200);

        expect(staged(container)).toBe(1);
        expect(focused(), 'somebody playing by hand was given a ring they did not ask for').toBeNull();

        cleanup();

        const again = await live(match({}));

        at(again.container, 'at-24').focus();
        await key(at(again.container, 'at-24'), 'Enter');

        expect(focused()).toBe('at-23');

        tapPoint(again.container, 13, 'pointerdown');
        tapPoint(again.container, 13);
        await elapse(1200);

        expect(staged(again.container)).toBe(1);
        expect(focused(), 'a move made by hand took the keyboard back to the board').toBeNull();
    });

    it('gives somebody watching no stops, and nobody a stop when it is not their turn', async () =>
    {
        const watching = still(match({}, null));

        expect(watching.container.querySelector('.bg-cursor')).toBeNull();
        watching.unmount();

        const waiting = await live(match({ turn: 1 }, 0, { turn: 1 }));

        expect(stops(waiting.container)).toEqual([]);
    });

    it('says all of it in Persian, with Persian figures', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = await live(match({}));

        expect(container.querySelector('.bg-cursor')?.getAttribute('aria-label')).toBe('تخته');
        expect(named(container)).toEqual([
            'خانهٔ ۲۴، ۲ مهره. یکی را بردار.',
            'خانهٔ ۱۳، ۵ مهره. یکی را به خانهٔ ۷ ببر.',
            'خانهٔ ۸، ۳ مهره. یکی را بردار.',
            'خانهٔ ۶، ۵ مهره. یکی را به خانهٔ ۵ ببر.'
        ]);

        await key(at(container, 'at-24'), 'Enter');

        expect(named(container)).toEqual(['خانهٔ ۲۴. سر جایش برگردان.', 'خانهٔ ۲۳. همین‌جا بگذارش.', 'خانهٔ ۱۸. همین‌جا بگذارش.']);
    });
});

describe('the two seats of a backgammon table', () =>
{
    const rails = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.bg-rail')];

    const pegs = (rail: HTMLElement) => [...rail.querySelectorAll<HTMLElement>('.bg-score > i')].map((peg) => peg.hasAttribute('data-won'));

    const scored = (mine: number, theirs: number, more: Partial<Backgammon> = {}, rev = 4) => match({
        seats: [
            { seat: 0, checkers: [...START], pips: 167, score: mine },
            { seat: 1, checkers: [...START], pips: 167, score: theirs }
        ],
        ...more
    }, 0, { rev });

    it('draws each seat once, the other side’s and then the reader’s', async () =>
    {
        const { container } = await live(match({}));

        expect(rails(container).map((rail) => rail.hasAttribute('data-me'))).toEqual([false, true]);
        expect([container.querySelectorAll('.table-plate').length, container.querySelectorAll('.bg-plate').length], 'a seat is drawn twice, or wears the name it had when there were two of each').toEqual([2, 0]);
    });

    it('tells the match in pegs, one for each point there is to win and a brass one for each point won', async () =>
    {
        const { container } = await live(scored(2, 0));
        const [theirs, mine] = rails(container);

        expect([pegs(theirs), pegs(mine)]).toEqual([[false, false, false], [true, true, false]]);
        expect([theirs, mine].map((rail) => rail.querySelector('.bg-score')?.getAttribute('aria-hidden')), 'a row of pegs is read out as nothing').toEqual(['true', 'true']);
        expect([theirs.textContent, mine.textContent].map((said) => said?.match(/\d of \d/)?.[0]), 'the score is not said to somebody who cannot see the pegs').toEqual(['0 of 3', '2 of 3']);
        expect(container.querySelector('.bg-score-says'), 'the score is drawn twice, in pegs and in figures').toBeNull();
    });

    it('fills a peg when a point is won, in the seat that was there', async () =>
    {
        const table = await live(scored(0, 0));
        const before = rails(table.container);

        table.move(scored(0, 1, { round: 2 }, 5));
        await elapse(1200);

        const after = rails(table.container);

        expect(after.map((rail, at) => rail === before[at]), 'a seat was drawn again for a point').toEqual([true, true]);
        expect([pegs(after[0]), pegs(after[1])]).toEqual([[true, false, false], [false, false, false]]);
    });

    it('writes a match too long for pegs in figures: nine points are pegs and ten are not', async () =>
    {
        const nine = await live(scored(4, 7, { target: 9 }));

        expect(rails(nine.container).map((rail) => pegs(rail).filter(Boolean).length + ' of ' + pegs(rail).length)).toEqual(['7 of 9', '4 of 9']);
        nine.unmount();

        const { container } = await live(scored(4, 7, { target: 10 }));
        const [theirs, mine] = rails(container);

        expect([pegs(theirs), pegs(mine)]).toEqual([[], []]);
        expect([theirs, mine].map((rail) => rail.querySelector('.bg-score-says')?.textContent)).toEqual(['7 of 10', '4 of 10']);
    });

    it('writes the pips in figures of their own, with the word for that many under them, and says them once to somebody who cannot see them', async () =>
    {
        const { container } = await live(match({ seats: position({ 6: 15 }, { 1: 1, 0: 14 }) }));
        const [theirs, mine] = rails(container);

        expect([theirs, mine].map((rail) => [rail.querySelector('.bg-pips > b')?.textContent, rail.querySelector('.bg-pips > small')?.textContent, rail.querySelector('.bg-pips')?.getAttribute('aria-hidden')]))
            .toEqual([['1', 'pip', 'true'], ['90', 'pips', 'true']]);
        expect([theirs, mine].map((rail) => [...rail.querySelectorAll(':scope > .sr-only')].map((one) => one.textContent))).toEqual([['1 pip'], ['90 pips']]);
    });

    it('keeps the tip’s lamp in the reader’s seat, and gives somebody watching none', async () =>
    {
        const { container } = await live(match({ dice: [3, 3] }));
        const [theirs, mine] = rails(container);

        expect([theirs.querySelector('[role="note"]') === null, mine.querySelector('[role="note"]') !== null]).toEqual([true, true]);

        const watching = still(match({ dice: [3, 3] }, null));

        expect(watching.container.querySelector('[role="note"]')).toBeNull();
    });
});

describe('moves made on the table itself', () =>
{
    const whole = (container: HTMLElement) => zone(container).dataset.live === 'done';

    it('has no button, list or panel of the page for a move anywhere on the stage: what a key can press lies on the board', async () =>
    {
        const rolling = await live(match({ phase: 'roll', dice: [], doubling: true }));
        const moving = await live(match({}));

        for (const container of [rolling.container, moving.container])
        {
            expect([...container.querySelectorAll('.table-stage button')].map((one) => one.textContent?.trim()), 'a move is offered as a button').toEqual([]);
            expect(container.querySelector('.bg-keys'), 'the helper panel is still there').toBeNull();
            expect(container.querySelector('.table-stage ul')).toBeNull();
            expect([...container.querySelectorAll('.table-stage [role="button"]')].filter((one) => one.parentElement?.classList.contains('bg-cursor') !== true), 'something a key can press is not on the board').toEqual([]);
        }

        hop(moving.container, 13, 7);
        await elapse(1200);

        expect(moving.container.querySelectorAll('.table-stage button')).toHaveLength(0);
        expect(staged(moving.container)).toBe(1);
    });

    it('takes no room from the board for words: the sentences are a screen reader\'s, and only the tip is drawn', async () =>
    {
        const { container } = await live(match({ dice: [3, 3] }));
        const bar = container.querySelector('.table-bar') as HTMLElement;
        const drawn = [...bar.children].filter((one) => !one.classList.contains('sr-only'));

        expect(container.querySelector('[aria-live="polite"]')?.classList.contains('sr-only')).toBe(true);
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('You rolled 3 and 3. Move your checkers.');
        expect(bar.textContent).toContain('Match to 3');
        expect(drawn.map((one) => one.getAttribute('role')), 'something is drawn where the words were').toEqual([]);
        expect(container.querySelector('.bg-rail[data-me] [role="note"]'), 'the tip is not in the reader’s seat').not.toBeNull();
    });

    it('puts the clock on the plate of whoever is on turn', async () =>
    {
        const mine = await live(match({}, 0, { remainingMs: 20_000 }));
        const rows = (container: HTMLElement) => [...container.querySelectorAll('.bg-rail')].filter((row) => row.querySelector('.bg-clock') !== null);

        expect(rows(mine.container).length).toBeGreaterThan(0);
        expect(rows(mine.container).every((row) => row.classList.contains('table-hand') || row.hasAttribute('data-me'))).toBe(true);
        expect(mine.container.querySelector('.table-bar .bg-clock')).toBeNull();
        expect([...mine.container.querySelectorAll('.bg-clock > .contents > span')].map((one) => [one.getAttribute('aria-hidden'), one.classList.contains('sr-only')]), 'a rail has no room for the clock written out: it is drawn in brief and said in full')
            .toEqual([['true', false], [null, true]]);
        mine.unmount();

        const theirs = await live(match({ turn: 1 }, 0, { turn: 1, remainingMs: 20_000 }));

        expect(rows(theirs.container).length).toBeGreaterThan(0);
        expect(rows(theirs.container).some((row) => row.classList.contains('table-hand') || row.hasAttribute('data-me'))).toBe(false);
    });

    it('passes the ring and the clock when the table has shown the turn passing: after the checkers that ended one turn and the dice that begin the next', async () =>
    {
        const table = await live(match({}, 0, { remainingMs: 20_000 }));
        const worn = () => [...table.container.querySelectorAll('.bg-rail')].map((rail) => [rail.querySelector('.table-plate')?.hasAttribute('data-turn') === true, rail.querySelector('.bg-clock') !== null]);
        const moved = position({ 24: 2, 13: 4, 8: 2, 7: 2, 6: 5 }, { 24: 2, 13: 5, 8: 3, 6: 5 });

        expect(worn()).toEqual([[false, false], [true, true]]);

        table.tell(match({ turn: 1, dice: [3, 4], seats: moved }, 0, { rev: 5, turn: 1, remainingMs: 20_000 }), [happened(5, 0, [
            { e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false },
            { e: 'move', seat: 0, from: 8, to: 7, die: 1, hit: false },
            { e: 'roll', seat: 1, dice: [3, 4] }
        ])]);
        await elapse(300);

        expect(worn(), 'the turn left the reader while their own checkers were still moving').toEqual([[false, false], [true, true]]);

        await elapse(4000);

        expect(worn()).toEqual([[true, true], [false, false]]);
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
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Your turn. Tap the dice to roll.');

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

        hop(container, 13, 7);

        expect(staged(container)).toBe(1);

        tapDice(container);

        expect(play, 'half a turn was sent').not.toHaveBeenCalled();

        hop(container, 8, 7);
        await elapse(2000);

        expect(zone(container).dataset.live).toBe('done');
        expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Your move is whole. Tap the dice to play it.');

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
        const undoing = () => staged(container) > 0;

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

        expect(whole(container)).toBe(true);
        expect(container.querySelectorAll('.bg-layer .man[data-back]')).toHaveLength(1);

        tapPoint(container, 7);
        await elapse(1200);

        expect(whole(container)).toBe(false);
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

        hop(container, 13, 10);
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

    it('lifts only the checker that was pressed: the one under it stays down when the first has gone', async () =>
    {
        const { container } = await live(match({}));
        const held = () => container.querySelectorAll('.bg-layer .man[data-held]').length;

        tapPoint(container, 6, 'pointerdown');

        expect(held()).toBe(1);

        tapPoint(container, 6);
        await flush();

        expect(staged(container)).toBe(1);
        expect(held(), 'the next checker on the point was lifted when the pressed one left').toBe(0);

        await elapse(1200);

        expect(held()).toBe(0);
    });

    it('keeps a checker lifted while its move waits behind another, and lets go of it when it takes off', async () =>
    {
        const { container } = await live(match({}));
        const held = () => container.querySelectorAll('.bg-layer .man[data-held]').length;

        hop(container, 13, 7);
        await flush();
        tapPoint(container, 6, 'pointerdown');
        tapPoint(container, 6);
        await flush();

        expect(staged(container)).toBe(2);
        expect(held(), 'a checker whose move had to wait was put down at once').toBe(1);

        await elapse(1800);

        expect(held()).toBe(0);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });

    describe('a roll is told when it has landed', () =>
    {
        const said = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')?.textContent;

        it('lights no checker, offers no move and takes no tap until the reader\'s own dice have landed', async () =>
        {
            const table = await live(match({ phase: 'roll', dice: [], doubling: false }));

            table.tell(match({}, 0, { rev: 5 }), [happened(5, 0, [{ e: 'roll', seat: 0, dice: [6, 1] }])]);
            await elapse(300);

            expect(lit(table.container), 'checkers were lit while the dice were in the air').toBe(0);
            expect(said(table.container)).toBe('Your turn. Tap the dice to roll.');
            expect(note(table.container)).toBeNull();
            expect(table.container.querySelector('svg[viewBox="0 0 1000 820"]')!.hasAttribute('data-drags')).toBe(false);

            tapPoint(table.container, 13);
            await flush();

            expect(table.container.querySelectorAll('.bg-layer .man[data-held]'), 'a checker was moved by dice nobody had seen').toHaveLength(0);

            await elapse(1100);

            expect(lit(table.container)).toBeGreaterThan(0);
            expect(said(table.container)).toBe('You rolled 6 and 1. Move your checkers.');
            expect(table.container.querySelector('svg[viewBox="0 0 1000 820"]')!.hasAttribute('data-drags')).toBe(true);
        });

        it('waits through the other player\'s move too when the dice were rolled for the reader with it', async () =>
        {
            const table = await live(match({ turn: 1 }, 0, { turn: 1 }));
            const moved = position(START.reduce<Record<number, number>>((all, count, point) => ({ ...all, [point]: count }), {}), { 6: 5, 7: 2, 8: 2, 13: 4, 24: 2 });

            table.tell(match({ turn: 0, dice: [5, 2], seats: moved }, 0, { rev: 5, turn: 0 }), [happened(5, 1, [
                { e: 'move', seat: 1, from: 13, to: 7, die: 6, hit: false },
                { e: 'move', seat: 1, from: 8, to: 7, die: 1, hit: false },
                { e: 'roll', seat: 0, dice: [5, 2] }
            ])]);
            await elapse(900);

            expect(lit(table.container), 'the reader was shown what to move before their dice had been thrown').toBe(0);
            expect(said(table.container)).not.toContain('You rolled');

            await elapse(3200);

            expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
            expect(lit(table.container)).toBeGreaterThan(0);
            expect(said(table.container)).toBe('You rolled 5 and 2. Move your checkers.');
        });

        it('holds nothing back when little of the turn is left', async () =>
        {
            const table = await live(match({ phase: 'roll', dice: [], doubling: false }));

            table.tell(match({}, 0, { rev: 5, remainingMs: 6000 }), [happened(5, 0, [{ e: 'roll', seat: 0, dice: [6, 1] }])]);
            await flush();

            expect(lit(table.container), 'a reader with seconds left was made to watch their dice land').toBeGreaterThan(0);
            expect(table.container.querySelector('svg[viewBox="0 0 1000 820"]')!.hasAttribute('data-drags')).toBe(true);
        });

        it('holds nothing back on a board that is simply drawn with its dice down', async () =>
        {
            const { container } = await live(match({}));

            expect(lit(container)).toBeGreaterThan(0);
            expect(said(container)).toBe('You rolled 6 and 1. Move your checkers.');
        });

        it('tells the reader nothing of the other player\'s dice before they land either', async () =>
        {
            const table = await live(match({ phase: 'roll', turn: 1, dice: [] }, 0, { turn: 1 }));
            const label = () => table.container.querySelector('.table-surface [role="img"]')?.getAttribute('aria-label') ?? null;

            table.tell(match({ turn: 1, dice: [4, 3] }, 0, { rev: 5, turn: 1 }), [happened(5, 1, [{ e: 'roll', seat: 1, dice: [4, 3] }])]);
            await elapse(300);

            expect(label(), 'the dice were read out while they were in the air').toBeNull();

            await elapse(1100);

            expect(label()).toContain('4 and 3');
        });
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
            const svg = container.querySelector('svg[viewBox="0 0 1000 820"]') as SVGSVGElement;

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

        const undoing = (container: HTMLElement) => staged(container) > 0;

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

            hop(container, 13, 7);
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
            const board = (container: HTMLElement) => container.querySelector('svg[viewBox="0 0 1000 820"]')!;

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
