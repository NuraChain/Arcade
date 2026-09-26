import { DECK } from '../cards/cards.ts';
import { actors, allInTo, inHand, mayRaise, minRaiseTo, nextAlive, nextToAct, needsToAct, toCall } from './betting.ts';
import { evaluate, type Strength } from './evaluator.ts';
import { layers, leftOf, split, uncalled } from './pots.ts';
import {
    HANDS_PER_LEVEL,
    OPENING,
    STACK,
    blindsAt,
    type Exit,
    type PokerAction,
    type PokerEvent,
    type PokerRefusal,
    type PokerState,
    type Shown,
    type Street,
    type Won
} from './state.ts';

export type Die = (sides: number) => number;

export type Applied =
    | { ok: true; state: PokerState; events: PokerEvent[] }
    | { ok: false; reason: PokerRefusal };

const NEXT_STREET: Readonly<Record<Street, Street>> = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'river' };

const SETTLE_LIMIT = 1000;

export function levelOf(state: PokerState): number
{
    return state.opening + Math.floor((Math.max(1, state.hand) - 1) / HANDS_PER_LEVEL);
}

export function handsToNextLevel(state: PokerState): number
{
    return HANDS_PER_LEVEL - ((Math.max(1, state.hand) - 1) % HANDS_PER_LEVEL);
}

export function chipsInPlay(state: PokerState): number
{
    return state.stacks.reduce((sum, chips) => sum + chips, 0) + state.put.reduce((sum, chips) => sum + chips, 0) + state.gone;
}

function draw(state: PokerState, die: Die): number
{
    const used = new Set([...state.holes.flat(), ...state.board]);
    const remaining = DECK.filter((card) => !used.has(card));
    const pick = Math.min(remaining.length, Math.max(1, Math.floor(die(remaining.length))));

    return remaining[pick - 1];
}

function commit(state: PokerState, seat: number, chips: number): void
{
    state.stacks[seat] -= chips;
    state.bets[seat] += chips;
    state.put[seat] += chips;
}

function raiseTo(state: PokerState, seat: number, to: number): void
{
    const increment = to - state.current;

    if (increment >= state.raise)
    {
        state.raise = increment;
    }

    state.current = to;
    commit(state, seat, to - state.bets[seat]);
}

function alive(state: PokerState): number[]
{
    return state.out.map((_, seat) => seat).filter((seat) => !state.out[seat]);
}

function startHand(state: PokerState, events: PokerEvent[], die: Die): void
{
    if (state.hand > 0)
    {
        state.button = nextAlive(state, state.button);
    }

    state.hand += 1;

    const { small, big } = blindsAt(levelOf(state));

    state.street = 'preflop';
    state.board = [];
    state.holes = state.out.map(() => []);
    state.bets = state.out.map(() => 0);
    state.put = state.out.map(() => 0);
    state.start = [...state.stacks];
    state.folded = [...state.out];
    state.faced = state.out.map(() => -1);

    events.push({ e: 'deal', hand: state.hand, button: state.button, small, big });

    const sb = alive(state).length === 2 ? state.button : nextAlive(state, state.button);
    const bb = nextAlive(state, sb);

    for (const [seat, amount] of [[sb, small], [bb, big]] as const)
    {
        const chips = Math.min(amount, state.stacks[seat]);

        commit(state, seat, chips);
        events.push({ e: 'blind', seat, amount: chips });
    }

    state.current = big;
    state.raise = big;

    const order = leftOf(state.button, state.seats);
    const dealt = alive(state).sort((a, b) => order(a) - order(b));

    for (let round = 0; round < 2; round += 1)
    {
        for (const seat of dealt)
        {
            state.holes[seat].push(draw(state, die));
        }
    }

    for (const seat of dealt)
    {
        events.push({ e: 'hole', seat, cards: [...state.holes[seat]] });
    }

    state.turn = nextToAct(state, bb) ?? bb;
}

function dealStreet(state: PokerState, events: PokerEvent[], die: Die): void
{
    const count = state.street === 'preflop' ? 3 : 1;
    const cards: number[] = [];

    state.street = NEXT_STREET[state.street];

    for (let card = 0; card < count; card += 1)
    {
        const next = draw(state, die);

        state.board.push(next);
        cards.push(next);
    }

    events.push({ e: 'board', street: state.street, cards });
}

function closeRound(state: PokerState): void
{
    state.bets = state.bets.map(() => 0);
    state.faced = state.faced.map(() => -1);
    state.current = 0;
    state.raise = blindsAt(levelOf(state)).big;
}

function bust(state: PokerState, events: PokerEvent[], won: readonly (Won & { eligible: number[] })[]): void
{
    const busted = alive(state).filter((seat) => state.stacks[seat] === 0);
    const remaining = alive(state).length - busted.length;

    for (const seat of busted)
    {
        const better = busted.filter((other) => state.start[other] > state.start[seat]).length;
        const place = remaining + 1 + better;
        const last = [...won].reverse().find((pot) => pot.eligible.includes(seat));

        state.places[seat] = place;
        state.exits[seat] = 'chips';
        events.push({ e: 'bust', seat, place, by: last === undefined ? [] : [...last.winners] });
    }

    for (const seat of busted)
    {
        state.out[seat] = true;
        state.folded[seat] = true;
    }
}

function finishHand(state: PokerState, events: PokerEvent[], showdown: boolean): void
{
    const refund = uncalled(state.put, state.folded);

    if (refund !== null)
    {
        state.stacks[refund.seat] += refund.amount;
        state.put[refund.seat] -= refund.amount;
        events.push({ e: 'refund', seat: refund.seat, amount: refund.amount });
    }

    const order = leftOf(state.button, state.seats);
    const contenders = state.out.map((_, seat) => seat).filter((seat) => inHand(state, seat)).sort((a, b) => order(a) - order(b));
    const strengths = new Map<number, Strength>();
    const shown: Shown[] = [];

    if (showdown && contenders.length > 1)
    {
        for (const seat of contenders)
        {
            const strength = evaluate([...state.holes[seat], ...state.board]);

            strengths.set(seat, strength);
            shown.push({ seat, cards: [...state.holes[seat]], category: strength.category });
            events.push({ e: 'show', seat, cards: [...state.holes[seat]], category: strength.category });
        }
    }

    const won: (Won & { eligible: number[] })[] = [];

    for (const pot of layers(state.put, state.folded))
    {
        const top = Math.max(...pot.eligible.map((seat) => strengths.get(seat)?.score ?? 0));
        const winners = pot.eligible.length === 1
            ? [...pot.eligible]
            : pot.eligible.filter((seat) => (strengths.get(seat)?.score ?? 0) === top);

        for (const [seat, chips] of split(pot.amount, winners, order))
        {
            state.stacks[seat] += chips;
        }

        won.push({ amount: pot.amount, winners: [...winners].sort((a, b) => order(a) - order(b)), eligible: pot.eligible });
        events.push({ e: 'pot', amount: pot.amount, winners: [...winners].sort((a, b) => order(a) - order(b)) });
    }

    state.put = state.put.map(() => 0);
    state.bets = state.bets.map(() => 0);
    state.last = { board: [...state.board], shown, pots: won.map((pot) => ({ amount: pot.amount, winners: pot.winners })) };

    events.push({ e: 'end', hand: state.hand, dealt: state.holes.map((cards, seat) => (cards.length > 0 ? seat : -1)).filter((seat) => seat >= 0) });

    bust(state, events, won);

    const standing = alive(state);

    if (standing.length === 1)
    {
        state.winner = standing[0];
        state.places[standing[0]] = 1;
        state.turn = -1;
        events.push({ e: 'finish', seat: standing[0] });
    }
}

function settle(state: PokerState, events: PokerEvent[], die: Die): void
{
    for (let guard = 0; guard < SETTLE_LIMIT; guard += 1)
    {
        if (state.winner !== null)
        {
            return;
        }

        const holding = state.out.map((_, seat) => seat).filter((seat) => inHand(state, seat));

        if (holding.length <= 1)
        {
            finishHand(state, events, false);

            if (state.winner === null)
            {
                startHand(state, events, die);
            }

            continue;
        }

        if (state.turn >= 0 && needsToAct(state, state.turn))
        {
            return;
        }

        const next = nextToAct(state, Math.max(0, state.turn));

        if (next !== null)
        {
            state.turn = next;
            return;
        }

        closeRound(state);

        if (state.street === 'river' || actors(state).length <= 1)
        {
            while (state.board.length < 5)
            {
                dealStreet(state, events, die);
            }

            finishHand(state, events, true);

            if (state.winner === null)
            {
                startHand(state, events, die);
            }

            continue;
        }

        dealStreet(state, events, die);
        state.turn = nextToAct(state, state.button) ?? state.button;
    }
}

function refuse(reason: PokerRefusal): Applied
{
    return { ok: false, reason };
}

function act(state: PokerState, action: Exclude<PokerAction, { kind: 'forfeit' }>, events: PokerEvent[]): PokerRefusal | null
{
    const seat = action.seat;
    const owe = toCall(state, seat);

    if (action.kind === 'fold')
    {
        state.folded[seat] = true;
        events.push({ e: 'fold', seat, amount: 0 });
    }
    else if (action.kind === 'check')
    {
        if (owe > 0)
        {
            return 'cannot-check';
        }

        events.push({ e: 'check', seat, amount: 0 });
    }
    else if (action.kind === 'call')
    {
        if (owe === 0)
        {
            return 'nothing-to-call';
        }

        commit(state, seat, owe);
        events.push({ e: 'call', seat, amount: owe });
    }
    else if (action.kind === 'raise')
    {
        if (!mayRaise(state, seat))
        {
            return 'cannot-raise';
        }

        if (!Number.isInteger(action.amount) || action.amount < minRaiseTo(state, seat))
        {
            return 'raise-too-small';
        }

        if (action.amount > allInTo(state, seat))
        {
            return 'raise-too-large';
        }

        raiseTo(state, seat, action.amount);
        events.push({ e: 'raise', seat, amount: action.amount });
    }
    else
    {
        const to = allInTo(state, seat);

        if (to > state.current)
        {
            if (!mayRaise(state, seat))
            {
                return 'cannot-raise';
            }

            raiseTo(state, seat, to);
        }
        else
        {
            commit(state, seat, state.stacks[seat]);
        }

        events.push({ e: 'allin', seat, amount: to });
    }

    state.faced[seat] = state.current;
    state.acts[seat] += 1;

    return null;
}

function forfeit(state: PokerState, seat: number, reason: Exit, events: PokerEvent[]): void
{
    const place = alive(state).length;

    state.places[seat] = place;
    state.exits[seat] = reason;
    state.out[seat] = true;
    state.folded[seat] = true;
    state.gone += state.stacks[seat];
    state.stacks[seat] = 0;
    events.push({ e: 'forfeit', seat, reason, place });
}

export function create(seats: number, blinds: keyof typeof OPENING, die: Die): PokerState
{
    const state: PokerState = {
        v: 1,
        game: 'poker',
        rev: 0,
        seats,
        opening: OPENING[blinds],
        hand: 0,
        button: Math.min(seats, Math.max(1, Math.floor(die(seats)))) - 1,
        street: 'preflop',
        board: [],
        holes: Array.from({ length: seats }, () => []),
        stacks: Array.from({ length: seats }, () => STACK),
        bets: Array.from({ length: seats }, () => 0),
        put: Array.from({ length: seats }, () => 0),
        start: Array.from({ length: seats }, () => STACK),
        folded: Array.from({ length: seats }, () => false),
        faced: Array.from({ length: seats }, () => -1),
        current: 0,
        raise: 0,
        turn: -1,
        out: Array.from({ length: seats }, () => false),
        exits: Array.from({ length: seats }, () => null),
        places: Array.from({ length: seats }, () => null),
        acts: Array.from({ length: seats }, () => 0),
        gone: 0,
        last: null,
        winner: null
    };

    startHand(state, [], die);
    settle(state, [], die);

    return state;
}

export function apply(state: PokerState, action: PokerAction, die: Die): Applied
{
    if (state.winner !== null)
    {
        return refuse('game-over');
    }

    const seat = action.seat;

    if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats || state.out[seat])
    {
        return refuse('not-playing');
    }

    const next = structuredClone(state);
    const events: PokerEvent[] = [];

    if (action.kind === 'forfeit')
    {
        forfeit(next, seat, action.reason, events);
    }
    else
    {
        if (seat !== state.turn)
        {
            return refuse('not-your-turn');
        }

        const refusal = act(next, action, events);

        if (refusal !== null)
        {
            return refuse(refusal);
        }
    }

    settle(next, events, die);
    next.rev = state.rev + 1;

    return { ok: true, state: next, events };
}

export function legalMoves(state: PokerState, seat: number): PokerAction[]
{
    if (state.winner !== null || seat !== state.turn)
    {
        return [];
    }

    const moves: PokerAction[] = toCall(state, seat) === 0
        ? [{ kind: 'check', seat }]
        : [{ kind: 'fold', seat }, { kind: 'call', seat }];

    if (mayRaise(state, seat))
    {
        const low = minRaiseTo(state, seat);

        if (low < allInTo(state, seat))
        {
            moves.push({ kind: 'raise', seat, amount: low });
        }

        moves.push({ kind: 'allin', seat });
    }

    return moves;
}

export function autoplay(state: PokerState, seat: number): PokerAction | null
{
    if (state.winner !== null || seat !== state.turn)
    {
        return null;
    }

    return toCall(state, seat) === 0 ? { kind: 'check', seat } : { kind: 'fold', seat };
}

export function standings(state: PokerState): { seat: number; place: number }[]
{
    return state.stacks.map((stack, seat) =>
    {
        const fixed = state.places[seat];

        if (fixed !== null)
        {
            return { seat, place: fixed };
        }

        const ahead = alive(state).filter((other) => state.stacks[other] > stack).length;

        return { seat, place: ahead + 1 };
    });
}
