export type Colour = 'w' | 'b';

export type Kind = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

/** A piece is its letter, upper case for White and lower case for Black. */
export type Piece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | Kind;

export const EMPTY = '.';

export const FILES = 'abcdefgh';

const PIECES = 'KQRBNPkqrbnp';

/**
 * Everything a position is, and nothing about how it was reached: the 64 squares from a1 to h8,
 * the side to move, the castling rights as a subset of `KQkq` in that order, the square a pawn
 * passed over on the double step just played (for one move only), the half-moves since a capture
 * or a pawn move, and the move number.
 */
export interface Position
{
    board: string;
    turn: Colour;
    castling: string;
    ep: number | null;
    halfmove: number;
    fullmove: number;
}

export const START: Position = {
    board: `RNBQKBNRPPPPPPPP${ EMPTY.repeat(32) }pppppppprnbqkbnr`,
    turn: 'w',
    castling: 'KQkq',
    ep: null,
    halfmove: 0,
    fullmove: 1
};

export const fileOf = (square: number) => square & 7;

export const rankOf = (square: number) => square >> 3;

export const squareAt = (file: number, rank: number) => rank * 8 + file;

export const nameOf = (square: number) => `${ FILES[fileOf(square)] }${ rankOf(square) + 1 }`;

export const colourOf = (piece: string): Colour => (piece === piece.toUpperCase() ? 'w' : 'b');

export const kindOf = (piece: string) => piece.toLowerCase() as Kind;

export const pieceOf = (colour: Colour, kind: Kind) => (colour === 'w' ? kind.toUpperCase() : kind) as Piece;

export const opponent = (colour: Colour): Colour => (colour === 'w' ? 'b' : 'w');

/** Light squares are the ones whose file and rank add up to an odd number: h1 is light. */
export const isLight = (square: number) => (fileOf(square) + rankOf(square)) % 2 === 1;

export function squareNamed(name: string)
{
    const file = FILES.indexOf(name[0] ?? '');
    const rank = Number(name[1]) - 1;

    return name.length === 2 && file >= 0 && rank >= 0 && rank <= 7 ? squareAt(file, rank) : null;
}

function placementOf(text: string): string | null
{
    const ranks = text.split('/');

    if (ranks.length !== 8)
    {
        return null;
    }

    let board = '';

    for (const rank of [...ranks].reverse())
    {
        let row = '';

        for (const char of rank)
        {
            row += char >= '1' && char <= '8' ? EMPTY.repeat(Number(char)) : (PIECES.includes(char) ? char : '?');
        }

        if (row.length !== 8 || row.includes('?'))
        {
            return null;
        }

        board += row;
    }

    return board;
}

/** A position from Forsyth-Edwards Notation, or null for text that is not one. */
export function parseFen(fen: string): Position | null
{
    const [placement, turn, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/);
    const board = placementOf(placement ?? '');
    const rights = castling ?? '';
    const passed = ep === '-' ? null : squareNamed(ep ?? '');
    const counts = [Number(halfmove ?? '0'), Number(fullmove ?? '1')];

    if (board === null || (turn !== 'w' && turn !== 'b') || rights === '' || !/^(-|K?Q?k?q?)$/.test(rights))
    {
        return null;
    }

    if ((ep !== '-' && passed === null) || counts.some((count) => !Number.isInteger(count) || count < 0))
    {
        return null;
    }

    return {
        board,
        turn,
        castling: rights === '-' ? '' : rights,
        ep: passed,
        halfmove: counts[0],
        fullmove: Math.max(1, counts[1])
    };
}

export function fenOf(position: Position)
{
    const ranks: string[] = [];

    for (let rank = 7; rank >= 0; rank -= 1)
    {
        let row = '';
        let empty = 0;

        for (let file = 0; file < 8; file += 1)
        {
            const piece = position.board[squareAt(file, rank)];

            if (piece === EMPTY)
            {
                empty += 1;
                continue;
            }

            row += `${ empty > 0 ? empty : '' }${ piece }`;
            empty = 0;
        }

        ranks.push(`${ row }${ empty > 0 ? empty : '' }`);
    }

    const ep = position.ep === null ? '-' : nameOf(position.ep);

    return `${ ranks.join('/') } ${ position.turn } ${ position.castling || '-' } ${ ep } ${ position.halfmove } ${ position.fullmove }`;
}
