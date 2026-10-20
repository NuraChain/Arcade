import type { BoardToken } from '../../game/bridge.ts';
import { FINISHED } from '../../game/board/path.ts';
import { keyOf, placeOf } from '../../game/ludo-felt.ts';
import type { LudoBoard } from '../../data/match.ts';
import { pieceFor } from '../../game/helpers/ludo.ts';

export const INITIAL: Record<string, string> = {
    red: 'R',
    green: 'G',
    yellow: 'Y',
    blue: 'B'
};

export function seatsFor(board: LudoBoard, mine?: number)
{
    const placed: BoardToken[] = [];

    for (const player of board.seats)
    {
        let finished = 0;

        for (const token of player.tokens)
        {
            const place = placeOf(player.colour, token.at, token.piece, finished);

            finished += token.at >= FINISHED ? 1 : 0;
            placed.push({
                key: keyOf(player.seat, token.piece),
                colour: player.colour,
                side: player.side,
                at: token.at,
                col: place.col,
                row: place.row,
                playable: mine !== undefined && player.seat === board.controls && pieceFor(board, token.piece) !== null
            });
        }
    }

    return placed;
}
