import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

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

const button = (container: HTMLElement, label: string): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === label || one.textContent?.trim() === label) as HTMLButtonElement;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
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
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue(undefined);
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

    it('offers roll and a double before the dice are thrown, and sends each as its verb', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue(undefined);
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
