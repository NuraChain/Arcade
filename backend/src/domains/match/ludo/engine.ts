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
 * The ruleset is the one written down for this product (`docs/games/04-ludo.md`) - Variant B, the
 * common Iranian rules, with the owner's decisions of 2026-10-05. Two of a player's own tokens on a
 * ring square are a block (D28): no opponent lands on it or passes it, its owner passes freely, no
 * third token joins, and a start square holds one token of its own colour. A six with no legal move
 * still earns the extra roll; only a non-six with nothing to do ends the turn. There is no "three
 * tries to find a six" - a full yard rolling one to five simply passes. And entering is a choice
 * among the legal moves, with any yard token eligible on any six.
 *
 * The rest: capture on exact landing only, never by passing over; eight starred squares where no
 * landing sends anybody home, except that a token coming out of its yard sends home every opponent
 * on its own start square, a block included (D27); an exact count into the five home cells, with an overshoot simply absent
 * from the legal set; three consecutive sixes end the turn and the third grants no roll; a
 * capture or a finish on a six still earns the roll.
 */

import {
    FINISHED,
    RING_STEPS,
    TOKENS_PER_PLAYER,
    YARD,
    capturesAt,
    coloursFor,
    obstacle,
    ringIndex,
    type LudoColour
} from './board.ts';
import type { EngineAction, GameEvent, LudoPlayer, LudoState, Outcome } from './state.ts';

const MAX_SIXES = 3;

export function create(seats: readonly number[], first: number, sides: readonly number[]): LudoState
{
    const ordered = seats.map((seat, index) => ({ seat, side: sides[index] })).sort((a, b) => a.seat - b.seat);
    const colours = coloursFor(ordered.length);

    const players: LudoPlayer[] = ordered.map(({ seat, side }, index) => ({
        seat,
        colour: colours[index] as LudoColour,
        pieces: Array.from({ length: TOKENS_PER_PLAYER }, () => YARD),
        out: false,
        side
    }));

    return {
        v: 1,
        game: 'ludo',
        players,
        turn: first % players.length,
        die: null,
        sixes: 0,
        rev: 1,
        winner: null
    };
}

export function indexOfSeat(state: LudoState, seat: number)
{
    return state.players.findIndex((player) => player.seat === seat);
}

export function isOver(state: LudoState)
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

function active(state: LudoState)
{
    return state.players
        .map((player, index) => (player.out ? -1 : index))
        .filter((index) => index >= 0);
}

const home = (player: LudoPlayer) => player.pieces.every((at) => at === FINISHED);

const membersOf = (state: LudoState, side: number) => state.players.filter((player) => player.side === side);

export function controlled(state: LudoState)
{
    const player = state.players[state.turn];
    const partner = state.players.findIndex((other, index) => index !== state.turn && other.side === player.side);

    return home(player) && partner >= 0 ? partner : state.turn;
}

function advance(state: LudoState)
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
        return die === 6 ? 0 : null;
    }

    const to = from + die;

    return to > FINISHED ? null : to;
}

export function legalMoves(state: LudoState): number[]
{
    if (state.winner !== null || state.die === null)
    {
        return [];
    }

    if (state.players[state.turn].out)
    {
        return [];
    }

    const mover = controlled(state);
    const player = state.players[mover];
    const moves: number[] = [];
    let entered = false;

    for (let piece = 0; piece < player.pieces.length; piece += 1)
    {
        const to = destination(player, piece, state.die);

        if (to === null || obstacle(state.players, mover, piece, to) !== null)
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

function entering(state: LudoState, piece: number)
{
    const pieces = state.players[controlled(state)].pieces;

    return pieces[piece] === YARD ? pieces.indexOf(YARD) : piece;
}

function captureAt(state: LudoState, seat: number, mover: number, moving: number, progress: number, events: GameEvent[])
{
    const player = state.players[mover];

    if (!capturesAt(player.colour, progress))
    {
        return;
    }

    const square = ringIndex(player.colour, progress);

    for (const victim of state.players)
    {
        if (victim.side === player.side)
        {
            continue;
        }

        for (let token = 0; token < victim.pieces.length; token += 1)
        {
            const at = victim.pieces[token];

            if (at < 0 || at >= RING_STEPS)
            {
                continue;
            }

            if (ringIndex(victim.colour, at) !== square)
            {
                continue;
            }

            victim.pieces[token] = YARD;
            events.push({ e: 'capture', seat, owner: player.seat, piece: moving, victim: victim.seat, victimPiece: token });
        }
    }
}

function won(state: LudoState, side: number, events: GameEvent[])
{
    state.winner = side;
    state.die = null;
    events.push({ e: 'finish', side, seats: membersOf(state, side).map((player) => player.seat) });
}

function finish(state: LudoState, events: GameEvent[])
{
    const live = [...new Set(state.players.map((player) => player.side))]
        .filter((side) => membersOf(state, side).every((player) => !player.out));

    if (live.length === 1)
    {
        won(state, live[0], events);
    }
}

function roll(state: LudoState, seat: number, die: number, events: GameEvent[])
{
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

    if (die === 6)
    {
        state.die = null;
        return;
    }

    events.push({ e: 'pass', seat, why: 'no-move' });
    advance(state);
}

function move(state: LudoState, seat: number, piece: number, events: GameEvent[])
{
    const mover = controlled(state);
    const player = state.players[mover];
    const owner = player.seat;
    const die = state.die ?? 0;
    const from = player.pieces[piece];
    const to = destination(player, piece, die) ?? from;

    player.pieces[piece] = to;

    if (from === YARD)
    {
        events.push({ e: 'enter', seat, owner, piece });
    }
    else
    {
        events.push({ e: 'step', seat, owner, piece, from, to });
    }

    captureAt(state, seat, mover, piece, to, events);

    if (to === FINISHED)
    {
        events.push({ e: 'home', seat, owner, piece });
    }

    if (membersOf(state, player.side).every(home))
    {
        won(state, player.side, events);
        return;
    }

    if (die === 6 && state.sixes < MAX_SIXES)
    {
        state.die = null;
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
        events.push({ e: 'forfeit', seat: action.seat, reason: action.reason });
        finish(next, events);

        if (next.winner === null)
        {
            player.pieces = player.pieces.map(() => YARD);

            if (next.turn === index)
            {
                advance(next);
            }
        }

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

    const piece = entering(state, action.piece);

    if (!legalMoves(state).includes(piece))
    {
        return { ok: false, reason: 'illegal-move' };
    }

    const next = clone(state);
    const events: GameEvent[] = [];

    move(next, action.seat, piece, events);
    next.rev = state.rev + 1;

    return { ok: true, state: next, events };
}
