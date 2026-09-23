import { CHECKERS, OFF, START, type Side } from './board.ts';
import { cubeLive, mayDouble } from './cube.ts';
import { diceOf, longest, settle, turns } from './moves.ts';
import { VALUE, crawfordAfter, kindOf, type GameKind } from './scoring.ts';
import type { BackgammonAction, BackgammonEvent, BackgammonRefusal, BackgammonState } from './state.ts';

export const SEATS: readonly number[] = [2];

export type Die = (sides: number) => number;

export type Outcome =
    | { ok: true; state: BackgammonState; events: BackgammonEvent[] }
    | { ok: false; reason: BackgammonRefusal };

const OPENING_TRIES = 16;

const PASS_LIMIT = 8;

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

function rolled(state: BackgammonState, seat: number, dice: number[], die: Die, events: BackgammonEvent[], passes: number): BackgammonState
{
    const next: BackgammonState = { ...state, turn: seat, phase: 'move', dice };

    if (longest(sideOf(next, seat), diceOf(dice)) > 0)
    {
        return next;
    }

    events.push({ e: 'pass', seat });

    return begin(next, 1 - seat, die, events, passes + 1);
}

function begin(state: BackgammonState, seat: number, die: Die, events: BackgammonEvent[], passes = 0): BackgammonState
{
    const waiting: BackgammonState = { ...state, turn: seat, phase: 'roll', dice: [] };

    if (passes >= PASS_LIMIT || mayDouble(waiting, seat))
    {
        return waiting;
    }

    const dice = [die(6), die(6)];

    events.push({ e: 'roll', seat, dice });

    return rolled(waiting, seat, dice, die, events, passes);
}

function opening(state: BackgammonState, die: Die, events: BackgammonEvent[]): BackgammonState
{
    for (let tries = 0; tries < OPENING_TRIES; tries += 1)
    {
        const first = die(6);
        const second = die(6);

        if (first !== second)
        {
            const seat = first > second ? 0 : 1;

            events.push({ e: 'opening', seat, dice: [first, second] });

            return rolled(state, seat, [first, second], die, events, 0);
        }
    }

    const seat = die(2) - 1;
    const dice = [die(6), die(6)];

    events.push({ e: 'opening', seat, dice });

    return rolled(state, seat, dice, die, events, 0);
}

export function create(target: number, cube: boolean, die: Die): BackgammonState
{
    return opening({
        v: 1,
        game: 'backgammon',
        rev: 0,
        target,
        cubed: cubeLive(target, cube),
        score: [0, 0],
        round: 1,
        crawford: 'before',
        checkers: [[...START], [...START]],
        turn: 0,
        phase: 'roll',
        dice: [],
        cube: 1,
        owner: null,
        acted: [0, 0],
        winner: null
    }, die, []);
}

function endGame(state: BackgammonState, winner: number, how: GameKind, die: Die, events: BackgammonEvent[]): BackgammonState
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
    }, die, events);
}

function refuse(reason: BackgammonRefusal): Outcome
{
    return { ok: false, reason };
}

function answer(state: BackgammonState, next: BackgammonState, action: BackgammonAction, die: Die): Outcome
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

        return { ok: true, state: begin({ ...next, cube, owner: action.seat }, state.turn, die, events), events };
    }

    if (action.kind === 'drop')
    {
        events.push({ e: 'drop', seat: action.seat });

        return { ok: true, state: endGame(next, state.turn, 'single', die, events), events };
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

        return { ok: true, state: rolled(next, action.seat, dice, die, events, 0), events };
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

function moving(state: BackgammonState, next: BackgammonState, action: BackgammonAction, die: Die): Outcome
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
        return { ok: true, state: endGame(moved, action.seat, kindOf(settled.side.them), die, events), events };
    }

    return { ok: true, state: begin(moved, 1 - action.seat, die, events), events };
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

    const acted = [...state.acted];

    acted[action.seat] += 1;

    const next: BackgammonState = { ...state, rev: state.rev + 1, acted };

    if (state.phase === 'double')
    {
        return answer(state, next, action, die);
    }

    if (action.seat !== state.turn)
    {
        return refuse('not-your-turn');
    }

    return state.phase === 'roll' ? waitingToRoll(state, next, action, die) : moving(state, next, action, die);
}

export function legalMoves(state: BackgammonState, seat: number): BackgammonAction[]
{
    if (state.winner !== null)
    {
        return [];
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
