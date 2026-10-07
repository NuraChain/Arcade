import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, type EntityManager } from 'typeorm';

import { Match, entities } from '../src/entities/index.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createRecorder } from '../src/domains/match/record.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import { FINISHED, YARD } from '../src/domains/match/ludo/board.ts';
import type { LudoState } from '../src/domains/match/ludo/state.ts';
import type { PokerState } from '../src/domains/match/poker/state.ts';
import type { Variant } from '../src/domains/match/sides.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;

let seq = 0;

const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

const ENGAGED = ludoEngine.engagement({ seats: 2, variant: 'standard' }).after;

const makeUser = async () =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`r${ seq }x${ Date.now() % 100000 }`, `Record ${ seq }`, seq % 360]
    ))[0].id;
};

const board = (pieces: number[][], winner: number | null, out: boolean[] = [], sides: number[] = []): LudoState => ({
    v: 1,
    game: 'ludo',
    players: pieces.map((set, index) => ({
        seat: index,
        colour: (['red', 'green', 'yellow', 'blue'] as const)[index],
        pieces: set,
        out: out[index] === true,
        side: sides[index] ?? index
    })),
    turn: 0,
    die: null,
    sixes: 0,
    rev: 2,
    winner
});

const WON = () => board([HOME, [12, YARD, YARD, YARD]], 0);

const EMPTIED = () => board([[3, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, [false, true]);

const FOUR = () => board([HOME, [12, YARD, YARD, YARD], [30, 5, YARD, YARD], [8, YARD, YARD, YARD]], 0);

const PAIRS = () => board([HOME, [12, YARD, YARD, YARD], HOME, [8, YARD, YARD, YARD]], 0, [], [0, 1, 0, 1]);

interface Ledger
{
    own?: number[];
    auto?: number[];
    quits?: { seat: number; walked: boolean }[];
    later?: number[];
    players?: string[];
    variant?: Variant;
}

const seatsOf = (state: LudoState | PokerState) => (state.game === 'ludo' ? state.players.length : state.seats);

const played = async (state: LudoState | PokerState, ledger: Ledger = {}): Promise<{ matchId: string; players: string[] }> =>
{
    const players = [...(ledger.players ?? [])];
    const verb = state.game === 'ludo' ? 'roll' : 'call';
    const variant = ledger.variant ?? 'standard';

    while (players.length < seatsOf(state))
    {
        players.push(await makeUser());
    }

    const tableId = rowsOf<{ id: string }>(await db.query(
        `insert into tables (game, code, host_id, seats, mode, privacy, target, cube, blinds, chat, voice, teams)
         values ($4, $3, $1, $2, 'live', 'public', 0, false, 'low', true, 'off', $5)
         returning id`,
        [players[0], seatsOf(state), `t${ seq }${ Math.floor(Math.random() * 1000000) }`, state.game, variant === 'teams']
    ))[0].id;

    const matchId = rowsOf<{ id: string }>(await db.query(
        `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
         values ($1, $5, $6, $2, $3::jsonb, $4, now() + interval '1 hour')
         returning id`,
        [tableId, seatsOf(state), JSON.stringify(state), state.rev, state.game, variant]
    ))[0].id;

    const quits = ledger.quits ?? [];

    for (const [seat, userId] of players.entries())
    {
        await db.query(
            `insert into match_players (match_id, seat, user_id, result) values ($1, $2, $3, $4)`,
            [matchId, seat, userId, quits.some((one) => one.seat === seat) ? 'abandoned' : null]
        );
    }

    let rev = 0;

    const write = async (seat: number, userId: string | null, kind: 'play' | 'forfeit', payload: Record<string, unknown>) =>
    {
        rev += 1;

        await db.query(
            `insert into match_actions (match_id, rev, seat, user_id, kind, payload, events, state)
             values ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, $7::jsonb)`,
            [matchId, rev, seat, userId, kind, JSON.stringify(payload), JSON.stringify(state)]
        );
    };

    for (const [seat, userId] of players.entries())
    {
        for (let roll = 0; roll < (ledger.own?.[seat] ?? 0); roll += 1)
        {
            await write(seat, userId, 'play', { kind: state.game, verb });
        }

        for (let roll = 0; roll < (ledger.auto?.[seat] ?? 0); roll += 1)
        {
            await write(seat, null, 'play', { kind: state.game, verb });
        }
    }

    for (const quit of quits)
    {
        await write(quit.seat, quit.walked ? players[quit.seat] : null, 'forfeit', { verb: quit.walked ? 'resign' : 'timeout' });
    }

    for (const [seat, userId] of players.entries())
    {
        for (let move = 0; move < (ledger.later?.[seat] ?? 0); move += 1)
        {
            await write(seat, userId, 'play', { kind: state.game, verb });
        }
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
    xp: number;
}

const statsOf = async (userId: string, game = 'ludo'): Promise<Stats | undefined> =>
    rowsOf<Stats>(await db.query(
        `select rating, peak_rating, played, won, abandoned, streak, best_streak, tallies, xp
           from player_stats where user_id = $1 and game = $2`,
        [userId, game]
    ))[0];

const seatOf = async (matchId: string, seat: number) =>
    rowsOf<{ result: string; xp: number; rating_before: number | null; rating_after: number | null }>(await db.query(
        `select result, xp, rating_before, rating_after from match_players where match_id = $1 and seat = $2`,
        [matchId, seat]
    ))[0];

const matchOf = async (matchId: string) =>
    rowsOf<{ outcome: string; winner_seat: number | null; finished: boolean; deadline_at: Date | null }>(await db.query(
        `select outcome, winner_seat, finished_at is not null as finished, deadline_at from matches where id = $1`,
        [matchId]
    ))[0];

const heldBy = async (userId: string): Promise<string[]> =>
    rowsOf<{ achievement_id: string }>(await db.query(
        `select achievement_id from user_achievements where user_id = $1 order by achievement_id`,
        [userId]
    )).map((row) => row.achievement_id);

const seedStats = async (userId: string, row: { rating: number; played: number; won: number; streak: number }) =>
{
    await db.query(
        `insert into player_stats (user_id, game, rating, peak_rating, played, won, streak, best_streak)
         values ($1, 'ludo', $2, $2, $3, $4, $5, $5)`,
        [userId, row.rating, row.played, row.won, row.streak]
    );
};

const waitingOnLocks = async () =>
    rowsOf<{ count: number }>(await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ))[0].count;

const atOnce = async (matchIds: string[], run: () => Promise<unknown>) =>
{
    const gate = db.createQueryRunner();

    await gate.connect();
    await gate.startTransaction();
    await gate.query('select id from matches where id = any($1) for update', [matchIds]);

    const running = run();

    while (await waitingOnLocks() < matchIds.length)
    {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await gate.commitTransaction();
    await gate.release();
    await running;
};

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

    const recorder = () => createRecorder(createAchieveService(db));

    const rowOf = (tx: EntityManager, matchId: string) => tx.getRepository(Match).findOneByOrFail({ id: matchId });

    const finish = async (matchId: string, state: LudoState) =>
    {
        await db.transaction(async (tx) => recorder().finish(tx, await rowOf(tx, matchId), ludoEngine, state, ludoEngine.finish(state)!));
    };

    describe('a game somebody won', () =>
    {
        it('moves both ratings, in opposite directions, by the same amount', async () =>
        {
            const state = WON();
            const { matchId, players } = await played(state);

            await finish(matchId, state);

            const winner = await statsOf(players[0]);
            const loser = await statsOf(players[1]);

            expect(winner?.rating).toBe(1216);
            expect(loser?.rating).toBe(1184);
            expect(winner?.won).toBe(1);
            expect(loser?.won).toBe(0);
            expect(winner?.streak).toBe(1);
            expect(loser?.peak_rating).toBe(1200);
            expect(winner?.peak_rating).toBe(1216);
        });

        it('finishes the match row itself, with the outcome and the seat that won', async () =>
        {
            const state = WON();
            const { matchId } = await played(state);

            await finish(matchId, state);

            expect(await matchOf(matchId)).toEqual({ outcome: 'won', winner_seat: 0, finished: true, deadline_at: null });
            expect((await seatOf(matchId, 0)).result).toBe('won');
            expect((await seatOf(matchId, 1)).result).toBe('lost');
        });

        it('writes the same move onto the match row it wrote into the record', async () =>
        {
            const state = WON();
            const { matchId, players } = await played(state);

            await finish(matchId, state);

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
            const state = WON();
            const { matchId, players } = await played(state);

            await db.query(
                `insert into match_actions (match_id, rev, seat, kind, payload, events, state)
                 values ($1, 900, 0, 'play', '{"die": 6}'::jsonb, $2::jsonb, $3::jsonb)`,
                [matchId, JSON.stringify([
                    { e: 'roll', seat: 0, die: 6 },
                    { e: 'capture', seat: 0, owner: 0, piece: 1, victim: 1, victimPiece: 0 },
                    { e: 'home', seat: 0, owner: 0, piece: 2 },
                    { e: 'roll', seat: 1, die: 3 }
                ]), JSON.stringify(state)]
            );

            await finish(matchId, state);

            const winner = await statsOf(players[0]);

            expect(winner?.tallies).toEqual({ rolls: 1, sixes: 1, captures: 1, home: 1 });
            expect((await statsOf(players[1]))?.tallies).toEqual({ rolls: 1 });
        });

        it('awards the first rung of every ladder the game climbed, and the same award twice is one row', async () =>
        {
            const state = WON();
            const { matchId, players } = await played(state);

            await finish(matchId, state);

            const once = await heldBy(players[0]);

            await finish(matchId, state);

            expect(once).toEqual(expect.arrayContaining([
                'all-won-1', 'all-played-1', 'all-days-1', 'all-hosted-1', 'all-opponents-1', 'all-won-live-1', 'all-won-duel-1',
                'ludo-won-1', 'ludo-played-1', 'ludo-won-2-1', 'ludo-played-2-1', 'ludo-won-live-1', 'ludo-played-live-1', 'ludo-days-1'
            ]));
            expect(once).not.toContain('ludo-won-turns-1');
            expect(once).not.toContain('all-won-full-1');
            expect(await heldBy(players[1])).not.toContain('ludo-won-1');
            expect(await heldBy(players[1])).toContain('ludo-played-1');

            const twice = await heldBy(players[0]);

            expect(new Set(twice).size).toBe(twice.length);
            expect(twice).toContain('ludo-played-2');
        });

        it('reads back as families, scopes and a ladder that agree with what was awarded', async () =>
        {
            const state = WON();
            const { matchId, players } = await played(state);

            await finish(matchId, state);

            const [{ handle }] = rowsOf<{ handle: string }>(await db.query('select handle::text from users where id = $1', [players[0]]));
            const achieve = createAchieveService(db);
            const record = await achieve.recordOf(handle);
            const held = await heldBy(players[0]);

            expect(record?.achievements.scopes).toEqual([
                { earned: held.filter((id) => id.startsWith('all-')).length, total: 1000 },
                { game: 'ludo', earned: held.filter((id) => id.startsWith('ludo-')).length, total: 1000 },
                { game: 'hokm', earned: 0, total: 1000 },
                { game: 'backgammon', earned: 0, total: 1000 },
                { game: 'poker', earned: 0, total: 1000 }
            ]);
            expect(record?.achievements.recent).toHaveLength(12);
            expect(record?.achievements.recent.every((one) => held.includes(one.id))).toBe(true);

            const won = record?.achievements.families.find((one) => one.game === 'ludo' && one.id === 'won');

            expect(won).toMatchObject({ have: 1, earned: 1, total: 70, tier: 'bronze', next: { step: 2, need: 2, tier: 'bronze' } });
            expect(won?.next?.blurb.en).toBe('Win 2 games of Ludo.');

            const ladder = await achieve.ladderOf(handle, 'ludo', 'won');

            expect(ladder?.rungs).toHaveLength(70);
            expect(ladder?.rungs[0].earnedAt).toBeDefined();
            expect(ladder?.rungs[1].earnedAt).toBeUndefined();
            expect(ladder?.rungs.at(-1)?.tier).toBe('diamond');
            expect(await achieve.ladderOf(handle, 'ludo', 'friends')).toBeNull();
            expect(await achieve.ladderOf(handle, 'chess', 'won')).toBeNull();
            expect(await achieve.ladderOf('nobody-here', null, 'won')).toBeNull();
        });
    });

    describe('a game played two against two', () =>
    {
        const ratedAt = async (matchId: string) =>
            rowsOf<{ result: string; rating_after: number }>(await db.query(
                `select result, rating_after from match_players where match_id = $1 order by seat`,
                [matchId]
            ));

        it('is rated side against side when the match row says teams, and seat against seat when it does not', async () =>
        {
            const pairs = PAIRS();
            const four = FOUR();
            const paired = await played(pairs, { variant: 'teams' });
            const alone = await played(four);

            expect(ludoEngine.finish(pairs)).toEqual({ winners: [0, 2], unsettled: [], trailing: [] });

            await finish(paired.matchId, pairs);
            await finish(alone.matchId, four);

            expect(await ratedAt(paired.matchId)).toEqual([
                { result: 'won', rating_after: 1216 },
                { result: 'lost', rating_after: 1184 },
                { result: 'won', rating_after: 1216 },
                { result: 'lost', rating_after: 1184 }
            ]);
            expect(await ratedAt(alone.matchId)).toEqual([
                { result: 'won', rating_after: 1216 },
                { result: 'lost', rating_after: 1195 },
                { result: 'lost', rating_after: 1205 },
                { result: 'lost', rating_after: 1184 }
            ]);
        });
    });

    describe('a room that emptied before anybody played', () =>
    {
        it('rates the quitter down and writes nothing at all for the seat left behind', async () =>
        {
            const state = EMPTIED();
            const { matchId, players } = await played(state, { own: [2, 1], quits: [{ seat: 1, walked: true }] });

            await finish(matchId, state);

            const quitter = await statsOf(players[1]);

            expect(quitter?.rating).toBe(1184);
            expect(quitter?.abandoned).toBe(1);
            expect(quitter?.played).toBe(1);
            expect(await statsOf(players[0])).toBeUndefined();
            expect(await seatOf(matchId, 0)).toEqual({ result: 'void', xp: 0, rating_before: null, rating_after: null });
            expect(await seatOf(matchId, 1)).toMatchObject({ result: 'abandoned', xp: 0, rating_before: 1200, rating_after: 1184 });
            expect(await matchOf(matchId)).toMatchObject({ outcome: 'abandoned', winner_seat: null, finished: true });
        });

        it('leaves the survivor streak of three exactly where it was', async () =>
        {
            const state = EMPTIED();
            const survivor = await makeUser();

            await seedStats(survivor, { rating: 1310, played: 9, won: 6, streak: 3 });

            const { matchId } = await played(state, { players: [survivor], quits: [{ seat: 1, walked: true }] });

            await finish(matchId, state);

            expect(await statsOf(survivor)).toMatchObject({ rating: 1310, played: 9, won: 6, streak: 3, best_streak: 3, xp: 0 });
        });

        it('gives the survivor no rung of any ladder', async () =>
        {
            const state = EMPTIED();
            const { matchId, players } = await played(state, { quits: [{ seat: 1, walked: true }] });

            await finish(matchId, state);

            expect(await heldBy(players[0])).toEqual([]);
        });

        it('charges a seat timed out of the game the rated loss, and lets it keep what it earned by playing', async () =>
        {
            const state = EMPTIED();
            const timeout = await played(state, { own: [0, ENGAGED], quits: [{ seat: 1, walked: false }] });
            const resign = await played(state, { own: [0, ENGAGED], quits: [{ seat: 1, walked: true }] });

            await finish(timeout.matchId, state);
            await finish(resign.matchId, state);

            expect(await seatOf(timeout.matchId, 1)).toMatchObject({ result: 'abandoned', xp: 10, rating_after: 1184 });
            expect(await seatOf(resign.matchId, 1)).toMatchObject({ result: 'abandoned', xp: 0, rating_after: 1184 });
        });

        it('pays a seat timed out before it had played its share nothing, whatever the server played for it', async () =>
        {
            const state = EMPTIED();
            const { matchId, players } = await played(state, { own: [0, ENGAGED - 1], auto: [0, ENGAGED], quits: [{ seat: 1, walked: false }] });

            await finish(matchId, state);

            expect(await seatOf(matchId, 1)).toMatchObject({ result: 'abandoned', xp: 0, rating_after: 1184 });
            expect(await statsOf(players[1])).toMatchObject({ xp: 0, played: 1, abandoned: 1 });
        });
    });

    describe('a forfeit by somebody who had been playing', () =>
    {
        it('moves the rating of a survivor who had been playing too, pays the finish alone, and credits no win and no game played', async () =>
        {
            const state = EMPTIED();
            const survivor = await makeUser();

            await seedStats(survivor, { rating: 1200, played: 4, won: 2, streak: 2 });

            const { matchId, players } = await played(state, { players: [survivor], own: [ENGAGED, ENGAGED], quits: [{ seat: 1, walked: true }] });

            await finish(matchId, state);

            expect(await seatOf(matchId, 0)).toEqual({ result: 'won', xp: 10, rating_before: 1200, rating_after: 1216 });
            expect(await statsOf(survivor)).toMatchObject({ rating: 1216, played: 4, won: 2, streak: 2, best_streak: 2, xp: 10 });
            expect((await statsOf(players[1]))?.rating).toBe(1184);
            expect(await matchOf(matchId)).toMatchObject({ outcome: 'won', winner_seat: 0 });

            const held = await heldBy(survivor);

            expect(held).toContain('ludo-played-1');

            for (const rung of ['ludo-won-3', 'ludo-won-2-1', 'ludo-won-live-1', 'all-won-3', 'all-won-live-1', 'all-won-duel-1', 'all-hosted-1'])
            {
                expect(held).not.toContain(rung);
            }
        });

        it('pays a poker win played out after somebody quit in full', async () =>
        {
            const state: PokerState = {
                ...pokerEngine.create([0, 1, 2], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state,
                out: [false, true, true],
                places: [1, 3, 2],
                winner: 0
            };
            const { matchId, players } = await played(state, { own: [3, 3, 3], quits: [{ seat: 1, walked: true }], later: [2, 0, 2] });

            await db.transaction(async (tx) => recorder().finish(tx, await rowOf(tx, matchId), pokerEngine, state, pokerEngine.finish(state)!));

            expect(await seatOf(matchId, 0)).toMatchObject({ result: 'won', xp: 35 });
            expect(await statsOf(players[0], 'poker')).toMatchObject({ played: 1, won: 1, streak: 1, xp: 35 });
            expect(await seatOf(matchId, 2)).toMatchObject({ result: 'lost', xp: 10 });
            expect(await heldBy(players[0])).toEqual(expect.arrayContaining(['poker-won-1', 'all-won-1', 'all-hosted-1']));
        });

        it('counts no turn the server played for somebody as theirs', async () =>
        {
            const state = EMPTIED();
            const { matchId, players } = await played(state, {
                own: [ENGAGED, 1],
                auto: [0, ENGAGED],
                quits: [{ seat: 1, walked: false }]
            });

            await finish(matchId, state);

            expect((await seatOf(matchId, 0)).result).toBe('void');
            expect(await statsOf(players[0])).toBeUndefined();
        });
    });

    describe('two games finishing at once for one person', () =>
    {
        it('rates the second from where the first left the rating', async () =>
        {
            const state = WON();
            const me = await makeUser();

            await seedStats(me, { rating: 1200, played: 0, won: 0, streak: 0 });

            const first = await played(state, { players: [me] });
            const second = await played(state, { players: [me] });

            await atOnce([first.matchId, second.matchId], () => Promise.all([finish(first.matchId, state), finish(second.matchId, state)]));

            const mine = await statsOf(me);

            expect(mine?.played).toBe(2);
            expect(mine?.won).toBe(2);
            expect(mine?.streak).toBe(2);
            expect(mine?.rating).toBe(1231);
        });
    });

    describe('a board over a window', () =>
    {
        it('counts no game that was no contest', async () =>
        {
            const me = await makeUser();
            const won = WON();
            const counted = await played(won, { players: [me] });

            await finish(counted.matchId, won);

            const emptied = EMPTIED();
            const voided = await played(emptied, { players: [me], quits: [{ seat: 1, walked: true }] });

            await finish(voided.matchId, emptied);

            const [{ handle }] = rowsOf<{ handle: string }>(await db.query('select handle::text from users where id = $1', [me]));
            const today = await createAchieveService(db).leaderboardOf('ludo', 'today');
            const row = today.standings.find((one) => one.handle === handle);

            expect(row?.played).toBe(1);
            expect(row?.won).toBe(1);
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
        const stat = async (user: string, xp: number, rating: number, played: number) =>
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
            const handleOf = async (id: string) =>
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
            const winning = WON();
            const first = await played(winning);

            await finish(first.matchId, winning);

            const after = await statsOf(first.players[0]);

            await db.query(
                `update player_stats set rating = 1400, peak_rating = 1400, played = 9, won = 9 where user_id = $1 and game = 'ludo'`,
                [first.players[0]]
            );

            const losing = board([[12, YARD, YARD, YARD], HOME], 1);
            const second = await played(losing, { players: [first.players[0]] });

            await finish(second.matchId, losing);

            const now = await statsOf(first.players[0]);

            expect(after?.rating).toBe(1216);
            expect(now?.played).toBe(10);
            expect(now?.rating).toBeLessThan(1400);
            expect(now?.peak_rating).toBe(1400);
            expect(now?.streak).toBe(0);
        });

        it('adds the tallies up rather than overwriting them', async () =>
        {
            const state = WON();

            const rolls = async (matchId: string, count: number) =>
            {
                await db.query(
                    `insert into match_actions (match_id, rev, seat, kind, payload, events, state)
                     values ($1, 900, 0, 'play', '{}'::jsonb, $2::jsonb, $3::jsonb)`,
                    [
                        matchId,
                        JSON.stringify(Array.from({ length: count }, () => ({ e: 'roll', seat: 0, die: 4 }))),
                        JSON.stringify(state)
                    ]
                );
            };

            const first = await played(state);

            await rolls(first.matchId, 3);
            await finish(first.matchId, state);

            expect((await statsOf(first.players[0]))?.tallies).toEqual({ rolls: 3 });

            const second = await played(state, { players: [first.players[0]] });

            await rolls(second.matchId, 2);
            await finish(second.matchId, state);

            expect((await statsOf(first.players[0]))?.tallies).toEqual({ rolls: 5 });
        });
    });
});
