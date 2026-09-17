import type { DataSource, EntityManager } from 'typeorm';

import { UserAchievement } from '../../entities/index.ts';
import type { PersonRecord } from '../../schemas.ts';
import { earnedBy, type AchievementFacts } from './rules.ts';

/**
 * Awarding, and the three facts a rule needs that a stats row cannot hold.
 *
 * Everything in `player_stats` is a running total something already maintains. These are not:
 * "seven different days", "a private table you filled" and "the same three people ten times" are
 * questions about the shape of a history, and the honest way to answer them is to ask the history.
 * One query per player at the end of a match - the FROM-less select of correlated sub-queries this
 * server already uses elsewhere, so three truths arrive as one row rather than three round trips.
 *
 * It runs on a FINISH, which is once per game. That is the whole reason it can afford to be a
 * question rather than a counter: a counter for "distinct days" would be a column that has to be
 * right on every write forever, and this is right by construction every time it is asked.
 */

interface HistoryFacts
{
    days: number;
    hosted: boolean;
    crew: boolean;
}

const HISTORY = `
    select
        (select count(distinct ((m.finished_at at time zone 'utc')::date))::int
           from match_players p
           join matches m on m.id = p.match_id
          where p.user_id = $1 and p.result is not null)                            as days,

        exists(select 1
                 from tables t
                 join matches m on m.table_id = t.id
                where t.host_id = $1 and t.privacy <> 'public')                     as hosted,

        exists(select 1
                 from (select array_agg(o.user_id order by o.user_id) as mates
                         from match_players mine
                         join matches m on m.id = mine.match_id
                         join match_players o
                           on o.match_id = mine.match_id and o.user_id <> mine.user_id
                        where mine.user_id = $1 and m.seats = 4 and mine.result is not null
                        group by mine.match_id) grouped
                group by grouped.mates
               having count(*) >= 10)                                               as crew
`;

export interface Tally
{
    played: number;
    won: number;
    abandoned: number;
    streak: number;
}

/**
 * The whole definition list with this reader's standing against each one.
 *
 * A LEFT JOIN rather than a filtered read, because an achievement nobody can see is one nobody can
 * play towards - and sending only what has been earned makes a new account's empty profile
 * indistinguishable from a request that failed.
 */
const STANDING_SQL = `
    select a.id, a.name_en, a.name_fa, a.blurb_en, a.blurb_fa, a.icon, a.tier, ua.earned_at
      from achievements a
      left join user_achievements ua on ua.achievement_id = a.id and ua.user_id = $1
     order by a.sort_order
`;

const RECORD_SQL = `
    select game, rating, peak_rating, played, won, abandoned,
           streak, best_streak, captures, rolls, tokens_home
      from player_stats
     where user_id = $1
     order by played desc, game
`;

interface StandingRow
{
    id: string;
    name_en: string;
    name_fa: string;
    blurb_en: string;
    blurb_fa: string;
    icon: string;
    tier: 'bronze' | 'silver' | 'gold';
    earned_at: Date | null;
}

interface RecordRow
{
    game: string;
    rating: number;
    peak_rating: number;
    played: number;
    won: number;
    abandoned: number;
    streak: number;
    best_streak: number;
    captures: number;
    rolls: number;
    tokens_home: number;
}

export function createAchieveService(db: DataSource)
{
    const history = async (tx: EntityManager, userId: string): Promise<HistoryFacts> =>
    {
        const [row] = await tx.query(HISTORY, [userId]) as { days: number; hosted: boolean; crew: boolean }[];

        return { days: row?.days ?? 0, hosted: row?.hosted === true, crew: row?.crew === true };
    };

    /**
     * Awarded with `on conflict do nothing`, which is what lets the whole rule set be re-evaluated
     * from scratch at the end of every match. `earnedBy` answers what the record deserves, not what
     * has changed, so a retried action and a reconnect write the same rows twice and mean it once.
     */
    const grant = async (tx: EntityManager, userId: string, matchId: string | null, ids: readonly string[]): Promise<void> =>
    {
        if (ids.length === 0)
        {
            return;
        }

        await tx.getRepository(UserAchievement)
            .createQueryBuilder()
            .insert()
            .values(ids.map((achievementId) => ({ userId, achievementId, matchId })))
            .orIgnore()
            .execute();
    };

    return {
        /** Everything a finished match has to say about one player's achievements. */
        async record(tx: EntityManager, userId: string, matchId: string, tally: Tally): Promise<void>
        {
            const found = await history(tx, userId);

            const facts: AchievementFacts = {
                played: tally.played,
                won: tally.won,
                abandoned: tally.abandoned,
                streak: tally.streak,
                distinctDays: found.days,
                seated: true,
                hostedFull: found.hosted,
                crewTen: found.crew
            };

            await grant(tx, userId, matchId, earnedBy(facts));
        },

        /**
         * `first-seat` says "Sat down at a table", so it is earned by sitting down. Awarding it at
         * the end of a match instead would mean somebody who took a chair and never finished a game
         * had not, according to the product, ever sat at one.
         */
        async seated(tx: EntityManager, userId: string): Promise<void>
        {
            await grant(tx, userId, null, ['first-seat']);
        },

        /** A person's record at every game, and where they stand against every achievement. */
        async recordOf(handle: string): Promise<PersonRecord | null>
        {
            const [who] = await db.query(
                `select id, handle::text as handle from users where handle = $1`,
                [handle]
            ) as { id: string; handle: string }[];

            if (who === undefined)
            {
                return null;
            }

            const games = await db.query(RECORD_SQL, [who.id]) as RecordRow[];
            const standing = await db.query(STANDING_SQL, [who.id]) as StandingRow[];

            return {
                handle: who.handle,
                games: games.map((row) => ({
                    game: row.game,
                    rating: row.rating,
                    peak: row.peak_rating,
                    played: row.played,
                    won: row.won,
                    abandoned: row.abandoned,
                    streak: row.streak,
                    bestStreak: row.best_streak,
                    captures: row.captures,
                    rolls: row.rolls,
                    tokensHome: row.tokens_home
                })),
                achievements: standing.map((row) => ({
                    id: row.id,
                    name: { en: row.name_en, fa: row.name_fa },
                    blurb: { en: row.blurb_en, fa: row.blurb_fa },
                    icon: row.icon,
                    tier: row.tier,
                    ...(row.earned_at === null ? {} : { earnedAt: new Date(row.earned_at).toISOString() })
                }))
            };
        }
    };
}

export type AchieveService = ReturnType<typeof createAchieveService>;
