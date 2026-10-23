import { EMPTY, colourOf, isLight, kindOf, type Colour, type Position } from './board.ts';
import type { Move } from './moves.ts';

function piecesOf(board: string)
{
    const found: { square: number; colour: Colour; kind: string }[] = [];

    for (let square = 0; square < 64; square += 1)
    {
        const piece = board[square];

        if (piece !== EMPTY && kindOf(piece) !== 'k')
        {
            found.push({ square, colour: colourOf(piece), kind: kindOf(piece) });
        }
    }

    return found;
}

/**
 * Whether `colour` could checkmate by some series of legal moves, the other side's included, which
 * is what decides a flag (FIDE 6.9). A pawn, a rook or a queen always could, and a bare king never
 * can. A knight with another minor piece could. A lone knight could where the other side has a
 * pawn, a knight, a bishop or a rook to wall its own king in with, and not where it has only
 * queens: a queen on the square beside a cornered king covers both squares a knight checks it
 * from. Bishops on both colours could. Bishops all on one colour could where the other side has a
 * pawn, a knight or a bishop on the other colour, and not against rooks and queens, which always
 * take or block the bishop that checks. What this does not see is a position locked by pawns that
 * no capture can ever open.
 */
export function canMate(board: string, colour: Colour)
{
    const pieces = piecesOf(board);
    const mine = pieces.filter((piece) => piece.colour === colour);
    const theirs = pieces.filter((piece) => piece.colour !== colour);
    const holds = (side: typeof pieces, kinds: string) => side.some((piece) => kinds.includes(piece.kind));

    if (holds(mine, 'prq'))
    {
        return true;
    }

    if (holds(mine, 'n'))
    {
        return mine.length > 1 || holds(theirs, 'pnbr');
    }

    const shades = new Set(mine.map((piece) => isLight(piece.square)));

    if (shades.size !== 1)
    {
        return shades.size === 2;
    }

    const [shade] = shades;

    return holds(theirs, 'pn') || theirs.some((piece) => piece.kind === 'b' && isLight(piece.square) !== shade);
}

/**
 * A position no series of legal moves can end in checkmate (FIDE 5.2.2), as it arises: king
 * against king, a king and a knight against a bare king, and kings with bishops that all stand on
 * squares of one colour. Asked as neither side being able to mate, so the two rules are one.
 */
export function deadPosition(board: string)
{
    return !canMate(board, 'w') && !canMate(board, 'b');
}

/**
 * What makes two positions the same for a repetition (FIDE 9.2.2): the pieces on the squares, the
 * side to move, the castling rights, and an en passant capture only when one can be made.
 */
export function keyOf(position: Position, legal: readonly Move[])
{
    const ep = position.ep !== null && legal.some((move) => move.enPassant === true) ? String(position.ep) : '-';

    return `${ position.board } ${ position.turn } ${ position.castling || '-' } ${ ep }`;
}
