/**
 * The rules, as a pure function of a state and an action.
 *
 * Nothing here reads a clock, draws a random number or touches a database. The die arrives as a
 * value the caller already drew, which is what makes "the client cannot choose a dice result"
 * structural rather than a review comment: there is no randomness in this file to subvert, and the
 * only place a die is produced is `service.ts`, inside the transaction, after the caller has been
 * authorised. `ludo-purity.spec.ts` reads this directory as text and fails on an import of
 * `node:`, `typeorm` or the tokens `Math.random` and `Date.now`.
 *
 * `apply` never throws. A refusal is a value, because the timeout job folds actions over a state
 * and a function that throws for ordinary control flow is one you cannot fold.
 *
 * The variant is Ludo as the board is drawn: enter on a six, eight safe squares where nobody is
 * sent home, capture by landing exactly, no stacking of your own, exact count into the five home
 * cells, a six earns another roll and three of them end the turn, and three tries to find a six
 * when every token is still in the yard. Entering on a six is a CHOICE and not an obligation -
 * standard Ludo, and the only case where it matters is a player who has tokens out, because a full
 * yard leaves nothing else to do anyway.
 */

import {
    FINISHED,
    RING_STEPS,
    TOKENS_PER_PLAYER,
    YARD,
    coloursFor,
    isSafeRing,
    ringIndex,
    type LudoColour
} from './board.ts';
import type { EngineAction, GameEvent, LudoPlayer, LudoState, Outcome } from './state.ts';

const MAX_SIXES = 3;

const MAX_TRIES = 3;

export function create(seats: readonly number[], first: number): LudoState
{
    const ordered = [...seats].sort((a, b) => a - b);
    const colours = coloursFor(ordered.length);

    const players: LudoPlayer[] = ordered.map((seat, index) => ({
        seat,
        colour: colours[index] as LudoColour,
        pieces: Array.from({ length: TOKENS_PER_PLAYER }, () => YARD),
        out: false
    }));

    return {
        v: 1,
        variant: 'ludo',
        players,
        turn: first % players.length,
        die: null,
        sixes: 0,
        tries: 0,
        rev: 0,
        winner: null
    };
}

export function indexOfSeat(state: LudoState, seat: number): number
{
    return state.players.findIndex((player) => player.seat === seat);
}

export function isOver(state: LudoState): boolean
{
    return state.winner !== null;
}

function clone(state: LudoState): LudoState
{
    return {
        ...state,
        players: state.players.map((player) => ({ ...player, pieces: [...player.pieces] }))
    };
}

function active(state: LudoState): number[]
{
    return state.players
        .map((player, index) => (player.out ? -1 : index))
        .filter((index) => index >= 0);
}

function advance(state: LudoState): void
{
    const playing = active(state);

    if (playing.length === 0)
    {
        return;
    }

    let next = state.turn;

    do
    {
        next = (next + 1) % state.players.length;
    }
    while (state.players[next].out && next !== state.turn);

    state.turn = next;
    state.die = null;
    state.sixes = 0;
    state.tries = 0;
}

function occupiedByOwn(player: LudoPlayer, progress: number, except: number): boolean
{
    if (progress >= FINISHED)
    {
        return false;
    }

    return player.pieces.some((at, index) => index !== except && at === progress);
}

function blockedInHome(player: LudoPlayer, from: number, to: number, piece: number): boolean
{
    const last = Math.min(to, FINISHED - 1);

    for (let step = Math.max(from + 1, RING_STEPS); step <= last; step += 1)
    {
        if (occupiedByOwn(player, step, piece))
        {
            return true;
        }
    }

    return false;
}

function destination(player: LudoPlayer, piece: number, die: number): number | null
{
    const from = player.pieces[piece];

    if (from === FINISHED)
    {
        return null;
    }

    if (from === YARD)
    {
        return die === 6 && !occupiedByOwn(player, 0, piece) ? 0 : null;
    }

    const to = from + die;

    if (to > FINISHED)
    {
        return null;
    }

    if (occupiedByOwn(player, to, piece))
    {
        return null;
    }

    if (to >= RING_STEPS && blockedInHome(player, from, to, piece))
    {
        return null;
    }

    return to;
}

export function legalMoves(state: LudoState): number[]
{
    if (state.winner !== null || state.die === null)
    {
        return [];
    }

    const player = state.players[state.turn];

    if (player.out)
    {
        return [];
    }

    const moves: number[] = [];
    let entered = false;

    for (let piece = 0; piece < player.pieces.length; piece += 1)
    {
        if (destination(player, piece, state.die) === null)
        {
            continue;
        }

        if (player.pieces[piece] === YARD)
        {
            if (entered)
            {
                continue;
            }

            entered = true;
        }

        moves.push(piece);
    }

    return moves;
}

function captureAt(state: LudoState, mover: number, progress: number, events: GameEvent[]): void
{
    if (progress >= RING_STEPS)
    {
        return;
    }

    const player = state.players[mover];
    const square = ringIndex(player.colour, progress);

    if (isSafeRing(square))
    {
        return;
    }

    for (let other = 0; other < state.players.length; other += 1)
    {
        if (other === mover)
        {
            continue;
        }

        const victim = state.players[other];

        for (let piece = 0; piece < victim.pieces.length; piece += 1)
        {
            const at = victim.pieces[piece];

            if (at < 0 || at >= RING_STEPS)
            {
                continue;
            }

            if (ringIndex(victim.colour, at) !== square)
            {
                continue;
            }

            victim.pieces[piece] = YARD;
            events.push({ e: 'capture', seat: player.seat, piece: mover, victim: victim.seat, victimPiece: piece });
        }
    }
}

function finish(state: LudoState, events: GameEvent[]): void
{
    const playing = active(state);

    if (playing.length === 1)
    {
        state.winner = playing[0];
        state.die = null;
        events.push({ e: 'finish', winner: state.players[playing[0]].seat });
    }
}

function roll(state: LudoState, seat: number, die: number, events: GameEvent[]): void
{
    const player = state.players[state.turn];

    state.die = die;
    events.push({ e: 'roll', seat, die });

    if (die === 6)
    {
        state.sixes += 1;

        if (state.sixes >= MAX_SIXES)
        {
            events.push({ e: 'pass', seat, why: 'three-sixes' });
            advance(state);
            return;
        }
    }

    if (legalMoves(state).length > 0)
    {
        return;
    }

    const caged = player.pieces.every((at) => at === YARD);

    if (caged && die !== 6)
    {
        state.tries += 1;

        if (state.tries < MAX_TRIES)
        {
            state.die = null;
            return;
        }

        events.push({ e: 'pass', seat, why: 'no-six' });
        advance(state);
        return;
    }

    events.push({ e: 'pass', seat, why: 'no-move' });
    advance(state);
}

function move(state: LudoState, seat: number, piece: number, events: GameEvent[]): void
{
    const player = state.players[state.turn];
    const die = state.die ?? 0;
    const from = player.pieces[piece];
    const to = destination(player, piece, die) ?? from;

    player.pieces[piece] = to;

    if (from === YARD)
    {
        events.push({ e: 'enter', seat, piece });
    }
    else
    {
        events.push({ e: 'step', seat, piece, from, to });
    }

    captureAt(state, state.turn, to, events);

    if (to === FINISHED)
    {
        events.push({ e: 'home', seat, piece });
    }

    if (player.pieces.every((at) => at === FINISHED))
    {
        state.winner = state.turn;
        state.die = null;
        events.push({ e: 'finish', winner: seat });
        return;
    }

    if (die === 6 && state.sixes < MAX_SIXES)
    {
        state.die = null;
        state.tries = 0;
        return;
    }

    advance(state);
}

export function apply(state: LudoState, action: EngineAction): Outcome
{
    if (state.winner !== null)
    {
        return { ok: false, reason: 'game-over' };
    }

    const index = indexOfSeat(state, action.seat);

    if (index < 0 || state.players[index].out)
    {
        return { ok: false, reason: 'not-playing' };
    }

    if (action.kind === 'forfeit')
    {
        const next = clone(state);
        const events: GameEvent[] = [];
        const player = next.players[index];

        player.out = true;
        player.pieces = player.pieces.map(() => YARD);
        events.push({ e: 'forfeit', seat: action.seat, reason: action.reason });

        if (next.turn === index)
        {
            advance(next);
        }

        finish(next, events);
        next.rev = state.rev + 1;

        return { ok: true, state: next, events };
    }

    if (index !== state.turn)
    {
        return { ok: false, reason: 'not-your-turn' };
    }

    if (action.kind === 'roll')
    {
        if (state.die !== null)
        {
            return { ok: false, reason: 'already-rolled' };
        }

        if (action.die < 1 || action.die > 6 || !Number.isInteger(action.die))
        {
            return { ok: false, reason: 'illegal-move' };
        }

        const next = clone(state);
        const events: GameEvent[] = [];

        roll(next, action.seat, action.die, events);
        next.rev = state.rev + 1;

        return { ok: true, state: next, events };
    }

    if (state.die === null)
    {
        return { ok: false, reason: 'must-roll-first' };
    }

    if (!legalMoves(state).includes(action.piece))
    {
        return { ok: false, reason: 'illegal-move' };
    }

    const next = clone(state);
    const events: GameEvent[] = [];

    move(next, action.seat, action.piece, events);
    next.rev = state.rev + 1;

    return { ok: true, state: next, events };
}
