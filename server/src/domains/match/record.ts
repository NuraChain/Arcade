import type { EntityManager } from 'typeorm';

import { MatchAction, MatchPlayer, PlayerStats } from '../../entities/index.ts';
import type { AchieveService } from '../achieve/service.ts';
import { FINISHED } from './ludo/board.ts';
import { placementsOf } from './ludo/standings.ts';
import { rateField, type Standing } from './rating.ts';
import { xpFor } from './levels.ts';
import type { LudoState } from './ludo/state.ts';

/**
 * What a finished match does to everybody's record, in the transaction that finished it.
 *
 * Inside, deliberately: a match that is over and a record that has not moved are two rows
 * disagreeing about the same game, and the window between them is exactly long enough for a
 * process to be restarted. The lock is per match and a finish happens once, so the cost is a
 * handful of queries on the rarest path there is.
 *
 * **A rating moves only when somebody actually won.** The engine declares a winner in two quite
 * different situations - one player brought four tokens home, or one player is the last one left
 * standing because everybody else walked out - and until this file existed both were recorded
 * identically. That is a rating farm: three accounts join a table, two leave, the third is handed
 * the win. `outcomeOf` tells them apart by looking at the board, the second one is recorded as
 * `abandoned`, and an abandoned match moves the counts and the streaks and nothing else.
 */

/** Every token home is a win somebody played for. Anything else is a room that emptied. */
export function outcomeOf(state: LudoState): 'won' | 'abandoned'
{
    if (state.winner === null)
    {
        return 'abandoned';
    }

    const champion = state.players[state.winner];

    return champion !== undefined && champion.pieces.every((piece) => piece >= FINISHED)
        ? 'won'
        : 'abandoned';
}

interface Tallies
{
    seat: number;
    rolls: number;
    captures: number;
    home: number;
}

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
 * What each seat did over the whole game, folded out of the action ledger.
 *
 * `match_actions.events` is already an append-only record of everything that happened, so the
 * alternative - a running counter on `match_players` updated by every action - would be a second
 * copy of a derivable fact, which is the mistake `tables.status` exists to avoid. This is read once
 * at the finish and never again.
 *
 * **Raw, and one of the named exceptions**: the FROM is a `cross join lateral` over
 * `jsonb_array_elements`, which is a table expression rather than a table, so there is no entity
 * for a `QueryBuilder` to be built from and no repository that can name it. `walkoutsOf` above is
 * the same question asked of the rows themselves and is an ordinary builder, which is the shape to
 * prefer whenever the answer does not have to be unnested out of a jsonb column.
 */
const TALLIES = `
    select (e ->> 'seat')::int                                      as seat,
           (count(*) filter (where e ->> 'e' = 'roll'))::int         as rolls,
           (count(*) filter (where e ->> 'e' = 'capture'))::int      as captures,
           (count(*) filter (where e ->> 'e' = 'home'))::int         as home
      from match_actions a
      cross join lateral jsonb_array_elements(a.events) e
     where a.match_id = $1 and jsonb_exists(e, 'seat')
     group by 1
`;

export interface Recorder
{
    finish(tx: EntityManager, matchId: string, game: string, state: LudoState): Promise<void>;
}

export function createRecorder(achieve: AchieveService): Recorder
{
    return {
        async finish(tx, matchId, game, state): Promise<void>
        {
            const players = await tx.getRepository(MatchPlayer).find({ where: { matchId } });

            if (players.length === 0)
            {
                return;
            }

            const tallies = await tx.query(TALLIES, [matchId]) as Tallies[];
            const bySeat = new Map(tallies.map((one) => [one.seat, one]));

            const walkouts = await walkoutsOf(tx, matchId);
            const walkedOut = new Set(walkouts.filter((one) => one.walked).map((one) => one.seat));

            const stats = tx.getRepository(PlayerStats);

            const existing = await stats.find({
                where: players.map((player) => ({ userId: player.userId, game }))
            });

            const ratingOf = (userId: string): number =>
                existing.find((row) => row.userId === userId)?.rating ?? 1200;

            const outcome = outcomeOf(state);
            const places = placementsOf(state);
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
                const tally = bySeat.get(player.seat);
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
                 * And a survivor of an abandoned match earns nothing either. `outcomeOf` already
                 * refuses them the rating, for the exact reason that two alts can hand a third a
                 * win by standing up - so paying the finish and the tokens they happened to get
                 * home reopens the farm at a slower rate. A game only pays when a game was played.
                 */
                const earned = xpFor({
                    walked: walkedOut.has(player.seat) || outcome !== 'won',
                    won,
                    captures: tally?.captures ?? 0,
                    home: tally?.home ?? 0
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
                 * The three that are NOT counters stay absolute. A rating is a position rather than
                 * a total, a peak is a maximum over everything including what is already stored, and
                 * a streak is a run this game either continued or broke.
                 */
                await tx.query(
                    `insert into player_stats
                         (user_id, game, rating, peak_rating, played, won, abandoned,
                          streak, best_streak, captures, rolls, tokens_home, xp)
                     values ($1, $2, $3, $4, 1, $5, $6, $7, $7, $8, $9, $10, $11)
                     on conflict (user_id, game) do update set
                         rating      = excluded.rating,
                         peak_rating = greatest(player_stats.peak_rating, excluded.rating),
                         played      = player_stats.played + 1,
                         won         = player_stats.won + excluded.won,
                         abandoned   = player_stats.abandoned + excluded.abandoned,
                         streak      = excluded.streak,
                         best_streak = greatest(player_stats.best_streak, excluded.streak),
                         captures    = player_stats.captures + excluded.captures,
                         rolls       = player_stats.rolls + excluded.rolls,
                         tokens_home = player_stats.tokens_home + excluded.tokens_home,
                         xp          = player_stats.xp + excluded.xp`,
                    [
                        player.userId,
                        game,
                        after,
                        Math.max(after, before, row?.peakRating ?? 0),
                        won ? 1 : 0,
                        walked ? 1 : 0,
                        streak,
                        tally?.captures ?? 0,
                        tally?.rolls ?? 0,
                        tally?.home ?? 0,
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

                await achieve.record(tx, player.userId, matchId, {
                    played: (row?.played ?? 0) + 1,
                    won: (row?.won ?? 0) + (won ? 1 : 0),
                    abandoned: (row?.abandoned ?? 0) + (walked ? 1 : 0),
                    streak
                });
            }
        }
    };
}
