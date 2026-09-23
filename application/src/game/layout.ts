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
