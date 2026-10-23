import { EMPTY, colourOf, kindOf, opponent, pieceOf, type Colour, type Kind, type Piece } from '../../../backend/src/domains/match/chess/board.ts';
import { attacked, kingOf } from '../../../backend/src/domains/match/chess/moves.ts';
import type { MatchLog } from '../api.ts';
import type { ChessBoard } from '../data/match.ts';

/** One piece on the table, keyed for its whole life so a move is that piece travelling. */
export interface Man
{
    key: string;
    piece: Piece;
    square: number;
}

/** What the table shows: every piece by its key, the move made last, and whose move it is. */
export interface Felt
{
    men: Man[];
    last: { from: number; to: number } | null;
    turn: Colour;
}

/** One thing the log tells, as the wire carries it. */
export type Told = Extract<MatchLog, { kind: 'chess' }>['moves'][number];

const WORTH: Record<Kind, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const START: Record<Kind, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

const ORDER: readonly Kind[] = ['q', 'r', 'b', 'n', 'p'];

/** The table as a board says it stands: each piece keyed by its letter and how many of it came before. */
export function feltOf(view: Pick<ChessBoard, 'board' | 'turn' | 'last'>): Felt
{
    const counts = new Map<string, number>();
    const men: Man[] = [];

    for (let square = 0; square < 64; square += 1)
    {
        const piece = view.board[square];

        if (piece === EMPTY)
        {
            continue;
        }

        const nth = (counts.get(piece) ?? 0) + 1;

        counts.set(piece, nth);
        men.push({ key: `${ piece }${ nth }`, piece: piece as Piece, square });
    }

    return { men, last: view.last === undefined ? null : { ...view.last }, turn: view.turn };
}

/** Where the rook goes when the king castles to `to`: from the corner beside it, over to the king's other side. */
export function rookOf(to: number, side: 'k' | 'q')
{
    return side === 'k' ? { from: to + 1, to: to - 1 } : { from: to - 2, to: to + 1 };
}

/** The square a pawn taken en passant stood on: behind the square the taker moved to. */
export const passedOf = (to: number, colour: Colour) => to + (colour === 'w' ? -8 : 8);

/** The table once one logged move has been shown. Anything else the log tells moves no piece. */
export function step(felt: Felt, told: Told): Felt
{
    if (told.e !== 'move' || told.from === undefined || told.to === undefined)
    {
        return felt;
    }

    const { from, to } = told;
    const mover = felt.men.find((man) => man.square === from);

    if (mover === undefined)
    {
        return felt;
    }

    const colour = colourOf(mover.piece);
    const taken = told.enPassant === true ? passedOf(to, colour) : (told.captured === undefined ? null : to);
    const rook = told.castle === undefined ? null : rookOf(to, told.castle);

    const men = felt.men
        .filter((man) => man === mover || man.square !== taken)
        .map((man): Man =>
        {
            if (man === mover)
            {
                return { ...man, square: to, piece: told.promotion === undefined ? man.piece : pieceOf(colour, told.promotion) };
            }

            return rook !== null && man.square === rook.from ? { ...man, square: rook.to } : man;
        });

    return { men, last: { from, to }, turn: colour === 'w' ? 'b' : 'w' };
}

/** The 64 squares from a1, as a board writes them. */
export function boardOf(men: readonly Man[])
{
    const squares = Array.from({ length: 64 }, () => EMPTY as string);

    for (const man of men)
    {
        squares[man.square] = man.piece;
    }

    return squares.join('');
}

/** The square of the king whose side is to move, when it stands in check. */
export function checkOf(felt: Pick<Felt, 'men' | 'turn'>)
{
    const board = boardOf(felt.men);
    const king = kingOf(board, felt.turn);

    return king >= 0 && attacked(board, king, opponent(felt.turn)) ? king : null;
}

const countsOf = (men: readonly Man[], colour: Colour) =>
{
    const counts: Record<Kind, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };

    for (const man of men)
    {
        if (colourOf(man.piece) === colour)
        {
            counts[kindOf(man.piece)] += 1;
        }
    }

    return counts;
};

/**
 * The pieces `colour` has taken, from what is missing of the other side's set. A piece more than
 * a set has came from a pawn reaching the last rank, so that pawn is not counted as taken.
 */
export function takenBy(men: readonly Man[], colour: Colour): Piece[]
{
    const other: Colour = colour === 'w' ? 'b' : 'w';
    const counts = countsOf(men, other);
    const promoted = ORDER.filter((kind) => kind !== 'p').reduce((total, kind) => total + Math.max(0, counts[kind] - START[kind]), 0);

    return ORDER.flatMap((kind) =>
    {
        const missing = kind === 'p' ? START.p - counts.p - promoted : START[kind] - counts[kind];

        return Array.from({ length: Math.max(0, missing) }, () => pieceOf(other, kind));
    });
}

/** How far ahead White is in material, in pawns: below nothing when Black is. */
export function leadOf(men: readonly Man[])
{
    return men.reduce((total, man) => total + (colourOf(man.piece) === 'w' ? 1 : -1) * WORTH[kindOf(man.piece)], 0);
}
