import { FINISHED, RING_STEPS, YARD, capturesAt, cellAt, obstacle, ringIndex, type LudoColour, type Walker } from '../../../../backend/src/domains/match/ludo/board.ts';
import type { LudoBoard, LudoSeat } from '../../data/match.ts';
import type { Tip } from './tip.ts';

export type LudoOutcome =
    | { kind: 'enter'; count?: number }
    | { kind: 'capture'; victim: number; count: number }
    | { kind: 'safe' }
    | { kind: 'home' }
    | { kind: 'step' };

export interface LudoHappened
{
    e: string;
    seat?: number;
    owner?: number;
    die?: number;
    why?: string;
}

const squareOf = (seat: LudoSeat, progress: number) => ringIndex(seat.colour as LudoColour, progress);

const onSquare = (seat: LudoSeat, square: number) =>
    seat.tokens.filter((token) => token.at >= 0 && token.at < RING_STEPS && squareOf(seat, token.at) === square).length;

const standingOn = (board: LudoBoard, side: number, square: number) =>
    board.seats
        .filter((other) => other.side !== side)
        .flatMap((other) => Array.from({ length: onSquare(other, square) }, () => other.seat));

const landing = (seat: LudoSeat, piece: number, die: number): number | null =>
{
    const token = seat.tokens.find((one) => one.piece === piece);

    if (token === undefined)
    {
        return null;
    }

    return token.at === YARD ? 0 : token.at + die;
};

const movedBy = (board: LudoBoard) => board.seats.find((one) => one.seat === board.controls);

const homeOf = (seat: LudoSeat) => seat.tokens.every((token) => token.at === FINISHED);

export function handOf(board: LudoBoard, seat: number)
{
    const own = board.seats.find((one) => one.seat === seat);
    const partner = own === undefined ? undefined : board.seats.find((one) => one.seat !== seat && one.side === own.side);

    return own !== undefined && partner !== undefined && homeOf(own) ? partner : own;
}

const paired = (board: LudoBoard) => new Set(board.seats.map((one) => one.side)).size < board.seats.length;

export function pieceFor(board: LudoBoard, piece: number)
{
    if (board.moves.includes(piece))
    {
        return piece;
    }

    const tokens = movedBy(board)?.tokens ?? [];

    if (tokens.find((token) => token.piece === piece)?.at !== YARD)
    {
        return null;
    }

    return tokens.find((token) => token.at === YARD && board.moves.includes(token.piece))?.piece ?? null;
}

export function movedTo(board: LudoBoard, piece: number): LudoBoard | null
{
    const mover = movedBy(board);
    const to = mover === undefined || board.die === undefined || !board.moves.includes(piece) ? null : landing(mover, piece, board.die);

    if (mover === undefined || to === null || to > FINISHED)
    {
        return null;
    }

    const cell = cellAt(mover.colour as LudoColour, to);
    const next: LudoBoard = {
        ...board,
        moves: [],
        seats: board.seats.map((one) => one.seat !== mover.seat ? one : {
            ...one,
            home: one.home + (to === FINISHED ? 1 : 0),
            tokens: one.tokens.map((token) => token.piece !== piece ? token : {
                piece,
                at: to,
                ...(cell === null ? {} : { cell: { col: cell.col, row: cell.row } })
            })
        })
    };

    delete next.die;

    return next;
}

export function outcomeOf(board: LudoBoard, piece: number): LudoOutcome | null
{
    const mover = movedBy(board);
    const to = mover === undefined || board.die === undefined ? null : landing(mover, piece, board.die);

    if (mover === undefined || to === null || !board.moves.includes(piece))
    {
        return null;
    }

    if (mover.tokens.find((one) => one.piece === piece)?.at === YARD)
    {
        const victims = standingOn(board, mover.side, squareOf(mover, 0));

        return victims.length === 0 ? { kind: 'enter' } : { kind: 'enter', count: victims.length };
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

    if (!capturesAt(mover.colour as LudoColour, to))
    {
        return { kind: 'safe' };
    }

    const victims = standingOn(board, mover.side, square);

    return victims.length === 0 ? { kind: 'step' } : { kind: 'capture', victim: victims[0], count: victims.length };
}

const starShields = (board: LudoBoard, me: LudoSeat, die: number) =>
    board.moves.some((piece) =>
    {
        const to = landing(me, piece, die);

        if (to === null || to >= RING_STEPS)
        {
            return false;
        }

        return !capturesAt(me.colour as LudoColour, to) && standingOn(board, me.side, squareOf(me, to)).length > 0;
    });

const joinsPartner = (board: LudoBoard, me: LudoSeat, die: number) =>
    board.moves.some((piece) =>
    {
        const to = landing(me, piece, die);

        return to !== null
            && to < RING_STEPS
            && board.seats.some((other) => other.seat !== me.seat && other.side === me.side && onSquare(other, squareOf(me, to)) > 0);
    });

const walkersOf = (board: LudoBoard): Walker[] =>
    board.seats.map((one) => ({
        colour: one.colour as LudoColour,
        pieces: [...one.tokens].sort((a, b) => a.piece - b.piece).map((token) => token.at),
        side: one.side
    }));

const stoppedBy = (board: LudoBoard, me: LudoSeat, die: number): Tip | null =>
{
    const walkers = walkersOf(board);
    const mover = board.seats.indexOf(me);
    const reasons = me.tokens.map((token) =>
    {
        if (token.at === FINISHED || (token.at === YARD && die !== 6))
        {
            return null;
        }

        const to = landing(me, token.piece, die);

        return to === null || to > FINISHED ? null : obstacle(walkers, mover, token.piece, to);
    });

    if (reasons.some((reason) => reason === 'block' || reason === 'full'))
    {
        return { key: paired(board) ? 'helpers.ludo.tip.blockedTeams' : 'helpers.ludo.tip.blocked' };
    }

    return reasons.includes('start') ? { key: 'helpers.ludo.tip.start' } : null;
};

const ends = (board: LudoBoard, me: LudoSeat, piece: number, die: number) =>
    landing(me, piece, die) === FINISHED
    && board.seats
        .filter((one) => one.side === me.side)
        .every((one) => one.tokens.every((token) => (one.seat === me.seat && token.piece === piece) || token.at === FINISHED));

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

    const me = turn === mine ? movedBy(board) : handOf(board, mine);

    if (me !== undefined && me.seat !== mine && !homeOf(me) && recent.some((one) => one.e === 'home' && one.seat === mine && one.owner === mine))
    {
        return { key: 'helpers.ludo.tip.helping' };
    }

    if (turn !== mine && lastTurn?.e === 'pass' && lastTurn.why === 'no-move' && lastTurn.seat === mine && me !== undefined)
    {
        const rolled = recent.slice(0, recent.lastIndexOf(lastTurn)).reverse().find((one) => one.e === 'roll' && one.seat === mine);

        return rolled?.die === undefined ? null : stoppedBy(board, me, rolled.die);
    }

    if (turn !== mine || me === undefined || me.out)
    {
        return null;
    }

    if (board.die === undefined)
    {
        const last = recent.at(-1);
        const wasted = last?.e === 'roll' && last.seat === mine && last.die === 6 ? stoppedBy(board, me, 6) : null;

        if (wasted !== null)
        {
            return wasted;
        }

        const waiting = me.tokens.filter((token) => token.at !== FINISHED);

        return waiting.length > 0 && waiting.every((token) => token.at === YARD) ? { key: 'helpers.ludo.tip.yard' } : null;
    }

    if (starShields(board, me, board.die))
    {
        return { key: 'helpers.ludo.tip.star' };
    }

    if (joinsPartner(board, me, board.die))
    {
        return { key: 'helpers.ludo.tip.partner' };
    }

    const stopped = stoppedBy(board, me, board.die);

    if (stopped !== null)
    {
        return stopped;
    }

    if (me.tokens.some((token) => token.at >= 0 && token.at < FINISHED && !board.moves.includes(token.piece)))
    {
        return { key: 'helpers.ludo.tip.exact' };
    }

    return board.die === 6 && !board.moves.some((piece) => ends(board, me, piece, 6)) ? { key: 'helpers.ludo.tip.six' } : null;
}
