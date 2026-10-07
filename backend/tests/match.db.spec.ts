import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, ConversationMember, Table, entities } from '../src/entities/index.ts';
import { TableSeat } from '../src/entities/table-seat.entity.ts';
import { FOLD_MAX, createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { SEATED_MAX, createTableService } from '../src/domains/table/service.ts';
import { WATCH_DELAY_MS, createWatchService } from '../src/domains/match/watch.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { matchWatch, type MatchView } from '../src/schemas.ts';
import { buildPorts } from '../src/services.ts';
import { legalMoves } from '../src/domains/match/ludo/engine.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import type { HokmState } from '../src/domains/match/hokm/state.ts';
import type { Draws, Engine } from '../src/domains/match/engine.ts';
import type { EngineAction, LudoState } from '../src/domains/match/ludo/state.ts';

/**
 * A played game, against a real database.
 *
 * Everything here is a claim about Postgres rather than about TypeScript, which is why it cannot
 * live in the pure suite: the single live match per table is a partial unique index, the retried
 * action is a unique index over the idempotency key, the serialised turn is `for update`, and the
 * expiring turn is a predicate on `now()`. A fake DataSource could only prove the fake agrees.
 *
 * Opt-in like the other database suites: `npm run test:db` with `TEST_DATABASE_URL`.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let matches: ReturnType<typeof createMatchService>;
let tables: ReturnType<typeof createTableService>;
let social: ReturnType<typeof createSocialService>;

let seq = 0;

const makeUser = async () =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`m${ seq }x${ Math.floor(Math.random() * 100000) }`, `Match ${ seq }`, seq % 360]
    ))[0].id;
};

const seatedTable = async (seats: number, game = 'ludo'): Promise<{ tableId: string; players: string[] }> =>
{
    const players: string[] = [];

    for (let index = 0; index < seats; index += 1)
    {
        players.push(await makeUser());
    }

    const table = await tables.create(players[0], {
        game,
        seats,
        mode: 'live',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: false,
        invitees: []
    });

    for (const player of players.slice(1))
    {
        await tables.claimSeat(player, table.id);
    }

    for (const player of players)
    {
        await tables.setReady(player, table.id, true);
    }

    return { tableId: table.id, players };
};

const leave = async (who: string, tableId: string, mayForfeit: boolean) =>
    await tables.leave(who, tableId, (tx) => matches.walkOut(tx, who, tableId, mayForfeit));

const walkOut = async (who: string, tableId: string) => await leave(who, tableId, true);

const liveAt = async (viewer: string, tableId: string) =>
    (await tables.byId(viewer, tableId))!.match_id;

const countActions = async (matchId: string) =>
    Number(rowsOf<{ n: string }>(await db.query(
        `select count(*) as n from match_actions where match_id = $1 and kind <> 'open'`,
        [matchId]
    ))[0].n);

/**
 * Ludo's two plays, written once. The wire carries a per-game action now, so a spec that drives the
 * service has to name the game the same way a client does.
 */
const ROLL = { kind: 'ludo', verb: 'roll' } as const;

const moveOf = (piece: number) => ({ kind: 'ludo', verb: 'move', piece } as const);

const SIXES: Draws = { die: () => 6 };

const sixes = { ...ludoEngine, apply: (state: LudoState, action: EngineAction) => ludoEngine.apply(state, action, SIXES) } as Engine;

const turnSeatOf = (state: unknown) => ludoEngine.turnOf(state as LudoState)!;

const deadlineAt = async (matchId: string) =>
    rowsOf<{ at: string | null }>(await db.query(
        `select deadline_at::text as at from matches where id = $1`,
        [matchId]
    ))[0].at;

const missesOf = async (matchId: string) =>
    rowsOf<{ seat: number; timeouts: number }>(await db.query(
        `select seat, timeouts from match_players where match_id = $1 order by seat`,
        [matchId]
    )).map((row) => row.timeouts);

describe.skipIf(!active)('a match, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);

        /**
         * Reference data, seeded the way a real database has it.
         *
         * A finished match awards achievements, and `user_achievements.achievement_id` is a
         * foreign key - so a database with no definitions in it refuses every finish with a 23503
         * that looks nothing like a game bug. A real one runs this on every boot; a test one that
         * does not is a test database shaped differently from the thing it is standing in for.
         */
        await seedReference(db);

        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('ludo', 'ludo', 'g.n', 'g.b', 'g.c', 'board', 2, 4, 1)
             on conflict (id) do nothing`
        );
        await db.query(
            `insert into game_rules (game_id, seats, modes, targets, stakes, partners, has_cube, has_blinds)
             values ('ludo', '{2,3,4}', '{live,turns}', '{}', 'none', false, false, false)
             on conflict (game_id) do update set seats = excluded.seats`
        );
    }, 60_000);

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
        await db.query('truncate conversations cascade');
        await db.query('delete from users');
        social = createSocialService(db);
        tables = createTableService(db, social);
        matches = createMatchService(db, createAchieveService(db));
    });

    describe('how many tables one person holds', () =>
    {
        it('refuses a fifty-first open table, and a fifty-first seat, with a code the browser can put into words', async () =>
        {
            const me = await makeUser();
            const config = { game: 'ludo', seats: 2, mode: 'live' as const, privacy: 'public' as const, target: 0, cube: false, blinds: 'low', chat: false, voice: false, invitees: [] };

            for (let index = 0; index < SEATED_MAX; index += 1)
            {
                await tables.create(me, config);
            }

            await expect(tables.create(me, config)).rejects.toMatchObject({ status: 409, code: 'seated-max' });

            const other = await tables.create(await makeUser(), config);
            await expect(tables.claimSeat(me, other.id)).rejects.toMatchObject({ code: 'seated-max' });
            expect(await tables.mine(me)).toHaveLength(SEATED_MAX);
        });
    });

    describe('starting', () =>
    {
        it('deals one match however many people press start at once', async () =>
        {
            const { tableId, players } = await seatedTable(4);

            const started = await Promise.all(players.map((player) => matches.start(player, tableId)));
            const ids = new Set(started.map((load) => load.match.id));

            expect(ids.size, 'four presses made more than one match').toBe(1);

            const rows = rowsOf<{ id: string }>(await db.query(
                `select id from matches where table_id = $1`,
                [tableId]
            ));

            expect(rows).toHaveLength(1);
        });

        /**
         * The colour is read off the BOARD the engine composes, because that is the only place it
         * lives now. `match_players.colour` was a ludo column on a table every game shares and
         * nothing had read it since the board became the engine's to draw.
         */
        it('seats everybody, each in their own colour', async () =>
        {
            const { tableId, players } = await seatedTable(4);
            const { match, players: seated, state } = await matches.start(players[0], tableId);
            const board = matches.board('ludo', state, null);

            expect(seated).toHaveLength(4);
            expect(board.kind).toBe('ludo');

            if (board.kind !== 'ludo')
            {
                return;
            }

            expect(new Set(board.seats.map((row) => row.colour)).size).toBe(4);

            const count = rowsOf<{ n: string }>(await db.query(
                `select count(*) as n from match_players where match_id = $1`,
                [match.id]
            ))[0].n;

            expect(Number(count)).toBe(4);
        });

        it('plays two, three and four on one engine', async () =>
        {
            for (const seats of [2, 3, 4])
            {
                const { tableId, players } = await seatedTable(seats);
                const load = await matches.start(players[0], tableId);

                expect((load.state as LudoState).players, `${ seats } players`).toHaveLength(seats);
                expect(load.match.seats).toBe(seats);
            }
        });

        it('will not start a table with an empty chair', async () =>
        {
            const host = await makeUser();
            const table = await tables.create(host, {
                game: 'ludo', seats: 2, mode: 'live', privacy: 'public',
                target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
            });

            await tables.setReady(host, table.id, true);

            await expect(matches.start(host, table.id)).rejects.toThrow(/chair/i);
        });

        it('will not start a table where somebody is not ready', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            await tables.setReady(players[1], tableId, false);

            await expect(matches.start(players[0], tableId)).rejects.toThrow(/ready/i);
        });

        it('answers somebody who is not sitting there as if the table were not there', async () =>
        {
            const { tableId } = await seatedTable(2);
            const stranger = await makeUser();

            await expect(matches.start(stranger, tableId)).rejects.toThrow(/no table there/i);
        });

        it('answers a stranger 404 while a game is running there', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            await matches.start(players[0], tableId);
            const stranger = await makeUser();

            await expect(matches.start(stranger, tableId)).rejects.toMatchObject({ status: 404, message: 'No table there.' });
        });

        it('answers somebody who stood up mid-game 404, like a stranger', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            await matches.start(players[0], tableId);
            await walkOut(players[1], tableId);

            await expect(matches.start(players[1], tableId)).rejects.toMatchObject({ status: 404, message: 'No table there.' });
        });

        it('answers somebody in a chair the running game never dealt them 404', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            await matches.start(players[0], tableId);
            await walkOut(players[1], tableId);
            const newcomer = await makeUser();

            await db.getRepository(TableSeat).update({ tableId, seat: 1 }, { userId: newcomer, joinedAt: new Date() });

            await expect(matches.start(newcomer, tableId)).rejects.toMatchObject({ status: 404, message: 'No table there.' });
        });

        it('will not start a game that has no engine', async () =>
        {
            /**
             * A game id the SEED does not define, like `seat-race.spec.ts` uses, rather than a real
             * one. Borrowing `hokm` worked only while this database had no reference data in it -
             * the seed writes hokm's real rules, `on conflict do nothing` then leaves them alone,
             * and the table is refused for having the wrong seat count instead of for having no
             * engine. The test still passed the day that happened; it just stopped testing this.
             */
            await db.query(
                `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
                 values ('engineless', 'engineless', 'g.n', 'g.b', 'g.c', 'cards', 2, 4, 90)
                 on conflict (id) do nothing`
            );
            await db.query(
                `insert into game_rules (game_id, seats, modes, targets, stakes, partners, has_cube, has_blinds)
                 values ('engineless', '{2}', '{live}', '{}', 'none', false, false, false)
                 on conflict (game_id) do nothing`
            );

            const host = await makeUser();
            const other = await makeUser();
            const table = await tables.create(host, {
                game: 'engineless', seats: 2, mode: 'live', privacy: 'public',
                target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
            });

            await tables.claimSeat(other, table.id);
            await tables.setReady(host, table.id, true);
            await tables.setReady(other, table.id, true);

            await expect(matches.start(host, table.id)).rejects.toThrow(/cannot be played/i);
        });
    });

    describe('the opening', () =>
    {
        it('writes the opening deal to the ledger, readable from revision zero with every hole kept back', async () =>
        {
            const { tableId, players } = await seatedTable(2, 'poker');
            const load = await matches.start(players[0], tableId);

            expect(load.match.rev).toBe(1);

            const read = await Promise.all(players.map((player) => matches.since(player, load.match.id, 0)));
            const watched = await matches.feed(load.match.id, 0);

            for (const entries of [...read.map((one) => one?.events ?? []), watched?.events(null) ?? []])
            {
                expect(entries.map((entry) => entry.rev)).toEqual([1]);
                expect((entries[0].log as { kind: string; moves: { e: string }[] }).moves.map((move) => move.e)).toEqual(['deal', 'blind', 'blind']);
            }

            expect(rowsOf<{ kind: string; seat: number; user_id: string | null }>(await db.query(
                `select kind, seat, user_id from match_actions where match_id = $1 order by rev`,
                [load.match.id]
            ))).toEqual([{ kind: 'open', seat: -1, user_id: null }]);
        });
    });

    describe('acting', () =>
    {
        it('applies a retried action once, however many times it arrives', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;
            const actor = players[turn];

            const answers = await Promise.all(
                Array.from({ length: 10 }, () => matches.act(actor, load.match.id, { play: ROLL, key: 'one-intention' }))
            );

            expect(answers.filter((answer) => answer.applied === 'now')).toHaveLength(1);
            expect(answers.filter((answer) => answer.applied === 'already')).toHaveLength(9);
            expect(await countActions(load.match.id)).toBe(1);

            const after = await matches.view(actor, load.match.id);

            expect(after!.match.rev).toBe(load.match.rev + 1);
        });

        it('writes nothing for an action composed against a board that has moved', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;
            const actor = players[turn];

            await matches.act(actor, load.match.id, { play: ROLL, rev: load.match.rev, key: 'first' });

            const stale = await matches.act(actor, load.match.id, { play: ROLL, rev: load.match.rev, key: 'second' });

            expect(stale.applied).toBe('stale');
            expect(await countActions(load.match.id)).toBe(1);
        });

        it('serialises two players acting on one match at once', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;

            await Promise.allSettled([
                matches.act(players[turn], load.match.id, { play: ROLL, key: 'mine' }),
                matches.act(players[1 - turn], load.match.id, { play: ROLL, key: 'theirs' })
            ]);

            const revs = rowsOf<{ rev: number }>(await db.query(
                `select rev from match_actions where match_id = $1 order by rev`,
                [load.match.id]
            )).map((row) => row.rev);

            const after = await matches.view(players[0], load.match.id);

            expect(new Set(revs).size, 'two actions produced one revision').toBe(revs.length);
            expect(revs).toEqual(revs.map((_row, index) => index + 1));
            expect(after!.match.rev, 'the row and the ledger agree').toBe(revs.length);
        });

        it('refuses a roll from somebody whose turn it is not', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;

            await expect(matches.act(players[1 - turn], load.match.id, { play: ROLL, key: 'nope' }))
                .rejects.toMatchObject({ status: 403, code: 'not-your-turn', message: expect.stringMatching(/not your turn/i) });
        });

        it('refuses a move before a roll', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;

            await expect(matches.act(players[turn], load.match.id, { play: moveOf(0), key: 'early' }))
                .rejects.toMatchObject({ status: 409, code: 'must-roll-first', message: expect.stringMatching(/roll/i) });
        });

        it('answers a stranger exactly as a game that does not exist', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const stranger = await makeUser();

            expect(await matches.view(stranger, load.match.id)).toBeNull();
            await expect(matches.act(stranger, load.match.id, { play: ROLL, key: 'x' })).rejects.toThrow(/no game/i);
        });

        it('says a game is over to somebody who played it, and to a stranger only that there is no game', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const stranger = await makeUser();
            const missing = { status: 404, code: 'not-found', message: 'No game there.' };

            await expect(matches.act(stranger, load.match.id, { play: ROLL, key: 'live' })).rejects.toMatchObject(missing);

            await matches.act(players[0], load.match.id, { play: null, key: 'resign' });

            await expect(matches.act(players[1], load.match.id, { play: ROLL, key: 'late' }))
                .rejects.toMatchObject({ status: 409, code: 'game-over' });
            await expect(matches.act(stranger, load.match.id, { play: ROLL, key: 'over' })).rejects.toMatchObject(missing);
            await expect(matches.act(stranger, '00000000-0000-4000-8000-000000000000', { play: ROLL, key: 'never' })).rejects.toMatchObject(missing);
        });

        it('records the die it rolled, in order, with no gaps', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            let view = load;

            for (let step = 0; step < 12; step += 1)
            {
                const board = view.state as LudoState;
                const seat = board.players[board.turn].seat;
                const actor = players[seat];
                const want = board.die === null
                    ? { play: ROLL, key: `r${ step }` }
                    : { play: moveOf(legalMoves(view.state as LudoState)[0]), key: `m${ step }` };

                const answer = await matches.act(actor, view.match.id, want);
                view = answer.load;
            }

            /*
             * The die is read out of the action's PAYLOAD now. It was two smallint columns on a
             * table every game shares, which is a ludo turn carved into shared furniture - a
             * backgammon roll is a pair and a poker bet is an amount, and neither fits a `die`
             * between 1 and 6.
             */
            const rows = rowsOf<{ rev: number; payload: { die?: number }; kind: string }>(await db.query(
                `select rev, payload, kind from match_actions where match_id = $1 order by rev`,
                [load.match.id]
            ));

            expect(rows.map((row) => row.rev)).toEqual(rows.map((_row, index) => index + 1));

            for (const row of rows.filter((candidate) => candidate.kind === 'roll'))
            {
                expect(row.payload.die).toBeGreaterThanOrEqual(1);
                expect(row.payload.die).toBeLessThanOrEqual(6);
            }

            expect(view.match.rev).toBe(rows.length);
        });
    });

    describe('a turn that runs out', () =>
    {
        const expireNow = async (matchId: string) =>
        {
            await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [matchId]);
        };

        const deadlineOf = async (matchId: string) =>
            rowsOf<{ future: boolean }>(await db.query(
                `select deadline_at > now() as future from matches where id = $1`,
                [matchId]
            ))[0].future;

        it('is found by Postgres time rather than this process clock', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            expect(await matches.expireNext()).toBeNull();

            await expireNow(load.match.id);

            expect(await matches.expireNext()).toEqual({ matchId: load.match.id, game: 'ludo', played: true, before: load.match.rev });
            expect(await matches.expireNext()).toBeNull();
        });

        it('plays the turn rather than ending the game', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await expireNow(load.match.id);

            expect((await matches.expireNext())?.played).toBe(true);

            const after = await matches.view(players[0], load.match.id);

            expect(after!.match.rev).toBeGreaterThan(0);
            expect(after!.match.finishedAt).toBeNull();
            expect(await deadlineOf(load.match.id)).toBe(true);

            const acted = rowsOf<{ user_id: string | null }>(await db.query(
                `select user_id from match_actions where match_id = $1 order by rev desc limit 1`,
                [load.match.id]
            ));

            expect(acted[0].user_id, 'the server acted, so nobody owns this action').toBeNull();
        });

        it('gives up on the third miss in a row, charging that seat and leaving the other no contest', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const seat = (load.state as LudoState).players[(load.state as LudoState).turn].seat;

            await db.query(
                `update match_players set timeouts = 2 where match_id = $1 and seat = $2`,
                [load.match.id, seat]
            );
            await expireNow(load.match.id);

            expect((await matches.expireNext())?.played).toBe(true);

            const after = await matches.view(players[0], load.match.id);

            expect(after!.match.finishedAt).not.toBeNull();
            expect(after!.match.winnerSeat).toBeNull();
            expect(after!.match.outcome).toBe('abandoned');

            const results = rowsOf<{ seat: number; result: string; rating_after: number | null }>(await db.query(
                `select seat, result, rating_after from match_players where match_id = $1 order by seat`,
                [load.match.id]
            ));

            expect(results.find((row) => row.seat === seat)).toMatchObject({ result: 'abandoned', rating_after: 1184 });
            expect(results.find((row) => row.seat !== seat)).toMatchObject({ result: 'void', rating_after: null });
        });

        it('counts misses IN A ROW, so acting clears them', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const state = load.state as LudoState;
            const seat = state.players[state.turn].seat;
            const mover = load.players.find((one) => one.seat === seat)!.user_id;

            await db.query(
                `update match_players set timeouts = 2 where match_id = $1 and seat = $2`,
                [load.match.id, seat]
            );

            await matches.act(mover, load.match.id, { play: ROLL, key: 'clears-misses' });

            const misses = rowsOf<{ timeouts: number }>(await db.query(
                `select timeouts from match_players where match_id = $1 and seat = $2`,
                [load.match.id, seat]
            ))[0].timeouts;

            expect(misses).toBe(0);
        });

        it('is handed to exactly one sweep when two run at once', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await expireNow(load.match.id);

            const both = await Promise.all([matches.expireNext(), matches.expireNext()]);

            expect(both.filter((one) => one !== null)).toHaveLength(1);
            expect((await missesOf(load.match.id)).reduce((total, misses) => total + misses, 0)).toBe(1);
        });

        /**
         * The two ways a sweep used to stall for good. An engine that names nobody left the match
         * due and first in line on every tick, and one that threw took the whole tick with it - so a
         * single bad match stopped every turn on the deployment. Either way the deadline moves now,
         * nobody is charged a miss for it, and the match behind it is reached.
         */
        it('moves the deadline of a match it cannot play, and charges nobody', async () =>
        {
            const blind = { ...ludoEngine, turnOf: () => null } as Engine;
            const sweeper = createMatchService(db, createAchieveService(db), [blind]);
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await expireNow(load.match.id);

            expect(await sweeper.expireNext()).toEqual({ matchId: load.match.id, game: 'ludo', played: false, reason: 'no-turn' });
            expect(await deadlineOf(load.match.id)).toBe(true);
            expect(await countActions(load.match.id)).toBe(0);

            const misses = rowsOf<{ total: number }>(await db.query(
                `select sum(timeouts)::int as total from match_players where match_id = $1`,
                [load.match.id]
            ))[0].total;

            expect(misses).toBe(0);
        });

        it('reaches the next due match past one whose engine throws', async () =>
        {
            const fragile = {
                ...ludoEngine,
                autoplay: (state: LudoState, seat: number, draws: Draws) =>
                {
                    if (state.players.length === 3)
                    {
                        throw new Error('poisoned');
                    }

                    return ludoEngine.autoplay(state, seat, draws);
                }
            } as Engine;
            const sweeper = createMatchService(db, createAchieveService(db), [fragile]);

            const poisoned = await seatedTable(3);
            const poisonedMatch = await matches.start(poisoned.players[0], poisoned.tableId);
            const healthy = await seatedTable(2);
            const healthyMatch = await matches.start(healthy.players[0], healthy.tableId);

            await db.query(`update matches set deadline_at = now() - interval '2 seconds' where id = $1`, [poisonedMatch.match.id]);
            await expireNow(healthyMatch.match.id);

            const first = await sweeper.expireNext();

            expect(first).toMatchObject({ matchId: poisonedMatch.match.id, played: false });
            expect(first?.played === false ? first.reason : '').toContain('poisoned');
            expect(await deadlineOf(poisonedMatch.match.id)).toBe(true);

            expect(await sweeper.expireNext()).toEqual({ matchId: healthyMatch.match.id, game: 'ludo', played: true, before: healthyMatch.match.rev });
            expect(await sweeper.expireNext()).toBeNull();
        });

        it('keeps one deadline for a whole turn, and arms the next one only when the turn passes', async () =>
        {
            const clock = createMatchService(db, createAchieveService(db), [sixes]);
            const { tableId, players } = await seatedTable(2);
            const load = await clock.start(players[0], tableId);
            const seat = turnSeatOf(load.state);
            const mover = load.players.find((one) => one.seat === seat)!.user_id;
            const armed = await deadlineAt(load.match.id);

            let state = load.state as LudoState;
            let step = 0;

            while (turnSeatOf(state) === seat)
            {
                expect(await deadlineAt(load.match.id), `action ${ step } of the same turn`).toBe(armed);

                const want = state.die === null ? { play: ROLL, key: `t${ step }` } : { play: moveOf(legalMoves(state)[0]), key: `t${ step }` };

                state = (await clock.act(mover, load.match.id, want)).load.state as LudoState;
                step += 1;

                expect(step).toBeLessThan(FOLD_MAX);
            }

            expect(step).toBeGreaterThan(1);
            expect(await deadlineAt(load.match.id)).not.toBe(armed);
        });

        it('leaves the deadline alone when a seat not on turn resigns', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            const load = await matches.start(players[0], tableId);
            const turn = turnSeatOf(load.state);
            const quitter = load.players.find((one) => one.seat !== turn)!.user_id;
            const armed = await deadlineAt(load.match.id);

            await matches.act(quitter, load.match.id, { play: null, key: 'resign' });

            expect((await matches.peek(load.match.id))!.match.finishedAt).toBeNull();
            expect(await deadlineAt(load.match.id)).toBe(armed);
        });

        it('plays the whole turn in one sweep and charges one miss for it', async () =>
        {
            const clock = createMatchService(db, createAchieveService(db), [sixes]);
            const { tableId, players } = await seatedTable(2);
            const load = await clock.start(players[0], tableId);
            const seat = turnSeatOf(load.state);

            await expireNow(load.match.id);

            expect(await clock.expireNext()).toEqual({ matchId: load.match.id, game: 'ludo', played: true, before: load.match.rev });

            const swept = rowsOf<{ seat: number; user_id: string | null }>(await db.query(
                `select seat, user_id from match_actions where match_id = $1 and kind <> 'open' order by rev`,
                [load.match.id]
            ));

            expect(swept.length).toBeGreaterThan(1);
            expect(swept.every((row) => row.seat === seat && row.user_id === null)).toBe(true);
            expect(await missesOf(load.match.id)).toEqual([0, 1].map((one) => (one === seat ? 1 : 0)));
            expect(turnSeatOf((await clock.peek(load.match.id))!.state)).not.toBe(seat);
            expect(await clock.expireNext()).toBeNull();
        });

        it('still pushes the deadline when the turn outlasts the fold bound', async () =>
        {
            const stalling = {
                ...ludoEngine,
                apply: (state: LudoState) => ({ ok: true as const, state: { ...state, rev: state.rev + 1 }, events: [] })
            } as Engine;
            const clock = createMatchService(db, createAchieveService(db), [stalling]);
            const { tableId, players } = await seatedTable(2);
            const load = await clock.start(players[0], tableId);

            await expireNow(load.match.id);

            expect((await clock.expireNext())?.played).toBe(true);
            expect(await countActions(load.match.id)).toBe(FOLD_MAX);
            expect((await missesOf(load.match.id)).reduce((total, misses) => total + misses, 0)).toBe(1);
            expect(await deadlineOf(load.match.id)).toBe(true);
            expect(await clock.expireNext()).toBeNull();
        });

        it('forfeits on the third missed TURN, however many actions each turn took', async () =>
        {
            const clock = createMatchService(db, createAchieveService(db), [sixes]);
            const { tableId, players } = await seatedTable(2);
            const load = await clock.start(players[0], tableId);
            const first = turnSeatOf(load.state);

            for (let sweep = 0; sweep < 4; sweep += 1)
            {
                await expireNow(load.match.id);
                expect((await clock.expireNext())?.played).toBe(true);
            }

            expect(await missesOf(load.match.id)).toEqual([2, 2]);
            expect(await countActions(load.match.id)).toBeGreaterThan(4);
            expect((await clock.peek(load.match.id))!.match.finishedAt).toBeNull();

            await expireNow(load.match.id);
            expect((await clock.expireNext())?.played).toBe(true);

            const results = rowsOf<{ seat: number; result: string }>(await db.query(
                `select seat, result from match_players where match_id = $1 order by seat`,
                [load.match.id]
            ));

            expect((await clock.peek(load.match.id))!.match.finishedAt).not.toBeNull();
            expect(results.find((row) => row.seat === first)?.result).toBe('abandoned');
        });
    });

    describe('the table it belongs to', () =>
    {
        it('holds one live match, and offers it back by table', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            expect(await liveAt(players[0], tableId)).toBe(load.match.id);

            await db.query(
                `update matches set finished_at = now(), outcome = 'closed', deadline_at = null where id = $1`,
                [load.match.id]
            );

            expect(await liveAt(players[0], tableId)).toBeNull();
        });

        it('is offered to quick play fullest first, and never with a game already running', async () =>
        {
            const looker = await makeUser();
            const quiet = await tables.create(await makeUser(), {
                game: 'ludo', seats: 4, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
            });
            const busy = await tables.create(await makeUser(), {
                game: 'ludo', seats: 4, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
            });
            const slow = await tables.create(await makeUser(), {
                game: 'ludo', seats: 4, mode: 'turns', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
            });

            await tables.claimSeat(await makeUser(), busy.id);
            await tables.claimSeat(await makeUser(), busy.id);

            const listed = (await tables.open(looker, { game: 'ludo', mode: 'live' }, 20)).map((row) => row.id);

            expect(listed).toEqual([busy.id, quiet.id]);
            expect(listed).not.toContain(slow.id);

            const { tableId } = await seatedTable(3);

            await db.query(`update tables set seats = 4 where id = $1`, [tableId]);
            await db.query(`insert into table_seats (table_id, seat) values ($1, 3)`, [tableId]);
            await db.query(
                `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
                 values ($1, 'ludo', 'standard', 3, '{"rev":0}'::jsonb, 0, now() + interval '1 hour')`,
                [tableId]
            );

            expect((await tables.open(looker, { game: 'ludo', mode: null }, 20)).map((row) => row.id)).not.toContain(tableId);
        });

        it('cannot be closed under a game somebody is still playing', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await expect(tables.close(players[0], tableId)).rejects.toThrow('Finish or resign the game first.');

            const status = rowsOf<{ status: string }>(await db.query(`select status from tables where id = $1`, [tableId]))[0].status;

            expect(status).not.toBe('closed');

            await matches.act(players[0], load.match.id, { play: null, key: 'resign-then-close' });
            await tables.close(players[0], tableId);

            expect(rowsOf<{ status: string }>(await db.query(`select status from tables where id = $1`, [tableId]))[0].status).toBe('closed');
        });

        it('refuses a second live match even with the index asked directly', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            await matches.start(players[0], tableId);

            await expect(db.query(
                `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
                 values ($1, 'ludo', 'standard', 2, '{"rev":0}'::jsonb, 0, now())`,
                [tableId]
            )).rejects.toThrow();
        });
    });

    describe('leaving a live match', () =>
    {
        const forfeitsOf = async (matchId: string) =>
            rowsOf<{ user_id: string | null; verb: string }>(await db.query(
                `select user_id, payload ->> 'verb' as verb from match_actions
                  where match_id = $1 and kind = 'forfeit'
                  order by rev`,
                [matchId]
            ));

        const heldBy = async (who: string, tableId: string) => ({
            chair: await db.getRepository(TableSeat).existsBy({ tableId, userId: who }),
            thread: await db.getRepository(ConversationMember)
                .createQueryBuilder('cm')
                .innerJoin(Conversation, 'c', 'c.id = cm.conversation_id')
                .where('c.table_id = :tableId and cm.user_id = :who', { tableId, who })
                .getExists()
        });

        it('is a walkout: a rated loss paid nothing, and no contest for a survivor who never played', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            const left = await walkOut(players[1], tableId);

            expect(left).toMatchObject({ left: true, walked: { matchId: load.match.id, before: load.match.rev } });
            expect(await forfeitsOf(load.match.id)).toEqual([{ user_id: players[1], verb: 'left' }]);

            const seats = new Map(rowsOf<{ user_id: string; result: string; xp: number; rating_after: number | null }>(await db.query(
                `select user_id, result, xp, rating_after from match_players where match_id = $1`,
                [load.match.id]
            )).map((row) => [row.user_id, row]));

            expect(seats.get(players[1])).toMatchObject({ result: 'abandoned', xp: 0 });
            expect(seats.get(players[1])!.rating_after).toBeLessThan(1200);
            expect(seats.get(players[0])).toMatchObject({ result: 'void', xp: 0, rating_after: null });
            expect(await liveAt(players[0], tableId)).toBeNull();
        });

        it('keeps the chair it left out of anybody else’s reach until the game is over', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            const load = await matches.start(players[0], tableId);
            const newcomer = await makeUser();

            await walkOut(players[1], tableId);

            await expect(tables.claimSeat(newcomer, tableId)).rejects.toMatchObject({ status: 409, code: 'playing' });
            expect((await tables.open(newcomer, { game: 'ludo', mode: null }, 20)).map((row) => row.id)).not.toContain(tableId);

            await matches.act(players[2], load.match.id, { play: null, key: 'gives-up' });

            expect(await liveAt(newcomer, tableId)).toBeNull();
            expect((await tables.open(newcomer, { game: 'ludo', mode: null }, 20)).map((row) => row.id)).toContain(tableId);
            expect(await tables.claimSeat(newcomer, tableId)).toBe(1);
        });

        it('writes no second forfeit for somebody who had already resigned', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            const load = await matches.start(players[0], tableId);

            await matches.act(players[1], load.match.id, { play: null, key: 'resigns' });

            expect(await walkOut(players[1], tableId)).toMatchObject({ left: true, walked: null });
            expect(await forfeitsOf(load.match.id)).toEqual([{ user_id: players[1], verb: 'resign' }]);
            expect(await liveAt(players[0], tableId)).toBe(load.match.id);
        });

        it('keeps somebody who did not agree to forfeit in their chair, their thread and their game, and writes nothing', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await expect(leave(players[1], tableId, false)).rejects.toMatchObject({ status: 409, code: 'playing' });

            expect(await forfeitsOf(load.match.id)).toEqual([]);
            expect(await heldBy(players[1], tableId)).toEqual({ chair: true, thread: true });
            expect(await liveAt(players[1], tableId)).toBe(load.match.id);
            expect((await matches.view(players[1], load.match.id))!.match.rev).toBe(load.match.rev);
        });

        it('lets go of somebody with nothing to forfeit there, whatever they agreed to: resigned, never dealt in, or in no chair', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            const load = await matches.start(players[0], tableId);
            const newcomer = await makeUser();
            const stranger = await makeUser();

            await matches.act(players[1], load.match.id, { play: null, key: 'resigns' });

            expect(await leave(players[1], tableId, false)).toEqual({ left: true, closed: false, walked: null });
            expect(await heldBy(players[1], tableId)).toEqual({ chair: false, thread: false });

            await db.getRepository(TableSeat).update({ tableId, seat: 1 }, { userId: newcomer, joinedAt: new Date() });

            expect(await leave(newcomer, tableId, false)).toEqual({ left: true, closed: false, walked: null });
            expect(await leave(stranger, tableId, false)).toEqual({ left: false, closed: false, walked: null });
            expect(await forfeitsOf(load.match.id)).toEqual([{ user_id: players[1], verb: 'resign' }]);
            expect(await liveAt(players[0], tableId)).toBe(load.match.id);
        });

        it('gives the chair back with no game on, before one and after one, whatever was agreed', async () =>
        {
            const waiting = await seatedTable(2);

            expect(await leave(waiting.players[1], waiting.tableId, false)).toEqual({ left: true, closed: false, walked: null });

            const over = await seatedTable(2);
            const load = await matches.start(over.players[0], over.tableId);

            await matches.act(over.players[0], load.match.id, { play: null, key: 'gives-up' });

            expect(await leave(over.players[0], over.tableId, false)).toEqual({ left: true, closed: false, walked: null });
            expect(await leave(over.players[1], over.tableId, false)).toEqual({ left: true, closed: true, walked: null });
            expect(await forfeitsOf(load.match.id)).toEqual([{ user_id: over.players[0], verb: 'resign' }]);
        });
    });

    describe('playing again at the same table', () =>
    {
        const readyAt = async (tableId: string) =>
            (await db.getRepository(TableSeat).find({ where: { tableId }, order: { seat: 'ASC' } })).map((chair) => chair.ready);

        const moverOf = (load: Awaited<ReturnType<typeof matches.start>>) =>
        {
            const state = load.state as LudoState;
            const seat = state.players[state.turn].seat;

            return load.players.find((one) => one.seat === seat)!.user_id;
        };

        it('keeps everybody ready while the game goes on, and takes it away when the game ends', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await matches.act(moverOf(load), load.match.id, { play: ROLL, key: 'rolls-on' });

            expect(await readyAt(tableId)).toEqual([true, true]);

            await matches.act(players[1], load.match.id, { play: null, key: 'gives-up' });

            expect((await matches.view(players[0], load.match.id))!.match.finishedAt).not.toBeNull();
            expect(await readyAt(tableId)).toEqual([false, false]);
        });

        it('takes it away when the turn clock ends the game too', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const state = load.state as LudoState;

            await db.query(
                `update match_players set timeouts = 2 where match_id = $1 and seat = $2`,
                [load.match.id, state.players[state.turn].seat]
            );
            await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [load.match.id]);

            expect((await matches.expireNext())?.played).toBe(true);
            expect((await matches.view(players[0], load.match.id))!.match.finishedAt).not.toBeNull();
            expect(await readyAt(tableId)).toEqual([false, false]);
        });

        it('refuses one player starting the next game alone, and deals it once everybody says so', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const first = await matches.start(players[0], tableId);

            await matches.act(players[1], first.match.id, { play: null, key: 'gives-up' });
            await tables.setReady(players[0], tableId, true);

            await expect(matches.start(players[0], tableId)).rejects.toMatchObject({ status: 409, message: 'Everybody has to be ready first.' });
            expect(await liveAt(players[0], tableId)).toBeNull();

            await tables.setReady(players[1], tableId, true);
            const next = await matches.start(players[1], tableId);

            expect(next.match.id).not.toBe(first.match.id);
            expect(next.match.finishedAt).toBeNull();
        });
    });

    describe('a side that wins together', () =>
    {
        const hokmFour = async () =>
        {
            const players: string[] = [];

            for (let index = 0; index < 4; index += 1)
            {
                players.push(await makeUser());
            }

            const table = await tables.create(players[0], {
                game: 'hokm', seats: 4, mode: 'live', privacy: 'public',
                target: 7, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
            });

            for (const player of players.slice(1))
            {
                await tables.claimSeat(player, table.id);
            }

            for (const player of players)
            {
                await tables.setReady(player, table.id, true);
            }

            return { players, load: await matches.start(players[0], table.id) };
        };

        it('leaves the partner of somebody who walks out of it, with no record written at all', async () =>
        {
            const { load } = await hokmFour();
            const quitter = load.players.find((one) => one.seat === 1)!;

            await matches.act(quitter.user_id, load.match.id, { play: null, key: 'walks' });

            const rows = rowsOf<{ seat: number; result: string; rating_after: number | null; stats: number }>(await db.query(
                `select p.seat, p.result, p.rating_after,
                        (select count(*)::int from player_stats s where s.user_id = p.user_id) as stats
                   from match_players p
                  where p.match_id = $1
                  order by p.seat`,
                [load.match.id]
            ));

            expect(rows.map((row) => row.result)).toEqual(['void', 'abandoned', 'void', 'void']);
            expect(rows[1].rating_after).toBeLessThan(1200);
            expect(rows[3]).toMatchObject({ rating_after: null, stats: 0 });
            expect(rows.map((row) => row.stats)).toEqual([0, 1, 0, 0]);
        });

        it('pays both partners the win, not only the first seat of the side', async () =>
        {
            const { load } = await hokmFour();
            const lastTrick = {
                ...(load.state as Record<string, unknown>),
                phase: 'tricks',
                trump: 'spades',
                hakem: 0,
                turn: 0,
                lead: 0,
                trick: [],
                took: null,
                hands: [[51], [0], [13], [26]],
                tricks: [3, 3, 3, 3],
                points: [6, 0]
            };

            await db.query(`update matches set state = $2::jsonb where id = $1`, [load.match.id, JSON.stringify(lastTrick)]);

            const userAt = new Map(rowsOf<{ seat: number; user_id: string }>(await db.query(
                `select seat, user_id from match_players where match_id = $1`,
                [load.match.id]
            )).map((row) => [row.seat, row.user_id]));

            for (const [seat, rating] of [[0, 1300], [1, 1250], [2, 1100], [3, 1150]])
            {
                await db.query(
                    `insert into player_stats (user_id, game, rating, peak_rating, played) values ($1, 'hokm', $2, $2, 4)`,
                    [userAt.get(seat), rating]
                );
            }

            for (const [seat, card] of [[0, 51], [1, 0], [2, 13], [3, 26]])
            {
                await matches.act(userAt.get(seat)!, load.match.id, { play: { kind: 'hokm', verb: 'card', card }, key: `c${ seat }` });
            }

            const rows = rowsOf<{ seat: number; result: string; won: number; streak: number; swing: number }>(await db.query(
                `select p.seat, p.result, s.won, s.streak, p.rating_after - p.rating_before as swing
                   from match_players p
                   join player_stats s on s.user_id = p.user_id and s.game = 'hokm'
                  where p.match_id = $1
                  order by p.seat`,
                [load.match.id]
            ));

            expect(rows.map((row) => row.result)).toEqual(['won', 'lost', 'won', 'lost']);
            expect(rows.map((row) => row.won)).toEqual([1, 0, 1, 0]);
            expect(rows.map((row) => row.streak)).toEqual([1, 0, 1, 0]);
            expect(rows.map((row) => row.swing)).toEqual([16, -16, 16, -16]);
        });
    });

    describe('whose turn it is, across every table somebody sits at', () =>
    {
        it('answers each viewer about their own seat, and nothing for a match that is over or unknown', async () =>
        {
            const first = await seatedTable(2);
            const second = await seatedTable(2);
            const live = await matches.start(first.players[0], first.tableId);
            const over = await matches.start(second.players[0], second.tableId);
            const nowhere = '00000000-0000-4000-8000-000000000000';
            const due = matches.turnOf('ludo', live.state)!;

            await matches.act(second.players[1], over.match.id, { play: null, key: 'walk' });

            const onTurn = await matches.turnsAt(first.players[due], [live.match.id, over.match.id, nowhere]);

            expect(onTurn.get(live.match.id)).toBe(true);
            expect(onTurn.has(over.match.id)).toBe(false);
            expect(onTurn.has(nowhere)).toBe(false);
            expect((await matches.turnsAt(first.players[1 - due], [live.match.id])).get(live.match.id)).toBe(false);
            expect((await matches.turnsAt(second.players[0], [over.match.id])).has(over.match.id)).toBe(false);
            expect((await matches.turnsAt(first.players[0], [])).size).toBe(0);
        });

        it('says nothing to somebody sitting in a chair the match never dealt them', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            const live = await matches.start(players[0], tableId);
            const due = matches.turnOf('ludo', live.state)!;

            await walkOut(players[due], tableId);

            const newcomer = await makeUser();

            await db.getRepository(TableSeat).update({ tableId, seat: due }, { userId: newcomer, joinedAt: new Date() });

            expect((await matches.turnsAt(newcomer, [live.match.id])).has(live.match.id)).toBe(false);
        });
    });

    describe('watching', () =>
    {
        const DELAY = WATCH_DELAY_MS / 1000;

        const watchOf = () => createWatchService(db, (matchId) => matches.seatsOf(matchId));

        const portsOf = () => buildPorts(db, {
            secret: 'a-test-secret-that-is-long-enough-to-use',
            origin: 'http://localhost:1',
            env: 'test',
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: ''
        } as Parameters<typeof buildPorts>[1]);

        const sent = async (matchId: string) => matchWatch.parse(await portsOf().match.watch(await makeUser(), matchId));

        const aged = async (matchId: string, seconds: number) =>
        {
            await db.query(`update match_actions set created_at = now() - make_interval(secs => $2::int) where match_id = $1`, [matchId, seconds]);
        };

        const outOf = (view: MatchView) => (view.view.kind === 'ludo' ? view.view.seats.map((seat) => seat.out) : []);

        const firstMove = async (): Promise<{ matchId: string; opening: number }> =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;

            await matches.act(players[turn], load.match.id, { play: ROLL, key: 'watched' });

            return { matchId: load.match.id, opening: load.match.rev };
        };

        it('shows a stranger the board a game began with before anybody has moved', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const seen = await watchOf().delayed(load.match.id);

            expect(seen, 'a game nobody has moved in answered as if there were nothing to watch').not.toBeNull();
            expect(seen!.load.match.rev).toBe(load.match.rev);
            expect(seen!.live).toBe(true);
        });

        it('shows the opening until a move is old enough, and is as far behind as the board it shows is old', async () =>
        {
            const { matchId, opening } = await firstMove();
            const fresh = await watchOf().delayed(matchId);

            expect(fresh!.load.match.rev, 'a move younger than the delay reached a watcher').toBe(opening);
            expect(fresh!.behind).toBeGreaterThanOrEqual(0);
            expect(fresh!.behind).toBeLessThan(DELAY);

            await aged(matchId, 20);

            const later = await watchOf().delayed(matchId);

            expect(later!.load.match.rev, 'a move younger than the delay reached a watcher').toBe(opening);
            expect(later!.behind, 'the opening is twenty seconds old and a watcher was told otherwise').toBeGreaterThanOrEqual(20);
            expect(later!.behind).toBeLessThan(DELAY);
        });

        it('shows the move itself once it is older than the delay', async () =>
        {
            const { matchId, opening } = await firstMove();

            await aged(matchId, DELAY + 1);

            const seen = await watchOf().delayed(matchId);

            expect(seen!.load.match.rev).toBe(opening + 1);
        });

        it('shows a seat that gave up as still playing until the board beside it has the forfeit on it', async () =>
        {
            const { tableId, players } = await seatedTable(3);
            const load = await matches.start(players[0], tableId);
            const quitter = load.players.find((one) => one.seat === 2)!.user_id;

            await matches.act(quitter, load.match.id, { play: null, key: 'gives-up' });

            expect((await matches.peek(load.match.id))!.match.finishedAt, 'three seats play on after one gives up').toBeNull();
            expect((await matches.seatsOf(load.match.id)).map((row) => row.result)).toEqual([null, null, 'abandoned']);

            const early = await sent(load.match.id);

            expect(early.live).toBe(true);
            expect(early.match.rev).toBe(load.match.rev);
            expect(outOf(early.match)).toEqual([false, false, false]);
            expect(early.match.players.map((player) => player.result), 'a plate said a seat had left beside a board it is still on').toEqual([undefined, undefined, undefined]);

            await aged(load.match.id, DELAY + 1);

            const late = await sent(load.match.id);

            expect(late.live).toBe(true);
            expect(late.match.rev).toBe(load.match.rev + 1);
            expect(outOf(late.match)).toEqual([false, false, true]);
            expect(late.match.players.map((player) => player.result)).toEqual([undefined, undefined, 'abandoned']);
        });

        it('says nothing of a missed turn while the game is live, and counts them once it is over', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const absent = turnSeatOf(load.state);
            const misses = [0, 1].map((seat) => (seat === absent ? 1 : 0));

            await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [load.match.id]);

            expect((await matches.expireNext())?.played).toBe(true);
            expect(await missesOf(load.match.id)).toEqual(misses);

            await aged(load.match.id, DELAY + 1);

            const live = await sent(load.match.id);

            expect(live.live).toBe(true);
            expect(live.match.rev, 'the turn the server played is on the board a watcher is shown').toBeGreaterThan(load.match.rev);
            expect(live.match.players.map((player) => Object.keys(player).includes('timeouts')), 'a watcher was told a seat had gone quiet').toEqual([false, false]);

            await matches.act(load.players.find((one) => one.seat !== absent)!.user_id, load.match.id, { play: null, key: 'ends-it' });

            const over = await sent(load.match.id);

            expect(over.live).toBe(false);
            expect(over.match.players.map((player) => player.timeouts)).toEqual(misses);
        });

        it('shows no result and no rating from a finish that lands while the game is being read', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await db.query(
                `update match_players set result = 'won', rating_before = 1200, rating_after = 1216 where match_id = $1`,
                [load.match.id]
            );

            const shown = await sent(load.match.id);

            expect(shown.live).toBe(true);
            expect(shown.match.players.map((player) => [player.result, player.ratingBefore, player.ratingAfter]))
                .toEqual([[undefined, undefined, undefined], [undefined, undefined, undefined]]);
        });

        it('sends a live game with no clock, no winner and no outcome, and a finished one with how it ended', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const endings = ['remainingMs', 'winner', 'outcome', 'finishedAt'];
            const endingsOf = async () => Object.keys((await sent(load.match.id)).match).filter((key) => endings.includes(key)).sort();

            expect((await portsOf().match.view(players[0], load.match.id))!.remainingMs, 'a player is sent the clock').toBeGreaterThan(0);
            expect(await endingsOf()).toEqual([]);

            await matches.act(players[1], load.match.id, { play: null, key: 'ends-it' });

            expect(await endingsOf()).toEqual(['finishedAt', 'outcome']);
        });

        it('has nothing to watch at an id nobody holds, or at one that is no id at all', async () =>
        {
            const reader = await makeUser();
            const ports = portsOf();

            for (const nowhere of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', '00000000-0000-4000-8000-00000000000'])
            {
                expect(await ports.match.watch(reader, nowhere), nowhere).toBeNull();
            }
        });

        it('has nothing to watch at a table the reader may not see, while its game is live and once it is over', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const stranger = await makeUser();
            const ports = portsOf();

            expect(await ports.match.watch(stranger, load.match.id), 'anybody may watch a game at a public table').not.toBeNull();

            await db.getRepository(Table).update({ id: tableId }, { privacy: 'friends' });

            expect(await ports.match.watch(stranger, load.match.id), 'a stranger was shown a game at a friends table').toBeNull();

            await matches.act(players[1], load.match.id, { play: null, key: 'ends-it' });

            expect(await ports.match.watch(stranger, load.match.id), 'a game being over made the table it was played at public').toBeNull();
            expect((await ports.match.watch(players[0], load.match.id))?.live, 'somebody in a chair there is still shown it').toBe(false);
        });
    });

    describe('the two-handed hokm draw', () =>
    {
        it('sweeps an absent pair through the whole draw, and nothing put face down reaches either of them or a watcher', async () =>
        {
            const players = [await makeUser(), await makeUser()];
            const table = await tables.create(players[0], {
                game: 'hokm', seats: 2, mode: 'live', privacy: 'public',
                target: 7, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
            });

            await tables.claimSeat(players[1], table.id);

            for (const player of players)
            {
                await tables.setReady(player, table.id, true);
            }

            const load = await matches.start(players[0], table.id);

            for (let sweep = 0; sweep < 24; sweep += 1)
            {
                await db.query(`update match_players set timeouts = 0 where match_id = $1`, [load.match.id]);
                await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [load.match.id]);

                expect((await matches.expireNext())?.played, `sweep ${ sweep }`).toBe(true);
            }

            const rows = rowsOf<{ rev: number; user_id: string | null; state: HokmState }>(await db.query(
                `select rev, user_id, state from match_actions where match_id = $1 and kind <> 'open' order by rev`,
                [load.match.id]
            ));

            expect(rows).toHaveLength(24);
            expect(rows.every((row) => row.user_id === null)).toBe(true);

            const last = rows[rows.length - 1].state;

            expect(last.phase).toBe('tricks');
            expect(last.hands.map((hand) => hand.length)).toEqual([13, 13]);
            expect(last.trick).toEqual([]);

            const down = new Set<number>();

            for (const state of [load.state as HokmState, ...rows.map((row) => row.state)])
            {
                const live = new Set([...state.hands.flat(), ...state.stock, ...(state.offer === null ? [] : [state.offer])]);

                Array.from({ length: 52 }, (_, card) => card).filter((card) => !live.has(card)).forEach((card) => down.add(card));
            }

            expect(down.size).toBe(26);

            for (const seat of [0, 1])
            {
                const user = load.players.find((one) => one.seat === seat)!.user_id;
                const feed = await matches.since(user, load.match.id, 0);
                const moves = feed!.events.flatMap((one) => (one.log.kind === 'hokm' ? one.log.moves : []));

                expect(moves.map((move) => move.e)).toEqual(['deal', 'trump', 'discard', 'discard', ...Array.from({ length: 21 }, () => 'draw')]);
                expect(moves.filter((move) => move.card !== undefined)).toEqual([]);

                const board = hokmEngine.view(feed!.load.state as HokmState, feed!.load.mine);

                expect(board.kind === 'hokm' && board.hand.some((card) => down.has(card))).toBe(false);
            }

            const watching = createWatchService(db, (matchId) => matches.seatsOf(matchId));

            for (const row of rows)
            {
                await db.query(
                    `update match_actions set created_at = case when rev <= $2 then now() - interval '1 minute' else now() end where match_id = $1`,
                    [load.match.id, row.rev]
                );

                const seen = await watching.delayed(load.match.id);
                const board = hokmEngine.view(seen!.load.state as HokmState, null);

                expect(seen!.load.match.rev, `revision ${ row.rev }`).toBe(row.rev);
                expect(board.kind === 'hokm' && (board.hand.length > 0 || board.offer !== undefined || board.glimpse !== undefined || board.trick.length > 0))
                    .toBe(false);
            }
        }, 60_000);
    });
});
