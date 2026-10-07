import { FINISHED } from './board.ts';
import type { LudoState } from './state.ts';

export interface Placement
{
    seat: number;

    place: number;

    /** Tokens all the way home, which is also what the profile shows beside the result. */
    home: number;

    /** Every token's progress added up, the tie-break and the only other thing the board says. */
    distance: number;
}

interface Side
{
    side: number;
    out: boolean;
    home: number;
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

function sidesOf(state: LudoState)
{
    const sides = new Map<number, Side>();

    for (const player of state.players)
    {
        const { home, distance } = scoreOf(player.pieces);
        const held = sides.get(player.side) ?? { side: player.side, out: false, home: 0, distance: 0 };

        sides.set(player.side, {
            side: player.side,
            out: held.out || player.out,
            home: held.home + home,
            distance: held.distance + distance
        });
    }

    return [...sides.values()];
}

const further = (a: Side, b: Side) => b.home - a.home || b.distance - a.distance;

export function placementsOf(state: LudoState): Placement[]
{
    const rank = (one: Side) => (one.side === state.winner ? 2 : (one.out ? 0 : 1));
    const better = (a: Side, b: Side) => rank(b) - rank(a) || (a.out ? 0 : further(a, b));
    const sides = sidesOf(state);

    return [...sides].sort(better).flatMap((mine) =>
    {
        const place = sides.filter((other) => better(other, mine) < 0).length + 1;

        return state.players
            .filter((player) => player.side === mine.side)
            .map((player) => ({ seat: player.seat, ...scoreOf(player.pieces), place }));
    });
}

export function trailingOf(state: LudoState)
{
    const sides = sidesOf(state);
    const trailing = sides.filter((mine) => sides.some((other) => other.side !== mine.side && !other.out && further(other, mine) < 0));

    return state.players
        .filter((player) => !player.out && trailing.some((side) => side.side === player.side))
        .map((player) => player.seat);
}
