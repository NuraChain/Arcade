import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { legalMoves } from '../src/domains/match/ludo/engine.ts';
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
         * `first-seat` is awarded inside the seat claim, and `user_achievements.achievement_id` is
         * a foreign key - so a database with no definitions in it refuses every claim with a 23503
         * that looks nothing like a seating bug. A real one runs this on every boot; a test one
         * that does not is a test database shaped differently from the thing it is standing in for.
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
        tables = createTableService(db, social, createAchieveService(db));
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
                target: 0, cube: false, blinds: 'low', invitees: []
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
                target: 0, cube: false, blinds: 'low', invitees: []
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

        it('is found by Postgres time rather than this process clock', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            expect(await matches.due(10)).toEqual([]);

            await expireNow(load.match.id);

            expect(await matches.due(10)).toEqual([load.match.id]);
        });

        it('plays the turn rather than ending the game', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await expireNow(load.match.id);

            expect(await matches.expire(load.match.id)).toBe(true);

            const after = await matches.view(players[0], load.match.id);

            expect(after!.match.rev).toBeGreaterThan(0);
            expect(after!.match.finishedAt).toBeNull();

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

            expect(await matches.expire(load.match.id)).toBe(true);

            const after = await matches.view(players[0], load.match.id);

            expect(after!.match.finishedAt).not.toBeNull();
            expect(after!.match.winnerSeat).not.toBe(seat);

            const results = rowsOf<{ seat: number; result: string }>(await db.query(
                `select seat, result from match_players where match_id = $1 order by seat`,
                [load.match.id]
            ));

            expect(results.find((row) => row.seat === seat)!.result).toBe('abandoned');
        });

        it('is handed to exactly one sweep when two run at once', async () =>
        {
            const { tableId, players } = await seatedTable(2);
            const load = await matches.start(players[0], tableId);

            await expireNow(load.match.id);

            const both = await Promise.all([
                matches.expire(load.match.id),
                matches.expire(load.match.id)
            ]);

            expect(both.filter(Boolean)).toHaveLength(1);
            expect(await countActions(load.match.id)).toBe(1);
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
});
