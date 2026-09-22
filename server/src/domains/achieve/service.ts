import type { DataSource, EntityManager } from 'typeorm';

import { Achievement, Match, MatchPlayer, PlayerStats, User, UserAchievement } from '../../entities/index.ts';
import type { Leaderboard, LeaderboardWindow, PersonRecord, Standing } from '../../schemas.ts';
import { ACHIEVEMENT_GAME, earnedBy, progressOf, type AchievementFacts } from './rules.ts';
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
    hue: number;
    rating: number;
    played: number;
    won: number;
    xp: number;
    rank: number;
}

/**
 * The row as the wire wants it, carrying only what drawing it needs.
 *
 * A name and a hue - not a bio, not `lastSeenAt`, and above all not `isMinor`. This route is
 * unguarded, so everything on it is public, and the privacy rule this product states is that a
 * client cannot render what it was never given.
 */
const asStanding = (row: BoardRow): Standing => ({
    handle: row.handle,
    person: {
        handle: row.handle,
        displayName: row.display_name,
        hue: row.hue
    },
    rating: row.rating,
    played: row.played,
    won: row.won,
    xp: row.xp,
    rank: Number(row.rank)
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

/**
 * Where a row stands, as a window function inside a QueryBuilder.
 *
 * `rank() over (...)` is the one thing here a repository genuinely cannot say: the rank has to be
 * computed over EVERY row before a page is cut out of it, and it then has to be filtered on - which
 * is why each board is a sub-query with the rank selected inside and compared outside. That is the
 * shape this project's rules already point at for exactly this case: the window expression is a
 * string handed to `.addSelect`, while the FROM, the joins, the WHERE and every parameter stay
 * TypeORM's. `getRawMany` rather than `db.query`, so nothing has to know what shape a mutation
 * would have returned.
 *
 * Each board ranks by its OWN order, including its own tiebreak - the all-time board separates a
 * tie by rating and the windowed one by wins - so the two expressions are written out rather than
 * shared. A single "rank" helper would have had to take the order as a parameter, which is the same
 * two strings with a layer over them.
 *
 * The position is STRICT - every row gets its own number - and that is forced by the paging rather
 * than chosen. `handle` is inside the window's own ORDER BY, so two people level on XP and rating
 * are still separated, and `rank()` therefore never repeats a number here.
 *
 * Sharing a number would read as fairer and would silently lose rows: the cursor is "everything
 * after rank 20", so two rows both ranked 20 means the second one is on neither page. A board that
 * drops a player between page one and page two is worse than one that breaks a tie alphabetically.
 */
const RANKED_BY_TOTAL = 'rank() over (order by s.xp desc, s.rating desc, u.handle asc)';

const WON = `count(*) filter (where p.result = 'won')::int`;

const RANKED_BY_WINDOW =
    `rank() over (order by sum(p.xp) desc, count(*) filter (where p.result = 'won') desc, u.handle asc)`;

/**
 * One page of the board, and whether there is another.
 *
 * The query asks for one row more than a page so "is there more" needs no second count, which is
 * the same trick `matches/history` uses. The cursor is the last rank ACTUALLY shown, so the next
 * page continues the numbering rather than restarting it.
 *
 * Both boards go through here because both had the same bug available to them: a `limit` with no
 * cursor and a rank the client invented from its array index, which is correct only on page one.
 */
function page(game: string, window: LeaderboardWindow, rows: BoardRow[]): Leaderboard
{
    const shown = rows.slice(0, BOARD_SIZE);
    const more = rows.length > BOARD_SIZE;

    return {
        game,
        window,
        standings: shown.map(asStanding),
        ...(more && shown.length > 0 ? { cursor: Number(shown[shown.length - 1].rank) } : {})
    };
}

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
    const factsFor = async (tx: EntityManager, userId: string, streak: number | null, seated: boolean): Promise<AchievementFacts> =>
    {
        const rows = await tx.getRepository(PlayerStats).find({ where: { userId } });
        const found = await history(tx, userId);
        const total = (pick: (row: PlayerStats) => number): number => rows.reduce((sum, row) => sum + pick(row), 0);

        return {
            played: total((row) => row.played),
            won: total((row) => row.won),
            abandoned: total((row) => row.abandoned),
            streak: streak ?? Math.max(0, ...rows.map((row) => row.streak)),
            distinctDays: found.days,
            seated,
            hostedFull: found.hosted,
            crewTen: found.crew,
            games: Object.fromEntries(rows.map((row) => [row.game, {
                played: row.played,
                won: row.won,
                tallies: Object.fromEntries(Object.entries(row.tallies ?? {}).map(([name, value]) => [name, Number(value)]))
            }]))
        };
    };

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
        async record(tx: EntityManager, userId: string, matchId: string, streak: number): Promise<void>
        {
            await grant(tx, userId, matchId, earnedBy(await factsFor(tx, userId, streak, true)));
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
        async leaderboardOf(game: string, window: LeaderboardWindow, after?: number): Promise<Leaderboard>
        {
            if (window === 'all')
            {
                const rows = await db.createQueryBuilder()
                    .select('board.*')
                    .from((inner) => inner
                        .select('u.handle::text', 'handle')
                        .addSelect('u.display_name', 'display_name')
                        .addSelect('u.hue', 'hue')
                        .addSelect('s.rating', 'rating')
                        .addSelect('s.played', 'played')
                        .addSelect('s.won', 'won')
                        .addSelect('s.xp', 'xp')
                        .addSelect(RANKED_BY_TOTAL, 'rank')
                        .from(PlayerStats, 's')
                        .innerJoin(User, 'u', 'u.id = s.user_id')
                        .where('s.game = :game and s.played >= :floor', { game, floor: MIN_PLAYED }),
                    'board')
                    .where('CAST(:after AS int) is null or board.rank > CAST(:after AS int)', { after: after ?? null })
                    .orderBy('board.rank')
                    .limit(BOARD_SIZE + 1)
                    .getRawMany<BoardRow>();

                return page(game, window, rows);
            }

            /**
             * `date_trunc` over Postgres `now()`, never a date this process computed, and pinned to
             * UTC rather than to whatever the connection's `TimeZone` happens to be.
             *
             * `finished_at` was written by Postgres, so a boundary from the Node clock would be
             * compared against it across whatever skew there is between the two - the same reason
             * every session and expiry predicate in this server stays on the database's clock.
             *
             * The `at time zone` pair is what makes "today" mean one thing. Bare `date_trunc` over
             * a `timestamptz` truncates in the SESSION's timezone, which is a server setting rather
             * than a decision: the same deployment moved between two machines answers a different
             * board, and a pooled connection could in principle answer a different one from its
             * neighbour. Stated in UTC it is a documented limitation - somebody in Tehran sees a
             * board that turns over at UTC midnight - rather than an accident of configuration.
             */
            const rows = await db.createQueryBuilder()
                .select('board.*')
                .from((inner) => inner
                    .select('u.handle::text', 'handle')
                    .addSelect('max(u.display_name)', 'display_name')
                    .addSelect('max(u.hue)::int', 'hue')
                    .addSelect('coalesce(max(s.rating), 1200)::int', 'rating')
                    .addSelect('count(*)::int', 'played')
                    .addSelect(WON, 'won')
                    .addSelect('sum(p.xp)::int', 'xp')
                    .addSelect(RANKED_BY_WINDOW, 'rank')
                    .from(MatchPlayer, 'p')
                    .innerJoin(Match, 'm', 'm.id = p.match_id')
                    .innerJoin(User, 'u', 'u.id = p.user_id')
                    .leftJoin(PlayerStats, 's', 's.user_id = p.user_id and s.game = m.game')
                    .where('m.game = :game', { game })
                    .andWhere('m.finished_at is not null')
                    .andWhere(
                        `m.finished_at >= (date_trunc(:span, (now() at time zone 'utc')) at time zone 'utc')`,
                        { span: SPANS[window] }
                    )
                    .groupBy('u.handle')
                    .having('sum(p.xp) > 0'),
                'board')
                .where('CAST(:after AS int) is null or board.rank > CAST(:after AS int)', { after: after ?? null })
                .orderBy('board.rank')
                .limit(BOARD_SIZE + 1)
                .getRawMany<BoardRow>();

            return page(game, window, rows);
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

            const seated = standing.some((row) => row.id === 'first-seat' && row.earned_at !== null);
            const progress = progressOf(await factsFor(db.manager, who.id, null, seated));

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
                    tallies: row.tallies,
                    xp: row.xp
                })),
                achievements: standing.map((row) => ({
                    id: row.id,
                    name: { en: row.name_en, fa: row.name_fa },
                    blurb: { en: row.blurb_en, fa: row.blurb_fa },
                    icon: row.icon,
                    tier: row.tier,
                    ...(ACHIEVEMENT_GAME[row.id] === undefined ? {} : { game: ACHIEVEMENT_GAME[row.id] }),
                    ...(row.earned_at === null ? {} : { earnedAt: new Date(row.earned_at).toISOString() }),
                    ...(row.earned_at === null && (progress.get(row.id)?.need ?? 1) > 1 ? { progress: progress.get(row.id)! } : {})
                }))
            };
        }
    };
}

export type AchieveService = ReturnType<typeof createAchieveService>;
