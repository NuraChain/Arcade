import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createRecorder } from '../src/domains/match/record.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { FINISHED, YARD } from '../src/domains/match/ludo/board.ts';
import type { LudoState } from '../src/domains/match/ludo/state.ts';

/**
 * What a finished match does to everybody's record, against a real database.
 *
 * The arithmetic is already pinned in `rating.spec.ts` with no Postgres anywhere near it. These are
 * the claims that are only true of the DATABASE: that the rating a match records and the rating the
 * profile reads are the same number, that awarding the same achievement twice writes one row
 * because the primary key says so, that a `player_stats` upsert accumulates rather than replaces,
 * and that every CHECK on the way in accepts what the recorder actually writes. A fake DataSource
 * could only prove the fake agrees with the code.
 *
 * The board states here are BUILT rather than played. `ludo-pass.mjs` plays hundreds of real turns
 * over the api and is where "the rules work" is settled; what this needs is a finished position of
 * a precise shape - a genuine win, a room that emptied - reached in one line rather than in four
 * hundred rolls of a real die.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;

let seq = 0;

const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

const makeUser = async (): Promise<string> =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`r${ seq }x${ Date.now() % 100000 }`, `Record ${ seq }`, seq % 360]
    ))[0].id;
};

const board = (pieces: number[][], winner: number | null, out: boolean[] = []): LudoState => ({
    v: 1,
    game: 'ludo',
    players: pieces.map((set, index) => ({
        seat: index,
        colour: (['red', 'green', 'yellow', 'blue'] as const)[index],
        pieces: set,
        out: out[index] === true
    })),
    turn: 0,
    die: null,
    sixes: 0,
    rev: 2,
    winner
});

/** A finished match with its players already resulted, exactly as `commit` leaves one. */
const finished = async (
    state: LudoState,
    results: ('won' | 'lost' | 'abandoned')[],
    outcome: 'won' | 'abandoned'
): Promise<{ matchId: string; players: string[] }> =>
{
    const players: string[] = [];

    for (let index = 0; index < state.players.length; index += 1)
    {
        players.push(await makeUser());
    }

    const tableId = rowsOf<{ id: string }>(await db.query(
        `insert into tables (game, code, host_id, seats, mode, privacy, target, cube, blinds)
         values ('ludo', $3, $1, $2, 'live', 'public', 0, false, 'low')
         returning id`,
        [players[0], state.players.length, `t${ seq }${ Math.floor(Math.random() * 1000000) }`]
    ))[0].id;

    const matchId = rowsOf<{ id: string }>(await db.query(
        `insert into matches (table_id, game, variant, seats, state, rev, winner_seat, outcome, finished_at)
         values ($1, 'ludo', 'standard', $2, $3::jsonb, $4, $5, $6, now())
         returning id`,
        [
            tableId,
            state.players.length,
            JSON.stringify(state),
            state.rev,
            state.winner === null ? null : state.players[state.winner].seat,
            outcome
        ]
    ))[0].id;

    for (const [seat, userId] of players.entries())
    {
        await db.query(
            `insert into match_players (match_id, seat, user_id, result)
             values ($1, $2, $3, $4)`,
            [matchId, seat, userId, results[seat]]
        );
    }

    return { matchId, players };
};

interface Stats
{
    rating: number;
    peak_rating: number;
    played: number;
    won: number;
    abandoned: number;
    streak: number;
    best_streak: number;
    tallies: Record<string, number>;
}

const statsOf = async (userId: string): Promise<Stats | undefined> =>
    rowsOf<Stats>(await db.query(
        `select rating, peak_rating, played, won, abandoned, streak, best_streak, tallies
           from player_stats where user_id = $1 and game = 'ludo'`,
        [userId]
    ))[0];

const heldBy = async (userId: string): Promise<string[]> =>
    rowsOf<{ achievement_id: string }>(await db.query(
        `select achievement_id from user_achievements where user_id = $1 order by achievement_id`,
        [userId]
    )).map((row) => row.achievement_id);

describe.skipIf(!active)('a record, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 120_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.query('truncate tables cascade');
        await db.query('delete from users');
    });

    const recorder = (): ReturnType<typeof createRecorder> => createRecorder(createAchieveService(db));

    describe('a game somebody won', () =>
    {
        it('moves both ratings, in opposite directions, by the same amount', async () =>
        {
            const state = board([HOME, [12, YARD, YARD, YARD]], 0);
            const { matchId, players } = await finished(state, ['won', 'lost'], 'won');

            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));

            const winner = await statsOf(players[0]);
            const loser = await statsOf(players[1]);

            expect(winner?.rating).toBe(1216);
            expect(loser?.rating).toBe(1184);
            expect(winner?.won).toBe(1);
            expect(loser?.won).toBe(0);
            expect(winner?.streak).toBe(1);

            /**
             * A peak is the highest rating somebody has ever HELD, and everybody starts at 1200 -
             * so a first game that ends in a loss records a peak of 1200, not of the number they
             * dropped to. Taking it from the new rating alone gave a new player a personal best
             * they had never once been below.
             */
            expect(loser?.peak_rating).toBe(1200);
            expect(winner?.peak_rating).toBe(1216);
        });

        /**
         * The number the profile shows and the number the history row shows have to be the same
         * one, or a person reading their own games back finds a rating that never adds up.
         */
        it('writes the same move onto the match row it wrote into the record', async () =>
        {
            const state = board([HOME, [12, YARD, YARD, YARD]], 0);
            const { matchId, players } = await finished(state, ['won', 'lost'], 'won');

            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));

            const rows = rowsOf<{ seat: number; rating_before: number; rating_after: number }>(await db.query(
                `select seat, rating_before, rating_after from match_players where match_id = $1 order by seat`,
                [matchId]
            ));

            expect(rows[0].rating_before).toBe(1200);
            expect(rows[0].rating_after).toBe((await statsOf(players[0]))?.rating);
            expect(rows[1].rating_after).toBe((await statsOf(players[1]))?.rating);
        });

        it('tallies what the ledger says each seat did', async () =>
        {
            const state = board([HOME, [12, YARD, YARD, YARD]], 0);
            const { matchId, players } = await finished(state, ['won', 'lost'], 'won');

            await db.query(
                `insert into match_actions (match_id, rev, seat, kind, payload, events, state)
                 values ($1, 1, 0, 'play', '{"die": 6}'::jsonb, $2::jsonb, $3::jsonb)`,
                [matchId, JSON.stringify([
                    { e: 'roll', seat: 0, die: 6 },
                    { e: 'capture', seat: 0, piece: 1, victim: 1, victimPiece: 0 },
                    { e: 'home', seat: 0, piece: 2 },
                    { e: 'roll', seat: 1, die: 3 }
                ]), JSON.stringify(state)]
            );

            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));

            const winner = await statsOf(players[0]);

            expect(winner?.tallies).toEqual({ rolls: 1, captures: 1, home: 1 });
            expect((await statsOf(players[1]))?.tallies).toEqual({ rolls: 1 });
        });

        it('awards a first win, and the same award twice is one row', async () =>
        {
            const state = board([HOME, [12, YARD, YARD, YARD]], 0);
            const { matchId, players } = await finished(state, ['won', 'lost'], 'won');

            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));
            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));

            expect(await heldBy(players[0])).toContain('first-win');
            expect(await heldBy(players[1])).not.toContain('first-win');
        });
    });

    describe('a room that emptied', () =>
    {
        /**
         * The rating farm this exists to close: two accounts sit down, one walks out, and the
         * engine declares the other the winner because they are the last one playing. Paying a
         * rating for that makes quitting a service somebody performs for a friend.
         */
        it('moves no rating at all', async () =>
        {
            const state = board([[3, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, [false, true]);
            const { matchId, players } = await finished(state, ['won', 'abandoned'], 'abandoned');

            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));

            expect((await statsOf(players[0]))?.rating).toBe(1200);
            expect((await statsOf(players[1]))?.rating).toBe(1200);
        });

        it('still records that it happened, and who walked out', async () =>
        {
            const state = board([[3, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, [false, true]);
            const { matchId, players } = await finished(state, ['won', 'abandoned'], 'abandoned');

            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));

            expect((await statsOf(players[0]))?.played).toBe(1);
            expect((await statsOf(players[0]))?.won).toBe(0);
            expect((await statsOf(players[1]))?.abandoned).toBe(1);
        });

        it('gives nobody a win that never happened', async () =>
        {
            const state = board([[3, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, [false, true]);
            const { matchId, players } = await finished(state, ['won', 'abandoned'], 'abandoned');

            await db.transaction((tx) => recorder().finish(tx, matchId, ludoEngine, state));

            expect(await heldBy(players[0])).not.toContain('first-win');
        });
    });

    /**
     * The board's own numbers, which nothing but a real Postgres can settle.
     *
     * The rank comes from a window function over EVERY row, so it is the one thing here a repository
     * cannot express - and it used to be the client's array index, which is right only while the
     * board is one page starting at the top. Paging it is what made that wrong, and a pinned "you"
     * row would have made it wrong again.
     */
    describe('the leaderboard', () =>
    {
        const stat = async (user: string, xp: number, rating: number, played: number): Promise<void> =>
        {
            await db.query(
                `insert into player_stats (user_id, game, rating, peak_rating, played, won, xp)
                 values ($1, 'ludo', $2, $2, $3, 0, $4)
                 on conflict (user_id, game) do update
                     set rating = $2, peak_rating = $2, played = $3, xp = $4`,
                [user, rating, played, xp]
            );
        };

        it('counts the rank itself, and gives every row its own number', async () =>
        {
            const achieve = createAchieveService(db);

            const top = await makeUser();
            const tiedA = await makeUser();
            const tiedB = await makeUser();
            const last = await makeUser();

            await stat(top, 500, 1300, 9);
            await stat(tiedA, 300, 1250, 9);
            await stat(tiedB, 300, 1250, 9);
            await stat(last, 100, 1200, 9);

            const board = await achieve.leaderboardOf('ludo', 'all');
            const ranks = new Map(board.standings.map((row) => [row.handle, row.rank]));
            const handleOf = async (id: string): Promise<string> =>
                rowsOf<{ handle: string }>(await db.query('select handle from users where id = $1', [id]))[0].handle;

            expect(ranks.get(await handleOf(top))).toBe(1);

            /*
             * Level on XP and on rating, and still given two different numbers - because `handle` is
             * inside the window's own ORDER BY. Sharing a number would read as fairer and would lose
             * rows: the cursor is "everything after rank 20", so two rows both ranked 20 put the
             * second on neither page.
             */
            const tied = [ranks.get(await handleOf(tiedA)), ranks.get(await handleOf(tiedB))].sort();

            expect(tied, 'a tie shared a rank, which the cursor cannot page past').toEqual([2, 3]);
            expect(ranks.get(await handleOf(last))).toBe(4);
        });

        it('pages without repeating a row, and the numbers carry across the join', async () =>
        {
            const achieve = createAchieveService(db);

            for (let index = 0; index < 25; index += 1)
            {
                await stat(await makeUser(), 1000 - index, 1200, 9);
            }

            const first = await achieve.leaderboardOf('ludo', 'all');

            expect(first.standings).toHaveLength(20);
            expect(first.standings[0].rank).toBe(1);
            expect(first.standings[19].rank).toBe(20);
            expect(first.cursor, 'a full page did not offer the next one').toBe(20);

            const second = await achieve.leaderboardOf('ludo', 'all', first.cursor);

            expect(second.standings).toHaveLength(5);
            expect(second.standings[0].rank, 'the second page restarted the numbering').toBe(21);
            expect(second.cursor, 'the last page offered another').toBeUndefined();

            const seen = [...first.standings, ...second.standings].map((row) => row.handle);

            expect(new Set(seen).size, 'a row appeared on both pages').toBe(25);
        });

        it('says nothing more when there is nothing more', async () =>
        {
            const achieve = createAchieveService(db);

            await stat(await makeUser(), 10, 1200, 9);

            const only = await achieve.leaderboardOf('ludo', 'all');

            expect(only.standings).toHaveLength(1);
            expect(only.cursor).toBeUndefined();
        });
    });

    describe('a record that accumulates', () =>
    {
        it('adds to the row rather than replacing it, and remembers the peak', async () =>
        {
            const winning = board([HOME, [12, YARD, YARD, YARD]], 0);
            const first = await finished(winning, ['won', 'lost'], 'won');

            await db.transaction((tx) => recorder().finish(tx, first.matchId, ludoEngine, winning));

            const after = await statsOf(first.players[0]);

            await db.query(
                `insert into player_stats (user_id, game, rating, peak_rating, played, won)
                 values ($1, 'ludo', 1400, 1400, 9, 9)
                 on conflict (user_id, game) do update set rating = 1400, peak_rating = 1400, played = 9, won = 9`,
                [first.players[0]]
            );

            const losing = board([[12, YARD, YARD, YARD], HOME], 1);
            const second = await finished(losing, ['lost', 'won'], 'won');

            await db.query(`update match_players set user_id = $1 where match_id = $2 and seat = 0`, [first.players[0], second.matchId]);
            await db.transaction((tx) => recorder().finish(tx, second.matchId, ludoEngine, losing));

            const now = await statsOf(first.players[0]);

            expect(after?.rating).toBe(1216);
            expect(now?.played).toBe(10);
            expect(now?.rating).toBeLessThan(1400);
            expect(now?.peak_rating).toBe(1400);
            expect(now?.streak).toBe(0);
        });

        /**
         * The property the three integer columns had for free and a jsonb object does NOT.
         *
         * Postgres has no operator that adds two jsonb objects of numbers: `||` replaces a key
         * rather than summing it, so two games finishing for one person would record the second and
         * forget the first - the same defect the read-modify-write had, reintroduced by the storage
         * changing shape. Summing both key sets inside the one statement the unique index
         * serialises is what keeps it addition.
         *
         * Each match writes an event ledger of its own, so the expected total is the sum across
         * both rather than either one.
         */
        it('adds the tallies up rather than overwriting them', async () =>
        {
            const state = board([HOME, [12, YARD, YARD, YARD]], 0);

            const rolls = async (matchId: string, count: number): Promise<void> =>
            {
                await db.query(
                    `insert into match_actions (match_id, rev, seat, kind, payload, events, state)
                     values ($1, 1, 0, 'play', '{}'::jsonb, $2::jsonb, $3::jsonb)`,
                    [
                        matchId,
                        JSON.stringify(Array.from({ length: count }, () => ({ e: 'roll', seat: 0, die: 4 }))),
                        JSON.stringify(state)
                    ]
                );
            };

            const first = await finished(state, ['won', 'lost'], 'won');

            await rolls(first.matchId, 3);
            await db.transaction((tx) => recorder().finish(tx, first.matchId, ludoEngine, state));

            expect((await statsOf(first.players[0]))?.tallies).toEqual({ rolls: 3 });

            const second = await finished(state, ['won', 'lost'], 'won');

            await db.query(`update match_players set user_id = $1 where match_id = $2 and seat = 0`, [first.players[0], second.matchId]);
            await rolls(second.matchId, 2);
            await db.transaction((tx) => recorder().finish(tx, second.matchId, ludoEngine, state));

            expect((await statsOf(first.players[0]))?.tallies).toEqual({ rolls: 5 });
        });
    });
});
