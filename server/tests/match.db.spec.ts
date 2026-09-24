import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { createWatchService } from '../src/domains/match/watch.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { legalMoves } from '../src/domains/match/ludo/engine.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import type { Draws, Engine } from '../src/domains/match/engine.ts';
import type { LudoState } from '../src/domains/match/ludo/state.ts';

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

const makeUser = async (): Promise<string> =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`m${ seq }x${ Math.floor(Math.random() * 100000) }`, `Match ${ seq }`, seq % 360]
    ))[0].id;
};

const seatedTable = async (seats: number): Promise<{ tableId: string; players: string[] }> =>
{
    const players: string[] = [];

    for (let index = 0; index < seats; index += 1)
    {
        players.push(await makeUser());
    }

    const table = await tables.create(players[0], {
        game: 'ludo',
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

const countActions = async (matchId: string): Promise<number> =>
    Number(rowsOf<{ n: string }>(await db.query(
        `select count(*) as n from match_actions where match_id = $1`,
        [matchId]
    ))[0].n);

/**
 * Ludo's two plays, written once. The wire carries a per-game action now, so a spec that drives the
 * service has to name the game the same way a client does.
 */
const ROLL = { kind: 'ludo', verb: 'roll' } as const;

const moveOf = (piece: number) => ({ kind: 'ludo', verb: 'move', piece } as const);

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

            expect(after!.match.rev).toBe(1);
        });

        it('writes nothing for an action composed against a board that has moved', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;
            const actor = players[turn];

            await matches.act(actor, load.match.id, { play: ROLL, rev: 0, key: 'first' });

            const stale = await matches.act(actor, load.match.id, { play: ROLL, rev: 0, key: 'second' });

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
                .rejects.toThrow(/not your turn/i);
        });

        it('refuses a move before a roll', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const turn = (load.state as LudoState).players[(load.state as LudoState).turn].seat;

            await expect(matches.act(players[turn], load.match.id, { play: moveOf(0), key: 'early' }))
                .rejects.toThrow(/roll/i);
        });

        it('answers a stranger exactly as a game that does not exist', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);
            const stranger = await makeUser();

            expect(await matches.view(stranger, load.match.id)).toBeNull();
            await expect(matches.act(stranger, load.match.id, { play: ROLL, key: 'x' })).rejects.toThrow(/no game/i);
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
        const expireNow = async (matchId: string): Promise<void> =>
        {
            await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [matchId]);
        };

        const deadlineOf = async (matchId: string): Promise<boolean> =>
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

            expect(await matches.expireNext()).toEqual({ matchId: load.match.id, game: 'ludo', played: true });
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

        it('gives up on the third miss in a row, and the survivor takes it', async () =>
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
            expect(after!.match.winnerSeat).not.toBe(seat);

            const results = rowsOf<{ seat: number; result: string }>(await db.query(
                `select seat, result from match_players where match_id = $1 order by seat`,
                [load.match.id]
            ));

            expect(results.find((row) => row.seat === seat)!.result).toBe('abandoned');
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
            expect(await countActions(load.match.id)).toBe(1);
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

            expect(await sweeper.expireNext()).toEqual({ matchId: healthyMatch.match.id, game: 'ludo', played: true });
            expect(await sweeper.expireNext()).toBeNull();
        });
    });

    describe('the table it belongs to', () =>
    {
        it('holds one live match, and offers it back by table', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            expect(await matches.liveFor(tableId)).toBe(load.match.id);

            await db.query(
                `update matches set finished_at = now(), outcome = 'closed', deadline_at = null where id = $1`,
                [load.match.id]
            );

            expect(await matches.liveFor(tableId)).toBeNull();
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

    describe('a side that wins together', () =>
    {
        it('pays both partners the win, not only the first seat of the side', async () =>
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

            const load = await matches.start(players[0], table.id);
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

            for (const [seat, card] of [[0, 51], [1, 0], [2, 13], [3, 26]])
            {
                await matches.act(userAt.get(seat)!, load.match.id, { play: { kind: 'hokm', verb: 'card', card }, key: `c${ seat }` });
            }

            const rows = rowsOf<{ seat: number; result: string; won: number; streak: number }>(await db.query(
                `select p.seat, p.result, s.won, s.streak
                   from match_players p
                   join player_stats s on s.user_id = p.user_id and s.game = 'hokm'
                  where p.match_id = $1
                  order by p.seat`,
                [load.match.id]
            ));

            expect(rows.map((row) => row.result)).toEqual(['won', 'lost', 'won', 'lost']);
            expect(rows.map((row) => row.won)).toEqual([1, 0, 1, 0]);
            expect(rows.map((row) => row.streak)).toEqual([1, 0, 1, 0]);
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

            await tables.leave(players[due], tableId);

            const newcomer = await makeUser();

            expect(await tables.claimSeat(newcomer, tableId), 'the newcomer landed in some other chair').toBe(due);
            expect((await matches.turnsAt(newcomer, [live.match.id])).has(live.match.id)).toBe(false);
        });
    });

    describe('watching', () =>
    {
        const watchOf = () => createWatchService(db, (matchId) => matches.seatsOf(matchId));

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

        it('keeps the opening position once somebody moves, and shows it until that move is old enough', async () =>
        {
            const { matchId, opening } = await firstMove();
            const kept = rowsOf<{ rev: number }>(await db.query(`select (opening ->> 'rev')::int as rev from matches where id = $1`, [matchId]));

            expect(kept[0].rev).toBe(opening);

            const seen = await watchOf().delayed(matchId);

            expect(seen!.load.match.rev, 'a move younger than the delay reached a watcher').toBe(opening);
        });

        it('shows the move itself once it is older than the delay', async () =>
        {
            const { matchId, opening } = await firstMove();

            await db.query(`update match_actions set created_at = now() - interval '31 seconds' where match_id = $1`, [matchId]);

            const seen = await watchOf().delayed(matchId);

            expect(seen!.load.match.rev).toBe(opening + 1);
        });
    });
});
