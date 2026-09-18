import type { BoardToken } from '../../game/bridge.ts';
import type { MatchView } from '../../api.ts';

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
 */

const YARDS: Record<string, readonly [number, number]> = {
    red: [0, 0],
    green: [9, 0],
    yellow: [9, 9],
    blue: [0, 9]
};

/**
 * The four wells printed inside each home yard.
 *
 * `atlas.py` draws them at `corner + 3 +/- 0.95` cells - a POSITION on the grid, not a cell index -
 * and `centreOf` adds the half cell that turns an index into a centre. Passing 2 and 4 therefore
 * landed every yard token half a cell down and to the right of the circle it belongs in, which read
 * as "nearly right" and is the hardest kind of wrong to notice.
 */
const YARD_SPOTS: readonly (readonly [number, number])[] = [
    [1.55, 1.55],
    [3.45, 1.55],
    [1.55, 3.45],
    [3.45, 3.45]
];

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
export function seatsFor(game: MatchView, mine?: number): BoardToken[]
{
    const placed: BoardToken[] = [];

    for (const player of game.players)
    {
        const corner = YARDS[player.colour];
        let parked = 0;

        for (const token of player.tokens)
        {
            const key = `${ player.seat }-${ token.piece }`;
            const label = INITIAL[player.colour];
            const playable = mine !== undefined && player.seat === mine && game.moves.includes(token.piece);

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
                continue;
            }

            const spot = YARD_SPOTS[parked];

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
