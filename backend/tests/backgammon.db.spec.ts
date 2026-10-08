import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { backgammonEngine } from '../src/domains/match/engines/backgammon.ts';
import type { BackgammonState } from '../src/domains/match/backgammon/state.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const ENGAGED = backgammonEngine.engagement({ seats: 2, variant: 'standard' }).after;

let db: DataSource;
let matches: ReturnType<typeof createMatchService>;
let tables: ReturnType<typeof createTableService>;

let seq = 0;

type Step = 'own' | 'sweep' | null;

interface Seat
{
    seat: number;
    result: string;
    xp: number;
    rating_after: number | null;
    stats: number;
}

const makeUser = async () =>
{
    seq += 1;

    return rowsOf<{ id: string }>(await db.query(
        `insert into users (handle, display_name, hue)
         values ($1, $2, $3)
         returning id`,
        [`b${ seq }x${ Math.floor(Math.random() * 100000) }`, `Board ${ seq }`, seq % 360]
    ))[0].id;
};

const started = async ({ cube = false, target = 3, row }: { cube?: boolean; target?: number; row?: boolean } = {}) =>
{
    const players = [await makeUser(), await makeUser()];
    const table = await tables.create(players[0], {
        game: 'backgammon', seats: 2, mode: 'live', privacy: 'public',
        target, cube, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: []
    });

    if (row !== undefined)
    {
        await db.query(`update tables set cube = $2 where id = $1`, [table.id, row]);
    }

    await tables.claimSeat(players[1], table.id);

    for (const player of players)
    {
        await tables.setReady(player, table.id, true);
    }

    const load = await matches.start(players[0], table.id);

    return { tableId: table.id, matchId: load.match.id, userAt: new Map(load.players.map((one) => [one.seat, one.user_id])) };
};

const missesOf = async (matchId: string) =>
    rowsOf<{ timeouts: number }>(await db.query(
        `select timeouts from match_players where match_id = $1 order by seat`,
        [matchId]
    )).map((row) => row.timeouts);

const stateOf = async (matchId: string) => (await matches.peek(matchId))!.state as BackgammonState;

const play = async (matchId: string, userAt: ReadonlyMap<number, string>, next: (seat: number, own: number[], swept: number[]) => Step) =>
{
    const own = [0, 0];
    const swept = [0, 0];

    for (let step = 0; step < 200; step += 1)
    {
        const state = await stateOf(matchId);
        const seat = backgammonEngine.turnOf(state);

        expect(seat, 'the match ended before the script did').not.toBeNull();

        const chosen = next(seat!, own, swept);

        if (chosen === null)
        {
            return;
        }

        if (chosen === 'sweep')
        {
            await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [matchId]);
            expect((await matches.expireNext())?.played).toBe(true);
            swept[seat!] += 1;
            continue;
        }

        const action = backgammonEngine.autoplay(state, seat!, { die: () => 1 });

        if (action?.kind !== 'move')
        {
            throw new Error(`expected a move at step ${ step }, got ${ action?.kind }`);
        }

        await matches.act(userAt.get(seat!)!, matchId, { play: { kind: 'backgammon', verb: 'move', hops: action.hops }, key: `move-${ step }` });
        own[seat!] += 1;
    }

    throw new Error('the script never stopped');
};

const resign = async (matchId: string, userId: string) =>
{
    await matches.act(userId, matchId, { play: null, key: 'resign' });
};

const seatsOf = async (matchId: string) =>
    rowsOf<Seat>(await db.query(
        `select p.seat, p.result, p.xp, p.rating_after,
                (select count(*)::int from player_stats s where s.user_id = p.user_id and s.game = 'backgammon') as stats
           from match_players p
          where p.match_id = $1
          order by p.seat`,
        [matchId]
    ));

const matchOf = async (matchId: string) =>
    rowsOf<{ outcome: string; winner_seat: number | null }>(await db.query(
        `select outcome, winner_seat from matches where id = $1`,
        [matchId]
    ))[0];

describe.skipIf(!active)('a backgammon match judged, against a real database', () =>
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
        matches = createMatchService(db, createAchieveService(db));
    });

    it('charges a resignation at the opening a rated loss and leaves the other seat no contest', async () =>
    {
        const { matchId, userAt } = await started();

        await resign(matchId, userAt.get(1)!);

        expect(await seatsOf(matchId)).toEqual([
            { seat: 0, result: 'void', xp: 0, rating_after: null, stats: 0 },
            { seat: 1, result: 'abandoned', xp: 0, rating_after: 1184, stats: 1 }
        ]);
        expect(await matchOf(matchId)).toEqual({ outcome: 'abandoned', winner_seat: null });
    });

    it('is a rated win once both seats have made their moves', async () =>
    {
        const { matchId, userAt } = await started();

        await play(matchId, userAt, (_seat, own) => (own.every((count) => count >= ENGAGED) ? null : 'own'));
        await resign(matchId, userAt.get(1)!);

        const [winner, quitter] = await seatsOf(matchId);

        expect(winner).toMatchObject({ result: 'won', rating_after: 1216, stats: 1 });
        expect(winner.xp).toBeGreaterThan(0);
        expect(quitter).toEqual({ seat: 1, result: 'abandoned', xp: 0, rating_after: 1184, stats: 1 });
        expect(await matchOf(matchId)).toEqual({ outcome: 'won', winner_seat: 0 });
    });

    it('counts no turn the sweep played as a move of that seat', async () =>
    {
        const { matchId, userAt } = await started();

        await play(matchId, userAt, (seat, own, swept) =>
        {
            if (own[0] >= ENGAGED && own[1] + swept[1] >= ENGAGED)
            {
                return null;
            }

            if (seat === 0)
            {
                return 'own';
            }

            return own[1] > swept[1] ? 'sweep' : 'own';
        });
        await resign(matchId, userAt.get(1)!);

        expect(await seatsOf(matchId)).toEqual([
            { seat: 0, result: 'void', xp: 0, rating_after: null, stats: 0 },
            { seat: 1, result: 'abandoned', xp: 0, rating_after: 1184, stats: 1 }
        ]);
    });

    it('opens a one-point table with no cube whatever the form asked for, and plays it without one', async () =>
    {
        const { tableId, matchId } = await started({ cube: true, target: 1 });
        const state = await stateOf(matchId);

        expect(rowsOf<{ cube: boolean }>(await db.query(`select cube from tables where id = $1`, [tableId]))).toEqual([{ cube: false }]);
        expect(state).toMatchObject({ target: 1, cubed: false });
        expect([0, 1].flatMap((seat) => backgammonEngine.legal(state, seat)).some((action) => action.kind === 'double')).toBe(false);
    });

    it('starts a one-point match with no cube even when the table row claims one', async () =>
    {
        const { matchId } = await started({ cube: true, target: 1, row: true });

        expect(await stateOf(matchId)).toMatchObject({ target: 1, cubed: false });
    });

    it('keeps the cube the form asked for at three points', async () =>
    {
        const { tableId, matchId } = await started({ cube: true });

        expect(rowsOf<{ cube: boolean }>(await db.query(`select cube from tables where id = $1`, [tableId]))).toEqual([{ cube: true }]);
        expect(await stateOf(matchId)).toMatchObject({ target: 3, cubed: true });
    });

    it('folds an expired roll and move of the cube holder into one miss and one deadline', async () =>
    {
        const { matchId, userAt } = await started({ cube: true });
        const holder = backgammonEngine.turnOf(await stateOf(matchId))!;
        const doubler = 1 - holder;

        await play(matchId, userAt, (_seat, own) => (own[holder] === 0 ? 'own' : null));
        await matches.act(userAt.get(doubler)!, matchId, { play: { kind: 'backgammon', verb: 'double' }, key: 'double' });
        await matches.act(userAt.get(holder)!, matchId, { play: { kind: 'backgammon', verb: 'take' }, key: 'take' });
        await play(matchId, userAt, (seat) => (seat === doubler ? 'own' : null));

        const waiting = await stateOf(matchId);

        expect(waiting).toMatchObject({ turn: holder, phase: 'roll', owner: holder, cube: 2 });

        const before = (await matches.peek(matchId))!.match.rev;

        await db.query(`update matches set deadline_at = now() - interval '1 second' where id = $1`, [matchId]);

        expect(await matches.expireNext()).toEqual({ matchId, game: 'backgammon', played: true, before });
        expect(await matches.expireNext()).toBeNull();

        const swept = rowsOf<{ seat: number; user_id: string | null; verb: string }>(await db.query(
            `select seat, user_id, payload ->> 'verb' as verb from match_actions where match_id = $1 and rev > $2 order by rev`,
            [matchId, before]
        ));

        expect(swept).toEqual([holder, holder].map((seat) => ({ seat, user_id: null, verb: 'auto' })));
        expect(await missesOf(matchId)).toEqual([0, 1].map((seat) => (seat === holder ? 1 : 0)));
        expect(backgammonEngine.turnOf(await stateOf(matchId))).toBe(doubler);
    });
});
