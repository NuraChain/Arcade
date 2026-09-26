import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import BackgammonBoard from '../src/components/games/backgammon-board.component.azeroth';
import {
    BAR_LEFT,
    BAR_WIDTH,
    FIELD_LEFT,
    FIELD_RIGHT,
    FRAME,
    POINT_WIDTH,
    TRAY,
    TRAY_LEFT,
    WIDTH,
    columnOf,
    pointAt
} from '../src/game/backgammon-layout.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { MatchView } from '../src/api.ts';

type Rendered = HTMLElement;

type Backgammon = Extract<MatchView['view'], { kind: 'backgammon' }>;

const START = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

const match = (view: Partial<Backgammon>, mine: number | null = 0): MatchView => ({
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
    }
});

const row = (points: Record<number, number>): number[] =>
    Array.from({ length: 26 }, (_, point) => points[point] ?? 0);

const position = (mine: Record<number, number>, theirs: Record<number, number>): Backgammon['seats'] => [
    { seat: 0, checkers: row(mine), pips: 0, score: 0 },
    { seat: 1, checkers: row(theirs), pips: 0, score: 0 }
];

const lit = (container: HTMLElement): number =>
    container.querySelectorAll('svg circle[stroke="var(--accent)"]').length;

const note = (container: HTMLElement): string | null =>
    container.querySelector('[role="note"]')?.textContent ?? null;

const button = (container: HTMLElement, label: string): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === label || one.textContent?.trim() === label) as HTMLButtonElement;

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
        const { container } = renderTest(() => BackgammonBoard({ match: match({}) }) as Rendered);
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
        const { container } = renderTest(() => BackgammonBoard({ match: match({}) }) as Rendered);
        const confirm = (): HTMLButtonElement => button(container, 'Play the move');

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
        const { container } = renderTest(() => BackgammonBoard({ match: match({}) }) as Rendered);
        const undo = (): HTMLButtonElement => button(container, 'Undo');

        expect(undo().disabled).toBe(true);

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        expect(undo().disabled).toBe(false);
        expect(button(container, 'Move a checker from 7 to 6')).toBeDefined();

        fire(undo(), 'click');
        expect(undo().disabled).toBe(true);
        expect(button(container, 'Move a checker from 7 to 6')).toBeUndefined();
    });

    it('keeps a half-staged turn through a re-read of the same board, and drops it once the board moves', () =>
    {
        const [current, setCurrent] = createSignal(match({}));
        const { container } = renderTest(() => BackgammonBoard({ get match()
        {
            return current();
        } }) as Rendered);
        const undo = (): HTMLButtonElement => button(container, 'Undo');

        fire(button(container, 'Move a checker from 13 to 7'), 'click');
        setCurrent({ ...current() });
        expect(undo().disabled).toBe(false);

        setCurrent({ ...current(), rev: current().rev + 1 });
        expect(undo().disabled).toBe(true);
    });

    it('offers roll and a double before the dice are thrown, and sends each as its verb', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => BackgammonBoard({ match: match({ phase: 'roll', dice: [], doubling: true }) }) as Rendered);

        fire(button(container, 'Roll'), 'click');
        fire(button(container, 'Double to 2'), 'click');

        expect(play.mock.calls.map((call) => call[0])).toEqual([
            { kind: 'backgammon', verb: 'roll' },
            { kind: 'backgammon', verb: 'double' }
        ]);
    });

    it('asks the player a double is offered to whether they take it, and nobody else', () =>
    {
        const asked = renderTest(() => BackgammonBoard({ match: match({ phase: 'double', turn: 0, dice: [] }) }) as Rendered);

        expect(button(asked.container, 'Take at 2')).toBeDefined();
        expect(button(asked.container, 'Give up this game')).toBeDefined();
        asked.unmount();

        const waiting = renderTest(() => BackgammonBoard({ match: match({ phase: 'double', turn: 1, dice: [] }) }) as Rendered);

        expect(button(waiting.container, 'Take at 2')).toBeUndefined();
        expect(waiting.container.textContent).toContain('Waiting for');
    });

    it('draws a spectator the board and gives them nothing to press', () =>
    {
        const { container } = renderTest(() => BackgammonBoard({ match: match({}, null) }) as Rendered);

        expect(container.querySelector('svg')).not.toBeNull();
        expect(container.querySelectorAll('button').length).toBe(0);
    });

    it('draws the board left to right in every language, because it is a printed object', () =>
    {
        useLocale().setLocale('fa');
        const { container } = renderTest(() => BackgammonBoard({ match: match({}) }) as Rendered);

        expect(container.querySelector('svg')?.parentElement?.className).toContain('[direction:ltr]');
        useLocale().setLocale('en');
    });
});

describe('the backgammon helpers', () =>
{
    const blot = (mine: number | null = 0): MatchView => match({ dice: [5, 3], seats: position({ 13: 1, 1: 14 }, { 17: 1, 6: 14 }) }, mine);

    it('lights the checkers that can move, and stops when the switch is off without taking a move away', () =>
    {
        const { container } = renderTest(() => BackgammonBoard({ match: match({}) }) as Rendered);

        expect(lit(container)).toBeGreaterThan(0);

        useSettings().update({ hintMoves: false });

        expect(lit(container)).toBe(0);
        expect(button(container, 'Move a checker from 13 to 7')).toBeDefined();
    });

    it('says a hop hits a blot, in its name and on its face, until the switch is off', () =>
    {
        const { container } = renderTest(() => BackgammonBoard({ match: blot() }) as Rendered);
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
        const { container } = renderTest(() => BackgammonBoard({ match: match({ dice: [5, 3], seats: position({ 25: 1, 6: 14 }, { 6: 15 }) }) }) as Rendered);

        expect(button(container, 'Enter a checker from the bar on 20')).toBeDefined();
        expect(note(container)).toContain('comes back in first');
    });

    it('coaches the rule that matters, and goes quiet when the coach is off', () =>
    {
        const { container } = renderTest(() => BackgammonBoard({ match: match({ dice: [3, 3] }) }) as Rendered);

        expect(note(container)).toContain('A double plays four times');

        useSettings().update({ hintRules: false });

        expect(note(container)).toBeNull();
    });

    it('explains the double to the player it was offered to', () =>
    {
        const { container } = renderTest(() => BackgammonBoard({ match: match({ phase: 'double', turn: 0, dice: [], cube: 2 }) }) as Rendered);

        expect(note(container)).toContain('goes on at 4');
    });

    it('gives the player who doubled no tip while they wait for the answer', () =>
    {
        const { container } = renderTest(() => BackgammonBoard({ match: match({ phase: 'double', turn: 1, dice: [], cube: 2 }) }) as Rendered);

        expect(note(container)).toBeNull();
    });

    it('gives a spectator no tip and no outcome, because they have no move', () =>
    {
        const doubles = renderTest(() => BackgammonBoard({ match: match({ dice: [3, 3] }, null) }) as Rendered);

        expect(note(doubles.container)).toBeNull();
        doubles.unmount();

        const watching = renderTest(() => BackgammonBoard({ match: blot(null) }) as Rendered);

        expect(note(watching.container)).toBeNull();
        expect(watching.container.textContent).not.toContain('Hit');
    });
});
