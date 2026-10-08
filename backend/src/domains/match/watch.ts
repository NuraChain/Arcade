import { Brackets, LessThanOrEqual, type DataSource } from 'typeorm';

import { Match, MatchAction } from '../../entities/index.ts';
import type { MatchLoad, MatchSeatRow } from './service.ts';
import { WATCH_DELAY_MS } from './turns.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WatchLoad
{
    load: MatchLoad;

    /** How many seconds behind the live game this board is. Zero once the game has finished. */
    behind: number;

    /** Whether the game is still being played. A finished one is shown whole. */
    live: boolean;
}

export async function boardShown(db: DataSource, match: Match, players: MatchSeatRow[], seenUpTo = -1): Promise<WatchLoad | null>
{
    if (match.finishedAt !== null)
    {
        return {
            load: { match, state: match.state, players, mine: -1 },
            behind: 0,
            live: false
        };
    }

    const matchId = match.id;

    /**
     * The newest board old enough to show, and the `now()` in that predicate is the whole
     * point of it being written here rather than as a `LessThan(new Date())`.
     *
     * The rows were written by Postgres, and a delay measured against the Node clock is a
     * delay that drifts from the thing it is protecting - which for a window that exists to
     * stop coaching means drifting in the direction of showing a fresher board than the rule
     * says. It is the same reason the nonce burn, the session window and the expiry sweep
     * all keep `now()` in the predicate.
     */
    const row = await db.getRepository(MatchAction)
        .createQueryBuilder('a')
        .select('a.state', 'state')
        .addSelect('a.rev', 'rev')
        .addSelect('extract(epoch from (now() - a.created_at))', 'behind')
        .where('a.match_id = :matchId', { matchId })
        .andWhere(new Brackets((shown) => shown
            .where(`a.created_at <= now() - (:delay || ' milliseconds')::interval`, { delay: WATCH_DELAY_MS })
            .orWhere(`a.kind = 'open'`)
            .orWhere('a.rev <= :seenUpTo', { seenUpTo })))
        .orderBy('a.rev', 'DESC')
        .limit(1)
        .getRawOne<{ state: unknown; rev: number; behind: string }>();

    if (row === undefined)
    {
        return null;
    }

    const forfeits = await db.getRepository(MatchAction).find({
        select: { seat: true },
        where: { matchId, kind: 'forfeit', rev: LessThanOrEqual(row.rev) }
    });
    const gone = new Set(forfeits.map((forfeit) => forfeit.seat));

    /**
     * The MATCH row is handed over with the delayed state written onto it, so everything
     * downstream reads one shape. `rev` moves with the state for the same reason: a client
     * that compared the live revision against a delayed board would conclude it had missed
     * frames and refetch forever.
     */
    return {
        load: {
            match: { ...match, state: row.state, rev: row.rev, deadlineAt: null, winnerSeat: null, outcome: null },
            state: row.state,
            players: players.map((player) => ({
                ...player,
                timeouts: null,
                result: gone.has(player.seat) ? 'abandoned' : null,
                rating_before: null,
                rating_after: null
            })),
            mine: -1
        },
        behind: Math.max(0, Math.round(Number(row.behind))),
        live: true
    };
}

export function createWatchService(db: DataSource, seatsOf: (matchId: string) => Promise<MatchSeatRow[]>)
{
    return {
        async delayed(matchId: string)
        {
            if (!UUID.test(matchId))
            {
                return null;
            }

            const match = await db.getRepository(Match).findOne({ where: { id: matchId } });

            return match === null ? null : await boardShown(db, match, await seatsOf(matchId));
        }
    };
}

export type WatchService = ReturnType<typeof createWatchService>;
