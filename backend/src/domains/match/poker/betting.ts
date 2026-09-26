import type { PokerState } from './state.ts';

export function inHand(state: PokerState, seat: number): boolean
{
    return !state.out[seat] && !state.folded[seat];
}

export function actors(state: PokerState): number[]
{
    return state.stacks.map((_, seat) => seat).filter((seat) => inHand(state, seat) && state.stacks[seat] > 0);
}

export function nextAlive(state: PokerState, from: number): number
{
    for (let step = 1; step <= state.seats; step += 1)
    {
        const seat = (from + step) % state.seats;

        if (!state.out[seat])
        {
            return seat;
        }
    }

    return from;
}

export function toCall(state: PokerState, seat: number): number
{
    return Math.max(0, Math.min(state.current - state.bets[seat], state.stacks[seat]));
}

export function allInTo(state: PokerState, seat: number): number
{
    return state.bets[seat] + state.stacks[seat];
}

export function minRaiseTo(state: PokerState, seat: number): number
{
    return Math.min(state.current + state.raise, allInTo(state, seat));
}

export function mayRaise(state: PokerState, seat: number): boolean
{
    const reopened = state.faced[seat] < 0 || state.current - state.faced[seat] >= state.raise;
    const answerable = actors(state).some((other) => other !== seat);

    return reopened && answerable && allInTo(state, seat) > state.current;
}

export function needsToAct(state: PokerState, seat: number): boolean
{
    if (!inHand(state, seat) || state.stacks[seat] === 0)
    {
        return false;
    }

    const others = state.bets.filter((_, other) => other !== seat && inHand(state, other));

    if (actors(state).length === 1 && state.bets[seat] >= Math.max(0, ...others))
    {
        return false;
    }

    return state.faced[seat] < 0 || state.bets[seat] < state.current;
}

export function nextToAct(state: PokerState, from: number): number | null
{
    for (let step = 1; step <= state.seats; step += 1)
    {
        const seat = (from + step) % state.seats;

        if (needsToAct(state, seat))
        {
            return seat;
        }
    }

    return null;
}
