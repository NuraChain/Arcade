import { EMPTY, colourOf, fileOf, kindOf, opponent, pieceOf, rankOf, type Colour, type Kind, type Piece, type Position } from './board.ts';

export interface Move
{
    from: number;
    to: number;
    piece: Piece;
    captured?: Piece;
    promotion?: Kind;
    castle?: 'k' | 'q';
    enPassant?: true;
}

type Step = readonly [number, number];

const KNIGHT: readonly Step[] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

const KING: readonly Step[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const ROOK: readonly Step[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const BISHOP: readonly Step[] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

const PROMOTIONS: readonly Kind[] = ['q', 'r', 'b', 'n'];

/** Where a rook stands before it castles, and the right it takes away when it leaves or is taken there. */
const ROOK_HOMES: Readonly<Record<number, string>> = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' };

/** The square a step away, or -1 off the board. */
function shift(square: number, [file, rank]: Step)
{
    const toFile = fileOf(square) + file;
    const toRank = rankOf(square) + rank;

    return toFile >= 0 && toFile < 8 && toRank >= 0 && toRank < 8 ? toRank * 8 + toFile : -1;
}

const ahead = (colour: Colour) => (colour === 'w' ? 1 : -1);

function slidesTo(board: string, square: number, directions: readonly Step[], wanted: string)
{
    for (const direction of directions)
    {
        for (let at = shift(square, direction); at >= 0; at = shift(at, direction))
        {
            if (board[at] !== EMPTY)
            {
                if (wanted.includes(board[at]))
                {
                    return true;
                }

                break;
            }
        }
    }

    return false;
}

/** Whether a piece of `by` attacks `square`, whatever stands on it. */
export function attacked(board: string, square: number, by: Colour)
{
    const pawn = pieceOf(by, 'p');

    for (const file of [-1, 1])
    {
        const at = shift(square, [file, -ahead(by)]);

        if (at >= 0 && board[at] === pawn)
        {
            return true;
        }
    }

    const leaps: readonly [readonly Step[], Piece][] = [[KNIGHT, pieceOf(by, 'n')], [KING, pieceOf(by, 'k')]];

    for (const [steps, piece] of leaps)
    {
        if (steps.some((step) => board[shift(square, step)] === piece))
        {
            return true;
        }
    }

    const queen = pieceOf(by, 'q');

    return slidesTo(board, square, ROOK, `${ pieceOf(by, 'r') }${ queen }`)
        || slidesTo(board, square, BISHOP, `${ pieceOf(by, 'b') }${ queen }`);
}

export const kingOf = (board: string, colour: Colour) => board.indexOf(pieceOf(colour, 'k'));

/** Whether the side to move stands in check. */
export function inCheck(position: Position)
{
    const king = kingOf(position.board, position.turn);

    return king >= 0 && attacked(position.board, king, opponent(position.turn));
}

const put = (board: string, square: number, piece: string) => `${ board.slice(0, square) }${ piece }${ board.slice(square + 1) }`;

function pawnMoves(position: Position, from: number, piece: Piece, moves: Move[])
{
    const { board, turn } = position;
    const forward = ahead(turn);
    const last = turn === 'w' ? 7 : 0;

    const add = (to: number, extra: Partial<Move>) =>
    {
        if (rankOf(to) === last)
        {
            for (const promotion of PROMOTIONS)
            {
                moves.push({ from, to, piece, ...extra, promotion });
            }

            return;
        }

        moves.push({ from, to, piece, ...extra });
    };

    const one = shift(from, [0, forward]);

    if (one >= 0 && board[one] === EMPTY)
    {
        add(one, {});

        const two = shift(one, [0, forward]);

        if (rankOf(from) === (turn === 'w' ? 1 : 6) && board[two] === EMPTY)
        {
            moves.push({ from, to: two, piece });
        }
    }

    for (const file of [-1, 1])
    {
        const to = shift(from, [file, forward]);

        if (to < 0)
        {
            continue;
        }

        const target = board[to];

        if (target !== EMPTY && colourOf(target) !== turn)
        {
            add(to, { captured: target as Piece });
        }
        else if (to === position.ep)
        {
            moves.push({ from, to, piece, captured: pieceOf(opponent(turn), 'p'), enPassant: true });
        }
    }
}

function stepMoves(position: Position, from: number, piece: Piece, steps: readonly Step[], slide: boolean, moves: Move[])
{
    for (const step of steps)
    {
        for (let to = shift(from, step); to >= 0; to = slide ? shift(to, step) : -1)
        {
            const target = position.board[to];

            if (target === EMPTY)
            {
                moves.push({ from, to, piece });
                continue;
            }

            if (colourOf(target) !== position.turn)
            {
                moves.push({ from, to, piece, captured: target as Piece });
            }

            break;
        }
    }
}

/**
 * Castling, with every condition but the last: the rook and the king where they began, the
 * squares between them empty, and the king neither in check nor passing over an attacked square.
 * Whether it lands on one is asked of every move alike, by `legalMoves`.
 */
function castleMoves(position: Position, moves: Move[])
{
    const { board, turn, castling } = position;
    const home = turn === 'w' ? 4 : 60;
    const king = pieceOf(turn, 'k');
    const rook = pieceOf(turn, 'r');
    const enemy = opponent(turn);

    if (board[home] !== king || attacked(board, home, enemy))
    {
        return;
    }

    const sides: readonly ['k' | 'q', string, number, readonly number[], number][] = [
        ['k', turn === 'w' ? 'K' : 'k', home + 3, [home + 1, home + 2], home + 1],
        ['q', turn === 'w' ? 'Q' : 'q', home - 4, [home - 1, home - 2, home - 3], home - 1]
    ];

    for (const [side, right, corner, between, crossed] of sides)
    {
        if (castling.includes(right) && board[corner] === rook && between.every((square) => board[square] === EMPTY) && !attacked(board, crossed, enemy))
        {
            moves.push({ from: home, to: side === 'k' ? home + 2 : home - 2, piece: king, castle: side });
        }
    }
}

/** Every move the side to move could make if its own king did not matter. */
export function pseudoMoves(position: Position)
{
    const moves: Move[] = [];

    for (let from = 0; from < 64; from += 1)
    {
        const piece = position.board[from];

        if (piece === EMPTY || colourOf(piece) !== position.turn)
        {
            continue;
        }

        const kind = kindOf(piece);
        const own = piece as Piece;

        if (kind === 'p')
        {
            pawnMoves(position, from, own, moves);
        }
        else if (kind === 'n' || kind === 'k')
        {
            stepMoves(position, from, own, kind === 'n' ? KNIGHT : KING, false, moves);
        }
        else
        {
            stepMoves(position, from, own, kind === 'r' ? ROOK : (kind === 'b' ? BISHOP : [...ROOK, ...BISHOP]), true, moves);
        }
    }

    castleMoves(position, moves);

    return moves;
}

function rightsAfter(castling: string, move: Move)
{
    let rights = castling;

    if (kindOf(move.piece) === 'k')
    {
        rights = rights.replace(colourOf(move.piece) === 'w' ? /[KQ]/g : /[kq]/g, '');
    }

    for (const square of [move.from, move.to])
    {
        const right = ROOK_HOMES[square];

        if (right !== undefined)
        {
            rights = rights.replace(right, '');
        }
    }

    return rights;
}

/** The position after a move, which is taken to be one of the side to move's. */
export function play(position: Position, move: Move): Position
{
    const { turn } = position;
    let board = put(position.board, move.from, EMPTY);

    if (move.enPassant === true)
    {
        board = put(board, move.to - 8 * ahead(turn), EMPTY);
    }

    board = put(board, move.to, move.promotion === undefined ? move.piece : pieceOf(turn, move.promotion));

    if (move.castle !== undefined)
    {
        const [corner, landing] = move.castle === 'k' ? [move.from + 3, move.from + 1] : [move.from - 4, move.from - 1];

        board = put(put(board, corner, EMPTY), landing, pieceOf(turn, 'r'));
    }

    const pawn = kindOf(move.piece) === 'p';

    return {
        board,
        turn: opponent(turn),
        castling: rightsAfter(position.castling, move),
        ep: pawn && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : null,
        halfmove: pawn || move.captured !== undefined ? 0 : position.halfmove + 1,
        fullmove: turn === 'b' ? position.fullmove + 1 : position.fullmove
    };
}

/** Every legal move of the side to move: the pseudo-legal ones that leave its own king safe. */
export function legalMoves(position: Position)
{
    return pseudoMoves(position).filter((move) =>
    {
        const after = play(position, move);
        const king = kingOf(after.board, position.turn);

        return king >= 0 && !attacked(after.board, king, opponent(position.turn));
    });
}

/** How many move sequences of `depth` there are from a position: the count every generator is checked against. */
export function perft(position: Position, depth: number): number
{
    if (depth === 0)
    {
        return 1;
    }

    const moves = legalMoves(position);

    if (depth === 1)
    {
        return moves.length;
    }

    let total = 0;

    for (const move of moves)
    {
        total += perft(play(position, move), depth - 1);
    }

    return total;
}
