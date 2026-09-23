import type { BoardToken } from '../../game/bridge.ts';
import { HOME_SLOTS, NEST, NEST_SPREAD, NEST_WELLS } from '../../game/layout.ts';
import type { LudoBoard } from '../../data/match.ts';

/**
 * Where every token on a board stands, from the match the server sent.
 *
 * Shared by the board a player acts on and the board a spectator watches, because those are two
 * views of one position and two copies of this would be two chances to draw it differently - a
 * watcher seeing a token half a cell off the circle it belongs in would be the kind of wrong that
 * reads as "nearly right" and is never traced back to here.
 *
 * `playable` is the ONLY thing that differs between them, and it is a parameter rather than a
 * branch: a watcher passes no seat, so nothing is playable, so nothing on their board can be
 * pressed. A view that cannot name a seat cannot offer a move.
 *
 * It is handed the BOARD rather than the match, because the board is the half the engine composed
 * for one viewer. The legal moves come with it for the same reason: `moves` is what THIS seat may
 * do, and reading it off anything wider would be reading somebody else's turn.
 */

const YARDS: Record<string, readonly [number, number]> = {
    red: [0, 0],
    green: [9, 0],
    yellow: [9, 9],
    blue: [0, 9]
};

export const INITIAL: Record<string, string> = {
    red: 'R',
    green: 'G',
    yellow: 'Y',
    blue: 'B'
};

/**
 * Every token on the board, each with the grid square it stands on.
 *
 * Built per TOKEN rather than per cell: a token then keeps its identity across a move, so the
 * renderer walks the same piece rather than blanking one square and lighting another. It is also
 * sixteen entries instead of two hundred and twenty-five.
 */
export function seatsFor(board: LudoBoard, mine?: number): BoardToken[]
{
    const placed: BoardToken[] = [];

    for (const player of board.seats)
    {
        const corner = YARDS[player.colour];
        let parked = 0;
        let finished = 0;

        for (const token of player.tokens)
        {
            const key = `${ player.seat }-${ token.piece }`;
            const label = INITIAL[player.colour];
            const playable = mine !== undefined && player.seat === mine && board.moves.includes(token.piece);

            if (token.cell !== undefined)
            {
                placed.push({
                    key,
                    colour: player.colour,
                    label,
                    at: token.at,
                    col: token.cell.col,
                    row: token.cell.row,
                    playable
                });
                continue;
            }

            if (token.at >= 0)
            {
                const slots = HOME_SLOTS[player.colour] ?? HOME_SLOTS.red;
                const slot = slots[Math.min(finished, slots.length - 1)];

                finished += 1;

                placed.push({ key, colour: player.colour, label, at: token.at, col: slot[0], row: slot[1], playable: false });
                continue;
            }

            const nest = NEST[player.colour] ?? NEST.red;
            const well = NEST_WELLS[parked] ?? NEST_WELLS[0];
            const spot = [nest[0] + well[0] * NEST_SPREAD - 0.5, nest[1] + well[1] * NEST_SPREAD - 0.5];

            parked += 1;

            placed.push({
                key,
                colour: player.colour,
                label,
                at: token.at,
                col: corner[0] + spot[0],
                row: corner[1] + spot[1],
                playable
            });
        }
    }

    return placed;
}
