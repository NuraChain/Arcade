import { FINISHED } from './board.ts';
import type { LudoState } from './state.ts';

/**
 * Who came where, for a game that only ever declares a first.
 *
 * Ludo ends the moment somebody brings their fourth token home, so everybody else is unplaced - and
 * a rating needs an order over the whole field or three of the four players would move by the same
 * amount whatever they did. The order is the board itself: tokens home first, then total distance
 * travelled, both of which are facts about the position rather than a guess about intent.
 *
 * Somebody who is `out` is last whatever their board says. They stopped playing; the position they
 * left behind is not a placement they earned, and letting a forfeit finish second would make walking
 * out a strategy.
 *
 * Equal scores share a place, which the rating reads as a draw between exactly those players. Two
 * people who really did get the same distance are not separated by their seat number.
 */

export interface Placement
{
    seat: number;

    place: number;

    /** Tokens all the way home, which is also what the profile shows beside the result. */
    home: number;

    /** Every token's progress added up, the tie-break and the only other thing the board says. */
    distance: number;
}

const scoreOf = (pieces: readonly number[]): { home: number; distance: number } =>
{
    let home = 0;
    let distance = 0;

    for (const piece of pieces)
    {
        if (piece >= FINISHED)
        {
            home += 1;
        }

        distance += Math.max(0, piece);
    }

    return { home, distance };
};

export function placementsOf(state: LudoState): Placement[]
{
    const champion = state.winner === null ? null : state.players[state.winner]?.seat ?? null;

    const scored = state.players.map((player) =>
    {
        const { home, distance } = scoreOf(player.pieces);

        return {
            seat: player.seat,
            home,
            distance,
            rank: player.seat === champion ? 2 : (player.out ? 0 : 1)
        };
    });

    type Scored = typeof scored[number];

    const better = (a: Scored, b: Scored): number => b.rank - a.rank || b.home - a.home || b.distance - a.distance;

    const order = [...scored].sort(better);

    return order.map((one) => ({
        seat: one.seat,
        home: one.home,
        distance: one.distance,
        place: order.findIndex((candidate) => better(candidate, one) === 0) + 1
    }));
}
