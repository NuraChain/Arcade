/**
 * A chess board in a box of 1000 units: a walnut frame round the 64 squares. The art is drawn in
 * these units (`tools/art/chess.mjs`) and the page lays its pieces, marks and coordinates over the
 * board in the same ones, as percentages of the box, so the two cannot disagree about a square.
 *
 * The reader's colour is at the foot. The board is turned round for whoever plays Black, never
 * mirrored: White's queen stands on d1 to White's left whoever looks, and the page keeps it
 * `direction: ltr` in Persian as every printed board does.
 */

export type Foot = 'w' | 'b';

export const SIZE = 1000;

export const FRAME = 52;

export const FIELD = SIZE - 2 * FRAME;

export const SQUARE = FIELD / 8;

const fileOf = (square: number) => square % 8;

const rankOf = (square: number) => Math.floor(square / 8);

/** The column and row a square is drawn in, counted from the top left of the field. */
export function cellOf(square: number, foot: Foot)
{
    const file = fileOf(square);
    const rank = rankOf(square);

    return foot === 'w' ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}

/** Where a square's top left corner stands, in board units. */
export function spotOf(square: number, foot: Foot)
{
    const { col, row } = cellOf(square, foot);

    return { x: FRAME + col * SQUARE, y: FRAME + row * SQUARE };
}

/** The box of the cell in a column and a row of the field, as a share of the board, for a style. */
export function boxOf(col: number, row: number)
{
    const share = (value: number) => `${ (value / SIZE * 100).toFixed(3) }%`;

    return `left: ${ share(FRAME + col * SQUARE) }; top: ${ share(FRAME + row * SQUARE) }; width: ${ share(SQUARE) }; height: ${ share(SQUARE) }`;
}

/** A square's box as a share of the board, for a style. */
export function placeOf(square: number, foot: Foot)
{
    const { col, row } = cellOf(square, foot);

    return boxOf(col, row);
}

/** The square under a point in board units, or null off the field. */
export function squareAt(x: number, y: number, foot: Foot)
{
    const col = Math.floor((x - FRAME) / SQUARE);
    const row = Math.floor((y - FRAME) / SQUARE);

    if (col < 0 || col > 7 || row < 0 || row > 7)
    {
        return null;
    }

    return foot === 'w' ? (7 - row) * 8 + col : row * 8 + (7 - col);
}

/** Where the letters and numbers stand on the frame: a file's under its column, a rank's beside its row. */
export function coordinatesOf(foot: Foot)
{
    const files = Array.from({ length: 8 }, (_, col) => ({
        label: 'abcdefgh'[foot === 'w' ? col : 7 - col],
        x: FRAME + (col + 0.5) * SQUARE,
        y: SIZE - FRAME / 2
    }));
    const ranks = Array.from({ length: 8 }, (_, row) => ({
        label: String(foot === 'w' ? 8 - row : row + 1),
        x: FRAME / 2,
        y: FRAME + (row + 0.5) * SQUARE
    }));

    return { files, ranks };
}
