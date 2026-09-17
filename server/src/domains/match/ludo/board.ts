/**
 * The Ludo board, derived from the one this product already draws.
 *
 * `tools/blender/lib/atlas.py` paints the field and `tools/blender/assets/set-ludo.py` builds the
 * GLB from the same 15x15 grid. `board.spec.ts` asserts every constant here against the literals in
 * that Python, so the squares a token walks and the squares underneath it cannot drift apart.
 */

export type LudoColour = 'red' | 'green' | 'yellow' | 'blue';

export interface Cell
{
    col: number;
    row: number;
}

export const GRID = 15;

export const RING = 52;

export const HOME_RUN = 5;

export const TOKENS_PER_PLAYER = 4;

export const YARD = -1;

export const RING_STEPS = 51;

export const FINISHED = RING_STEPS + HOME_RUN;

export const COLOURS: readonly LudoColour[] = ['red', 'green', 'yellow', 'blue'];

interface Segment
{
    from: readonly [number, number];
    step: readonly [number, number];
    count: number;
}

const WALK: readonly Segment[] = [
    { from: [1, 6], step: [1, 0], count: 5 },
    { from: [6, 5], step: [0, -1], count: 6 },
    { from: [7, 0], step: [1, 0], count: 1 },
    { from: [8, 0], step: [0, 1], count: 6 },
    { from: [9, 6], step: [1, 0], count: 6 },
    { from: [14, 7], step: [0, 1], count: 1 },
    { from: [14, 8], step: [-1, 0], count: 6 },
    { from: [8, 9], step: [0, 1], count: 6 },
    { from: [7, 14], step: [-1, 0], count: 1 },
    { from: [6, 14], step: [0, -1], count: 6 },
    { from: [5, 8], step: [-1, 0], count: 6 },
    { from: [0, 7], step: [0, -1], count: 2 }
];

const HOME_WALK: Readonly<Record<LudoColour, Segment>> = {
    red: { from: [1, 7], step: [1, 0], count: HOME_RUN },
    green: { from: [7, 1], step: [0, 1], count: HOME_RUN },
    yellow: { from: [13, 7], step: [-1, 0], count: HOME_RUN },
    blue: { from: [7, 13], step: [0, -1], count: HOME_RUN }
};

const YARD_CORNER: Readonly<Record<LudoColour, readonly [number, number]>> = {
    red: [0, 0],
    green: [9, 0],
    yellow: [9, 9],
    blue: [0, 9]
};

function trace(segments: readonly Segment[]): Cell[]
{
    const cells: Cell[] = [];

    for (const segment of segments)
    {
        for (let index = 0; index < segment.count; index += 1)
        {
            cells.push({
                col: segment.from[0] + segment.step[0] * index,
                row: segment.from[1] + segment.step[1] * index
            });
        }
    }

    return cells;
}

export const RING_CELLS: readonly Cell[] = trace(WALK);

export const ENTRY: Readonly<Record<LudoColour, number>> = {
    red: 0,
    green: 13,
    yellow: 26,
    blue: 39
};

export const SAFE: readonly number[] = [0, 8, 13, 21, 26, 34, 39, 47];

export const HOME_CELLS: Readonly<Record<LudoColour, readonly Cell[]>> = {
    red: trace([HOME_WALK.red]),
    green: trace([HOME_WALK.green]),
    yellow: trace([HOME_WALK.yellow]),
    blue: trace([HOME_WALK.blue])
};

export function yardCells(colour: LudoColour): readonly Cell[]
{
    const [col, row] = YARD_CORNER[colour];

    return [
        { col: col + 2, row: row + 2 },
        { col: col + 4, row: row + 2 },
        { col: col + 2, row: row + 4 },
        { col: col + 4, row: row + 4 }
    ];
}

export function ringIndex(colour: LudoColour, progress: number): number
{
    return (ENTRY[colour] + progress) % RING;
}

export function cellAt(colour: LudoColour, progress: number): Cell | null
{
    if (progress < 0 || progress >= FINISHED)
    {
        return null;
    }

    if (progress < RING_STEPS)
    {
        return RING_CELLS[ringIndex(colour, progress)];
    }

    return HOME_CELLS[colour][progress - RING_STEPS];
}

export function isSafeRing(index: number): boolean
{
    return SAFE.includes(index);
}

export function coloursFor(seats: number): readonly LudoColour[]
{
    if (seats === 2)
    {
        return ['red', 'yellow'];
    }

    return COLOURS.slice(0, seats);
}
