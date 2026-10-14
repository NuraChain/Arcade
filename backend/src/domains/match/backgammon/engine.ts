import { CHECKERS, OFF, START, type Side } from './board.ts';
import { cubeLive, mayDouble } from './cube.ts';
import { diceOf, longest, settle, turns } from './moves.ts';
import { VALUE, crawfordAfter, kindOf, type GameKind } from './scoring.ts';
import type { BackgammonAction, BackgammonEvent, BackgammonRefusal, BackgammonState } from './state.ts';

export const SEATS: readonly number[] = [2];

export const UNTHROWN = 0;

export type Die = (sides: number) => number;

export type Outcome =
    | { ok: true; state: BackgammonState; events: BackgammonEvent[] }
    | { ok: false; reason: BackgammonRefusal };

export function sideOf(state: BackgammonState, seat: number): Side
{
    return { me: state.checkers[seat], them: state.checkers[1 - seat] };
}

function withSide(state: BackgammonState, seat: number, side: Side): BackgammonState
{
    const checkers = [...state.checkers];

    checkers[seat] = side.me;
    checkers[1 - seat] = side.them;

    return { ...state, checkers };
}

function begin(state: BackgammonState, seat: number): BackgammonState
{
    return { ...state, turn: seat, phase: 'roll', dice: [], turns: state.turns + 1 };
}

function rolled(state: BackgammonState, seat: number, dice: number[], events: BackgammonEvent[])
{
    const next: BackgammonState = { ...state, turn: seat, phase: 'move', dice };

    if (longest(sideOf(next, seat), diceOf(dice)) > 0)
    {
        return next;
    }

    events.push({ e: 'pass', seat });

    return begin(next, 1 - seat);
}

function opening(state: BackgammonState): BackgammonState
{
    return { ...state, turn: 0, phase: 'opening', dice: [], thrown: [UNTHROWN, UNTHROWN], turns: state.turns + 1 };
}

export function create(target: number, cube: boolean)
{
    const events: BackgammonEvent[] = [];
    const state = opening({
        v: 1,
        game: 'backgammon',
        rev: 1,
        target,
        cubed: cubeLive(target, cube),
        score: [0, 0],
        round: 1,
        crawford: 'before',
        checkers: [[...START], [...START]],
        turn: 0,
        phase: 'opening',
        dice: [],
        thrown: [UNTHROWN, UNTHROWN],
        cube: 1,
        owner: null,
        turns: 0,
        winner: null
    });

    return { state, events };
}

function endGame(state: BackgammonState, winner: number, how: GameKind, events: BackgammonEvent[]): BackgammonState
{
    const points = VALUE[how] * state.cube;
    const score = [...state.score];

    score[winner] += points;
    events.push({ e: 'game', seat: winner, how, points, cube: state.cube });

    if (score[winner] >= state.target)
    {
        events.push({ e: 'finish', seat: winner });

        return { ...state, score, winner, phase: 'roll', dice: [] };
    }

    return opening({
        ...state,
        score,
        crawford: crawfordAfter(state.crawford, score[winner], state.target),
        round: state.round + 1,
        checkers: [[...START], [...START]],
        cube: 1,
        owner: null
    });
}

function refuse(reason: BackgammonRefusal): Outcome
{
    return { ok: false, reason };
}

function throwing(state: BackgammonState, next: BackgammonState, action: BackgammonAction, die: Die): Outcome
{
    if (action.kind !== 'roll')
    {
        return refuse(action.kind === 'move' ? 'must-roll-first' : (action.kind === 'double' ? 'cannot-double' : 'no-double'));
    }

    if (state.thrown[action.seat] !== UNTHROWN)
    {
        return refuse('already-rolled');
    }

    const thrown = [...state.thrown];

    thrown[action.seat] = die(6);

    const events: BackgammonEvent[] = [{ e: 'throw', seat: action.seat, die: thrown[action.seat] }];
    const waiting = thrown.indexOf(UNTHROWN);

    if (waiting >= 0)
    {
        return { ok: true, state: { ...next, thrown, turn: waiting }, events };
    }

    if (thrown[0] === thrown[1])
    {
        events.push({ e: 'tie', dice: thrown });

        return { ok: true, state: opening(next), events };
    }

    const seat = thrown[0] > thrown[1] ? 0 : 1;

    events.push({ e: 'opening', seat, dice: thrown });

    return { ok: true, state: rolled({ ...next, thrown: [UNTHROWN, UNTHROWN], turns: next.turns + 1 }, seat, thrown, events), events };
}

function answer(state: BackgammonState, next: BackgammonState, action: BackgammonAction): Outcome
{
    if (action.seat === state.turn)
    {
        return refuse('not-your-turn');
    }

    const events: BackgammonEvent[] = [];

    if (action.kind === 'take')
    {
        const cube = state.cube * 2;

        events.push({ e: 'take', seat: action.seat, cube });

        return { ok: true, state: begin({ ...next, cube, owner: action.seat }, state.turn), events };
    }

    if (action.kind === 'drop')
    {
        events.push({ e: 'drop', seat: action.seat });

        return { ok: true, state: endGame(next, state.turn, 'single', events), events };
    }

    return refuse('double-pending');
}

function waitingToRoll(state: BackgammonState, next: BackgammonState, action: BackgammonAction, die: Die): Outcome
{
    const events: BackgammonEvent[] = [];

    if (action.kind === 'roll')
    {
        const dice = [die(6), die(6)];

        events.push({ e: 'roll', seat: action.seat, dice });

        return { ok: true, state: rolled(next, action.seat, dice, events), events };
    }

    if (action.kind === 'double')
    {
        if (!mayDouble(state, action.seat))
        {
            return refuse('cannot-double');
        }

        events.push({ e: 'double', seat: action.seat, cube: state.cube * 2 });

        return { ok: true, state: { ...next, phase: 'double' }, events };
    }

    return refuse(action.kind === 'move' ? 'must-roll-first' : 'no-double');
}

function moving(state: BackgammonState, next: BackgammonState, action: BackgammonAction): Outcome
{
    if (action.kind !== 'move')
    {
        return refuse(action.kind === 'roll' || action.kind === 'double' ? 'already-rolled' : 'no-double');
    }

    const settled = settle(sideOf(state, action.seat), state.dice, action.hops);

    if (settled === null)
    {
        return refuse('illegal-move');
    }

    const events: BackgammonEvent[] = settled.played.map((played) => ({ e: 'move' as const, seat: action.seat, ...played }));
    const moved = withSide(next, action.seat, settled.side);

    if (settled.side.me[OFF] === CHECKERS)
    {
        return { ok: true, state: endGame(moved, action.seat, kindOf(settled.side.them), events), events };
    }

    return { ok: true, state: begin(moved, 1 - action.seat), events };
}

export function apply(state: BackgammonState, action: BackgammonAction, die: Die): Outcome
{
    if (state.winner !== null)
    {
        return refuse('game-over');
    }

    if (action.seat !== 0 && action.seat !== 1)
    {
        return refuse('not-playing');
    }

    if (action.kind === 'forfeit')
    {
        const winner = 1 - action.seat;

        return {
            ok: true,
            state: { ...state, rev: state.rev + 1, winner },
            events: [{ e: 'forfeit', seat: action.seat, reason: action.reason }, { e: 'finish', seat: winner }]
        };
    }

    const next: BackgammonState = { ...state, rev: state.rev + 1 };

    if (state.phase === 'opening')
    {
        return throwing(state, next, action, die);
    }

    if (state.phase === 'double')
    {
        return answer(state, next, action);
    }

    if (action.seat !== state.turn)
    {
        return refuse('not-your-turn');
    }

    return state.phase === 'roll' ? waitingToRoll(state, next, action, die) : moving(state, next, action);
}

export function legalMoves(state: BackgammonState, seat: number): BackgammonAction[]
{
    if (state.winner !== null)
    {
        return [];
    }

    if (state.phase === 'opening')
    {
        return state.thrown[seat] === UNTHROWN ? [{ kind: 'roll', seat }] : [];
    }

    if (state.phase === 'double')
    {
        return seat === 1 - state.turn ? [{ kind: 'take', seat }, { kind: 'drop', seat }] : [];
    }

    if (seat !== state.turn)
    {
        return [];
    }

    if (state.phase === 'roll')
    {
        return mayDouble(state, seat) ? [{ kind: 'roll', seat }, { kind: 'double', seat }] : [{ kind: 'roll', seat }];
    }

    return turns(sideOf(state, seat), state.dice).map((hops) => ({ kind: 'move', seat, hops }));
}

export function autoplay(state: BackgammonState, seat: number): BackgammonAction | null
{
    if (state.winner !== null)
    {
        return null;
    }

    if (state.phase === 'opening')
    {
        return state.thrown[seat] === UNTHROWN ? { kind: 'roll', seat } : null;
    }

    if (state.phase === 'double')
    {
        return seat === 1 - state.turn ? { kind: 'drop', seat } : null;
    }

    if (seat !== state.turn)
    {
        return null;
    }

    return state.phase === 'roll' ? { kind: 'roll', seat } : (legalMoves(state, seat)[0] ?? null);
}
