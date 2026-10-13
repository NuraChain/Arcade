import { describe, expect, it } from 'vitest';

import { RAIL, aroundStadium } from '../src/game/poker-seats.ts';

const SHAPES = [0.5, 0.54, 0.8, 1, 1.25, 1.6, 2, 2.3];

const COUNTS = [2, 6, 9];

const sizeOf = (ratio: number) => ({ width: ratio >= 1 ? ratio : 1, height: ratio >= 1 ? 1 : 1 / ratio });

const inShort = (spot: { x: number; y: number }, ratio: number) =>
{
    const { width, height } = sizeOf(ratio);

    return { x: (spot.x - 50) / 100 * width, y: (spot.y - 50) / 100 * height };
};

const fromEdge = (spot: { x: number; y: number }, ratio: number) =>
{
    const { width, height } = sizeOf(ratio);
    const at = inShort(spot, ratio);
    const half = Math.min(width, height) / 2;
    const along = Math.max(0, (width >= height ? Math.abs(at.x) : Math.abs(at.y)) - (Math.max(width, height) / 2 - half));
    const across = width >= height ? at.y : at.x;

    return half - Math.hypot(along, across);
};

describe('where the seats of a poker table are', () =>
{
    it('puts the reader at the middle of the near rail, whatever shape the table has', () =>
    {
        for (const ratio of SHAPES)
        {
            for (const seats of COUNTS)
            {
                const [mine] = aroundStadium(seats, ratio);

                expect(mine.x, `${ seats } seats at ${ ratio }`).toBeCloseTo(50, 6);
                expect(fromEdge(mine, ratio), `${ seats } seats at ${ ratio }`).toBeCloseTo(RAIL / 2, 6);
                expect(mine.y).toBeGreaterThan(80);
                expect([mine.ux, mine.uy, mine.lies]).toEqual([0, -1, 'flat']);
            }
        }
    });

    it('passes to the reader\'s LEFT, because poker is dealt clockwise', () =>
    {
        for (const ratio of SHAPES)
        {
            for (const seats of [6, 9])
            {
                const spots = aroundStadium(seats, ratio);

                expect(spots[1].x, `${ seats } seats at ${ ratio }`).toBeLessThan(50);
                expect(spots[1].y).toBeGreaterThan(50);
                expect(spots[seats - 1].x).toBeGreaterThan(50);
            }
        }
    });

    it('seats two players across the table from each other', () =>
    {
        for (const ratio of SHAPES)
        {
            const [mine, theirs] = aroundStadium(2, ratio);

            expect(theirs.x).toBeCloseTo(50, 6);
            expect(theirs.y).toBeCloseTo(100 - mine.y, 6);
            expect([theirs.uy, theirs.lies]).toEqual([1, 'flat']);
        }
    });

    it('stands every seat on the rail: the same way in from the edge, on a straight and on a bend', () =>
    {
        for (const ratio of SHAPES)
        {
            for (const seats of COUNTS)
            {
                for (const [place, spot] of aroundStadium(seats, ratio).entries())
                {
                    expect(fromEdge(spot, ratio), `place ${ place } of ${ seats } at ${ ratio }`).toBeCloseTo(RAIL / 2, 6);
                    expect(spot.x).toBeGreaterThan(0);
                    expect(spot.x).toBeLessThan(100);
                    expect(spot.y).toBeGreaterThan(0);
                    expect(spot.y).toBeLessThan(100);
                }
            }
        }
    });

    it('is the same table seen in a mirror: a seat on the left has one facing it on the right', () =>
    {
        for (const ratio of SHAPES)
        {
            for (const seats of COUNTS)
            {
                const spots = aroundStadium(seats, ratio);

                for (let place = 1; place < seats; place += 1)
                {
                    const other = spots[seats - place];

                    expect(spots[place].x + other.x, `place ${ place } of ${ seats } at ${ ratio }`).toBeCloseTo(100, 6);
                    expect(spots[place].y).toBeCloseTo(other.y, 6);
                    expect(spots[place].ux).toBeCloseTo(-other.ux, 6);
                    expect(spots[place].lies).toBe(other.lies);
                }
            }
        }
    });

    it('spaces the seats evenly along the rail, so nine plates never crowd on any table', () =>
    {
        for (const ratio of SHAPES)
        {
            const spots = aroundStadium(9, ratio).map((spot) => inShort(spot, ratio));
            const gaps = spots.map((spot, place) => Math.hypot(spot.x - spots[(place + 1) % 9].x, spot.y - spots[(place + 1) % 9].y));

            expect(Math.min(...gaps), `nine seats at ${ ratio }`).toBeGreaterThan(0.28);
        }
    });

    it('lays a plate along the rail it stands on: flat on a rail that runs across, upright on one that runs down', () =>
    {
        const tall = aroundStadium(6, 0.54);
        const wide = aroundStadium(6, 2.3);

        expect(tall.map((spot) => spot.lies)).toEqual(['flat', 'upright', 'upright', 'flat', 'upright', 'upright']);
        expect(tall.slice(1, 3).map((spot) => [spot.ux, spot.uy])).toEqual([[1, 0], [1, 0]]);
        expect(wide.map((spot) => spot.lies), 'six seats at a wide table are two a side and one at each end of the long rails').toEqual(['flat', 'flat', 'flat', 'flat', 'flat', 'flat']);
        expect([wide[1].ux, wide[1].uy]).toEqual([0, -1]);
        expect([wide[2].ux, wide[2].uy]).toEqual([0, 1]);
        expect(aroundStadium(9, 2.3).map((spot) => spot.lies[0]).join('')).toBe('ffuffffuf');
        expect(aroundStadium(9, 0.54).map((spot) => spot.lies[0]).join('')).toBe('fuuuffuuu');
    });

    it('faces every seat square at the felt: one whole step across its rail and none along it', () =>
    {
        for (const ratio of SHAPES)
        {
            for (const seats of COUNTS)
            {
                for (const spot of aroundStadium(seats, ratio))
                {
                    expect([Math.abs(spot.ux), Math.abs(spot.uy)], `${ seats } seats at ${ ratio }`).toEqual(spot.lies === 'flat' ? [0, 1] : [1, 0]);
                    expect(spot.ux * (50 - spot.x), 'a seat faces away from the middle of the table').toBeGreaterThanOrEqual(0);
                    expect(spot.uy * (50 - spot.y), 'a seat faces away from the middle of the table').toBeGreaterThanOrEqual(0);
                    expect(Object.is(spot.ux, -0) || Object.is(spot.uy, -0), 'a step of minus nothing is written into a stylesheet as "-0"').toBe(false);
                }
            }
        }
    });

    it('is a round table when the room is square', () =>
    {
        const spots = aroundStadium(9, 1).map((spot) => Math.hypot(spot.x - 50, spot.y - 50));

        for (const reach of spots)
        {
            expect(reach).toBeCloseTo((0.5 - RAIL / 2) * 100, 6);
        }
    });
});
