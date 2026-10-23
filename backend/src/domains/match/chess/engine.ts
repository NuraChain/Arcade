import { START } from './board.ts';
import { charged } from './clock.ts';
import { inCheck, legalMoves, play } from './moves.ts';
import { sanOf } from './san.ts';
import { canMate, deadPosition, keyOf } from './status.ts';
import { DRAWN, colourOfSeat, movesBy, turnSeat, type ChessAction, type ChessEvent, type ChessRefusal, type ChessState, type Reason } from './state.ts';

export const SEATS: readonly number[] = [2];

export type Outcome =
    | { ok: true; state: ChessState; events: ChessEvent[] }
    | { ok: false; reason: ChessRefusal };

/** What the server says about the moment a move arrived: the time its side had left then. */
export interface Moment
{
    left: number;
}

const refuse = (reason: ChessRefusal): Outcome => ({ ok: false, reason });

export function create(white: number, clock: { base: number; increment: number } | null)
{
    const state: ChessState = {
        v: 1,
        game: 'chess',
        rev: 1,
        white,
        position: START,
        keys: [keyOf(START, legalMoves(START))],
        notation: [],
        moved: [false, false],
        offer: null,
        offered: [-1, -1],
        ply: 0,
        clock: clock === null ? null : { ...clock, left: [clock.base, clock.base] },
        last: null,
        over: null
    };
    const events: ChessEvent[] = [{ e: 'colours', white }];

    return { state, events };
}

function ended(state: ChessState, winner: number | null, reason: Reason, events: ChessEvent[]): ChessState
{
    events.push(winner === null ? { e: 'finish', reason } : { e: 'finish', reason, winner });

    return { ...state, offer: null, over: { winner, reason } };
}

function moved(state: ChessState, next: ChessState, action: Extract<ChessAction, { kind: 'move' }>, moment: Moment | undefined): Outcome
{
    const { seat } = action;

    if (seat !== turnSeat(state))
    {
        return refuse('not-your-turn');
    }

    if (moment !== undefined && moment.left <= 0)
    {
        return refuse('time-up');
    }

    const legal = legalMoves(state.position);
    const reaching = legal.filter((move) => move.from === action.from && move.to === action.to);
    const move = reaching.find((one) => one.promotion === action.promotion);

    if (move === undefined)
    {
        return refuse(reaching.length > 0 && action.promotion === undefined ? 'promotion-needed' : 'illegal-move');
    }

    const position = play(state.position, move);
    const replies = legalMoves(position);
    const check = inCheck(position);
    const mate = check && replies.length === 0;
    const events: ChessEvent[] = state.offer === 1 - seat ? [{ e: 'decline', seat }] : [];
    const san = `${ sanOf(move, legal) }${ mate ? '#' : (check ? '+' : '') }`;

    events.push({
        e: 'move',
        seat,
        from: move.from,
        to: move.to,
        piece: move.piece,
        ...(move.captured === undefined ? {} : { captured: move.captured }),
        ...(move.promotion === undefined ? {} : { promotion: move.promotion }),
        ...(move.castle === undefined ? {} : { castle: move.castle }),
        ...(move.enPassant === undefined ? {} : { enPassant: true }),
        ...(check ? { check: true } : {}),
        ...(mate ? { mate: true } : {}),
        san
    });

    const key = keyOf(position, replies);
    const keys = position.halfmove === 0 ? [key] : [...state.keys, key];
    const after: ChessState = {
        ...next,
        position,
        keys,
        notation: [...state.notation, san],
        moved: state.moved.map((one, at) => one || at === seat),
        offer: state.offer === 1 - seat ? null : state.offer,
        ply: state.ply + 1,
        clock: charged(state, seat, moment?.left),
        last: { from: move.from, to: move.to }
    };

    if (mate)
    {
        return { ok: true, state: ended(after, seat, 'checkmate', events), events };
    }

    const drawn: Reason | null = replies.length === 0
        ? 'stalemate'
        : (deadPosition(position.board)
            ? 'material'
            : (keys.filter((one) => one === key).length >= 3 ? 'repetition' : (position.halfmove >= 100 ? 'fifty' : null)));

    return { ok: true, state: drawn === null ? after : ended(after, null, drawn, events), events };
}

function offered(state: ChessState, next: ChessState, seat: number): Outcome
{
    if (state.offer === 1 - seat)
    {
        return agreed(next, seat);
    }

    if (state.offer === seat || state.offered[seat] >= movesBy(state, seat))
    {
        return refuse('draw-offered');
    }

    const offers = [...state.offered];

    offers[seat] = movesBy(state, seat);

    return { ok: true, state: { ...next, offer: seat, offered: offers }, events: [{ e: 'offer', seat }] };
}

function agreed(next: ChessState, seat: number): Outcome
{
    const events: ChessEvent[] = [{ e: 'accept', seat }];

    return { ok: true, state: ended(next, null, 'agreement', events), events };
}

/** A resignation before both sides have moved is no result, so nothing can be farmed by it. */
function resigned(state: ChessState, next: ChessState, seat: number): Outcome
{
    const events: ChessEvent[] = [{ e: 'resign', seat }];
    const begun = state.moved.every(Boolean);

    return { ok: true, state: ended(next, begun ? 1 - seat : null, begun ? 'resign' : 'abort', events), events };
}

/**
 * The flag of the side to move falling. The sweep lets it fall when the deadline passes, and the
 * side that is waiting may claim it once the server's clock says the time has gone (`moment`), so a
 * game does not stand at nought until the sweep comes round. Before the fallen side's first move it
 * is no result; after it, a loss on time, unless the other side has nothing that could ever mate.
 */
function flagged(state: ChessState, next: ChessState, moment: Moment | undefined): Outcome
{
    if (moment !== undefined && moment.left > 0)
    {
        return refuse('time-left');
    }

    const seat = turnSeat(state);
    const events: ChessEvent[] = [{ e: 'flag', seat }];

    if (!state.moved[seat])
    {
        return { ok: true, state: ended(next, null, 'abort', events), events };
    }

    const mates = canMate(state.position.board, colourOfSeat(state, 1 - seat));
    const spent = next.clock === null ? next : { ...next, clock: { ...next.clock, left: next.clock.left.map((bank, at) => (at === seat ? 0 : bank)) } };

    return { ok: true, state: ended(spent, mates ? 1 - seat : null, mates ? 'flag' : 'flag-material', events), events };
}

export function apply(state: ChessState, action: ChessAction, moment?: Moment): Outcome
{
    if (state.over !== null)
    {
        return refuse('game-over');
    }

    if (action.seat !== 0 && action.seat !== 1)
    {
        return refuse('not-playing');
    }

    const next: ChessState = { ...state, rev: state.rev + 1 };
    const other = 1 - action.seat;

    if (action.kind === 'move')
    {
        return moved(state, next, action, moment);
    }

    if (action.kind === 'offer')
    {
        return offered(state, next, action.seat);
    }

    if (action.kind === 'accept' || action.kind === 'decline')
    {
        if (state.offer !== other)
        {
            return refuse('no-draw-offer');
        }

        return action.kind === 'accept'
            ? agreed(next, action.seat)
            : { ok: true, state: { ...next, offer: null }, events: [{ e: 'decline', seat: action.seat }] };
    }

    if (action.kind === 'resign')
    {
        return resigned(state, next, action.seat);
    }

    if (action.kind === 'flag')
    {
        return flagged(state, next, moment);
    }

    const events: ChessEvent[] = [{ e: 'forfeit', seat: action.seat, reason: action.reason }];

    return { ok: true, state: ended(next, other, 'forfeit', events), events };
}

/** The moves a seat may make, which is all `legal` offers: an offer or a resignation is never forced on anybody. */
export function legalActions(state: ChessState, seat: number): ChessAction[]
{
    if (state.over !== null || seat !== turnSeat(state))
    {
        return [];
    }

    return legalMoves(state.position).map((move): ChessAction => ({
        kind: 'move',
        seat,
        from: move.from,
        to: move.to,
        ...(move.promotion === undefined ? {} : { promotion: move.promotion })
    }));
}

/** What the sweep plays for a side whose time is up: never a move, only its flag. */
export function autoplay(state: ChessState, seat: number): ChessAction | null
{
    return state.over === null && seat === turnSeat(state) ? { kind: 'flag', seat } : null;
}

/** Who won, and who nobody can be rated against: both sides, when the game was aborted. */
export function endingOf(state: ChessState)
{
    if (state.over === null)
    {
        return null;
    }

    if (state.over.winner !== null)
    {
        return { winners: [state.over.winner], unsettled: [], trailing: [] };
    }

    return { winners: [], unsettled: state.over.reason === 'abort' ? [0, 1] : [], trailing: [] };
}

/** Where each seat came: the winner first, and one shared place for a draw or a game still going. */
export function placesOf(state: ChessState)
{
    const winner = state.over?.winner ?? null;

    return [0, 1].map((seat) => ({ seat, place: winner === null || winner === seat ? 1 : 2 }));
}

/** What each seat did, folded out of a whole game's events. */
export function tallyOf(events: readonly ChessEvent[])
{
    const bySeat = new Map<number, Record<string, number>>();

    const bump = (seat: number, name: string) =>
    {
        const tally = bySeat.get(seat) ?? {};

        tally[name] = (tally[name] ?? 0) + 1;
        bySeat.set(seat, tally);
    };

    for (const event of events)
    {
        if (event.e === 'move')
        {
            bump(event.seat, 'moves');

            const did: [boolean, string][] = [
                [event.captured !== undefined, 'captures'],
                [event.check === true && event.mate !== true, 'checks'],
                [event.mate === true, 'checkmates'],
                [event.castle !== undefined, 'castles'],
                [event.promotion !== undefined, 'promotions'],
                [event.enPassant === true, 'enPassants']
            ];

            for (const [done, name] of did)
            {
                if (done)
                {
                    bump(event.seat, name);
                }
            }
        }

        if (event.e === 'finish' && DRAWN.includes(event.reason))
        {
            bump(0, 'draws');
            bump(1, 'draws');
        }
    }

    return bySeat;
}
