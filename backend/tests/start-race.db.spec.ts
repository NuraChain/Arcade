import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, IsNull } from 'typeorm';

import { Conversation, Match, MatchAction, MatchPlayer, Table, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService, lockTable } from '../src/domains/table/service.ts';
import { rowsOf } from '../src/lib/rows.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const ROUNDS = 20;

const NO_TABLE = { status: 404, code: 'not-found', message: 'No table there.' };

const STILL_WAITING = 'still waiting for the table';

interface Hands
{
    tables: ReturnType<typeof createTableService>;
    matches: ReturnType<typeof createMatchService>;
}

let db: DataSource;
let here: Hands;
let there: Hands;

let seq = 0;

const hands = (): Hands => ({
    tables: createTableService(db, createSocialService(db)),
    matches: createMatchService(db, createAchieveService(db))
});

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `s${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Racer ${ seq }`,
        hue: seq % 360,
        kind: 'guest'
    });

    return made.id;
};

const seated = async (seats: number) =>
{
    const players: string[] = [];

    for (let index = 0; index < seats; index += 1)
    {
        players.push(await makeUser());
    }

    const table = await here.tables.create(players[0], {
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
        await here.tables.claimSeat(player, table.id);
    }

    for (const player of players)
    {
        await here.tables.setReady(player, table.id, true);
    }

    return { tableId: table.id, players };
};

const leave = (from: Hands, who: string, tableId: string, mayForfeit: boolean) =>
    from.tables.leave(who, tableId, (tx) => from.matches.walkOut(tx, who, tableId, mayForfeit));

const walkOut = (from: Hands, who: string, tableId: string) => leave(from, who, tableId, true);

const standUp = (from: Hands, who: string, tableId: string) => leave(from, who, tableId, false);

const walkoutsAt = async (tableId: string) =>
    await db.getRepository(MatchAction)
        .createQueryBuilder('a')
        .innerJoin(Match, 'm', 'm.id = a.match_id')
        .where('m.table_id = :tableId', { tableId })
        .andWhere(`a.kind = 'forfeit' and a.payload ->> 'verb' = 'left'`)
        .getCount();

const unagreed = async (tableId: string) =>
{
    const walkouts = await walkoutsAt(tableId);

    return walkouts > 0 ? [`${ walkouts } walked out of a game without agreeing to`] : [];
};

const inAChair = async (who: string, tableId: string) =>
    await db.getRepository(TableSeat).existsBy({ tableId, userId: who });

const stillPlayingWithNoChair = async (tableId: string) =>
    await db.getRepository(MatchPlayer)
        .createQueryBuilder('p')
        .innerJoin(Match, 'm', 'm.id = p.match_id')
        .where('m.table_id = :tableId', { tableId })
        .andWhere('p.result is null')
        .andWhere(
            `not exists (select 1 from table_seats s
                          where s.table_id = m.table_id and s.seat = p.seat and s.user_id = p.user_id)`
        )
        .getCount();

const seatedAndNeverDealt = async (tableId: string) =>
    await db.getRepository(TableSeat)
        .createQueryBuilder('s')
        .innerJoin(Match, 'm', 'm.table_id = s.table_id and m.finished_at is null')
        .where('s.table_id = :tableId', { tableId })
        .andWhere('s.user_id is not null')
        .andWhere(
            `not exists (select 1 from match_players p
                          where p.match_id = m.id and p.seat = s.seat and p.user_id = s.user_id)`
        )
        .getCount();

const faultsAt = async (tableId: string) =>
{
    const chairless = await stillPlayingWithNoChair(tableId);
    const undealt = await seatedAndNeverDealt(tableId);
    const playing = await db.getRepository(Match).existsBy({ tableId, finishedAt: IsNull() });
    const closed = await db.getRepository(Table).existsBy({ id: tableId, status: 'closed' });

    return [
        ...(chairless > 0 ? [`${ chairless } still in the game with no chair`] : []),
        ...(undealt > 0 ? [`${ undealt } in a chair the game never dealt`] : []),
        ...(playing && closed ? ['a game running on a closed table'] : [])
    ];
};

const refusalsOf = (answers: PromiseSettledResult<unknown>[]) =>
    answers
        .filter((answer) => answer.status === 'rejected')
        .map((answer) => String((answer.reason as { code?: unknown }).code ?? answer.reason));

const toldOtherThan = (answers: PromiseSettledResult<unknown>[], owed: string[]) =>
{
    const refused = refusalsOf(answers);

    return refused.join() === owed.join() ? [] : [`refused [${ refused.join() }] where [${ owed.join() }] was owed`];
};

const strangeIn = (answers: PromiseSettledResult<unknown>[], ordinary: string[]) =>
    refusalsOf(answers)
        .filter((code) => !ordinary.includes(code))
        .map((code) => `refused with ${ code }`);

const everyRound = async (round: (index: number) => Promise<string[]>) =>
{
    const broken: string[] = [];

    for (let index = 0; index < ROUNDS; index += 1)
    {
        broken.push(...(await round(index)).map((fault) => `round ${ index }: ${ fault }`));
    }

    return broken.join('\n');
};

const waitingOnLocks = async () =>
    rowsOf<{ count: number }>(await db.query(
        `select count(*)::int as count from pg_stat_activity
          where datname = current_database() and backend_type = 'client backend' and wait_event_type = 'Lock'`
    ))[0].count;

const backedUp = async (mode: 'share' | 'exclusive', arriving: (() => Promise<unknown>)[]) =>
{
    const gate = db.createQueryRunner();
    const answers: Promise<PromiseSettledResult<unknown>>[] = [];
    let settled = 0;

    await gate.connect();
    await gate.startTransaction();
    await gate.query(`lock table matches in ${ mode } mode`);

    try
    {
        for (const arrive of arriving)
        {
            answers.push(Promise.allSettled([arrive()]).then(([answer]) =>
            {
                settled += 1;

                return answer;
            }));

            await vi.waitFor(async () =>
            {
                const done = settled;

                expect(done + await waitingOnLocks()).toBeGreaterThanOrEqual(answers.length);
            }, { timeout: 10_000, interval: 5 });
        }
    }
    finally
    {
        await gate.commitTransaction();
        await gate.release();
    }

    return await Promise.all(answers);
};

const withTheTableHeld = async (tableId: string, ask: () => Promise<unknown>) =>
{
    const holder = db.createQueryRunner();
    let patience: ReturnType<typeof setTimeout> | undefined;

    await holder.connect();
    await holder.startTransaction();
    await lockTable(holder.manager, tableId);

    const asked = ask().then(() => null, (error: unknown) => error);

    try
    {
        return await Promise.race([
            asked,
            new Promise<string>((resolve) =>
            {
                patience = setTimeout(() => resolve(STILL_WAITING), 2_000);
            })
        ]);
    }
    finally
    {
        clearTimeout(patience);
        await holder.rollbackTransaction();
        await holder.release();
        await asked;
    }
};

describe.skipIf(!active)('a start racing whatever moves its chairs, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        here = hands();
        there = hands();
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
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    it('deals in nobody whose chair a leave is emptying, whichever reaches the table first', async () =>
    {
        const broken = await everyRound(async (round) =>
        {
            const { tableId, players } = await seated(3);
            const starting = () => here.matches.start(players[0], tableId);
            const leaving = () => walkOut(there, players[1], tableId);
            const startFirst = round % 2 === 0;

            const answers = await backedUp('exclusive', startFirst ? [starting, leaving] : [leaving, starting]);

            return [...await faultsAt(tableId), ...toldOtherThan(answers, startFirst ? [] : ['chairs-empty'])];
        });

        expect(broken).toBe('');
    }, 120_000);

    it('deals in nobody who left for whoever took their chair', async () =>
    {
        const broken = await everyRound(async () =>
        {
            const { tableId, players: [host, leaver] } = await seated(2);
            const newcomer = await makeUser();

            const answers = await backedUp('share', [
                () => here.matches.start(host, tableId),
                async () =>
                {
                    await walkOut(there, leaver, tableId);
                    await there.tables.claimSeat(newcomer, tableId);
                    await there.tables.setReady(newcomer, tableId, true);
                }
            ]);

            return [...await faultsAt(tableId), ...toldOtherThan(answers, [])];
        });

        expect(broken).toBe('');
    }, 120_000);

    it('leaves no game running on a table its host closes under it', async () =>
    {
        const broken = await everyRound(async () =>
        {
            const { tableId, players: [host, guest] } = await seated(2);

            const answers = await backedUp('share', [
                () => here.matches.start(guest, tableId),
                () => there.tables.close(host, tableId)
            ]);

            return [...await faultsAt(tableId), ...toldOtherThan(answers, ['playing'])];
        });

        expect(broken).toBe('');
    }, 120_000);

    it('never deadlocks a leave, a finish and a start that arrive together', async () =>
    {
        const { tableId, players: [stays, leaves] } = await seated(2);

        const broken = await everyRound(async (round) =>
        {
            await here.tables.claimSeat(leaves, tableId);
            await here.tables.setReady(stays, tableId, true);
            await here.tables.setReady(leaves, tableId, true);

            const { match } = await here.matches.start(stays, tableId);

            const arriving = [
                () => walkOut(there, leaves, tableId),
                () => here.matches.act(stays, match.id, { play: null, key: `resigns-${ round }` }),
                () => there.matches.start(stays, tableId)
            ];

            const answers = await backedUp('exclusive', [...arriving.slice(round % 3), ...arriving.slice(0, round % 3)]);

            return [...await faultsAt(tableId), ...strangeIn(answers, ['game-over', 'chairs-empty', 'not-ready'])];
        });

        expect(broken).toBe('');
    }, 120_000);

    it('holds a table under one lock however its id is spelled', async () =>
    {
        const { tableId, players } = await seated(3);

        const answers = await backedUp('exclusive', [
            () => here.matches.start(players[0], tableId.toUpperCase()),
            () => walkOut(there, players[1], tableId)
        ]);

        expect([...await faultsAt(tableId), ...toldOtherThan(answers, [])]).toEqual([]);
    }, 30_000);

    it('answers somebody with no chair at once, however long the table is held', async () =>
    {
        const { tableId } = await seated(2);
        const stranger = await makeUser();

        expect(await withTheTableHeld(tableId, () => here.matches.start(stranger, tableId))).toMatchObject(NO_TABLE);
    }, 30_000);

    it('answers somebody whose own leave reached the table first as it answers a stranger', async () =>
    {
        const { tableId, players } = await seated(3);

        const [left, started] = await backedUp('exclusive', [
            () => walkOut(there, players[1], tableId),
            () => here.matches.start(players[1], tableId)
        ]);

        expect(left).toMatchObject({ status: 'fulfilled', value: { left: true, walked: null } });
        expect(started).toMatchObject({ status: 'rejected', reason: NO_TABLE });
    }, 30_000);

    describe('a leave that did not agree to forfeit', () =>
    {
        it('keeps its chair and its game, or is gone with no game dealt, by whichever reached the table first', async () =>
        {
            const broken = await everyRound(async (round) =>
            {
                const { tableId, players } = await seated(3);
                const starting = () => here.matches.start(players[0], tableId);
                const leaving = () => standUp(there, players[1], tableId);
                const startFirst = round % 2 === 0;

                const answers = await backedUp('exclusive', startFirst ? [starting, leaving] : [leaving, starting]);
                const stayed = await inAChair(players[1], tableId);

                return [
                    ...await faultsAt(tableId),
                    ...await unagreed(tableId),
                    ...toldOtherThan(answers, startFirst ? ['playing'] : ['chairs-empty']),
                    ...(stayed === startFirst ? [] : [stayed ? 'still in a chair it left before the start' : 'out of a chair whose game had started'])
                ];
            });

            expect(broken).toBe('');
        }, 120_000);

        it('is never swapped out of a game it was dealt into', async () =>
        {
            const broken = await everyRound(async () =>
            {
                const { tableId, players: [host, leaver] } = await seated(2);
                const newcomer = await makeUser();

                const answers = await backedUp('share', [
                    () => here.matches.start(host, tableId),
                    async () =>
                    {
                        await standUp(there, leaver, tableId);
                        await there.tables.claimSeat(newcomer, tableId);
                        await there.tables.setReady(newcomer, tableId, true);
                    }
                ]);

                return [
                    ...await faultsAt(tableId),
                    ...await unagreed(tableId),
                    ...toldOtherThan(answers, ['playing']),
                    ...(await inAChair(leaver, tableId) ? [] : ['out of a chair whose game had started']),
                    ...(await inAChair(newcomer, tableId) ? ['somebody else in its chair'] : [])
                ];
            });

            expect(broken).toBe('');
        }, 120_000);

        it('never deadlocks with a finish and a start that arrive together', async () =>
        {
            const { tableId, players: [stays, leaves] } = await seated(2);

            const broken = await everyRound(async (round) =>
            {
                await here.tables.claimSeat(leaves, tableId);
                await here.tables.setReady(stays, tableId, true);
                await here.tables.setReady(leaves, tableId, true);

                const { match } = await here.matches.start(stays, tableId);

                const arriving = [
                    () => standUp(there, leaves, tableId),
                    () => here.matches.act(stays, match.id, { play: null, key: `gives-up-${ round }` }),
                    () => there.matches.start(stays, tableId)
                ];

                const answers = await backedUp('exclusive', [...arriving.slice(round % 3), ...arriving.slice(0, round % 3)]);

                return [
                    ...await faultsAt(tableId),
                    ...await unagreed(tableId),
                    ...strangeIn(answers, ['playing', 'chairs-empty', 'not-ready'])
                ];
            });

            expect(broken).toBe('');
        }, 120_000);
    });
});
