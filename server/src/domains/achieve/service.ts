import { In, type DataSource, type EntityManager } from 'typeorm';

import { Match, MatchPlayer, PlayerStats, Table, User, UserAchievement } from '../../entities/index.ts';
import type { AchievementFamily, AchievementLadder, AchievementSummary, EarnedAchievement, Leaderboard, LeaderboardWindow, PersonRecord, Standing } from '../../schemas.ts';
import { GAME_FAMILIES, RUNGS, familiesOf } from './families.ts';
import { measure, reached, rungId, scopeOf, type Family, type GlobalFacts, type LadderFacts, type Pace, type Rung } from './ladders.ts';
import { levelOf } from '../match/levels.ts';

interface Facts
{
    games: ReadonlyMap<string, LadderFacts>;
    global: GlobalFacts;
}

interface SplitRow
{
    game: string;
    seats: number;
    mode: Pace;
    played: number;
    won: number;
}

interface DaysRow
{
    game: string | null;
    days: number;
}

interface HeldRow
{
    achievementId: string;
    earnedAt: Date;
}

const RUNG_BY_ID: ReadonlyMap<string, Rung> = new Map(RUNGS.map((rung) => [rung.id, rung]));

const SCOPES: readonly (string | null)[] = [null, ...Object.keys(GAME_FAMILIES)];

const RECENT = 12;

const FINISHED = 'p.user_id = :userId and p.result is not null and m.finished_at is not null';

const blank = (): LadderFacts => ({
    played: 0,
    won: 0,
    xp: 0,
    days: 0,
    peak: 0,
    streak: 0,
    tallies: {},
    seats: {},
    pace: { live: { played: 0, won: 0 }, turns: { played: 0, won: 0 } }
});

async function factsOf(runner: EntityManager, userId: string): Promise<Facts>
{
    const stats = await runner.getRepository(PlayerStats).find({ where: { userId } });

    const split = await runner.getRepository(MatchPlayer)
        .createQueryBuilder('p')
        .innerJoin(Match, 'm', 'm.id = p.match_id')
        .innerJoin(Table, 't', 't.id = m.table_id')
        .select('m.game', 'game')
        .addSelect('m.seats', 'seats')
        .addSelect('t.mode', 'mode')
        .addSelect('count(*)::int', 'played')
        .addSelect(`count(*) filter (where p.result = 'won' and m.outcome = 'won')::int`, 'won')
        .where(FINISHED, { userId })
        .groupBy('m.game')
        .addGroupBy('m.seats')
        .addGroupBy('t.mode')
        .getRawMany<SplitRow>();

    const days = await runner.getRepository(MatchPlayer)
        .createQueryBuilder('p')
        .innerJoin(Match, 'm', 'm.id = p.match_id')
        .select('m.game', 'game')
        .addSelect(`count(distinct ((m.finished_at at time zone 'utc')::date))::int`, 'days')
        .where(FINISHED, { userId })
        .groupBy('grouping sets ((m.game), ())')
        .getRawMany<DaysRow>();

    const opponents = await runner.getRepository(MatchPlayer)
        .createQueryBuilder('p')
        .innerJoin(Match, 'm', 'm.id = p.match_id')
        .innerJoin(MatchPlayer, 'o', 'o.match_id = p.match_id and o.user_id <> p.user_id')
        .select('count(distinct o.user_id)::int', 'count')
        .where(FINISHED, { userId })
        .getRawOne<{ count: number }>();

    const hosted = await runner.getRepository(Table)
        .createQueryBuilder('t')
        .innerJoin(Match, 'm', 'm.table_id = t.id')
        .select('count(distinct t.id)::int', 'count')
        .where(`t.host_id = :userId and m.outcome = 'won'`, { userId })
        .getRawOne<{ count: number }>();

    const games = new Map<string, LadderFacts>();
    const of = (game: string): LadderFacts =>
    {
        const found = games.get(game) ?? blank();

        games.set(game, found);

        return found;
    };

    for (const row of stats)
    {
        Object.assign(of(row.game), {
            played: row.played,
            won: row.won,
            xp: row.xp,
            peak: row.peakRating,
            streak: row.bestStreak,
            tallies: Object.fromEntries(Object.entries(row.tallies ?? {}).map(([name, value]) => [name, Number(value)]))
        });
    }

    for (const row of split)
    {
        const facts = of(row.game);
        const seats = facts.seats as Record<number, { played: number; won: number }>;
        const at = seats[row.seats] ?? { played: 0, won: 0 };

        seats[row.seats] = { played: at.played + row.played, won: at.won + row.won };
        facts.pace[row.mode].played += row.played;
        facts.pace[row.mode].won += row.won;
    }

    for (const row of days)
    {
        if (row.game !== null)
        {
            of(row.game).days = row.days;
        }
    }

    const wins = (keep: (row: SplitRow) => boolean): number => split.filter(keep).reduce((total, row) => total + row.won, 0);
    const xp = stats.reduce((total, row) => total + row.xp, 0);

    return {
        games,
        global: {
            played: stats.reduce((total, row) => total + row.played, 0),
            won: stats.reduce((total, row) => total + row.won, 0),
            xp,
            level: levelOf(xp).level,
            days: days.find((row) => row.game === null)?.days ?? 0,
            hosted: hosted?.count ?? 0,
            opponents: opponents?.count ?? 0,
            peak: Math.max(0, ...stats.map((row) => row.peakRating)),
            streak: Math.max(0, ...stats.map((row) => row.bestStreak)),
            wonFull: wins((row) => row.seats >= 4),
            wonTurns: wins((row) => row.mode === 'turns'),
            wonLive: wins((row) => row.mode === 'live'),
            wonDuel: wins((row) => row.seats === 2)
        }
    };
}

const valueOf = (facts: Facts, game: string | null, family: Family): number =>
    measure((game === null ? undefined : facts.games.get(game)) ?? blank(), facts.global, family.metric);

const reachedIn = (facts: Facts, game: string | null): string[] =>
    familiesOf(game).flatMap((family) =>
        Array.from({ length: reached(family.steps, valueOf(facts, game, family)) }, (_, index) => rungId(game, family.id, index + 1)));

function summaryOf(facts: Facts, game: string | null, family: Family, held: ReadonlyMap<string, Date>): AchievementFamily
{
    const rungs = family.steps.map((_, index) => RUNG_BY_ID.get(rungId(game, family.id, index + 1))!);
    const earned = rungs.filter((rung) => held.has(rung.id));
    const top = earned.at(-1);
    const next = rungs.find((rung) => !held.has(rung.id));

    return {
        id: family.id,
        ...(game === null ? {} : { game }),
        icon: family.icon,
        name: family.title,
        have: valueOf(facts, game, family),
        earned: earned.length,
        total: rungs.length,
        ...(top === undefined ? {} : { tier: top.tier }),
        ...(next === undefined ? {} : { next: { step: next.step, need: next.need, tier: next.tier, blurb: { en: next.blurbEn, fa: next.blurbFa } } })
    };
}

const asEarned = (rung: Rung, earnedAt: Date): EarnedAchievement => ({
    id: rung.id,
    name: { en: rung.nameEn, fa: rung.nameFa },
    blurb: { en: rung.blurbEn, fa: rung.blurbFa },
    icon: rung.icon,
    tier: rung.tier,
    ...(rung.game === null ? {} : { game: rung.game }),
    earnedAt: new Date(earnedAt).toISOString()
});

function summarise(facts: Facts, held: readonly HeldRow[]): AchievementSummary
{
    const when = new Map(held.map((row) => [row.achievementId, row.earnedAt]));
    const known = held.filter((row) => RUNG_BY_ID.has(row.achievementId));

    return {
        scopes: SCOPES.map((game) =>
        {
            const prefix = `${ scopeOf(game) }-`;

            return {
                ...(game === null ? {} : { game }),
                earned: known.filter((row) => row.achievementId.startsWith(prefix)).length,
                total: RUNGS.filter((rung) => rung.game === game).length
            };
        }),
        families: SCOPES.flatMap((game) => familiesOf(game).map((family) => summaryOf(facts, game, family, when))),
        recent: [...known]
            .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime() || b.achievementId.localeCompare(a.achievementId))
            .slice(0, RECENT)
            .map((row) => asEarned(RUNG_BY_ID.get(row.achievementId)!, row.earnedAt))
    };
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
    const userOf = (handle: string): Promise<User | null> =>
        db.getRepository(User).findOne({ select: { id: true, handle: true }, where: { handle } });

    const heldBy = (userId: string, ids?: readonly string[]): Promise<HeldRow[]> =>
        db.getRepository(UserAchievement).find({
            select: { achievementId: true, earnedAt: true },
            where: ids === undefined ? { userId } : { userId, achievementId: In([...ids]) }
        });

    return {
        async record(tx: EntityManager, userId: string, matchId: string, game: string): Promise<void>
        {
            const facts = await factsOf(tx, userId);
            const ids = [...reachedIn(facts, null), ...reachedIn(facts, game)];

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
        },

        async ladderOf(handle: string, game: string | null, id: string): Promise<AchievementLadder | null>
        {
            const family = familiesOf(game).find((one) => one.id === id);
            const who = family === undefined ? null : await userOf(handle);

            if (family === undefined || who === null)
            {
                return null;
            }

            const rungs = family.steps.map((_, index) => RUNG_BY_ID.get(rungId(game, family.id, index + 1))!);
            const held = await heldBy(who.id, rungs.map((rung) => rung.id));
            const when = new Map(held.map((row) => [row.achievementId, row.earnedAt]));

            return {
                family: summaryOf(await factsOf(db.manager, who.id), game, family, when),
                rungs: rungs.map((rung) => ({
                    step: rung.step,
                    need: rung.need,
                    tier: rung.tier,
                    name: { en: rung.nameEn, fa: rung.nameFa },
                    blurb: { en: rung.blurbEn, fa: rung.blurbFa },
                    ...(when.has(rung.id) ? { earnedAt: new Date(when.get(rung.id)!).toISOString() } : {})
                }))
            };
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

        async recordOf(handle: string): Promise<PersonRecord | null>
        {
            const who = await userOf(handle);

            if (who === null)
            {
                return null;
            }

            const games = await db.getRepository(PlayerStats).find({
                where: { userId: who.id },
                order: { played: 'DESC', game: 'ASC' }
            });

            return {
                handle: who.handle,
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
                achievements: summarise(await factsOf(db.manager, who.id), await heldBy(who.id))
            };
        }
    };
}

export type AchieveService = ReturnType<typeof createAchieveService>;
