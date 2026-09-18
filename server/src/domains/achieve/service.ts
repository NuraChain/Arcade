import type { DataSource, EntityManager } from 'typeorm';

import { Achievement, Match, MatchPlayer, PlayerStats, User, UserAchievement } from '../../entities/index.ts';
import type { Leaderboard, LeaderboardWindow, PersonRecord, Standing } from '../../schemas.ts';
import { earnedBy, type AchievementFacts } from './rules.ts';
import { levelOf } from '../match/levels.ts';

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
    display_name: string;
    bio: string;
    hue: number;
    is_minor: boolean;
    rating: number;
    played: number;
    won: number;
    xp: number;
}

/**
 * The row as the wire wants it, with the person built rather than left to be fetched.
 *
 * `lastSeenAt` is deliberately ABSENT rather than null, which is the privacy rule this product
 * states in so many words: a client cannot render what it was never given, and a board is read by
 * strangers who have no claim on when somebody was last online.
 */
const asStanding = (row: BoardRow): Standing => ({
    handle: row.handle,
    person: {
        id: row.handle,
        handle: row.handle,
        displayName: row.display_name,
        bio: row.bio,
        hue: row.hue,
        isMinor: row.is_minor
    },
    rating: row.rating,
    played: row.played,
    won: row.won,
    xp: row.xp
});

/**
 * How many games somebody has to have played before the ALL-TIME board will rank them.
 *
 * One win from one game puts a new account at 1216 and, on an empty board, at the top - which says
 * nothing about anybody and makes the leaderboard a measure of who played most recently. Five is
 * low enough to reach in an evening and high enough that the number means something.
 *
 * A windowed board has no such floor and needs none. It ranks by XP EARNED inside the window, which
 * is a count of what somebody did rather than an estimate of how well they do it - one game earns
 * one game's worth and cannot flatter anybody. A floor there would do the opposite of what this one
 * does: it would keep new people off the very board they can climb.
 */
const MIN_PLAYED = 5;

const BOARD_SIZE = 20;

/** What each window truncates to. `all` is not here, because it reads a different table entirely. */
const SPANS: Record<Exclude<LeaderboardWindow, 'all'>, string> = {
    today: 'day',
    month: 'month',
    year: 'year'
};

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

        /**
         * Who is at the top of one game, over one window.
         *
         * Two queries rather than one with a branch in it, because they are asking two different
         * things of two different tables. All time is a read of the running totals in
         * `player_stats`, which is one row per person and already has the answer; a window has to be
         * summed out of `match_players`, because a running total has no dates in it.
         *
         * Both rank by XP. Ranking the window by rating would have made it the all-time board with
         * the inactive hidden, and ranking all time by rating makes the top of this product a place
         * nobody new can reach - the number you climb should be the one that only goes up, and the
         * rating is right beside it for anybody who wants to know how well.
         */
        async leaderboardOf(game: string, window: LeaderboardWindow): Promise<Leaderboard>
        {
            if (window === 'all')
            {
                const rows = await db.getRepository(PlayerStats)
                    .createQueryBuilder('s')
                    .innerJoin(User, 'u', 'u.id = s.user_id')
                    .select('u.handle::text', 'handle')
                    .addSelect('u.display_name', 'display_name')
                    .addSelect('u.bio', 'bio')
                    .addSelect('u.hue', 'hue')
                    .addSelect('u.is_minor', 'is_minor')
                    .addSelect('s.rating', 'rating')
                    .addSelect('s.played', 'played')
                    .addSelect('s.won', 'won')
                    .addSelect('s.xp', 'xp')
                    .where('s.game = :game and s.played >= :floor', { game, floor: MIN_PLAYED })
                    .orderBy('s.xp', 'DESC')
                    .addOrderBy('s.rating', 'DESC')
                    .addOrderBy('u.handle', 'ASC')
                    .limit(BOARD_SIZE)
                    .getRawMany<BoardRow>();

                return { game, window, standings: rows.map(asStanding) };
            }

            /**
             * `date_trunc` over Postgres `now()`, never a date this process computed.
             *
             * `finished_at` was written by Postgres, so a boundary from the Node clock would be
             * compared against it across whatever skew there is between the two - the same reason
             * every session and expiry predicate in this server stays on the database's clock.
             */
            const rows = await db.getRepository(MatchPlayer)
                .createQueryBuilder('p')
                .innerJoin(Match, 'm', 'm.id = p.match_id')
                .innerJoin(User, 'u', 'u.id = p.user_id')
                .leftJoin(PlayerStats, 's', 's.user_id = p.user_id and s.game = m.game')
                .select('u.handle::text', 'handle')
                .addSelect('max(u.display_name)', 'display_name')
                .addSelect('max(u.bio)', 'bio')
                .addSelect('max(u.hue)::int', 'hue')
                .addSelect('bool_or(u.is_minor)', 'is_minor')
                .addSelect('coalesce(max(s.rating), 1200)::int', 'rating')
                .addSelect('count(*)::int', 'played')
                .addSelect(`count(*) filter (where p.result = 'won')::int`, 'won')
                .addSelect('sum(p.xp)::int', 'xp')
                .where('m.game = :game', { game })
                .andWhere('m.finished_at is not null')
                .andWhere(`m.finished_at >= date_trunc(:span, now())`, { span: SPANS[window] })
                .groupBy('u.handle')
                .having('sum(p.xp) > 0')
                .orderBy('sum(p.xp)', 'DESC')
                .addOrderBy(`count(*) filter (where p.result = 'won')`, 'DESC')
                .addOrderBy('u.handle', 'ASC')
                .limit(BOARD_SIZE)
                .getRawMany<BoardRow>();

            return { game, window, standings: rows.map(asStanding) };
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

                /*
                 * Summed here rather than stored. Six rows on a profile read is not a cost worth a
                 * second source of truth, and a stored account total is one more number that can
                 * disagree with the rows it came from.
                 */
                progress: levelOf(games.reduce((total, row) => total + row.xp, 0)),

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
                    tokensHome: row.tokensHome,
                    xp: row.xp
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
