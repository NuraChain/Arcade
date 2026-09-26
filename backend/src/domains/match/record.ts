import type { EntityManager } from 'typeorm';

import { MatchAction, MatchPlayer, PlayerStats } from '../../entities/index.ts';
import type { AchieveService } from '../achieve/service.ts';
import type { Engine } from './engine.ts';
import { rateField, type Standing } from './rating.ts';
import { xpFor } from './levels.ts';

/**
 * What a finished match does to everybody's record, in the transaction that finished it.
 *
 * Inside, deliberately: a match that is over and a record that has not moved are two rows
 * disagreeing about the same game, and the window between them is exactly long enough for a
 * process to be restarted. The lock is per match and a finish happens once, so the cost is a
 * handful of queries on the rarest path there is.
 *
 * **A rating moves only when somebody actually won.** An engine declares a winner in two quite
 * different situations - somebody played the last move, or everybody else walked out and the last
 * player standing is all that is left - and until this file existed both were recorded identically.
 * That is a rating farm: three accounts join a table, two leave, the third is handed the win.
 *
 * **The engine is the one that can tell them apart, so it is the one asked.** This file used to
 * carry `outcomeOf`, which read ludo's own board - every token home is a win somebody played for -
 * beside an `ludoEngine.finish` that already answered the same question the same way. Two copies of
 * one answer, and the second game would have had to remember to add a third. `Ending` is what the
 * seam returns and `standings` is where the field comes from, so nothing here knows what was played.
 */



/**
 * Which seats WALKED OUT, as opposed to being timed out of the game.
 *
 * `match_players.result` says `abandoned` for both, so it cannot tell them apart - and treating
 * them alike paid a dropped connection exactly what it paid a quitter, which is the opposite of the
 * rule `levels.ts` states. The ledger already knows: the timeout sweep writes its forfeits with
 * `user_id = null`, because the server took that action rather than a person, and a resignation
 * carries the resigner's id. So a seat walked out if and only if a forfeit for it names somebody.
 */
interface Walkout
{
    seat: number;
    walked: boolean;
}

const walkoutsOf = (tx: EntityManager, matchId: string): Promise<Walkout[]> =>
    tx.getRepository(MatchAction)
        .createQueryBuilder('a')
        .select('a.seat', 'seat')
        .addSelect('bool_or(a.user_id is not null)', 'walked')
        .where(`a.match_id = :matchId and a.kind = 'forfeit'`, { matchId })
        .groupBy('a.seat')
        .getRawMany<Walkout>();

/**
 * What each seat did over the whole game, folded out of the action ledger BY THE ENGINE.
 *
 * `match_actions.events` is already an append-only record of everything that happened, so the fold
 * is the right shape - a running counter on `match_players` updated by every action would be a
 * second copy of a derivable fact, which is the mistake `tables.status` exists to avoid. It is read
 * once at the finish and never again.
 *
 * What changed is who knows the words. This was a raw `count(*) filter (where e ->> 'e' =
 * 'capture')` - ludo's event names, in SQL, in the file that records every game's result - so hokm
 * would have had to add its own branch here and poker a third. The rows come back whole now and
 * `engine.tally` does the counting, which also means the fold is covered by the engine's own tests
 * with no Postgres anywhere near it.
 */
const eventsOf = async (tx: EntityManager, matchId: string): Promise<unknown[]> =>
{
    const rows = await tx.getRepository(MatchAction).find({
        select: { events: true },
        where: { matchId }
    });

    return rows.flatMap((row) => (row.events ?? []) as unknown[]);
};

export interface Recorder
{
    finish(tx: EntityManager, matchId: string, engine: Engine, state: unknown): Promise<void>;
}

export function createRecorder(achieve: AchieveService): Recorder
{
    return {
        async finish(tx, matchId, engine, state): Promise<void>
        {
            const game = engine.id;
            const players = await tx.getRepository(MatchPlayer).find({ where: { matchId }, order: { userId: 'ASC' } });

            if (players.length === 0)
            {
                return;
            }

            const bySeat = engine.tally(await eventsOf(tx, matchId));

            const walkouts = await walkoutsOf(tx, matchId);
            const walkedOut = new Set(walkouts.filter((one) => one.walked).map((one) => one.seat));

            const stats = tx.getRepository(PlayerStats);

            const existing = await stats.find({
                where: players.map((player) => ({ userId: player.userId, game }))
            });

            const ratingOf = (userId: string): number =>
                existing.find((row) => row.userId === userId)?.rating ?? 1200;

            const outcome = engine.finish(state)?.outcome ?? 'abandoned';
            const places = engine.standings(state);
            const placeOf = (seat: number): number => places.find((one) => one.seat === seat)?.place ?? players.length;

            const field: Standing[] = players.map((player) => ({
                seat: player.seat,
                rating: ratingOf(player.userId),
                place: placeOf(player.seat)
            }));

            const moves = outcome === 'won' ? rateField(field) : [];

            for (const player of players)
            {
                const move = moves.find((one) => one.seat === player.seat);
                const before = ratingOf(player.userId);
                const after = move?.after ?? before;
                const tally = bySeat.get(player.seat) ?? {};
                const row = existing.find((one) => one.userId === player.userId);

                const won = player.result === 'won' && outcome === 'won';
                const walked = player.result === 'abandoned';
                const streak = won ? (row?.streak ?? 0) + 1 : 0;

                /**
                 * Two things the counts and the XP disagree about, deliberately.
                 *
                 * `walked` is what the RECORD says - anybody whose seat ended `abandoned`, however
                 * it ended - because a game somebody was not present at the end of is one their
                 * abandoned count should carry. What XP asks is narrower and asks it of the ledger:
                 * did this person CHOOSE to leave. Three missed turns is usually a dropped
                 * connection, and charging it what a walkout costs punishes a bad train journey.
                 *
                 * And a survivor of an abandoned match earns nothing either. The engine's own
                 * `Ending` already refuses them the rating, for the reason two alts can hand a third a
                 * win by standing up - so paying the finish and the tokens they happened to get
                 * home reopens the farm at a slower rate. A game only pays when a game was played.
                 */
                const earned = xpFor({
                    walked: walkedOut.has(player.seat) || outcome !== 'won',
                    won,
                    bonus: engine.points(tally)
                });

                /**
                 * The COUNTERS are added by the database, not by this process.
                 *
                 * It was an `orUpdate`, which is all TypeORM's insert builder can express: every
                 * listed column is overwritten with what this statement computed. So the counts
                 * were a read-modify-write over `existing`, read once before the loop - and nothing
                 * serialises two matches finishing for the same person, because each holds `for
                 * update` on its OWN match row and they are different rows. Two games ending
                 * together recorded one. The sweep makes that reachable rather than theoretical: it
                 * can finish several due matches in one tick.
                 *
                 * `on conflict do update set played = player_stats.played + 1` is arithmetic the
                 * row does to itself under the unique index, so a concurrent finish adds to
                 * whatever is there rather than to whatever was there a moment ago. It is raw for
                 * the reason the notification dedupe is - the insert builder has no expression form
                 * for a SET, only a column list - and it is the named exception in the house rules.
                 *
                 * `tallies` is the same arithmetic over a jsonb object, which Postgres has no
                 * operator for: `||` REPLACES a key rather than adding to it, so two games finishing
                 * together would record one. Summing both key sets through `jsonb_each_text` and
                 * re-aggregating is the addition, and it stays inside the one statement the unique
                 * index serialises - which is the whole property the integer columns had.
                 *
                 * The three that are NOT counters stay absolute. A rating is a position rather than
                 * a total, a peak is a maximum over everything including what is already stored, and
                 * a streak is a run this game either continued or broke.
                 */
                await tx.query(
                    `insert into player_stats
                         (user_id, game, rating, peak_rating, played, won, abandoned,
                          streak, best_streak, tallies, xp)
                     values ($1, $2, $3, $4, 1, $5, $6, $7, $7, $8::jsonb, $9)
                     on conflict (user_id, game) do update set
                         rating      = excluded.rating,
                         peak_rating = greatest(player_stats.peak_rating, excluded.rating),
                         played      = player_stats.played + 1,
                         won         = player_stats.won + excluded.won,
                         abandoned   = player_stats.abandoned + excluded.abandoned,
                         streak      = excluded.streak,
                         best_streak = greatest(player_stats.best_streak, excluded.streak),
                         tallies     = (select coalesce(jsonb_object_agg(name, total), '{}'::jsonb)
                                          from (select name, sum(count::numeric) as total
                                                  from (select key as name, value as count
                                                          from jsonb_each_text(player_stats.tallies)
                                                        union all
                                                        select key as name, value as count
                                                          from jsonb_each_text(excluded.tallies)) pairs
                                                 group by name) summed),
                         xp          = player_stats.xp + excluded.xp`,
                    [
                        player.userId,
                        game,
                        after,
                        Math.max(after, before, row?.peakRating ?? 0),
                        won ? 1 : 0,
                        walked ? 1 : 0,
                        streak,
                        JSON.stringify(tally),
                        earned
                    ]
                );

                /**
                 * The seat's own row carries what it earned, ALWAYS - a rating move only happens
                 * when somebody really won, and the two must not share a branch. They did for one
                 * commit and every abandoned match recorded nothing, which made a windowed
                 * leaderboard quietly blind to a whole class of game.
                 */
                await tx.getRepository(MatchPlayer).update(
                    { matchId, seat: player.seat },
                    move === undefined
                        ? { xp: earned }
                        : { xp: earned, ratingBefore: move.before, ratingAfter: move.after }
                );

                await achieve.record(tx, player.userId, matchId, game);
            }
        }
    };
}
