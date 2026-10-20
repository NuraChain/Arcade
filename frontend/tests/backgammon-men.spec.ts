import { describe, it, expect } from 'vitest';

import {
    BAR,
    OFF,
    SPOTS,
    countsOf,
    fromCounts,
    indexOf,
    moved,
    opposite,
    same,
    settle,
    slotAt,
    slotOf,
    stacked,
    topAt,
    undone,
    type Counts
} from '../src/game/backgammon-men.ts';
import { BAR_LEFT, BAR_WIDTH, BOTTOM, CUBE, MIDDLE, POINT_WIDTH, RADIUS, TOP, TRAY, TRAY_LEFT, columnOf, stackAt } from '../src/game/backgammon-layout.ts';

const START = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

const row = (points: Record<number, number>) => Array.from({ length: SPOTS }, (_, point) => points[point] ?? 0);

const start = (): Counts => ({ near: START, far: START });

describe('checkers as objects', () =>
{
    it('makes one man for every checker, and counts them back exactly', () =>
    {
        const table = fromCounts(start());

        expect(table.men).toHaveLength(30);
        expect(countsOf(table)).toEqual({ near: START, far: START });
        expect(new Set(table.men.map((man) => man.key)).size).toBe(30);
    });

    it('keeps a man its own object through a move, so it is the same one that arrives', () =>
    {
        const table = fromCounts(start());
        const top = topAt(table, 'near', 13)!;
        const result = moved(table, { side: 'near', from: 13, to: 7, hit: false })!;

        expect(result.mover.key).toBe(top.key);
        expect(result.mover.spot).toBe(7);
        expect(result.knocked).toBeNull();
        expect(countsOf(result.table).near[13]).toBe(4);
        expect(countsOf(result.table).near[7]).toBe(1);
    });

    it('takes the checker from the top of its stack, and lays it on top of the one it joins', () =>
    {
        const table = fromCounts(start());
        const one = moved(table, { side: 'near', from: 13, to: 8, hit: false })!;

        expect(indexOf(one.table, one.mover)).toBe(3);
        expect(stacked(one.table, 'near', 13)).toHaveLength(4);
        expect(stacked(table, 'near', 13).slice(0, 4).map((man) => man.key)).toEqual(stacked(one.table, 'near', 13).map((man) => man.key));
    });

    it('knocks a blot to the bar of whoever owns it', () =>
    {
        const table = fromCounts({ near: row({ 13: 1, 6: 5 }), far: row({ 17: 1, 12: 2 }) });
        const result = moved(table, { side: 'near', from: 13, to: 8, hit: true })!;

        expect(result.knocked).not.toBeNull();
        expect(result.knocked!.side).toBe('far');
        expect(result.knocked!.spot).toBe(BAR);
        expect(countsOf(result.table).far[BAR]).toBe(1);
        expect(countsOf(result.table).far[17]).toBe(0);
        expect(opposite(8)).toBe(17);
    });

    it('does not knock anything that was not there', () =>
    {
        const table = fromCounts({ near: row({ 13: 1 }), far: row({ 12: 2 }) });
        const result = moved(table, { side: 'near', from: 13, to: 8, hit: true })!;

        expect(result.knocked).toBeNull();
    });

    it('enters from the bar, and bears off to the tray', () =>
    {
        const table = fromCounts({ near: row({ 25: 1, 3: 2 }), far: row({ 20: 3 }) });
        const entered = moved(table, { side: 'near', from: BAR, to: 20, hit: false })!;
        const off = moved(entered.table, { side: 'near', from: 3, to: OFF, hit: false })!;

        expect(countsOf(entered.table).near[BAR]).toBe(0);
        expect(countsOf(entered.table).near[20]).toBe(1);
        expect(countsOf(off.table).near[OFF]).toBe(1);
        expect(countsOf(off.table).near[3]).toBe(1);
    });

    it('says nothing happened when there is no checker to move', () =>
    {
        const table = fromCounts({ near: row({ 6: 1 }), far: row({}) });

        expect(moved(table, { side: 'near', from: 13, to: 8, hit: false })).toBeNull();
        expect(undone(table, { side: 'near', from: 13, to: 8, hit: false })).toBeNull();
    });

    it('takes a hop back, and puts a knocked checker back where it stood', () =>
    {
        const before = fromCounts({ near: row({ 13: 2, 6: 5 }), far: row({ 17: 1, 12: 2 }) });
        const went = moved(before, { side: 'near', from: 13, to: 8, hit: true })!;
        const back = undone(went.table, { side: 'near', from: 13, to: 8, hit: true })!;

        expect(countsOf(back.table)).toEqual(countsOf(before));
        expect(back.mover.key).toBe(went.mover.key);
        expect(back.knocked?.key).toBe(went.knocked?.key);
        expect(back.knocked?.spot).toBe(17);
    });

    it('settles a position by moving as few men as it can and leaving the others be', () =>
    {
        const table = fromCounts(start());
        const next = row({ 6: 4, 7: 1, 8: 3, 13: 5, 24: 2 });
        const result = settle(table, { near: next, far: START });

        expect(result.transfers).toHaveLength(1);
        expect(result.transfers[0].from).toBe(6);
        expect(result.transfers[0].to).toBe(7);
        expect(same(result.table, { near: next, far: START })).toBe(true);

        const kept = table.men.filter((man) => man.key !== result.transfers[0].man.key);

        for (const man of kept)
        {
            expect(result.table.men.find((one) => one.key === man.key)?.spot).toBe(man.spot);
        }
    });

    it('settles any position at all, even one with more or fewer checkers than it held', () =>
    {
        const result = settle(fromCounts(start()), { near: row({ 0: 15 }), far: row({ 6: 5, 8: 3 }) });

        expect(same(result.table, { near: row({ 0: 15 }), far: row({ 6: 5, 8: 3 }) })).toBe(true);
        expect(result.table.men).toHaveLength(23);
    });

    it('is the same thing it was when nothing changed', () =>
    {
        const table = fromCounts(start());

        expect(same(table, start())).toBe(true);
        expect(settle(table, start()).transfers).toEqual([]);
    });
});

describe('where each checker lies', () =>
{
    const x = (point: number) => columnOf(point).x + POINT_WIDTH / 2;

    it('stacks a point from the board\'s edge, one checker above the last', () =>
    {
        expect(slotAt('near', 6, 0)).toMatchObject({ x: x(6), y: stackAt('bottom', 0), off: false });
        expect(slotAt('near', 6, 1).y).toBeLessThan(slotAt('near', 6, 0).y);
        expect(slotAt('near', 13, 0)).toMatchObject({ x: x(13), y: stackAt('top', 0) });
        expect(slotAt('near', 13, 1).y).toBeGreaterThan(slotAt('near', 13, 0).y);
    });

    it('draws the other side from its own point of view, mirrored on the board', () =>
    {
        expect(slotAt('far', 6, 0).x).toBeCloseTo(x(19));
        expect(slotAt('far', 6, 0).y).toBeCloseTo(stackAt('top', 0));
        expect(slotAt('far', 24, 0).x).toBeCloseTo(x(1));
    });

    it('stops climbing at the fifth checker, so a tall stack never leaves the board', () =>
    {
        expect(slotAt('near', 6, 4).y).toBe(slotAt('near', 6, 9).y);
        expect(slotAt('near', 6, 9).index).toBe(9);
    });

    it('puts the bar in the middle of the board with each side\'s checkers on its own half', () =>
    {
        const near = slotAt('near', BAR, 0);
        const far = slotAt('far', BAR, 0);

        expect(near.x).toBe(BAR_LEFT + BAR_WIDTH / 2);
        expect(far.x).toBe(near.x);
        expect(near.y).toBeGreaterThan(far.y);
    });

    it('keeps a checker on the bar clear of a cube that lies in the middle', () =>
    {
        expect(slotAt('near', BAR, 0).y - RADIUS).toBeGreaterThanOrEqual(MIDDLE + CUBE / 2);
        expect(slotAt('far', BAR, 0).y + RADIUS).toBeLessThanOrEqual(MIDDLE - CUBE / 2);
        expect(slotAt('near', BAR, 4).y + RADIUS).toBeLessThan(BOTTOM);
        expect(slotAt('far', BAR, 4).y - RADIUS).toBeGreaterThan(TOP);
    });

    it('lays borne-off checkers in the tray, the reader\'s from the bottom and the other side\'s from the top', () =>
    {
        const mine = slotAt('near', OFF, 0);
        const theirs = slotAt('far', OFF, 0);

        expect(mine.off).toBe(true);
        expect(mine.x).toBe(TRAY_LEFT + TRAY / 2);
        expect(mine.y).toBeGreaterThan(BOTTOM / 2);
        expect(theirs.y).toBeLessThan(BOTTOM / 2);
        expect(slotAt('near', OFF, 1).y).toBeLessThan(mine.y);
        expect(slotAt('far', OFF, 1).y).toBeGreaterThan(theirs.y);
        expect(mine.y).toBeLessThan(BOTTOM);
        expect(theirs.y).toBeGreaterThan(TOP);
    });

    it('puts every checker of a full board on the board, none on another\'s place', () =>
    {
        const table = fromCounts(start());
        const seen = new Set<string>();

        for (const man of table.men)
        {
            const slot = slotOf(table, man);

            expect(slot.x).toBeGreaterThan(0);
            expect(slot.y).toBeGreaterThan(TOP);
            expect(slot.y).toBeLessThan(BOTTOM);

            const spot = `${ slot.x.toFixed(1) }:${ slot.y.toFixed(1) }`;

            expect(seen.has(spot), spot).toBe(false);
            seen.add(spot);
        }

        expect(RADIUS).toBeGreaterThan(0);
    });
});
