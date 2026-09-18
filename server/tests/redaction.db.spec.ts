import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import type { Ending, Engine, Placement, Tally } from '../src/domains/match/engine.ts';
import type { MatchBoard, MatchLog } from '../src/schemas.ts';

/**
 * A seat cannot see another seat's private state.
 *
 * This is the test the engine seam exists for, and it could not be written before the seam: ludo
 * hides nothing, so every assertion about hiding over a ludo match passes whether the code redacts
 * or not. So the engine here is a FIXTURE with something to hide - one secret per seat - and it is
 * INJECTED, which is the whole reason `createMatchService` takes its engines as an argument rather
 * than reading a module-level map.
 *
 * **The assertion is over the serialised payload, not over named fields.** Checking that
 * `view.seats[1].home` is absent only catches a leak through the field somebody thought to check;
 * searching the JSON for the other seat's secret catches it through any field at all, including one
 * added later by somebody who never read this file. The secrets are large and distinctive so they
 * cannot collide with a revision, a seat number or a timestamp.
 *
 * Against a real database because the read path is a real read path - the match row, the seat
 * lookup that decides `mine`, and the action rows `since` pages over. A fake DataSource would prove
 * the fake agrees with the code.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;

let seq = 0;

/** Big enough to be unmistakable in a JSON blob, and nothing else in the payload can equal one. */
const SECRETS = [811_111, 922_222];

interface SecretState
{
    rev: number;
    turn: number;
    secrets: number[];
}

const stateFor = (): SecretState => ({ rev: 1, turn: 0, secrets: [...SECRETS] });

/**
 * A game where every seat holds something the others must not read.
 *
 * It borrows ludo's wire shape because `matchBoard` is the wire and a fixture has no business
 * adding a member to it. What is under test is not the shape - it is that the viewer's SEAT reaches
 * the engine and the engine's answer is what ships, so a secret carried in a borrowed field proves
 * exactly as much as one carried in a field of its own.
 */
const secretEngine: Engine<SecretState, { seat: number }> = {
    id: 'ludo',

    create: (): SecretState => stateFor(),

    apply: (state: SecretState) => ({ ok: true, state, events: [] }),

    legal: () => [],

    turnOf: (state: SecretState): number | null => state.turn,

    autoplay: (): null => null,

    finish: (): Ending | null => null,

    standings: (): Placement[] => [],

    view: (state: SecretState, seat: number | null): MatchBoard => ({
        kind: 'ludo',
        moves: seat === null ? [] : [state.secrets[seat]],
        seats: state.secrets.map((secret, index) => ({
            seat: index,
            colour: 'red',
            tokens: [],
            home: seat === index ? secret : 0,
            out: false
        }))
    }),

    log: (events: readonly unknown[], seat: number | null): MatchLog => ({
        kind: 'ludo',
        moves: (events as { seat: number; die: number }[])
            .filter((event) => seat !== null && event.seat === seat)
            .map((event) => ({ e: 'roll' as const, seat: event.seat, die: event.die }))
    }),

    tally: (): Map<number, Tally> => new Map(),

    points: (): number => 0
};

const makeUser = async (): Promise<string> =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`x${ seq }y${ Math.floor(Math.random() * 100000) }`, `Secret ${ seq }`, seq % 360]
    ))[0].id;
};

/** A live two-seat match holding the fixture's state, written directly so nothing else is tested. */
const secretMatch = async (): Promise<{ matchId: string; players: string[] }> =>
{
    const players = [await makeUser(), await makeUser()];
    const state = stateFor();

    const tableId = rowsOf<{ id: string }>(await db.query(
        `insert into tables (game, code, host_id, seats, mode, privacy, target, cube, blinds)
         values ('ludo', $2, $1, 2, 'live', 'public', 0, false, 'low')
         returning id`,
        [players[0], `s${ seq }${ Math.floor(Math.random() * 1000000) }`]
    ))[0].id;

    const matchId = rowsOf<{ id: string }>(await db.query(
        `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
         values ($1, 'ludo', 'standard', 2, $2::jsonb, $3, now() + interval '1 hour')
         returning id`,
        [tableId, JSON.stringify(state), state.rev]
    ))[0].id;

    for (const [seat, userId] of players.entries())
    {
        await db.query(
            `insert into match_players (match_id, seat, user_id, colour) values ($1, $2, $3, $2)`,
            [matchId, seat, userId]
        );
    }

    for (const [seat, secret] of SECRETS.entries())
    {
        await db.query(
            `insert into match_actions (match_id, rev, seat, kind, payload, events, state)
             values ($1, $2, $3, 'roll', '{}'::jsonb, $4::jsonb, $5::jsonb)`,
            [matchId, seat + 1, seat, JSON.stringify([{ seat, die: secret }]), JSON.stringify(state)]
        );
    }

    return { matchId, players };
};

describe.skipIf(!active)('one seat cannot read another', () =>
{
    let matches: ReturnType<typeof createMatchService>;

    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);

        matches = createMatchService(db, createAchieveService(db), [secretEngine]);
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

    describe('the board', () =>
    {
        it('shows each player their own secret and nobody else it', async () =>
        {
            const { matchId, players } = await secretMatch();

            const first = await matches.view(players[0], matchId);
            const second = await matches.view(players[1], matchId);

            expect(first).not.toBeNull();
            expect(second).not.toBeNull();

            const mine = JSON.stringify(matches.board('ludo', first!.state, first!.mine));
            const theirs = JSON.stringify(matches.board('ludo', second!.state, second!.mine));

            expect(mine).toContain(String(SECRETS[0]));
            expect(mine, 'seat 0 was handed seat 1 secret').not.toContain(String(SECRETS[1]));

            expect(theirs).toContain(String(SECRETS[1]));
            expect(theirs, 'seat 1 was handed seat 0 secret').not.toContain(String(SECRETS[0]));
        });

        /**
         * A watcher has no chair, so they are handed `null` and get strictly less than any player.
         * `services.ts` is what turns `mine: -1` into that null and a source-text rule pins it
         * there; this is the other half - that an engine given null actually withholds everything.
         */
        it('shows a spectator nobody secret at all', async () =>
        {
            const { matchId, players } = await secretMatch();
            const load = await matches.view(players[0], matchId);

            const watching = JSON.stringify(matches.board('ludo', load!.state, null));

            for (const secret of SECRETS)
            {
                expect(watching, `a spectator was handed ${ secret }`).not.toContain(String(secret));
            }
        });
    });

    describe('the event feed', () =>
    {
        /**
         * `match_actions` is append-only, so a log left open is not a leak that heals - it is every
         * secret ever written, readable forever by asking for revision zero. This failed before
         * `Engine.log` existed, because `since` handed back the raw `events` column.
         */
        it('replays only what the reader was entitled to see', async () =>
        {
            const { matchId, players } = await secretMatch();

            const first = await matches.since(players[0], matchId, 0);
            const second = await matches.since(players[1], matchId, 0);

            expect(first?.events).toHaveLength(2);

            const mine = JSON.stringify(first!.events);
            const theirs = JSON.stringify(second!.events);

            expect(mine).toContain(String(SECRETS[0]));
            expect(mine, 'seat 0 replayed seat 1 secret').not.toContain(String(SECRETS[1]));

            expect(theirs).toContain(String(SECRETS[1]));
            expect(theirs, 'seat 1 replayed seat 0 secret').not.toContain(String(SECRETS[0]));
        });

        it('answers somebody with no seat as if the match were not there', async () =>
        {
            const { matchId } = await secretMatch();

            expect(await matches.since(await makeUser(), matchId, 0)).toBeNull();
        });
    });
});
