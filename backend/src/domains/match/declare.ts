import type { DataSource } from 'typeorm';

import { Conversation, Match } from '../../entities/index.ts';

/**
 * The line that tells the table how its game ended.
 *
 * `MessageKind: 'result'` and the winner slot in `lineParams` have been reserved since the wire
 * format was written and nothing wrote either, which made `chat.line.result` filler copy by this
 * product's own rule - a key with no producer standing in for a sentence nobody had written. This
 * is the producer.
 *
 * Shared, because a game ends two ways and both must say so identically: somebody plays the last
 * move, or the turn sweep forfeits the last player still holding one. A second copy of this in the
 * job would be a second chance to phrase it differently.
 *
 * `{ key, params }` and never prose, like every other server-authored line, so it follows a language
 * switch - and each winner travels as a HANDLE, which is what the client already resolves to a name.
 */

interface Ending
{
    conversationId: string;
    key: 'chat.line.result' | 'chat.line.result.none' | 'chat.line.result.void';
    params: { game: string; winners?: string[] };
}

/**
 * What a finished match has to announce, or null when there is nothing to say.
 *
 * Null covers three cases that are all "not now": the match is not finished, the row is gone, or
 * the table has no conversation - which a table can only be if it was made before its thread, and
 * is a state the read must survive rather than throw on.
 *
 * The winners' handles are a correlated sub-query rather than a join, because they are every seat
 * the judge marked won - partners on one side, or both survivors of a three-handed forfeit - and
 * joining `match_players` would fan the row out to one per player and then need folding back down.
 * The handles a table's stakes were paid to are one more, read off the escrow's mask of seats.
 */
export async function endingOf(db: DataSource, matchId: string): Promise<Ending | null>
{
    const row = await db.getRepository(Match)
        .createQueryBuilder('m')
        .innerJoin(Conversation, 'c', `c.table_id = m.table_id and c.kind = 'game'`)
        .select('c.id', 'conversation_id')
        .addSelect('m.game', 'game')
        .addSelect(`coalesce((m.state ->> 'voided') = 'true', false)`, 'voided')
        .addSelect(
            `(select array_agg(u.handle::text order by p.seat) from match_players p
                join users u on u.id = p.user_id
               where p.match_id = m.id and p.result = 'won')`,
            'winners'
        )
        .addSelect(
            `(select array_agg(u.handle::text order by s.seat) from escrows e
                join escrow_seats s on s.escrow_id = e.id
                join users u on u.id = s.user_id
               where e.match_id = m.id and (e.winners >> s.seat) & 1 = 1)`,
            'paid'
        )
        .where('m.id = :matchId and m.finished_at is not null', { matchId })
        .getRawOne<{ conversation_id: string; game: string; voided: boolean; winners: string[] | null; paid: string[] | null }>();

    if (row === undefined)
    {
        return null;
    }

    if (row.voided)
    {
        return { conversationId: row.conversation_id, key: 'chat.line.result.void', params: { game: row.game } };
    }

    /**
     * A game somebody WON names them. A room that emptied does not, and must not: the engine calls
     * the last player standing a winner so the board can stop, and printing "Dana won" into the
     * thread after everybody else walked out is the same untruth the rating refuses to pay for.
     * At a table played for NURA the winners are whoever the stakes were paid to, as on the result
     * card: leaving loses the stake, so the pot went to them however early the game ended.
     */
    const winners = row.paid ?? row.winners;

    return winners === null
        ? { conversationId: row.conversation_id, key: 'chat.line.result.none', params: { game: row.game } }
        : { conversationId: row.conversation_id, key: 'chat.line.result', params: { game: row.game, winners } };
}
