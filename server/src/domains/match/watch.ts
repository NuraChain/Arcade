import type { DataSource } from 'typeorm';

import { Match, MatchAction } from '../../entities/index.ts';
import type { LudoState } from './ludo/state.ts';
import type { MatchLoad, MatchSeatRow } from './service.ts';

/**
 * A game as a spectator is allowed to see it, which is a game as it stood two minutes ago.
 *
 * **The delay exists to stop coaching, and it only works because the SERVER holds the board back.**
 * A client that is handed the live position and told to wait is not delayed, it is asking nicely -
 * the request is right there in the network tab. So a watcher is never sent the current state at
 * all: they are sent the state a recorded action produced, chosen by its timestamp.
 *
 * It matters in ludo even though ludo hides nothing. A spectator with a live board can tell a
 * player which token to move, and coaching is cheating in a rated game whether or not the board is
 * secret. It matters more for every other game this platform lists, and the mechanism belongs here
 * before the game that needs it most rather than after.
 *
 * **A finished game has no delay.** There is nothing left to leak, so the current state is served
 * whole the moment `finished_at` is set - which is also what makes watching a game back possible.
 *
 * **A game with nothing old enough shows nothing.** The first two minutes of a match are not
 * rendered as an empty board, which would be a lie about the position; the watcher is told the game
 * has started and they are waiting, which is true.
 */

/**
 * How far behind a watcher is.
 *
 * One turn of a live table, whose deadline is thirty seconds.
 *
 * **Stated plainly, because it is the weaker of the two settings that were considered:** at one
 * turn, a spectator's board is one move stale, so advice relayed from the sidelines is about a
 * position that has just changed rather than one that changed three turns ago. It stops somebody
 * reading a board over your shoulder in real time; it does not stop a determined pair who accept
 * that their information is a move old. Raising it to a small multiple of the turn timer is the
 * change to make if that ever matters more than watching feeling live.
 */
export const WATCH_DELAY_MS = 30_000;

export interface WatchLoad
{
    load: MatchLoad;

    /** How many seconds behind the live game this board is. Zero once the game has finished. */
    behind: number;

    /** Whether the game is still being played. A finished one is shown whole. */
    live: boolean;
}

export function createWatchService(db: DataSource, seatsOf: (matchId: string) => Promise<MatchSeatRow[]>)
{
    return {
        /**
         * The board a watcher may see, or null when there is nothing to show them yet.
         *
         * Null covers two states that are both "not now" and are told apart by the caller: no such
         * match, and a match young enough that no action is old enough to serve.
         */
        async delayed(matchId: string): Promise<WatchLoad | null>
        {
            const match = await db.getRepository(Match).findOne({ where: { id: matchId } });

            if (match === null)
            {
                return null;
            }

            const players = await seatsOf(matchId);

            if (match.finishedAt !== null)
            {
                return {
                    load: { match, state: match.state as LudoState, players, mine: -1 },
                    behind: 0,
                    live: false
                };
            }

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
                .andWhere(`a.created_at <= now() - (:delay || ' milliseconds')::interval`, { delay: WATCH_DELAY_MS })
                .orderBy('a.rev', 'DESC')
                .limit(1)
                .getRawOne<{ state: LudoState; rev: number; behind: string }>();

            if (row === undefined)
            {
                return null;
            }

            /**
             * The MATCH row is handed over with the delayed state written onto it, so everything
             * downstream reads one shape. `rev` moves with the state for the same reason: a client
             * that compared the live revision against a delayed board would conclude it had missed
             * frames and refetch forever.
             */
            return {
                load: {
                    match: { ...match, state: row.state, rev: row.rev } as Match,
                    state: row.state,
                    players,
                    mine: -1
                },
                behind: Math.max(0, Math.round(Number(row.behind))),
                live: true
            };
        }
    };
}

export type WatchService = ReturnType<typeof createWatchService>;
