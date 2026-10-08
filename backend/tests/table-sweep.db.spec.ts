import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, IsNull, Not, type EntityManager } from 'typeorm';

import { Conversation, ConversationMember, Friendship, Match, MatchAction, MatchPlayer, Notification, Table, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService, lockTable } from '../src/domains/table/service.ts';
import { hashToken, mintToken } from '../src/lib/crypto.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { createHub, SEEN_MS } from '../src/realtime/hub.ts';
import { buildPorts, type PresenceReader, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const ROUNDS = 10;

const EVERY_CHAIR = 500;

const NOTHING_DONE = { stoodUp: 0, closed: 0, failed: [] };

interface Hands
{
    tables: ReturnType<typeof createTableService>;
    matches: ReturnType<typeof createMatchService>;
}

type Opening = Parameters<Hands['tables']['create']>[1];

let db: DataSource;
let here: Hands;
let there: Hands;

let seq = 0;

const away = new Set<string>();

const whoIsHere: PresenceReader = {
    present: (userIds) => new Set(userIds.filter((id) => !away.has(id)))
};

const nobodyHere = () => new Set<string>();

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const hands = (): Hands => ({
    tables: createTableService(db, createSocialService(db)),
    matches: createMatchService(db, createAchieveService(db))
});

const door = (presence?: PresenceReader, from: DataSource = db, live: WriteListener = listener) => buildPorts(from, {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1], live, presence);

const hubAt = (clock: { at: number }) => createHub({
    now: () => clock.at,
    accountMax: 3,
    edgesFor: async (userId) => ({
        party: { id: userId, isMinor: false, allowStrangerMessages: true, showOnline: true },
        handle: userId,
        friends: new Set<string>(),
        blocks: new Set<string>(),
        loadedAt: clock.at
    }),
    recipientsOf: async () => [],
    aliveSessions: async (ids) => new Set(ids),
    touchSeen: () => undefined,
    report: () => undefined,
    voiceAllowed: async () => false,
    mayTalk: async () => false,
    pulse: async () => ({ games: [], watching: '' })
});

const asking = async (userId: string) =>
{
    const token = mintToken();

    await db.query(
        `insert into sessions (user_id, token_hash, expires_at)
         values ($1, $2, now() + interval '30 days')`,
        [userId, hashToken(token)]
    );

    return new Request('http://localhost:1/api/tables/mine', { headers: { cookie: `nura.session=${ token }` } });
};

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `w${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Waiting ${ seq }`,
        hue: seq % 360
    });

    return made.id;
};

const crowd = async (size: number) =>
{
    const people: string[] = [];

    for (let index = 0; index < size; index += 1)
    {
        people.push(await makeUser());
    }

    return people;
};

const opened = async (host: string, patch: Partial<Opening> = {}) =>
    (await here.tables.create(host, {
        game: 'ludo',
        seats: 4,
        mode: 'live',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: [],
        ...patch
    })).id;

const sat = async (who: string, tableId: string) =>
{
    await here.tables.claimSeat(who, tableId);
    await here.tables.setReady(who, tableId, true);
};

const seated = async (seats: number) =>
{
    const players = await crowd(seats);
    const tableId = await opened(players[0], { seats });

    await here.tables.setReady(players[0], tableId, true);

    for (const player of players.slice(1))
    {
        await sat(player, tableId);
    }

    return { tableId, players };
};

const chairOf = async (who: string, tableId: string) =>
    await db.getRepository(TableSeat).findOne({ where: { tableId, userId: who } });

const sitting = async (tableId: string) =>
    (await db.getRepository(TableSeat).find({ where: { tableId, userId: Not(IsNull()) }, order: { seat: 'ASC' } })).map((chair) => chair.userId);

const threadOf = async (tableId: string) => (await db.getRepository(Conversation).findOneByOrFail({ tableId, kind: 'game' })).id;

const inThread = async (who: string, tableId: string) =>
    await db.getRepository(ConversationMember).existsBy({ conversationId: await threadOf(tableId), userId: who });

const row = async (tableId: string) => await db.getRepository(Table).findOneByOrFail({ id: tableId });

const live = async (tableId: string) => await db.getRepository(Match).countBy({ tableId, finishedAt: IsNull() });

const satSince = async (who: string, tableId: string, minutesAgo: number) =>
{
    await db.getRepository(TableSeat).update({ tableId, userId: who }, { joinedAt: new Date(Date.now() - minutesAgo * 60_000) });
};

const dealtWithNoChair = async (tableId: string) =>
    await db.getRepository(MatchPlayer)
        .createQueryBuilder('p')
        .innerJoin(Match, 'm', 'm.id = p.match_id and m.finished_at is null')
        .where('m.table_id = :tableId', { tableId })
        .andWhere(
            `not exists (select 1 from table_seats s
                          where s.table_id = m.table_id and s.seat = p.seat and s.user_id = p.user_id)`
        )
        .getCount();

const codeOf = (answer: PromiseSettledResult<unknown>) =>
    answer.status === 'rejected' ? String((answer.reason as { code?: unknown }).code ?? answer.reason) : 'no refusal';

const everyRound = async (round: () => Promise<string[]>) =>
{
    const broken: string[] = [];

    for (let index = 0; index < ROUNDS; index += 1)
    {
        broken.push(...(await round()).map((fault) => `round ${ index }: ${ fault }`));
    }

    return broken.join('\n');
};

const waitingOnLocks = async () =>
    rowsOf<{ count: number }>(await db.query(
        `select count(*)::int as count from pg_stat_activity
          where datname = current_database() and backend_type = 'client backend' and wait_event_type = 'Lock'`
    ))[0].count;

const parkedBehind = async (hold: (tx: EntityManager) => Promise<unknown>, arriving: (() => Promise<unknown>)[]) =>
{
    const gate = db.createQueryRunner();
    const answers: Promise<PromiseSettledResult<unknown>>[] = [];
    let settled = 0;

    await gate.connect();
    await gate.startTransaction();

    try
    {
        await hold(gate.manager);

        for (const arrive of arriving)
        {
            expect(settled, 'somebody who should have been parked at the gate went straight through').toBe(0);

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
        await gate.rollbackTransaction();
        await gate.release();
    }

    return await Promise.all(answers);
};

const atTheInsertAndTheThread = (thread: string, who: string) => async (tx: EntityManager) =>
{
    await tx.query('lock table matches in share mode');
    await tx.getRepository(ConversationMember).findOne({
        where: { conversationId: thread, userId: who },
        lock: { mode: 'pessimistic_write' }
    });
};

describe.skipIf(!active)('a waiting chair whose occupant is not here, against a real database', () =>
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
        away.clear();
    });

    describe('who a sweep stands up', () =>
    {
        it('leaves somebody their chair the first time it finds them away, and stands them up the second time in a row', async () =>
        {
            const [host, guest] = await crowd(2);
            const tableId = await opened(host);
            const { jobs } = door(whoIsHere);

            await sat(guest, tableId);
            away.add(guest);

            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
            expect(await chairOf(guest, tableId)).toMatchObject({ seat: 1, ready: true });
            expect(await inThread(guest, tableId)).toBe(true);

            expect(await jobs.sweepTables()).toEqual({ stoodUp: 1, closed: 0, failed: [] });
            expect(await db.getRepository(TableSeat).findOneByOrFail({ tableId, seat: 1 })).toMatchObject({ userId: null, ready: false, joinedAt: null });
            expect(await inThread(guest, tableId)).toBe(false);
            expect(await sitting(tableId)).toEqual([host]);
            expect(await inThread(host, tableId)).toBe(true);
            expect(await row(tableId)).toMatchObject({ status: 'open', closedAt: null });

            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
        });

        it('leaves the chair of somebody whose page goes on asking the server, though no socket of theirs ever opened', async () =>
        {
            const [host, guest] = await crowd(2);
            const tableId = await opened(host);
            const clock = { at: Date.now() };
            const hub = hubAt(clock);
            const { jobs, identity } = door({ present: (userIds) => hub.present(userIds) }, db, hub);
            const request = await asking(guest);
            const hosting = await asking(host);

            await sat(guest, tableId);

            for (let sweep = 0; sweep < 4; sweep += 1)
            {
                expect((await identity.principal(request))?.userId).toBe(guest);
                expect((await identity.principal(hosting))?.userId).toBe(host);
                clock.at += SEEN_MS - 1;

                expect(await jobs.sweepTables(), `sweep ${ sweep }`).toEqual(NOTHING_DONE);
            }

            expect(await sitting(tableId)).toEqual([host, guest]);

            expect((await identity.principal(hosting))?.userId).toBe(host);
            clock.at += SEEN_MS - 1;
            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
            expect((await identity.principal(hosting))?.userId).toBe(host);
            clock.at += SEEN_MS - 1;
            expect(await jobs.sweepTables(), 'the guest stopped asking two sweeps ago').toEqual({ stoodUp: 1, closed: 0, failed: [] });
            expect(await sitting(tableId)).toEqual([host]);
        });

        it('lets somebody who is back by the second sweep keep the chair, and starts from nothing if they go again', async () =>
        {
            const [host, guest] = await crowd(2);
            const tableId = await opened(host);
            const { jobs } = door(whoIsHere);

            await sat(guest, tableId);
            away.add(guest);
            await jobs.sweepTables();
            away.delete(guest);

            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);

            away.add(guest);

            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
            expect(await chairOf(guest, tableId)).toMatchObject({ seat: 1, ready: true });
            expect(await jobs.sweepTables()).toMatchObject({ stoodUp: 1 });
            expect(await chairOf(guest, tableId)).toBeNull();
        });

        it('closes the table behind the last one it stands up, at a table for the host’s friends as at a public one', async () =>
        {
            const [alone, host, friend] = await crowd(3);
            const empty = await opened(alone);
            const theirs = await opened(host, { privacy: 'friends' });
            const { jobs } = door(whoIsHere);

            await db.getRepository(Friendship).insert([{ userId: host, friendId: friend }, { userId: friend, friendId: host }]);
            await sat(friend, theirs);
            [alone, host, friend].forEach((who) => away.add(who));
            await jobs.sweepTables();

            expect(await jobs.sweepTables()).toEqual({ stoodUp: 3, closed: 2, failed: [] });

            for (const tableId of [empty, theirs])
            {
                expect(await sitting(tableId)).toEqual([]);
                expect(await row(tableId)).toMatchObject({ status: 'closed' });
                expect((await row(tableId)).closedAt).not.toBeNull();
            }

            expect(await db.getRepository(ConversationMember).count()).toBe(0);
        });

        it('counts everybody as here when there is no hub to ask', async () =>
        {
            const host = await makeUser();
            const tableId = await opened(host);
            const { jobs } = door();

            away.add(host);

            for (let sweep = 0; sweep < 3; sweep += 1)
            {
                expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
            }

            expect(await sitting(tableId)).toEqual([host]);
        });
    });

    describe('which chairs it never frees', () =>
    {
        it('keeps the absent at a turn-based table, an invite table, a table opened in a conversation and a closed one', async () =>
        {
            const [slow, asked, host, member, shut, anybody, friendly] = await crowd(7);
            const room = (await db.getRepository(Conversation).save({ kind: 'direct', pairKey: [host, member].sort().join(':') })).id;

            await db.getRepository(ConversationMember).insert([{ conversationId: room, userId: host }, { conversationId: room, userId: member }]);

            const kept = [
                [slow, await opened(slow, { mode: 'turns' })],
                [asked, await opened(asked, { privacy: 'invite' })],
                [host, await opened(host, { seats: 2, roomId: room })],
                [shut, await opened(shut)]
            ];
            const swept = [
                [anybody, await opened(anybody)],
                [friendly, await opened(friendly, { privacy: 'friends' })]
            ];
            const { jobs } = door(whoIsHere);

            await here.tables.close(shut, kept[3][1]);
            [...kept, ...swept].forEach(([who]) => away.add(who));

            expect(await here.tables.waitingSeats(EVERY_CHAIR)).toEqual(swept.map(([userId, tableId]) => ({ tableId, userId })));

            await jobs.sweepTables();

            expect(await jobs.sweepTables()).toEqual({ stoodUp: 2, closed: 2, failed: [] });
            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);

            for (const [who, tableId] of kept)
            {
                expect(await sitting(tableId), tableId).toEqual([who]);
                expect(await inThread(who, tableId), tableId).toBe(true);
                expect(await here.tables.vacate(tableId, who, nobodyHere), tableId).toBeNull();
                expect(await sitting(tableId), tableId).toEqual([who]);
            }

            for (const [, tableId] of swept)
            {
                expect(await sitting(tableId), tableId).toEqual([]);
            }
        });

        it('never touches a table with a game on, and takes it up again once the game is over', async () =>
        {
            const { tableId, players: [host, guest] } = await seated(2);
            const { match } = await here.matches.start(host, tableId);
            const { jobs } = door(whoIsHere);

            away.add(host).add(guest);

            for (let sweep = 0; sweep < 3; sweep += 1)
            {
                expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
            }

            expect(await here.tables.waitingSeats(EVERY_CHAIR)).toEqual([]);
            expect(await here.tables.vacate(tableId, guest, nobodyHere)).toBeNull();
            expect(await sitting(tableId)).toEqual([host, guest]);
            expect(await inThread(guest, tableId)).toBe(true);
            expect(await live(tableId)).toBe(1);
            expect(await db.getRepository(MatchPlayer).countBy({ matchId: match.id, result: IsNull() })).toBe(2);

            await here.matches.act(guest, match.id, { play: null, key: 'gives-up' });

            const results = async () => await db.getRepository(MatchPlayer).find({ where: { matchId: match.id }, order: { seat: 'ASC' } });
            const recorded = await results();

            expect(await live(tableId)).toBe(0);
            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
            expect(await jobs.sweepTables()).toEqual({ stoodUp: 2, closed: 1, failed: [] });
            expect(await sitting(tableId)).toEqual([]);
            expect(await results()).toEqual(recorded);
            expect(await db.getRepository(MatchAction).countBy({ matchId: match.id, kind: 'forfeit' })).toBe(1);
        });

        it('reads the chairs that have been sat in longest first, and no more of them than it is asked for', async () =>
        {
            const [newest, oldest, between] = await crowd(3);
            const tables = [await opened(newest), await opened(oldest), await opened(between)];

            await satSince(newest, tables[0], 1);
            await satSince(oldest, tables[1], 30);
            await satSince(between, tables[2], 10);

            expect(await here.tables.waitingSeats(2)).toEqual([
                { tableId: tables[1], userId: oldest },
                { tableId: tables[2], userId: between }
            ]);
            expect(await here.tables.waitingSeats(EVERY_CHAIR)).toHaveLength(3);
        });

        it('leaves a chair alone when somebody else is in it by then, and when nobody is', async () =>
        {
            const [host, guest, newcomer, stranger] = await crowd(4);
            const tableId = await opened(host, { seats: 2 });

            await sat(guest, tableId);

            expect(await here.tables.vacate(tableId, stranger, nobodyHere)).toBeNull();

            await here.tables.leave(guest, tableId, async () => null);

            expect(await here.tables.vacate(tableId, guest, nobodyHere)).toBeNull();

            await sat(newcomer, tableId);

            expect(await here.tables.vacate(tableId, guest, nobodyHere)).toBeNull();
            expect(await sitting(tableId)).toEqual([host, newcomer]);
            expect(await chairOf(newcomer, tableId)).toMatchObject({ ready: true });
            expect(await inThread(newcomer, tableId)).toBe(true);
            expect(await here.tables.vacate(tableId, newcomer, nobodyHere)).toEqual({ closed: false, conversationId: await threadOf(tableId) });
            expect(await sitting(tableId)).toEqual([host]);
        });

        it('asks who is here again under the table’s lock, and leaves the chair of somebody who came back while it waited', async () =>
        {
            const [host, guest] = await crowd(2);
            const tableId = await opened(host);
            const { jobs } = door(whoIsHere);
            const holder = db.createQueryRunner();

            await sat(guest, tableId);
            away.add(guest);
            await jobs.sweepTables();

            const tables = vi.spyOn(listener, 'tableChanged');
            const threads = vi.spyOn(listener, 'chatChanged');

            try
            {
                await holder.connect();
                await holder.startTransaction();
                await lockTable(holder.manager, tableId);

                const sweeping = jobs.sweepTables();

                await vi.waitFor(async () =>
                {
                    expect(await waitingOnLocks()).toBeGreaterThanOrEqual(1);
                }, { timeout: 10_000, interval: 5 });

                away.delete(guest);
                await holder.rollbackTransaction();

                expect(await sweeping).toEqual(NOTHING_DONE);
                expect(tables).not.toHaveBeenCalled();
                expect(threads).not.toHaveBeenCalled();
            }
            finally
            {
                vi.restoreAllMocks();

                if (holder.isTransactionActive)
                {
                    await holder.rollbackTransaction();
                }

                await holder.release();
            }

            expect(await chairOf(guest, tableId)).toMatchObject({ seat: 1, ready: true });
            expect(await inThread(guest, tableId)).toBe(true);
            expect(await row(tableId)).toMatchObject({ status: 'open', closedAt: null });

            away.add(guest);

            expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
            expect(await jobs.sweepTables()).toEqual({ stoodUp: 1, closed: 0, failed: [] });
            expect(await chairOf(guest, tableId)).toBeNull();
        }, 30_000);
    });

    describe('what it does after a chair is free', () =>
    {
        it('rings the table for everybody still there and whoever was stood up, the thread for whoever was stood up, and notifies nobody', async () =>
        {
            const [host, guest, stays] = await crowd(3);
            const tableId = await opened(host);
            const { jobs } = door(whoIsHere);

            await sat(guest, tableId);
            await sat(stays, tableId);
            away.add(guest);

            const tables = vi.spyOn(listener, 'tableChanged');
            const threads = vi.spyOn(listener, 'chatChanged');

            try
            {
                await jobs.sweepTables();

                expect(tables).not.toHaveBeenCalled();
                expect(threads).not.toHaveBeenCalled();

                await jobs.sweepTables();

                expect(tables).toHaveBeenCalledTimes(1);
                expect(tables.mock.calls[0][0]).toBe(tableId);
                expect([...tables.mock.calls[0][1]].sort()).toEqual([host, guest, stays].sort());
                expect(threads.mock.calls).toEqual([[await threadOf(tableId), guest]]);
                expect(await db.getRepository(Notification).count()).toBe(0);
            }
            finally
            {
                vi.restoreAllMocks();
            }
        });

        it('still frees the next chair when a ring fails', async () =>
        {
            const [first, second] = await crowd(2);
            const tables = [await opened(first), await opened(second)];
            const { jobs } = door(whoIsHere);

            away.add(first).add(second);
            await jobs.sweepTables();

            const said = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            vi.spyOn(listener, 'tableChanged').mockImplementationOnce(() =>
            {
                throw new Error('the bell fell off');
            });

            try
            {
                expect(await jobs.sweepTables()).toEqual({ stoodUp: 2, closed: 2, failed: [] });
                expect(said.mock.calls.map((call) => String(call[0])).join('')).toContain('table ring failed: the bell fell off');
            }
            finally
            {
                vi.restoreAllMocks();
            }

            expect(await sitting(tables[0])).toEqual([]);
            expect(await sitting(tables[1])).toEqual([]);
        });

        it('goes on to the next table when one will not let go of its chair, says which, and tries that one again', async () =>
        {
            const [stuckHost, freeHost] = await crowd(2);
            const stuck = await opened(stuckHost);
            const free = await opened(freeHost);
            const impatient = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: false, extra: { lock_timeout: 250 } });
            const holder = db.createQueryRunner();

            await satSince(stuckHost, stuck, 30);
            away.add(stuckHost).add(freeHost);

            try
            {
                await impatient.initialize();

                const { jobs } = door(whoIsHere, impatient);

                await jobs.sweepTables();
                await holder.connect();
                await holder.startTransaction();
                await lockTable(holder.manager, stuck);

                expect(await jobs.sweepTables()).toEqual({
                    stoodUp: 1,
                    closed: 1,
                    failed: [{ tableId: stuck, reason: expect.stringContaining('lock timeout') }]
                });
                expect(await sitting(stuck)).toEqual([stuckHost]);
                expect(await sitting(free)).toEqual([]);

                await holder.rollbackTransaction();

                expect(await jobs.sweepTables()).toEqual(NOTHING_DONE);
                expect(await jobs.sweepTables()).toEqual({ stoodUp: 1, closed: 1, failed: [] });
                expect(await sitting(stuck)).toEqual([]);
            }
            finally
            {
                if (holder.isTransactionActive)
                {
                    await holder.rollbackTransaction();
                }

                await holder.release();

                if (impatient.isInitialized)
                {
                    await impatient.destroy();
                }
            }
        }, 30_000);
    });

    describe('against a start that reaches the table with it', () =>
    {
        it('deals the game and leaves the chair taken when the start got there first', async () =>
        {
            const broken = await everyRound(async () =>
            {
                const { tableId, players: [host, gone] } = await seated(3);

                const [started, vacated] = await parkedBehind(atTheInsertAndTheThread(await threadOf(tableId), gone), [
                    () => here.matches.start(host, tableId),
                    () => there.tables.vacate(tableId, gone, nobodyHere)
                ]);
                const stranded = await dealtWithNoChair(tableId);

                return [
                    ...(stranded === 0 ? [] : [`${ stranded } dealt into a game with no chair under them`]),
                    ...(started.status === 'fulfilled' ? [] : [`the start was refused with ${ codeOf(started) }`]),
                    ...(vacated.status === 'fulfilled' && vacated.value === null ? [] : ['a chair was freed under a game that had started']),
                    ...(await live(tableId) === 1 ? [] : ['no game was dealt']),
                    ...(await chairOf(gone, tableId) !== null && await inThread(gone, tableId) ? [] : ['out of a chair whose game had started'])
                ];
            });

            expect(broken).toBe('');
        }, 120_000);

        it('frees the chair and deals no game when the sweep got there first', async () =>
        {
            const broken = await everyRound(async () =>
            {
                const { tableId, players: [host, gone] } = await seated(3);
                const thread = await threadOf(tableId);

                const [vacated, started] = await parkedBehind(atTheInsertAndTheThread(thread, gone), [
                    () => there.tables.vacate(tableId, gone, nobodyHere),
                    () => here.matches.start(host, tableId)
                ]);
                const stranded = await dealtWithNoChair(tableId);
                const freed = vacated.status === 'fulfilled' && JSON.stringify(vacated.value) === JSON.stringify({ closed: false, conversationId: thread });

                return [
                    ...(stranded === 0 ? [] : [`${ stranded } dealt into a game with no chair under them`]),
                    ...(freed ? [] : ['the chair was not freed']),
                    ...(codeOf(started) === 'chairs-empty' ? [] : [`the start answered ${ codeOf(started) } where chairs-empty was owed`]),
                    ...(await live(tableId) === 0 ? [] : ['a game was dealt to an empty chair']),
                    ...(await chairOf(gone, tableId) === null && !await inThread(gone, tableId) ? [] : ['still in a chair it was stood up from'])
                ];
            });

            expect(broken).toBe('');
        }, 120_000);
    });
});
