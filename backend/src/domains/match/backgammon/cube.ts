import type { BackgammonState } from './state.ts';

export const MAX_CUBE = 64;

export function cubeLive(target: number, cube: boolean): boolean
{
    return cube && target > 1;
}

export function mayDouble(state: BackgammonState, seat: number): boolean
{
    return state.cubed
        && state.winner === null
        && state.crawford !== 'now'
        && state.cube < MAX_CUBE
        && (state.owner === null || state.owner === seat);
}
