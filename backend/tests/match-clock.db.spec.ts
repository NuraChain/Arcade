import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import type { Ending, Engine, Moment, Placement, TableConfig, Tally } from '../src/domains/match/engine.ts';
import type { MatchBoard, MatchLog, MatchPlay } from '../src/schemas.ts';

/**
 * The seam a game played against a clock needs: a deadline armed from what the side to move has
 * left, the moment a play arrived handed to the engine, and a resignation the game scores itself.
 *
 * Chess is not on the catalogue yet, so the engine here is a fixture that keeps a bank for each
 * side and writes down what it was handed. Against a real database because every number that
 * matters here is Postgres's: the deadline the start writes, the one a move re-arms, and the time
 * left that is read off the locked row.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let tables: ReturnType<typeof createTableService>;

let seq = 0;

interface Clocked
{
    rev: number;
    turn: number;
    moves: number;
    banks: number[] | null;
    clock: TableConfig['clock'];
    lefts: (number | null)[];
    over: number | null;
}

type Act = { kind: 'pass' | 'note' | 'flag' | 'concede' | 'forfeit'; seat: number };

const SECOND_BANK = 15_000;

/** Two sides taking turns; `pass` hands the turn on, `note` keeps it; a bank per side when the table has a clock. */
const fixture = (keeps: { bank: boolean; concede: boolean }): Engine<Clocked, Act> => ({
    id: 'ludo',

    formats: [{ seats: 2, variant: 'standard' }],

    create: (_seats, _draws, table) => ({
        state: {
            rev: 1,
            turn: 0,
            moves: 0,
            banks: table.clock === null || table.clock === undefined ? null : [table.clock.base, table.clock.base + SECOND_BANK],
            clock: table.clock ?? null,
            lefts: [],
            over: null
        },
        events: []
    }),

    parse: (play: MatchPlay, seat: number): Act | null => (play.kind === 'ludo' ? { kind: play.verb === 'roll' ? 'pass' : 'note', seat } : null),

    forfeit: (seat: number): Act => ({ kind: 'forfeit', seat }),

    apply: (state: Clocked, action: Act, _draws, moment?: Moment) =>
    {
        const next = { ...state, rev: state.rev + 1 };

        if (action.kind === 'pass' || action.kind === 'note')
        {
            const turn = action.kind === 'pass' ? 1 - state.turn : state.turn;

            return { ok: true, state: { ...next, turn, moves: state.moves + (action.kind === 'pass' ? 1 : 0), lefts: [...state.lefts, moment?.left ?? null] }, events: [] };
        }

        const winner = action.kind === 'flag' ? 1 - state.turn : 1 - action.seat;

        return { ok: true, state: { ...next, over: winner }, events: [] };
    },

    ...(keeps.bank ? { bank: (state: Clocked) => (state.over !== null || state.banks === null ? null : state.banks[state.turn]) } : {}),

    ...(keeps.concede ? { concede: (seat: number): Act => ({ kind: 'concede', seat }) } : {}),

    legal: () => [],

    turnOf: (state: Clocked) => (state.over === null ? state.turn : null),

    autoplay: (state: Clocked, seat: number): Act | null => (state.over === null && seat === state.turn ? { kind: 'flag', seat } : null),

    finish: (state: Clocked): Ending | null => (state.over === null ? null : { winners: [state.over], unsettled: [], trailing: [] }),

    standings: (state: Clocked): Placement[] => [0, 1].map((seat) => ({ seat, place: state.over === null || state.over === seat ? 1 : 2 })),

    sideOf: (seat: number) => seat,

    engagement: () => ({ verbs: ['roll'], after: 0 }),

    turnKey: (state: Clocked) => String(state.moves),

    view: (state: Clocked): MatchBoard => ({ kind: 'ludo', moves: [], controls: state.turn, seats: [] }),

    log: (): MatchLog => ({ kind: 'ludo', moves: [] }),

    tally: (): Map<number, Tally> => new Map(),

    points: (): number => 0
});

const CLOCKED = fixture({ bank: true, concede: true });

const makeUser = async () =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue)
         values ($1, $2, $3)
         returning id`,
        [`c${ seq }x${ Math.floor(Math.random() * 100000) }`, `Clock ${ seq }`, seq % 360]
    ))[0].id;
};

/** Two players ready at a ludo table, its time control written by hand where one is wanted. */
const seated = async (mode: 'live' | 'turns', clock: string | null) =>
{
    const players = [await makeUser(), await makeUser()];
    const table = await tables.create(players[0], {
        game: 'ludo', seats: 2, mode, privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: []
    });

    await tables.claimSeat(players[1], table.id);

    for (const player of players)
    {
        await tables.setReady(player, table.id, true);
    }

    await db.query('update tables set clock = $2 where id = $1', [table.id, clock]);

    return { tableId: table.id, players };
};

const started = async (engine: Engine<Clocked, Act>, mode: 'live' | 'turns' = 'live', clock: string | null = '3+2') =>
{
    const service = createMatchService(db, createAchieveService(db), [engine as Engine]);
    const { tableId, players } = await seated(mode, clock);
    const match = await service.start(players[0], tableId);

    return { service, players, matchId: match.match.id };
};

/** How far off the deadline is, by the database's clock, in milliseconds. */
const dueIn = async (matchId: string) =>
    rowsOf<{ due: number }>(await db.query(
        `select (extract(epoch from (deadline_at - now())) * 1000)::float8 as due from matches where id = $1`,
        [matchId]
    ))[0].due;

const stateOf = async (matchId: string) =>
    rowsOf<{ state: Clocked }>(await db.query('select state from matches where id = $1', [matchId]))[0].state;

const due = async (matchId: string, seconds: number) =>
{
    await db.query(`update matches set deadline_at = now() + make_interval(secs => $2) where id = $1`, [matchId, seconds]);
};

const ROLL = { kind: 'ludo', verb: 'roll' } as const;

const NOTE = { kind: 'ludo', verb: 'move', piece: 0 } as const;

describe.skipIf(!active)('a game played against a clock, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
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
        tables = createTableService(db, createSocialService(db));
    });

    describe('the deadline', () =>
    {
        it('hands the engine the table\'s time control, as each side\'s bank and what a move adds', async () =>
        {
            const { matchId } = await started(CLOCKED);

            expect((await stateOf(matchId)).clock).toEqual({ base: 180_000, increment: 2000 });
        });

        it('is armed at the start from what the side to move has on its own clock', async () =>
        {
            const { matchId } = await started(CLOCKED);
            const left = await dueIn(matchId);

            expect(left).toBeGreaterThan(178_000);
            expect(left).toBeLessThanOrEqual(180_000);
        });

        it('is armed from the mode where the game keeps no clock of its own, a day at a turn-based table', async () =>
        {
            const { matchId } = await started(CLOCKED, 'turns', null);

            expect((await stateOf(matchId)).clock).toBeNull();
            expect(await dueIn(matchId)).toBeGreaterThan(86_390_000);
        });

        it('is armed again from the next side\'s bank when the turn passes', async () =>
        {
            const { service, players, matchId } = await started(CLOCKED);

            await service.act(players[0], matchId, { play: ROLL, key: 'pass-1' });

            const left = await dueIn(matchId);

            expect(left).toBeGreaterThan(193_000);
            expect(left).toBeLessThanOrEqual(195_000);
        });

        it('is left where it was while the turn stays with the side to move', async () =>
        {
            const { service, players, matchId } = await started(CLOCKED);

            await due(matchId, 40);
            await service.act(players[0], matchId, { play: NOTE, key: 'note-1' });

            const left = await dueIn(matchId);

            expect(left).toBeGreaterThan(38_000);
            expect(left).toBeLessThanOrEqual(40_000);
        });
    });

    describe('the moment a play arrived', () =>
    {
        it('is what the side to move had left, read off the locked row by the database\'s clock', async () =>
        {
            const { service, players, matchId } = await started(CLOCKED);

            await due(matchId, 12);
            await service.act(players[0], matchId, { play: ROLL, key: 'pass-1' });

            const [left] = (await stateOf(matchId)).lefts;

            expect(left).toBeGreaterThan(11_000);
            expect(left).toBeLessThanOrEqual(12_000);
        });

        it('is below nothing once the deadline has passed, for the engine to refuse', async () =>
        {
            const { service, players, matchId } = await started(CLOCKED);

            await due(matchId, -3);
            await service.act(players[0], matchId, { play: ROLL, key: 'pass-1' });

            expect((await stateOf(matchId)).lefts[0]).toBeLessThan(-2_000);
        });

        it('is handed to no engine that keeps no clock of its own', async () =>
        {
            const { service, players, matchId } = await started(fixture({ bank: false, concede: true }));

            await service.act(players[0], matchId, { play: ROLL, key: 'pass-1' });

            expect((await stateOf(matchId)).lefts).toEqual([null]);
        });
    });

    describe('a resignation', () =>
    {
        it('is the game\'s own concession where it has one: a play, a loss and a full win', async () =>
        {
            const { service, players, matchId } = await started(CLOCKED);

            await service.act(players[0], matchId, { play: null, key: 'resign-1' });

            const rows = rowsOf<{ kind: string; verb: string }>(await db.query(
                `select kind, payload ->> 'verb' as verb from match_actions where match_id = $1 and seat = 0`,
                [matchId]
            ));
            const results = rowsOf<{ seat: number; result: string }>(await db.query(
                'select seat, result from match_players where match_id = $1 order by seat',
                [matchId]
            ));

            expect(rows).toEqual([{ kind: 'play', verb: 'resign' }]);
            expect(results).toEqual([{ seat: 0, result: 'lost' }, { seat: 1, result: 'won' }]);
            expect(rowsOf<{ won: number }>(await db.query('select won from player_stats where user_id = $1', [players[1]]))[0].won).toBe(1);
        });

        it('is still a forfeit in a game that concedes nothing', async () =>
        {
            const { service, players, matchId } = await started(fixture({ bank: true, concede: false }));

            await service.act(players[0], matchId, { play: null, key: 'resign-1' });

            const rows = rowsOf<{ kind: string; verb: string }>(await db.query(
                `select kind, payload ->> 'verb' as verb from match_actions where match_id = $1 and seat = 0`,
                [matchId]
            ));

            expect(rows).toEqual([{ kind: 'forfeit', verb: 'resign' }]);
            expect(rowsOf<{ result: string }>(await db.query('select result from match_players where match_id = $1 and seat = 0', [matchId]))[0].result).toBe('abandoned');
        });
    });

    describe('a deadline written by hand', () =>
    {
        it('is met by the sweep with what the engine plays for a side whose time is up', async () =>
        {
            const { service, matchId } = await started(CLOCKED);

            await due(matchId, -1);

            const swept = await service.expireNext();

            expect(swept).toMatchObject({ matchId, played: true });
            expect((await stateOf(matchId)).over).toBe(1);
            expect(rowsOf<{ outcome: string; finished: boolean }>(await db.query(
                'select outcome, finished_at is not null as finished from matches where id = $1',
                [matchId]
            ))[0]).toEqual({ outcome: 'won', finished: true });
        });
    });
});
