import type { DataSource } from 'typeorm';

/**
 * The line that tells the table how its game ended.
 *
 * `MessageKind: 'result'` and the `winner` slot in `lineParams` have been reserved since the wire
 * format was written and nothing wrote either, which made `chat.line.result` filler copy by this
 * product's own rule - a key with no producer standing in for a sentence nobody had written. This
 * is the producer.
 *
 * Shared, because a game ends two ways and both must say so identically: somebody plays the last
 * move, or the turn sweep forfeits the last player still holding one. A second copy of this in the
 * job would be a second chance to phrase it differently.
 *
 * `{ key, params }` and never prose, like every other server-authored line, so it follows a language
 * switch - and the winner travels as a HANDLE, which is what the client already resolves to a name.
 */

interface Ending
{
    conversationId: string;
    key: 'chat.line.result' | 'chat.line.result.none';
    params: { game: string; winner?: string };
}

/**
 * What a finished match has to announce, or null when there is nothing to say.
 *
 * Null covers three cases that are all "not now": the match is not finished, the row is gone, or
 * the table has no conversation - which a table can only be if it was made before its thread, and
 * is a state the read must survive rather than throw on.
 */
const ENDING_SQL = `
    select c.id                                                   as conversation_id,
           m.game                                                 as game,
           m.outcome                                              as outcome,
           (select u.handle::text
              from match_players p
              join users u on u.id = p.user_id
             where p.match_id = m.id and p.seat = m.winner_seat)   as winner
      from matches m
      join conversations c on c.table_id = m.table_id and c.kind = 'game'
     where m.id = $1 and m.finished_at is not null
`;

export async function endingOf(db: DataSource, matchId: string): Promise<Ending | null>
{
    const [row] = await db.query(ENDING_SQL, [matchId]) as {
        conversation_id: string;
        game: string;
        outcome: string;
        winner: string | null;
    }[];

    if (row === undefined)
    {
        return null;
    }

    /**
     * A game somebody WON names them. A room that emptied does not, and must not: the engine calls
     * the last player standing a winner so the board can stop, and printing "Dana won" into the
     * thread after everybody else walked out is the same untruth the rating refuses to pay for.
     */
    return row.outcome === 'won' && row.winner !== null
        ? { conversationId: row.conversation_id, key: 'chat.line.result', params: { game: row.game, winner: row.winner } }
        : { conversationId: row.conversation_id, key: 'chat.line.result.none', params: { game: row.game } };
}
