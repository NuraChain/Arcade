import type { DataSource, EntityManager } from 'typeorm';

import { Achievement, PlayerStats, User, UserAchievement } from '../../entities/index.ts';
import type { Leaderboard, PersonRecord } from '../../schemas.ts';
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

interface BoardRow
{
    handle: string;
    rating: number;
    played: number;
    won: number;
}

/**
 * How many games somebody has to have played before their rating is worth ranking.
 *
 * One win from one game puts a new account at 1216 and, on an empty board, at the top - which says
 * nothing about anybody and makes the leaderboard a measure of who played most recently. Five is
 * low enough to reach in an evening and high enough that the number means something.
 */
const MIN_PLAYED = 5;

const BOARD_SIZE = 20;

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

        /** The best ratings at one game, among people with enough games behind them to rank. */
        async leaderboardOf(game: string): Promise<Leaderboard>
        {
            const rows = await db.getRepository(PlayerStats)
                .createQueryBuilder('s')
                .innerJoin(User, 'u', 'u.id = s.user_id')
                .select('u.handle::text', 'handle')
                .addSelect('s.rating', 'rating')
                .addSelect('s.played', 'played')
                .addSelect('s.won', 'won')
                .where('s.game = :game and s.played >= :floor', { game, floor: MIN_PLAYED })
                .orderBy('s.rating', 'DESC')
                .addOrderBy('s.won', 'DESC')
                .addOrderBy('u.handle', 'ASC')
                .limit(BOARD_SIZE)
                .getRawMany<BoardRow>();

            return { game, standings: rows.map((row) => ({ ...row })) };
        },

        /** A person's record at every game, and where they stand against every achievement. */
        async recordOf(handle: string): Promise<PersonRecord | null>
        {
            const who = await db.getRepository(User).findOne({
                select: { id: true, handle: true },
                where: { handle }
            });

            if (who === null)
            {
                return null;
            }

            const games = await db.getRepository(PlayerStats).find({
                where: { userId: who.id },
                order: { played: 'DESC', game: 'ASC' }
            });

            /**
             * A LEFT JOIN rather than a filtered read, because an achievement nobody can see is one
             * nobody can play towards - and sending only what has been earned makes a new account's
             * empty profile indistinguishable from a request that failed. It is the one read here
             * that a repository cannot say: `find` cannot left-join a table this entity has no
             * relation to, and adding one would put an inverse side on the entity graph the whole
             * schema is kept acyclic to avoid.
             */
            const standing = await db.getRepository(Achievement)
                .createQueryBuilder('a')
                .leftJoin(UserAchievement, 'ua', 'ua.achievement_id = a.id and ua.user_id = :who', { who: who.id })
                .select('a.id', 'id')
                .addSelect('a.name_en', 'name_en')
                .addSelect('a.name_fa', 'name_fa')
                .addSelect('a.blurb_en', 'blurb_en')
                .addSelect('a.blurb_fa', 'blurb_fa')
                .addSelect('a.icon', 'icon')
                .addSelect('a.tier', 'tier')
                .addSelect('ua.earned_at', 'earned_at')
                .orderBy('a.sort_order', 'ASC')
                .getRawMany<StandingRow>();

            return {
                handle: who.handle,
                games: games.map((row) => ({
                    game: row.game,
                    rating: row.rating,
                    peak: row.peakRating,
                    played: row.played,
                    won: row.won,
                    abandoned: row.abandoned,
                    streak: row.streak,
                    bestStreak: row.bestStreak,
                    captures: row.captures,
                    rolls: row.rolls,
                    tokensHome: row.tokensHome
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
