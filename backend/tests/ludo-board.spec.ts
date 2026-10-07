import { describe, expect, it } from 'vitest';

import {
    COLOURS,
    ENTRY,
    FINISHED,
    HOME_CELLS,
    HOME_RUN,
    RING,
    RING_CELLS,
    RING_STEPS,
    SAFE,
    YARD,
    cellAt,
    coloursFor,
    obstacle,
    ringIndex,
    yardCells,
    type Cell,
    type LudoColour,
    type Obstacle,
    type Walker
} from '../src/domains/match/ludo/board.ts';

/**
 * The board the engine plays on has to be the board the art draws.
 *
 * `tools/blender/lib/atlas.py` paints the field and `tools/blender/assets/set-ludo.py` builds the
 * GLB, both from a 15x15 grid, and both were written long before any of this. The literals below
 * are transcribed from that Python; the constants they are compared against are walked from
 * segments. Two descriptions of one board, checked against each other, so neither can be edited
 * alone.
 *
 * The trap this exists to catch: `set-ludo.py` also carries a `track_spots` dictionary - red (2, 6),
 * green (8, 4), yellow (11, 8), blue (6, 10) - which is where the 3D model parks its loose tokens
 * for the market scene, NOT where a player enters the ring. Those are `starts` in `atlas.py`, two
 * squares away, painted under the stars. Taking the wrong pair would put every entry off the square
 * it is drawn on and nothing anywhere would fail.
 */

const STARTS: Record<LudoColour, readonly [number, number]> = {
    red: [1, 6],
    green: [8, 1],
    yellow: [13, 8],
    blue: [6, 13]
};

const STARRED: readonly (readonly [number, number])[] = [
    [1, 6], [8, 1], [13, 8], [6, 13],
    [6, 2], [12, 6], [8, 12], [2, 8]
];

const HOMES: Record<LudoColour, readonly (readonly [number, number])[]> = {
    red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    yellow: [[9, 7], [10, 7], [11, 7], [12, 7], [13, 7]],
    blue: [[7, 9], [7, 10], [7, 11], [7, 12], [7, 13]]
};

const key = (cell: Cell) => `${ cell.col },${ cell.row }`;

const pair = ([col, row]: readonly [number, number]) => `${ col },${ row }`;

const adjacent = (a: Cell, b: Cell) =>
    Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;

describe('the ring', () =>
{
    it('is the fifty-two squares the art paints as track', () =>
    {
        const painted = new Set<string>();

        for (let col = 6; col <= 8; col += 1)
        {
            for (const row of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14])
            {
                painted.add(`${ col },${ row }`);
            }
        }

        for (let row = 6; row <= 8; row += 1)
        {
            for (const col of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14])
            {
                painted.add(`${ col },${ row }`);
            }
        }

        expect(painted.size).toBe(72);

        for (const colour of COLOURS)
        {
            for (const cell of HOMES[colour])
            {
                painted.delete(pair(cell));
            }
        }

        expect(painted.size).toBe(RING);
        expect(new Set(RING_CELLS.map(key))).toEqual(painted);
    });

    it('never touches the three-by-three centre', () =>
    {
        for (const cell of RING_CELLS)
        {
            expect(cell.col >= 6 && cell.col <= 8 && cell.row >= 6 && cell.row <= 8).toBe(false);
        }
    });

    it('visits every square exactly once', () =>
    {
        expect(new Set(RING_CELLS.map(key)).size).toBe(RING);
    });

    it('steps one square at a time, and turns the four inner corners', () =>
    {
        let corners = 0;

        for (let index = 0; index < RING; index += 1)
        {
            const here = RING_CELLS[index];
            const next = RING_CELLS[(index + 1) % RING];
            const reach = Math.max(Math.abs(here.col - next.col), Math.abs(here.row - next.row));

            expect(reach, `${ key(here) } -> ${ key(next) }`).toBe(1);

            if (!adjacent(here, next))
            {
                corners += 1;
            }
        }

        expect(corners).toBe(4);
    });
});

describe('where a colour joins it', () =>
{
    it('enters on the square the art stars, not the one the model parks a token on', () =>
    {
        for (const colour of COLOURS)
        {
            expect(key(RING_CELLS[ENTRY[colour]]), colour).toBe(pair(STARTS[colour]));
        }
    });

    it('spaces the four entries evenly, as a four-fold board demands', () =>
    {
        expect(COLOURS.map((colour) => ENTRY[colour])).toEqual([0, 13, 26, 39]);
    });

    it('counts every colour from its own entry', () =>
    {
        expect(ringIndex('yellow', 0)).toBe(ENTRY.yellow);
        expect(ringIndex('yellow', RING - 1)).toBe(ENTRY.yellow - 1);
        expect(ringIndex('blue', 13)).toBe(ENTRY.red);
    });
});

describe('the safe squares', () =>
{
    it('are the eight the art marks with a star', () =>
    {
        expect(new Set(SAFE.map((index) => key(RING_CELLS[index])))).toEqual(new Set(STARRED.map(pair)));
    });

    it('include every entry, so nobody is sent home the moment they arrive', () =>
    {
        for (const colour of COLOURS)
        {
            expect(SAFE, colour).toContain(ENTRY[colour]);
        }
    });
});

describe('the home column', () =>
{
    it('is the five squares the art paints in each colour', () =>
    {
        for (const colour of COLOURS)
        {
            expect(new Set(HOME_CELLS[colour].map(key)), colour).toEqual(new Set(HOMES[colour].map(pair)));
        }
    });

    it('runs inward, so the first home square is the one the ring leads to', () =>
    {
        for (const colour of COLOURS)
        {
            const last = cellAt(colour, RING_STEPS - 1);
            const first = HOME_CELLS[colour][0];

            expect(last, colour).not.toBeNull();
            expect(adjacent(last!, first), colour).toBe(true);
        }
    });

    it('takes fifty-six steps to finish, and no more', () =>
    {
        expect(FINISHED).toBe(RING_STEPS + HOME_RUN);
        expect(cellAt('red', FINISHED - 1)).not.toBeNull();
        expect(cellAt('red', FINISHED)).toBeNull();
    });

    it('belongs to one colour, so no two colours share a home square', () =>
    {
        const seen = new Set<string>();

        for (const colour of COLOURS)
        {
            for (const cell of HOME_CELLS[colour])
            {
                expect(seen.has(key(cell)), `${ colour } ${ key(cell) }`).toBe(false);
                seen.add(key(cell));
            }
        }
    });
});

describe('the yards', () =>
{
    it('park four tokens inside each corner block', () =>
    {
        const corners: Record<LudoColour, readonly [number, number]> = {
            red: [0, 0],
            green: [9, 0],
            yellow: [9, 9],
            blue: [0, 9]
        };

        for (const colour of COLOURS)
        {
            const cells = yardCells(colour);
            const [col, row] = corners[colour];

            expect(cells, colour).toHaveLength(4);

            for (const cell of cells)
            {
                expect(cell.col >= col && cell.col < col + 6, colour).toBe(true);
                expect(cell.row >= row && cell.row < row + 6, colour).toBe(true);
            }
        }
    });
});

describe('who plays', () =>
{
    it('seats two players opposite each other rather than side by side', () =>
    {
        const [first, second] = coloursFor(2);
        const apart = Math.abs(ENTRY[first] - ENTRY[second]);

        expect(apart).toBe(RING / 2);
    });

    it('takes three and four in ring order', () =>
    {
        expect(coloursFor(3)).toEqual(['red', 'green', 'yellow']);
        expect(coloursFor(4)).toEqual(['red', 'green', 'yellow', 'blue']);
    });
});

describe('what stops a move', () =>
{
    const EMPTY = [YARD, YARD, YARD, YARD];

    const PAIRED = [0, 1, 0, 1];

    const ALONE = [0, 1, 2, 3];

    const SHARED = 30;

    const on = (colour: LudoColour, square: number) => (square - ENTRY[colour] + RING) % RING;

    const walkers = (rows: readonly (readonly number[])[], sides: readonly number[]): Walker[] =>
        rows.map((pieces, index) => ({ colour: coloursFor(rows.length)[index], pieces, side: sides[index] }));

    const standing = (walker: Walker, square: number, except: number) =>
        walker.pieces.filter((at, piece) => piece !== except && at >= 0 && at < RING_STEPS && ringIndex(walker.colour, at) === square).length;

    const byColour = (all: readonly Walker[], mover: number, piece: number, to: number): Obstacle | null =>
    {
        const own = all[mover];
        const from = own.pieces[piece];

        if (from === YARD)
        {
            return standing(own, ENTRY[own.colour], piece) > 0 ? 'start' : null;
        }

        for (let step = from + 1; step <= to && step < RING_STEPS; step += 1)
        {
            const square = ringIndex(own.colour, step);

            if (all.some((other, index) => index !== mover && standing(other, square, -1) >= 2))
            {
                return 'block';
            }
        }

        return to < RING_STEPS && standing(own, ringIndex(own.colour, to), piece) >= 2 ? 'full' : null;
    };

    it('is a block when two tokens of another side stand in the way, of one colour or of two', () =>
    {
        const blue = on('blue', SHARED);
        const two = [[on('red', SHARED), YARD, YARD, YARD], EMPTY, [on('yellow', SHARED), YARD, YARD, YARD], [blue - 2, YARD, YARD, YARD]];
        const one = [[on('red', SHARED), on('red', SHARED), YARD, YARD], EMPTY, EMPTY, [blue - 2, YARD, YARD, YARD]];

        expect(SAFE).not.toContain(SHARED);

        for (const rows of [two, one])
        {
            expect(obstacle(walkers(rows, PAIRED), 3, 0, blue), 'landing on it').toBe('block');
            expect(obstacle(walkers(rows, PAIRED), 3, 0, blue + 3), 'passing it').toBe('block');
            expect(obstacle(walkers(rows, PAIRED), 3, 0, blue - 1), 'stopping short of it').toBeNull();
        }

        expect(obstacle(walkers(two, ALONE), 3, 0, blue), 'two colours that are not one side are no pair').toBeNull();
        expect(obstacle(walkers(one, ALONE), 3, 0, blue), 'two of one colour are a pair whoever plays with whom').toBe('block');
    });

    it('is no block to the side the pair belongs to, which passes it freely', () =>
    {
        const rows = [[on('red', SHARED), on('red', SHARED) - 3, YARD, YARD], EMPTY, [on('yellow', SHARED), on('yellow', SHARED) - 1, YARD, YARD], EMPTY];

        expect(obstacle(walkers(rows, PAIRED), 0, 1, on('red', SHARED) + 2)).toBeNull();
        expect(obstacle(walkers(rows, PAIRED), 2, 1, on('yellow', SHARED) + 4)).toBeNull();
        expect(obstacle(walkers(rows, ALONE), 0, 1, on('red', SHARED) + 2), 'nor to anybody, while the two are not one side').toBeNull();
    });

    it('is a full square when two of the side already stand where it would land, of one colour or of two', () =>
    {
        const rows = [[on('red', SHARED), on('red', SHARED) - 3, YARD, YARD], EMPTY, [on('yellow', SHARED), on('yellow', SHARED) - 1, YARD, YARD], EMPTY];
        const single = [[on('red', SHARED) - 3, YARD, YARD, YARD], EMPTY, [on('yellow', SHARED), YARD, YARD, YARD], EMPTY];

        expect(obstacle(walkers(rows, PAIRED), 0, 1, on('red', SHARED)), 'red onto red and yellow').toBe('full');
        expect(obstacle(walkers(rows, PAIRED), 2, 1, on('yellow', SHARED)), 'yellow onto red and yellow').toBe('full');
        expect(obstacle(walkers(rows, ALONE), 0, 1, on('red', SHARED)), 'a colour by itself has one token there').toBeNull();
        expect(obstacle(walkers(single, PAIRED), 0, 0, on('red', SHARED)), 'a second token joins a partner').toBeNull();
        expect(obstacle(walkers([[SHARED, SHARED, SHARED - 3, YARD], EMPTY, EMPTY, EMPTY], PAIRED), 0, 2, SHARED), 'red onto two of red').toBe('full');
    });

    it('is the start square while one of its own colour stands there, and a full square while two of its partner do', () =>
    {
        const there = on('yellow', ENTRY.red);
        const opponent = on('green', ENTRY.red);

        expect(obstacle(walkers([[0, YARD, YARD, YARD], EMPTY, EMPTY, EMPTY], PAIRED), 0, 1, 0)).toBe('start');
        expect(obstacle(walkers([[0, YARD, YARD, YARD], EMPTY, [there, there, YARD, YARD], EMPTY], PAIRED), 0, 1, 0), 'its own colour is asked first').toBe('start');
        expect(obstacle(walkers([EMPTY, EMPTY, [there, there, YARD, YARD], EMPTY], PAIRED), 0, 0, 0)).toBe('full');
        expect(obstacle(walkers([EMPTY, EMPTY, [there, there, YARD, YARD], EMPTY], ALONE), 0, 0, 0), 'two of another side are sent home, not in the way').toBeNull();
        expect(obstacle(walkers([EMPTY, EMPTY, [there, YARD, YARD, YARD], EMPTY], PAIRED), 0, 0, 0), 'one partner there leaves room').toBeNull();
        expect(obstacle(walkers([EMPTY, [opponent, opponent, YARD, YARD], EMPTY, EMPTY], PAIRED), 0, 0, 0), 'a pair of opponents there is sent home').toBeNull();
    });

    it('answers as counting by colour always did, wherever every colour is a side of its own', () =>
    {
        let value = 20261007;

        const below = (limit: number) =>
        {
            value = (value * 48271) % 2147483647;

            return value % limit;
        };

        const somewhere = (colour: LudoColour) =>
        {
            const kind = below(12);

            if (kind === 0)
            {
                return FINISHED;
            }

            if (kind === 1)
            {
                return RING_STEPS + below(HOME_RUN);
            }

            const progress = on(colour, 8 + below(20));

            return kind < 4 || progress >= RING_STEPS ? YARD : progress;
        };

        const seen = new Map<Obstacle | null, number>();

        for (let trial = 0; trial < 2000; trial += 1)
        {
            const colours = coloursFor(2 + below(3));
            const all = colours.map((colour, index): Walker => ({ colour, pieces: [0, 1, 2, 3].map(() => somewhere(colour)), side: index }));

            all.forEach((own, mover) => own.pieces.forEach((from, piece) =>
            {
                for (let die = 1; die <= 6; die += 1)
                {
                    const to = from === YARD ? 0 : from + die;

                    if (from === FINISHED || to > FINISHED || (from === YARD && die !== 6))
                    {
                        continue;
                    }

                    const answer = obstacle(all, mover, piece, to);

                    expect(answer, `${ JSON.stringify(all) }: ${ own.colour } token ${ piece } to ${ to }`).toBe(byColour(all, mover, piece, to));
                    seen.set(answer, (seen.get(answer) ?? 0) + 1);
                }
            }));
        }

        for (const answer of ['block', 'full', 'start', null] as const)
        {
            expect(seen.get(answer) ?? 0, `${ answer } never came up`).toBeGreaterThan(20);
        }
    });
});
