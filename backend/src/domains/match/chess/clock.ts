import { turnSeat, type ChessState, type Clock } from './state.ts';

/**
 * How long a side has for its first move, before which its clock does not run. Missing it ends the
 * game with nobody rated, as an online game nobody began is not a result.
 */
export const FIRST_MOVE_MS = 30_000;

/**
 * The time the side to move has left, or null when the game keeps no bank: over, or played at a day
 * a move, whose deadline is the platform's own.
 */
export function bankOf(state: ChessState)
{
    if (state.over !== null || state.clock === null)
    {
        return null;
    }

    const seat = turnSeat(state);

    return state.moved[seat] ? state.clock.left[seat] : FIRST_MOVE_MS;
}

/**
 * The clock once `seat` has moved, `left` being what it had when the move arrived. Its first move
 * costs nothing; after that the bank is what was left and the increment on top. With no `left` (a
 * replay, a spec) no time passed.
 */
export function charged(state: ChessState, seat: number, left: number | undefined): Clock | null
{
    if (state.clock === null || !state.moved[seat])
    {
        return state.clock;
    }

    const banks = [...state.clock.left];

    banks[seat] = Math.max(0, left ?? banks[seat]) + state.clock.increment;

    return { ...state.clock, left: banks };
}
