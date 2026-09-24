import { FINISHED, RING_STEPS, YARD, isSafeRing, ringIndex, type LudoColour } from '../../../../server/src/domains/match/ludo/board.ts';
import type { LudoBoard, LudoSeat } from '../../data/match.ts';
import type { Tip } from './tip.ts';

export type LudoOutcome =
    | { kind: 'enter' }
    | { kind: 'capture'; victim: number; count: number }
    | { kind: 'safe' }
    | { kind: 'home' }
    | { kind: 'step' };

export interface LudoHappened
{
    e: string;
    seat?: number;
    why?: string;
}

const squareOf = (seat: LudoSeat, progress: number): number => ringIndex(seat.colour as LudoColour, progress);

const standingOn = (board: LudoBoard, mover: number, square: number): number[] =>
    board.seats
        .filter((other) => other.seat !== mover)
        .flatMap((other) => other.tokens
            .filter((token) => token.at >= 0 && token.at < RING_STEPS && squareOf(other, token.at) === square)
            .map(() => other.seat));

const landing = (seat: LudoSeat, piece: number, die: number): number | null =>
{
    const token = seat.tokens.find((one) => one.piece === piece);

    if (token === undefined)
    {
        return null;
    }

    return token.at === YARD ? 0 : token.at + die;
};

export function outcomeOf(board: LudoBoard, seat: number, piece: number): LudoOutcome | null
{
    const mover = board.seats.find((one) => one.seat === seat);
    const to = mover === undefined || board.die === undefined ? null : landing(mover, piece, board.die);

    if (mover === undefined || to === null || !board.moves.includes(piece))
    {
        return null;
    }

    if (mover.tokens.find((one) => one.piece === piece)?.at === YARD)
    {
        return { kind: 'enter' };
    }

    if (to === FINISHED)
    {
        return { kind: 'home' };
    }

    if (to >= RING_STEPS)
    {
        return { kind: 'step' };
    }

    const square = squareOf(mover, to);

    if (isSafeRing(square))
    {
        return { kind: 'safe' };
    }

    const victims = standingOn(board, seat, square);

    return victims.length === 0 ? { kind: 'step' } : { kind: 'capture', victim: victims[0], count: victims.length };
}

const starShields = (board: LudoBoard, me: LudoSeat, die: number): boolean =>
    board.moves.some((piece) =>
    {
        const to = landing(me, piece, die);

        if (to === null || to >= RING_STEPS)
        {
            return false;
        }

        const square = squareOf(me, to);

        return isSafeRing(square) && standingOn(board, me.seat, square).length > 0;
    });

const ends = (me: LudoSeat, piece: number, die: number): boolean =>
    landing(me, piece, die) === FINISHED && me.tokens.every((token) => token.piece === piece || token.at === FINISHED);

export function coachOf(board: LudoBoard, mine: number | undefined, turn: number | undefined, recent: readonly LudoHappened[]): Tip | null
{
    if (mine === undefined)
    {
        return null;
    }

    const lastTurn = [...recent].reverse().find((one) => one.e === 'roll' || one.e === 'pass');

    if (turn !== mine && lastTurn?.e === 'pass' && lastTurn.why === 'three-sixes' && lastTurn.seat === mine)
    {
        return { key: 'helpers.ludo.tip.threeSixes' };
    }

    const me = board.seats.find((one) => one.seat === mine);

    if (turn !== mine || me === undefined || me.out)
    {
        return null;
    }

    if (board.die === undefined)
    {
        const waiting = me.tokens.filter((token) => token.at !== FINISHED);

        return waiting.length > 0 && waiting.every((token) => token.at === YARD) ? { key: 'helpers.ludo.tip.yard' } : null;
    }

    if (starShields(board, me, board.die))
    {
        return { key: 'helpers.ludo.tip.star' };
    }

    if (me.tokens.some((token) => token.at >= 0 && token.at < FINISHED && !board.moves.includes(token.piece)))
    {
        return { key: 'helpers.ludo.tip.exact' };
    }

    return board.die === 6 && !board.moves.some((piece) => ends(me, piece, 6)) ? { key: 'helpers.ludo.tip.six' } : null;
}
