import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, IsNull, Not, type EntityManager } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Block, Conversation, ConversationMember, Match, MatchPlayer, Notification, Table, TableRemoval, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createAchieveService } from '../src/domains/achieve/service.ts';
import { createMatchService } from '../src/domains/match/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService, lockTable } from '../src/domains/table/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const ROUNDS = 20;

const NOWHERE = '00000000-0000-4000-8000-000000000000';

const NO_TABLE = {
    status: 404,
    body: JSON.stringify({ error: { code: 'not-found', message: 'No table there.' } })
};

const NOBODY = {
    status: 404,
    body: JSON.stringify({ error: { code: 'no-invitee', message: 'No one by that name can be invited.' } })
};

const DONE = { status: 200, body: '' };

const STILL_WAITING = 'still waiting for the table';

interface Person
{
    id: string;
    handle: string;
}

interface Hands
{
    tables: ReturnType<typeof createTableService>;
    matches: ReturnType<typeof createMatchService>;
}

type Privacy = 'invite' | 'friends' | 'public';

let db: DataSource;
let ports: Services;
let here: Hands;
let there: Hands;

let seq = 0;

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

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `k${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Kept ${ seq }`,
        hue: seq % 360
    });

    return { id: made.id, handle: made.handle };
};

const crowd = async (size: number) =>
{
    const people: Person[] = [];

    for (let index = 0; index < size; index += 1)
    {
        people.push(await makeUser());
    }

    return people;
};

const befriend = async (a: string, b: string) =>
{
    await db.query(
        `insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)
         on conflict do nothing`,
        [a, b]
    );
};

const config = (privacy: Privacy, seats: number, invitees: string[] = []) => ({
    game: 'ludo',
    seats,
    mode: 'live' as const,
    privacy,
    target: 0,
    cube: false,
    blinds: 'low' as const,
    chat: true,
    voice: 'off' as const,
    teams: false,
    invitees
});

const seated = async (size: number, seats = 4, privacy: Privacy = 'public') =>
{
    const [host, ...guests] = await crowd(size);

    if (privacy === 'friends')
    {
        for (const guest of guests)
        {
            await befriend(host.id, guest.id);
        }
    }

    const table = await ports.table.create(host.id, config(privacy, seats, privacy === 'invite' ? guests.map((guest) => guest.handle) : []));

    for (const guest of guests)
    {
        await ports.table.claim(guest.id, table.id);
    }

    return { tableId: table.id, host, guests };
};

const everybodyReady = async (tableId: string, players: Person[]) =>
{
    for (const player of players)
    {
        await ports.table.setReady(player.id, tableId, true);
    }
};

const sent = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return DONE;
    }

    const response = errorResponse(thrown);

    return { status: response.status, body: await response.text() };
};

const chairOf = async (who: string, tableId: string) =>
    await db.getRepository(TableSeat).findOne({ where: { tableId, userId: who } });

const sitting = async (tableId: string) =>
    (await db.getRepository(TableSeat).find({ where: { tableId, userId: Not(IsNull()) }, order: { seat: 'ASC' } })).map((chair) => chair.userId);

const heldFor = async (who: string, tableId: string) =>
    await db.getRepository(TableSeat).countBy({ tableId, invitedId: who });

const threadOf = async (tableId: string) => (await db.getRepository(Conversation).findOneByOrFail({ tableId, kind: 'game' })).id;

const inThread = async (who: string, tableId: string) =>
    await db.getRepository(ConversationMember).existsBy({ conversationId: await threadOf(tableId), userId: who });

const keptOut = async (who: string, tableId: string) =>
    await db.getRepository(TableRemoval).existsBy({ tableId, userId: who });

const removals = async () => await db.getRepository(TableRemoval).count();

const live = async (tableId: string) => await db.getRepository(Match).countBy({ tableId, finishedAt: IsNull() });

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

const atTheThread = (thread: string, who: string) => async (tx: EntityManager) =>
{
    await tx.getRepository(ConversationMember).findOne({
        where: { conversationId: thread, userId: who },
        lock: { mode: 'pessimistic_write' }
    });
};

const atTheInsertAndTheThread = (thread: string, who: string) => async (tx: EntityManager) =>
{
    await tx.query('lock table matches in share mode');
    await atTheThread(thread, who)(tx);
};

const atTheChairs = async (tx: EntityManager) =>
{
    await tx.query('lock table table_seats in share mode');
};

describe.skipIf(!active)('a host taking somebody out of a chair, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        here = hands();
        there = hands();
        ports = buildPorts(db, {
            secret: 'a-test-secret-that-is-long-enough-to-use',
            origin: 'http://localhost:1',
            env: 'test',
            vapidPublicKey: '',
            vapidPrivateKey: '',
            vapidSubject: ''
        } as Parameters<typeof buildPorts>[1], listener);
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

    describe('who may ask, and about whom', () =>
    {
        it('answers anybody but a sitting host, and a name that is not another player in a chair there, in the bytes of a table that is not there', async () =>
        {
            const { tableId, host, guests: [guest, other] } = await seated(3);
            const [stranger, elsewhere, invited] = await crowd(3);
            const away = await seated(2);
            const hidden = await seated(2, 4, 'invite');

            await ports.table.invite(host.id, tableId, invited.handle);
            await ports.table.leave(away.host.id, away.tableId, false);

            const missing = await sent(ports.table.remove(host.id, NOWHERE, guest.handle));

            expect(missing).toEqual(NO_TABLE);

            const asked: Record<string, () => Promise<unknown>> = {
                'a stranger to the table': () => ports.table.remove(stranger.id, tableId, guest.handle),
                'a stranger to a table it cannot see': () => ports.table.remove(stranger.id, hidden.tableId, hidden.guests[0].handle),
                'somebody sitting who is not the host': () => ports.table.remove(other.id, tableId, guest.handle),
                'the player who would be taken out': () => ports.table.remove(guest.id, tableId, guest.handle),
                'a host who has left the chair': () => ports.table.remove(away.host.id, away.tableId, away.guests[0].handle),
                'the host naming themselves': () => ports.table.remove(host.id, tableId, host.handle),
                'a name sitting at another table': () => ports.table.remove(host.id, tableId, away.guests[0].handle),
                'a name sitting nowhere': () => ports.table.remove(host.id, tableId, elsewhere.handle),
                'a name a chair is only held for': () => ports.table.remove(host.id, tableId, invited.handle),
                'a name nobody holds': () => ports.table.remove(host.id, tableId, `nobody${ Math.floor(Math.random() * 1_000_000) }`),
                'a table id that is not one': () => ports.table.remove(host.id, 'not-a-table', guest.handle)
            };

            for (const [who, ask] of Object.entries(asked))
            {
                expect(await sent(ask()), who).toEqual(missing);
            }

            expect(await sitting(tableId)).toEqual([host.id, guest.id, other.id]);
            expect(await sitting(away.tableId)).toEqual([away.guests[0].id]);
            expect(await heldFor(invited.id, tableId)).toBe(1);
            expect(await removals()).toBe(0);
            expect(await db.getRepository(Notification).countBy({ kind: 'table-removed' })).toBe(0);
        });

        it('answers whoever may not ask at once, however long the table is held', async () =>
        {
            const { tableId, guests: [guest, other] } = await seated(3);
            const stranger = await makeUser();
            const holder = db.createQueryRunner();

            await holder.connect();
            await holder.startTransaction();
            await lockTable(holder.manager, tableId);

            try
            {
                for (const asker of [stranger, other, guest])
                {
                    let patience: ReturnType<typeof setTimeout> | undefined;

                    const asked = sent(ports.table.remove(asker.id, tableId, guest.handle));
                    const answer = await Promise.race([
                        asked,
                        new Promise<string>((resolve) =>
                        {
                            patience = setTimeout(() => resolve(STILL_WAITING), 2_000);
                        })
                    ]);

                    clearTimeout(patience);

                    expect(answer, asker.handle).toEqual(NO_TABLE);
                }
            }
            finally
            {
                await holder.rollbackTransaction();
                await holder.release();
            }

            expect(await sitting(tableId)).toHaveLength(3);
        }, 30_000);

        it('takes nobody out of a game, says so to the host, and still says only that there is no table to anybody else', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2, 2);
            const stranger = await makeUser();

            await everybodyReady(tableId, [host, guest]);
            await ports.match.start(host.id, tableId);

            await expect(ports.table.remove(host.id, tableId, guest.handle)).rejects.toMatchObject({ status: 409, code: 'playing' });
            expect(await sent(ports.table.remove(stranger.id, tableId, guest.handle))).toEqual(NO_TABLE);
            expect(await sent(ports.table.remove(guest.id, tableId, host.handle))).toEqual(NO_TABLE);

            expect(await sitting(tableId)).toEqual([host.id, guest.id]);
            expect(await inThread(guest.id, tableId)).toBe(true);
            expect(await removals()).toBe(0);
            expect(await live(tableId)).toBe(1);
        });

        it('takes somebody out once the game is over', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2, 2);

            await everybodyReady(tableId, [host, guest]);

            const started = await ports.match.start(host.id, tableId);

            await ports.match.resign(guest.id, started.id, { key: 'gives-up' });

            expect(await sent(ports.table.remove(host.id, tableId, guest.handle))).toEqual(DONE);
            expect(await sitting(tableId)).toEqual([host.id]);
        });

        it('says the table has closed to the host of one that has', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);

            await ports.table.close(host.id, tableId);

            await expect(ports.table.remove(host.id, tableId, guest.handle)).rejects.toMatchObject({ status: 409, code: 'table-closed' });
            expect(await sitting(tableId)).toEqual([host.id, guest.id]);
            expect(await removals()).toBe(0);
        });

        it('takes out an account that was suspended in its chair, by the name the chair still shows', async () =>
        {
            const { tableId, host, guests: [guest, other] } = await seated(3);
            const thread = await threadOf(tableId);

            await db.getRepository(User).update({ id: guest.id }, { isSuspended: true });

            vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            const tables = vi.spyOn(listener, 'tableChanged');
            const threads = vi.spyOn(listener, 'chatChanged');

            try
            {
                expect((await ports.table.view(host.id, tableId))?.chairs.map((chair) => chair.who)).toEqual([host.handle, guest.handle, other.handle, undefined]);
                expect(await sent(ports.table.remove(host.id, tableId, guest.handle))).toEqual(DONE);
                expect(tables).toHaveBeenCalledTimes(1);
                expect([...new Set(tables.mock.calls[0][1])].sort()).toEqual([host.id, guest.id, other.id].sort());
                expect(threads.mock.calls).toEqual([[thread, guest.id]]);
            }
            finally
            {
                vi.restoreAllMocks();
            }

            expect(await sitting(tableId)).toEqual([host.id, other.id]);
            expect(await inThread(guest.id, tableId)).toBe(false);
            expect(await keptOut(guest.id, tableId)).toBe(true);
            expect(await sent(ports.table.remove(host.id, tableId, guest.handle)), 'the same name once its chair is empty').toEqual(NO_TABLE);
        });
    });

    describe('what it does', () =>
    {
        it('gives the chair back, takes them out of the table’s thread, and leaves the table open with everybody else where they were', async () =>
        {
            const { tableId, host, guests: [guest, other] } = await seated(3);

            await everybodyReady(tableId, [host, guest, other]);

            const answer = await ports.table.remove(host.id, tableId, guest.handle);

            expect(answer.id).toBe(tableId);
            expect(answer.taken).toBe(2);
            expect(answer.chairs.map((chair) => chair.who)).toEqual([host.handle, undefined, other.handle, undefined]);
            expect(answer.status).toBe('open');
            expect(await db.getRepository(TableSeat).findOneByOrFail({ tableId, seat: 1 })).toMatchObject({ userId: null, ready: false, joinedAt: null, invitedId: null });
            expect(await inThread(guest.id, tableId)).toBe(false);
            expect(await inThread(host.id, tableId)).toBe(true);
            expect(await inThread(other.id, tableId)).toBe(true);
            expect(await chairOf(other.id, tableId)).toMatchObject({ seat: 2, ready: true });
            expect(await db.getRepository(Table).findOneByOrFail({ id: tableId })).toMatchObject({ status: 'open', closedAt: null, hostId: host.id });
            expect(await keptOut(guest.id, tableId)).toBe(true);
            expect(await removals()).toBe(1);
        });

        it('takes somebody out even where a row already says they were, and keeps the one row', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);

            await db.getRepository(TableRemoval).insert({ tableId, userId: guest.id });

            expect(await sent(ports.table.remove(host.id, tableId, guest.handle))).toEqual(DONE);
            expect(await sitting(tableId)).toEqual([host.id]);
            expect(await removals()).toBe(1);
        });

        it('lets go of the chair that was held for them, so somebody else can take it and they can no longer see a table by invitation', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2, 2, 'invite');
            const late = await makeUser();

            expect(await heldFor(guest.id, tableId)).toBe(1);

            await ports.table.remove(host.id, tableId, guest.handle);

            expect(await heldFor(guest.id, tableId)).toBe(0);
            expect(await ports.table.view(guest.id, tableId)).toBeNull();
            expect(await sent(ports.table.claim(guest.id, tableId))).toEqual(NO_TABLE);

            await ports.table.invite(host.id, tableId, late.handle);

            expect((await ports.table.claim(late.id, tableId)).seat).toBe(1);
        });

        it('rings the table for everybody there and for whoever was taken out, the thread for them too, and tells them alone', async () =>
        {
            const { tableId, host, guests: [guest, other] } = await seated(3);
            const thread = await threadOf(tableId);
            const tables = vi.spyOn(listener, 'tableChanged');
            const threads = vi.spyOn(listener, 'chatChanged');
            const selves = vi.spyOn(listener, 'selfChanged');

            try
            {
                await ports.table.remove(host.id, tableId, guest.handle);

                expect(tables).toHaveBeenCalledTimes(1);
                expect(tables.mock.calls[0][0]).toBe(tableId);
                expect([...new Set(tables.mock.calls[0][1])].sort()).toEqual([host.id, guest.id, other.id].sort());
                expect(threads.mock.calls).toEqual([[thread, guest.id]]);
                expect(selves.mock.calls).toEqual([[guest.id, 'notifications']]);
            }
            finally
            {
                vi.restoreAllMocks();
            }

            const told = await db.getRepository(Notification).find();

            expect(told).toHaveLength(1);
            expect(told[0]).toMatchObject({
                userId: guest.id,
                kind: 'table-removed',
                actorId: host.id,
                ref: { tableId, game: 'ludo' },
                count: 1,
                readAt: null
            });
        });

        it('has taken them out even when the bell and the notice both fail', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);
            const said = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            vi.spyOn(listener, 'tableChanged').mockImplementationOnce(() =>
            {
                throw new Error('the bell fell off');
            });
            vi.spyOn(listener, 'selfChanged').mockImplementationOnce(() =>
            {
                throw new Error('the bell is gone too');
            });

            try
            {
                expect(await sent(ports.table.remove(host.id, tableId, guest.handle))).toEqual(DONE);
                expect(said.mock.calls.map((call) => String(call[0])).join('')).toContain('the bell fell off');
                expect(said.mock.calls.map((call) => String(call[0])).join('')).toContain('the bell is gone too');
            }
            finally
            {
                vi.restoreAllMocks();
            }

            expect(await sitting(tableId)).toEqual([host.id]);
            expect(await keptOut(guest.id, tableId)).toBe(true);
        });
    });

    describe('whoever was taken out', () =>
    {
        it('is refused a chair at that table in words of its own, and takes none', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);

            await ports.table.remove(host.id, tableId, guest.handle);

            await expect(ports.table.claim(guest.id, tableId)).rejects.toMatchObject({ status: 409, code: 'kept-out' });
            await expect(ports.table.claim(guest.id, tableId)).rejects.toMatchObject({ status: 409, code: 'kept-out' });

            expect(await sitting(tableId)).toEqual([host.id]);
            expect(await inThread(guest.id, tableId)).toBe(false);
        });

        it('is still let sit at any other table, by hand', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);
            const other = await seated(1);

            await ports.table.remove(host.id, tableId, guest.handle);

            expect((await ports.table.claim(guest.id, other.tableId)).seat).toBe(1);
        });

        it('is seated somewhere else by quick play, at a table quick play still fills for anybody else', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);
            const newcomer = await makeUser();

            await ports.table.setReady(host.id, tableId, true);
            await ports.table.remove(host.id, tableId, guest.handle);

            const found = await ports.table.quick(guest.id, { game: 'ludo', voice: 'off' });

            expect(found.id).not.toBe(tableId);
            expect(found.mine).toBe(0);
            expect(await chairOf(guest.id, tableId)).toBeNull();

            await ports.table.leave(guest.id, found.id, false);

            expect((await ports.table.quick(newcomer.id, { game: 'ludo', voice: 'off' })).id).toBe(tableId);

            const again = await ports.table.quick(guest.id, { game: 'ludo', voice: 'off' });

            expect(again.id).not.toBe(tableId);
            expect(await sitting(tableId)).toEqual([host.id, newcomer.id]);
        });

        it('is told so by the table’s view where they may still see it, and nobody else is told anything', async () =>
        {
            const { tableId, host, guests: [guest, other] } = await seated(3);
            const stranger = await makeUser();
            const friendly = await seated(2, 4, 'friends');

            await ports.table.remove(host.id, tableId, guest.handle);
            await ports.table.remove(friendly.host.id, friendly.tableId, friendly.guests[0].handle);

            expect((await ports.table.view(guest.id, tableId))?.removed).toBe(true);
            expect((await ports.table.view(friendly.guests[0].id, friendly.tableId))?.removed).toBe(true);

            for (const viewer of [host, other, stranger])
            {
                const view = await ports.table.view(viewer.id, tableId);

                expect(view, viewer.handle).not.toBeNull();
                expect(Object.hasOwn(view!, 'removed'), viewer.handle).toBe(false);
            }

            expect((await ports.table.mine(host.id)).some((table) => Object.hasOwn(table, 'removed'))).toBe(false);
            expect((await ports.table.mine(guest.id)).map((table) => table.id)).toEqual([]);
        });
    });

    describe('the people a host took out', () =>
    {
        it('are named to the sitting host on every answer the table gives them, the latest first, and to nobody else', async () =>
        {
            const { tableId, host, guests: [first, second, other] } = await seated(4);
            const stranger = await makeUser();

            expect(Object.hasOwn((await ports.table.view(host.id, tableId))!, 'keptOut'), 'before anybody was taken out').toBe(false);

            expect((await ports.table.remove(host.id, tableId, first.handle)).keptOut).toEqual([first.handle]);
            expect((await ports.table.remove(host.id, tableId, second.handle)).keptOut).toEqual([second.handle, first.handle]);

            expect((await ports.table.view(host.id, tableId))?.keptOut).toEqual([second.handle, first.handle]);
            expect((await ports.table.mine(host.id)).find((table) => table.id === tableId)?.keptOut).toEqual([second.handle, first.handle]);
            expect((await ports.table.setReady(host.id, tableId, true)).keptOut).toEqual([second.handle, first.handle]);

            for (const viewer of [first, second, other, stranger])
            {
                const view = await ports.table.view(viewer.id, tableId);

                expect(view, viewer.handle).not.toBeNull();
                expect(Object.hasOwn(view!, 'keptOut'), viewer.handle).toBe(false);
            }

            expect((await ports.table.mine(other.id)).some((table) => Object.hasOwn(table, 'keptOut'))).toBe(false);
            expect(Object.hasOwn(await ports.table.setReady(other.id, tableId, true), 'keptOut')).toBe(false);
        });

        it('are not named to a host who has left the chair, and are again once the host is back in it', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(3);

            await ports.table.remove(host.id, tableId, guest.handle);
            await ports.table.leave(host.id, tableId, false);

            expect(Object.hasOwn((await ports.table.view(host.id, tableId))!, 'keptOut')).toBe(false);
            expect((await ports.table.claim(host.id, tableId)).table.keptOut).toEqual([guest.handle]);
        });

        it('lose whoever the host invites back, and are not mentioned once nobody is kept out', async () =>
        {
            const { tableId, host, guests: [guest, other] } = await seated(3);

            await ports.table.remove(host.id, tableId, guest.handle);
            await ports.table.remove(host.id, tableId, other.handle);

            expect((await ports.table.invite(host.id, tableId, other.handle)).keptOut).toEqual([guest.handle]);
            expect(Object.hasOwn(await ports.table.invite(host.id, tableId, guest.handle), 'keptOut')).toBe(false);
        });

        it('leave out anybody on either side of a block with the host and an account that has been suspended, as every list of people does', async () =>
        {
            const { tableId, host, guests: [blocked, blocking, suspended] } = await seated(4);
            const plain = await makeUser();

            for (const guest of [blocked, blocking, suspended])
            {
                await ports.table.remove(host.id, tableId, guest.handle);
            }

            await ports.table.claim(plain.id, tableId);

            expect((await ports.table.remove(host.id, tableId, plain.handle)).keptOut).toEqual([plain.handle, suspended.handle, blocking.handle, blocked.handle]);

            await db.getRepository(Block).insert([{ userId: host.id, blockedId: blocked.id }, { userId: blocking.id, blockedId: host.id }]);
            await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

            expect((await ports.table.view(host.id, tableId))?.keptOut).toEqual([plain.handle]);
            expect(await removals()).toBe(4);

            await db.getRepository(Block).insert({ userId: plain.id, blockedId: host.id });

            expect(Object.hasOwn((await ports.table.view(host.id, tableId))!, 'keptOut')).toBe(false);
        });
    });

    describe('an invitation afterwards', () =>
    {
        it('from the host lets them sit again, and the host can take them out again', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);

            await ports.table.remove(host.id, tableId, guest.handle);

            const invited = await ports.table.invite(host.id, tableId, guest.handle);

            expect(invited.chairs.map((chair) => chair.invited)).toContain(guest.handle);
            expect(await keptOut(guest.id, tableId)).toBe(false);
            expect(Object.hasOwn((await ports.table.view(guest.id, tableId))!, 'removed')).toBe(false);
            expect((await ports.table.claim(guest.id, tableId)).seat).toBe(1);
            expect(await inThread(guest.id, tableId)).toBe(true);

            expect(await sent(ports.table.remove(host.id, tableId, guest.handle))).toEqual(DONE);
            expect(await keptOut(guest.id, tableId)).toBe(true);
            await expect(ports.table.claim(guest.id, tableId)).rejects.toMatchObject({ status: 409, code: 'kept-out' });
        });

        it('lets them back into a table by invitation, which they can see again', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2, 2, 'invite');

            await ports.table.remove(host.id, tableId, guest.handle);
            await ports.table.invite(host.id, tableId, guest.handle);

            expect((await ports.table.view(guest.id, tableId))?.id).toBe(tableId);
            expect((await ports.table.claim(guest.id, tableId)).seat).toBe(1);
        });

        it('from anybody else at the table is refused as any name that cannot be invited, holds no chair and lets nobody back', async () =>
        {
            const { tableId, host, guests: [guest, other] } = await seated(3);
            const invitations = async () => await db.getRepository(Notification).countBy({ kind: 'table-invite' });

            await ports.table.remove(host.id, tableId, guest.handle);

            expect(await sent(ports.table.invite(other.id, tableId, guest.handle))).toEqual(NOBODY);
            expect(await heldFor(guest.id, tableId)).toBe(0);
            expect(await keptOut(guest.id, tableId)).toBe(true);
            expect(await invitations()).toBe(0);
            await expect(ports.table.claim(guest.id, tableId)).rejects.toMatchObject({ status: 409, code: 'kept-out' });
        });

        it('from the host is still held to what they let a stranger do: refused as any name that cannot be invited, until the two are friends', async () =>
        {
            const { tableId, host, guests: [guest] } = await seated(2);

            await ports.table.remove(host.id, tableId, guest.handle);
            await db.getRepository(User).update({ id: guest.id }, { allowStrangerMessages: false });

            expect(await sent(ports.table.invite(host.id, tableId, guest.handle))).toEqual(NOBODY);
            expect(await heldFor(guest.id, tableId)).toBe(0);
            expect(await keptOut(guest.id, tableId)).toBe(true);
            expect(await db.getRepository(Notification).countBy({ kind: 'table-invite' })).toBe(0);
            expect((await ports.table.view(host.id, tableId))?.keptOut).toEqual([guest.handle]);

            await befriend(host.id, guest.id);

            expect(await sent(ports.table.invite(host.id, tableId, guest.handle))).toEqual(DONE);
            expect(await keptOut(guest.id, tableId)).toBe(false);
            expect((await ports.table.claim(guest.id, tableId)).seat).toBe(1);
        });
    });

    describe('against an invitation that reaches the table with it', () =>
    {
        it('never leaves a chair held for whoever was taken out: somebody else’s invitation is refused behind the removal, and let go of by a removal behind it', async () =>
        {
            const broken: string[] = [];

            for (let round = 0; round < ROUNDS; round += 1)
            {
                const [host, gone, other] = await crowd(3);
                const table = await here.tables.create(host.id, config('public', 4));
                const tableId = table.id;

                await here.tables.claimSeat(gone.id, tableId);
                await here.tables.claimSeat(other.id, tableId);

                const removalFirst = round % 2 === 0;
                const removing = () => here.tables.remove(host.id, tableId, gone.handle);
                const inviting = () => there.tables.invite(other.id, tableId, gone.id);
                const answers = await parkedBehind(
                    removalFirst ? atTheThread(await threadOf(tableId), gone.id) : atTheChairs,
                    removalFirst ? [removing, inviting] : [inviting, removing]
                );
                const [removed, invited] = removalFirst ? answers : [answers[1], answers[0]];

                const held = await heldFor(gone.id, tableId);
                const inChair = await chairOf(gone.id, tableId) !== null;
                const kept = await keptOut(gone.id, tableId);
                const answered = codeOf(removed) === 'no refusal' && codeOf(invited) === (removalFirst ? 'no-invitee' : 'no refusal');

                if (!answered || held !== 0 || inChair || !kept)
                {
                    broken.push(`round ${ round }: ${ removalFirst ? 'the removal' : 'the invitation' } got there first and it ended with ${ held } chair held for the player, `
                        + `who is ${ inChair ? 'in' : 'out of' } the chair and ${ kept ? 'kept out' : 'not kept out' }; `
                        + `the removal answered ${ codeOf(removed) } and the invitation ${ codeOf(invited) }`);
                }
            }

            expect(broken.join('\n')).toBe('');
        }, 180_000);
    });

    describe('against a start that reaches the table with it', () =>
    {
        it('ends every round as a game with everybody in it or as an empty chair with no game, by whichever got there first', async () =>
        {
            const broken: string[] = [];

            for (let round = 0; round < ROUNDS; round += 1)
            {
                const players = await crowd(3);
                const [host, gone] = players.map((player) => player.id);
                const table = await here.tables.create(host, config('public', 3));
                const tableId = table.id;

                for (const player of players.slice(1))
                {
                    await here.tables.claimSeat(player.id, tableId);
                }

                for (const player of players)
                {
                    await here.tables.setReady(player.id, tableId, true);
                }

                const startFirst = round % 2 === 0;
                const starting = () => here.matches.start(host, tableId);
                const removing = () => there.tables.remove(host, tableId, players[1].handle);
                const answers = await parkedBehind(
                    atTheInsertAndTheThread(await threadOf(tableId), gone),
                    startFirst ? [starting, removing] : [removing, starting]
                );
                const [started, removed] = startFirst ? answers : [answers[1], answers[0]];

                const games = await live(tableId);
                const stranded = await dealtWithNoChair(tableId);
                const inChair = await chairOf(gone, tableId) !== null;
                const inRoom = await inThread(gone, tableId);
                const kept = await keptOut(gone, tableId);
                const playing = games === 1 && inChair && inRoom && !kept && codeOf(started) === 'no refusal' && codeOf(removed) === 'playing';
                const emptied = games === 0 && !inChair && !inRoom && kept && codeOf(started) === 'chairs-empty' && codeOf(removed) === 'no refusal';

                if (stranded > 0)
                {
                    broken.push(`round ${ round }: ${ stranded } dealt into a game with no chair under them`);
                }

                if (startFirst ? !playing : !emptied)
                {
                    broken.push(`round ${ round }: ${ startFirst ? 'the start' : 'the removal' } got there first and it ended with ${ games } game on, `
                        + `the player ${ inChair ? 'in' : 'out of' } the chair, ${ inRoom ? 'in' : 'out of' } the thread and ${ kept ? 'kept out' : 'not kept out' }; `
                        + `the start answered ${ codeOf(started) } and the removal ${ codeOf(removed) }`);
                }
            }

            expect(broken.join('\n')).toBe('');
        }, 180_000);
    });
});
