import { inCheck, legalMoves } from '../../../../backend/src/domains/match/chess/moves.ts';
import { kindOf, type Position } from '../../../../backend/src/domains/match/chess/board.ts';
import type { ChessBoard } from '../../data/match.ts';
import type { Tip } from './tip.ts';

/** How close the clock has to be to nothing before the coach says what running out costs. */
export const SHORT_MS = 60_000;

/** How few half-moves may be left before the fifty-move draw for the coach to mention it. */
const FIFTY_NEAR = 80;

/** Castling is mentioned only while a game is young, or the tip would stand for half of every game. */
const CASTLE_PLIES = 30;

type Shown = Pick<ChessBoard, 'board' | 'turn' | 'castling' | 'ep' | 'halfmove' | 'fullmove' | 'white' | 'moved' | 'ply'>;

const positionOf = (view: Shown): Position => ({
    board: view.board,
    turn: view.turn,
    castling: view.castling,
    ep: view.ep ?? null,
    halfmove: view.halfmove,
    fullmove: view.fullmove
});

/**
 * The rule that matters to the reader right now, from the server's own move generator, or null when
 * nothing is worth saying. `left` is what the reader's clock had when the answer arrived, or null at a
 * game that keeps none.
 */
export function coachOf(view: Shown, mine: number | undefined, left: number | null): Tip | null
{
    if (mine === undefined)
    {
        return null;
    }

    const colour = mine === view.white ? 'w' : 'b';

    if (view.turn !== colour)
    {
        return view.moved[1 - mine] === true ? null : { key: 'helpers.chess.tip.waitFirst' };
    }

    if (view.moved[mine] !== true)
    {
        return { key: 'helpers.chess.tip.first' };
    }

    const position = positionOf(view);
    const legal = legalMoves(position);

    if (inCheck(position))
    {
        return legal.every((move) => kindOf(move.piece) === 'k') ? { key: 'helpers.chess.tip.checkKing' } : { key: 'helpers.chess.tip.check' };
    }

    if (legal.some((move) => move.promotion !== undefined))
    {
        return { key: 'helpers.chess.tip.promote' };
    }

    if (legal.some((move) => move.enPassant === true))
    {
        return { key: 'helpers.chess.tip.passant' };
    }

    if (left !== null && left < SHORT_MS)
    {
        return { key: 'helpers.chess.tip.time' };
    }

    if (view.ply < CASTLE_PLIES && legal.some((move) => move.castle !== undefined))
    {
        return { key: 'helpers.chess.tip.castle' };
    }

    if (view.halfmove >= FIFTY_NEAR)
    {
        return { key: 'helpers.chess.tip.fifty' };
    }

    return null;
}
