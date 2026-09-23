export const GRID = 15;

/** The walnut rim: `RIM / BOARD` from `set-ludo.py`, so the paper starts this far in. */
export const RIM = 0.016 / 0.380;

export const FIELD = 1 - RIM * 2;

/**
 * The playing grid does NOT fill the paper, and assuming it did put every token near an edge about
 * a quarter of a cell too far out - exact in the middle, worst in the corners, which is the hardest
 * kind of wrong to see.
 *
 * `atlas.py` draws the field with a 32px cream margin inside its 1024px region, and `set-ludo.py`
 * insets the face's UVs by the 16px `GUTTER` - so the mesh shows atlas pixels 16..1008, and inside
 * that the fifteen cells start 16px in and run 960px. Both fractions come from those two constants
 * and nothing is measured off the render.
 */
export const MARGIN = RIM + FIELD * (16 / 992);

export const CELL = FIELD * (960 / 992) / GRID;

export const NEST_RADIUS = 1.72;

export const NEST_SPREAD = 0.72;

export const NEST: Record<string, readonly [number, number]> = {
    red: [3.7, 3.7],
    green: [2.3, 3.7],
    yellow: [2.3, 2.3],
    blue: [3.7, 2.3]
};

export const NEST_WELLS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

export interface Spot
{
    x: number;
    y: number;
}

/** The centre of one grid square, in pixels, for a square board `size` across. */
export function centreOf(col: number, row: number, size: number): Spot
{
    return {
        x: (MARGIN + (col + 0.5) * CELL) * size,
        y: (MARGIN + (row + 0.5) * CELL) * size
    };
}

/** How big a token should be drawn on a board `size` across. */
export function tokenRadius(size: number): number
{
    return CELL * size * 0.40;
}

export interface Pickable
{
    key: string;
    col: number;
    row: number;
    playable: boolean;
}

export const PICK_REACH = 1.25;

export function pickNear(tokens: readonly Pickable[], x: number, y: number, size: number): string | null
{
    const cell = CELL * size;
    let best: string | null = null;
    let closest = cell * PICK_REACH;

    for (const token of tokens)
    {
        if (!token.playable)
        {
            continue;
        }

        const spot = centreOf(token.col, token.row, size);
        const distance = Math.hypot(spot.x - x, spot.y - cell * 0.3 - y);

        if (distance <= closest)
        {
            best = token.key;
            closest = distance;
        }
    }

    return best;
}
