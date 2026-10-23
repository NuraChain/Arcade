import { START, type Position } from '../../../backend/src/domains/match/chess/board.ts';
import { legalMoves, play, type Move } from '../../../backend/src/domains/match/chess/moves.ts';
import { sanOf } from '../../../backend/src/domains/match/chess/san.ts';

export interface Replayed
{
    position: Position;
    move: Move | null;
    legal: readonly Move[];
}

/**
 * Every position of a game from the start, read back from its moves as the board wrote them: each
 * move is the legal one of the position before it whose SAN it is, its check or mate mark aside, and
 * comes with the legal moves it was chosen from. A move that is not found ends the game there, so a
 * list that does not add up is shown as far as it does.
 */
export function replayOf(notation: readonly string[])
{
    const out: Replayed[] = [{ position: START, move: null, legal: [] }];

    for (const san of notation)
    {
        const before = out[out.length - 1].position;
        const legal = legalMoves(before);
        const bare = san.replace(/[+#]$/, '');
        const move = legal.find((one) => sanOf(one, legal) === bare);

        if (move === undefined)
        {
            break;
        }

        out.push({ position: play(before, move), move, legal });
    }

    return out;
}
