import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, IsNull, Not, type EntityManager } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Block, Conversation, ConversationMember, Friendship, Game, Match, MatchPlayer, Notification, Table, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { SEATED_MAX, createTableService } from '../src/domains/table/service.ts';
import type { QuickAsk } from '../src/domains/table/quick.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type PresenceReader, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const ROUNDS = 10;

type Tables = ReturnType<typeof createTableService>;

type Opening = Parameters<Tables['create']>[1];

let db: DataSource;
let here: Tables;
let there: Tables;

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

const everybody = (userIds: readonly string[]) => new Set(userIds);

const without = (...away: string[]) => (userIds: readonly string[]) => new Set(userIds.filter((id) => !away.includes(id)));

const door = (presence?: PresenceReader) => buildPorts(db, {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1], listener, presence);

const makeUser = async (overrides: Partial<Pick<User, 'isMinor' | 'allowStrangerMessages'>> = {}) =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `q${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Quick ${ seq }`,
        hue: seq % 360,
        kind: 'guest',
        ...overrides
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

const befriend = async (a: string, b: string) =>
{
    await db.getRepository(Friendship).insert([{ userId: a, friendId: b }, { userId: b, friendId: a }]);
};

const block = async (who: string, whom: string) =>
{
    await db.getRepository(Block).insert({ userId: who, blockedId: whom });
};

const opened = async (host: string, patch: Partial<Opening> = {}) =>
    (await here.create(host, {
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

const joined = async (tableId: string, size: number) =>
{
    const people = await crowd(size);

    for (const person of people)
    {
        await here.claimSeat(person, tableId);
    }

    return people;
};

const search = (who: string, ask: QuickAsk & { game?: string; voice?: 'off' | 'table' } = {}, from: Tables = here, present = everybody) =>
    from.quick(who, { game: 'ludo', voice: 'off', ...ask }, present);

const found = async (ask: QuickAsk & { game?: string } = {}, present = everybody) => (await search(await makeUser(), ask, here, present)).id;

const chairOf = async (who: string, tableId: string) =>
    await db.getRepository(TableSeat).findOne({ where: { tableId, userId: who } });

const chairsOf = async (who: string) => await db.getRepository(TableSeat).findBy({ userId: who });

const inThread = async (who: string, tableId: string) =>
    await db.getRepository(ConversationMember)
        .createQueryBuilder('cm')
        .innerJoin(Conversation, 'c', 'c.id = cm.conversation_id')
        .where(`c.table_id = :tableId and c.kind = 'game' and cm.user_id = :who`, { tableId, who })
        .getExists();

const row = async (tableId: string) => await db.getRepository(Table).findOneByOrFail({ id: tableId });

const sizes = async () =>
    (await db.getRepository(TableSeat)
        .createQueryBuilder('s')
        .select('s.table_id', 'id')
        .addSelect('count(*)::int', 'taken')
        .where('s.user_id is not null')
        .groupBy('s.table_id')
        .getRawMany<{ id: string; taken: number }>())
        .map((table) => table.taken)
        .sort((a, b) => a - b);

const live = async (tableId: string) => await db.getRepository(Match).countBy({ tableId, finishedAt: IsNull() });

const sent = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return { status: 200, body: '' };
    }

    const response = errorResponse(thrown);

    return { status: response.status, body: await response.text() };
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

describe.skipIf(!active)('quick play, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);

        await db.query(
            `insert into games (id, slug, name_key, blurb_key, category_key, category, min_players, max_players, sort_order)
             values ('quick-fixture', 'quick-fixture', 'g.n', 'g.b', 'g.c', 'cards', 2, 2, 9)
             on conflict (id) do nothing`
        );
        await db.query(
            `insert into game_rules (game_id, seats, modes, targets, stakes, partners, has_cube, has_blinds)
             values ('quick-fixture', '{2}', '{live}', '{}', 'none', 'none', false, false)
             on conflict (game_id) do nothing`
        );
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.getRepository(Table).createQueryBuilder().delete().execute();
            await db.getRepository(Game).delete({ id: 'quick-fixture' });
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
        await db.getRepository(Game).update({ id: 'quick-fixture' }, { status: 'available' });

        const social = createSocialService(db);

        here = createTableService(db, social);
        there = createTableService(db, social);
    });

    describe('which table it sits down at', () =>
    {
        it('takes a chair at a table somebody is waiting at, ready, and joins its thread', async () =>
        {
            const host = await makeUser();
            const me = await makeUser();
            const waiting = await opened(host);

            expect(await search(me)).toEqual({ id: waiting, seated: true });
            expect(await chairOf(me, waiting)).toMatchObject({ seat: 1, ready: true });
            expect((await chairOf(me, waiting))!.joinedAt).not.toBeNull();
            expect(await inThread(me, waiting)).toBe(true);
            expect(await db.getRepository(Table).count()).toBe(1);
        });

        it('is the fullest one first', async () =>
        {
            await opened(await makeUser());

            const busy = await opened(await makeUser());

            await joined(busy, 2);

            expect(await found()).toBe(busy);
            expect(await sizes()).toEqual([1, 4]);
        });

        it('is one where everybody is ready before an older one where somebody is not', async () =>
        {
            const older = await opened(await makeUser());
            const eager = await makeUser();
            const newer = await opened(eager);

            await here.setReady(eager, newer, true);
            await db.getRepository(Table).update({ id: older }, { createdAt: new Date(Date.now() - 3_600_000) });

            expect(await found()).toBe(newer);
        });

        it('is the oldest of those that are as full and as ready', async () =>
        {
            const first = await opened(await makeUser());
            const second = await opened(await makeUser());

            await db.getRepository(Table).update({ id: second }, { createdAt: new Date(Date.now() - 3_600_000) });

            expect(await found()).toBe(second);
            expect(await found()).toBe(second);
            expect(await found()).toBe(second);
            expect(await found()).toBe(first);
        });

        it('is any table of the game when nothing was chosen, whatever its seats, target or sides', async () =>
        {
            const pair = await opened(await makeUser(), { game: 'hokm', seats: 2, target: 7 });
            const four = await opened(await makeUser(), { game: 'hokm', seats: 4, target: 13, teams: true });

            await joined(four, 2);

            expect([await found({ game: 'hokm' }), await found({ game: 'hokm' })].sort()).toEqual([pair, four].sort());
            expect(await sizes()).toEqual([2, 4]);
            expect(await db.getRepository(Table).count()).toBe(2);
        });

        it('is only one with the seats, the target, the blinds, the cube or the sides that were chosen', async () =>
        {
            const pair = await opened(await makeUser(), { game: 'hokm', seats: 2, target: 7 });
            const four = await opened(await makeUser(), { game: 'hokm', seats: 4, target: 13, teams: true });

            await joined(four, 1);

            expect(await found({ game: 'hokm', seats: 4 })).toBe(four);
            expect(await found({ game: 'hokm', teams: true })).toBe(four);

            const again = await opened(await makeUser(), { game: 'hokm', seats: 4, target: 13, teams: true });

            await joined(again, 2);

            expect(await found({ game: 'hokm', target: 7 })).toBe(pair);

            const third = await opened(await makeUser(), { game: 'hokm', seats: 3, target: 7 });

            await joined(third, 1);

            expect(await found({ game: 'hokm', teams: false, target: 7 })).toBe(third);
            expect(await found({ game: 'hokm', seats: 4, target: 13 })).toBe(again);

            const low = await opened(await makeUser(), { game: 'poker', seats: 2, blinds: 'low' });
            const high = await opened(await makeUser(), { game: 'poker', seats: 6, blinds: 'high' });

            expect(await found({ game: 'poker', blinds: 'high' })).toBe(high);
            expect(await found({ game: 'poker', seats: 2 })).toBe(low);

            const plain = await opened(await makeUser(), { game: 'backgammon', seats: 2, target: 3, cube: false });
            const cubed = await opened(await makeUser(), { game: 'backgammon', seats: 2, target: 3, cube: true });

            expect(await found({ game: 'backgammon', cube: true })).toBe(cubed);
            expect(await found({ game: 'backgammon', cube: false })).toBe(plain);
        });

        it('is a live one unless turns were asked for', async () =>
        {
            const slow = await opened(await makeUser(), { mode: 'turns' });

            await joined(slow, 2);

            const fresh = await found();

            expect(fresh).not.toBe(slow);
            expect(await row(fresh)).toMatchObject({ mode: 'live' });
            expect(await found({ mode: 'turns' })).toBe(slow);
        });

        it('is never one with a game on, one that closed, one for invited people or one opened in a conversation', async () =>
        {
            const host = await makeUser();
            const member = await makeUser();
            const playing = await opened(await makeUser(), { seats: 3 });
            const closed = await opened(host);
            const invited = await opened(await makeUser(), { privacy: 'invite' });
            const room = (await db.getRepository(Conversation).save({ kind: 'direct', pairKey: [host, member].sort().join(':') })).id;

            await db.getRepository(ConversationMember).insert([{ conversationId: room, userId: host }, { conversationId: room, userId: member }]);

            const inRoom = await opened(host, { seats: 2, roomId: room });

            await joined(playing, 2);
            await db.getRepository(Table).update({ id: playing }, { seats: 4 });
            await db.getRepository(TableSeat).insert({ tableId: playing, seat: 3 });
            await db.query(
                `insert into matches (table_id, game, variant, seats, state, rev, deadline_at)
                 values ($1, 'ludo', 'standard', 3, '{"rev":0}'::jsonb, 0, now() + interval '1 hour')`,
                [playing]
            );
            await here.close(host, closed);

            const mine = (await search(member)).id;

            expect([playing, closed, invited, inRoom]).not.toContain(mine);
            expect(await row(mine)).toMatchObject({ hostId: member, privacy: 'public' });
        });

        it('is a table for the host’s friends only when the searcher is one of them', async () =>
        {
            const host = await makeUser();
            const friend = await makeUser();
            const stranger = await makeUser();
            const theirs = await opened(host, { privacy: 'friends' });

            await befriend(host, friend);

            expect((await search(friend)).id).toBe(theirs);
            expect((await search(stranger)).id).not.toBe(theirs);
            expect(await chairOf(stranger, theirs)).toBeNull();
        });

        it('is never one the searcher already has a chair at, and never a second chair there', async () =>
        {
            const me = await makeUser();
            const theirs = await opened(await makeUser());

            await here.claimSeat(me, theirs);

            const other = (await search(me)).id;

            expect(other).not.toBe(theirs);
            expect((await chairsOf(me)).map((chair) => chair.tableId).sort()).toEqual([theirs, other].sort());
        });
    });

    describe('who it will not seat somebody with', () =>
    {
        it('passes over a table where anybody sitting, or its host, and the searcher have blocked each other', async () =>
        {
            const host = await makeUser();
            const theirs = await opened(host);
            const [guest] = await joined(theirs, 1);
            const blocker = await makeUser();
            const blocked = await makeUser();
            const hostBlocked = await makeUser();
            const nobody = await makeUser();

            await block(blocker, guest);
            await block(guest, blocked);
            await block(host, hostBlocked);

            expect((await search(nobody)).id).toBe(theirs);

            for (const who of [blocker, blocked, hostBlocked])
            {
                expect((await search(who)).id).not.toBe(theirs);
                expect(await chairOf(who, theirs)).toBeNull();
            }
        });

        it('passes over a table whose host left it, if the host and the searcher have blocked each other', async () =>
        {
            const host = await makeUser();
            const theirs = await opened(host);
            const me = await makeUser();

            await joined(theirs, 1);
            await here.leave(host, theirs, async () => null);
            await block(me, host);

            expect((await search(me)).id).not.toBe(theirs);
        });

        it('never seats a minor with an adult who is not their friend, either way round, and still seats friends and two minors', async () =>
        {
            const child = () => makeUser({ isMinor: true, allowStrangerMessages: false });
            const minor = await child();
            const friend = await makeUser();
            const theirs = await opened(minor);

            await here.setReady(minor, theirs, true);
            await befriend(minor, friend);

            const grown = (await search(await makeUser())).id;

            expect(grown).not.toBe(theirs);
            expect((await search(friend)).id).toBe(theirs);

            const young = (await search(await child())).id;

            expect([theirs, grown]).not.toContain(young);
            expect((await search(await child())).id).toBe(young);
            expect((await search(await makeUser())).id).toBe(grown);
            expect(await sizes()).toEqual([2, 2, 2]);
        });

        it('passes over a live table where somebody sitting is not here, and still joins a turn-based one', async () =>
        {
            const away = await makeUser();
            const stale = await opened(away);
            const slow = await opened(away, { mode: 'turns' });

            await joined(stale, 2);

            const fresh = await found({}, without(away));

            expect(fresh).not.toBe(stale);
            expect(await sizes()).toEqual([1, 1, 3]);
            expect(await found({ mode: 'turns' }, without(away))).toBe(slow);
            expect(await found({}, everybody)).toBe(stale);
        });
    });

    describe('which chair it takes', () =>
    {
        it('never takes a chair held for somebody else, and takes the one held for the searcher', async () =>
        {
            const host = await makeUser();
            const guest = await makeUser();
            const stranger = await makeUser();
            const late = await makeUser();
            const theirs = await opened(host, { seats: 3, invitees: [guest] });

            expect((await search(stranger)).id).toBe(theirs);
            expect(await chairOf(stranger, theirs)).toMatchObject({ seat: 2 });
            expect((await search(late)).id).not.toBe(theirs);
            expect((await search(guest)).id).toBe(theirs);
            expect(await chairOf(guest, theirs)).toMatchObject({ seat: 1, ready: true });
        });

        it('takes the chair held for the searcher before a lower one anybody could have', async () =>
        {
            const host = await makeUser();
            const first = await makeUser();
            const second = await makeUser();
            const theirs = await opened(host, { invitees: [first, second] });

            await db.getRepository(TableSeat).update({ tableId: theirs, seat: 1 }, { invitedId: null });

            expect((await search(second)).id).toBe(theirs);
            expect(await chairOf(second, theirs)).toMatchObject({ seat: 2 });
        });

        it('fills a side before it starts the next one at a table of two sides', async () =>
        {
            const theirs = await opened(await makeUser(), { game: 'hokm', seats: 4, target: 7, teams: true });
            const arrivals = await crowd(3);
            const taken: number[] = [];

            for (const who of arrivals)
            {
                expect((await search(who, { game: 'hokm' })).id).toBe(theirs);
                taken.push((await chairOf(who, theirs))!.seat);
            }

            expect(taken).toEqual([2, 1, 3]);
        });
    });

    describe('with nothing to join', () =>
    {
        const made = async (ask: QuickAsk & { game: string; voice?: 'off' | 'table' }) =>
        {
            const me = await makeUser();
            const answer = await search(me, ask);
            const table = await row(answer.id);

            return { me, answer, table };
        };

        it('opens a public table and sits the searcher in its first chair, ready, in its thread', async () =>
        {
            const { me, answer, table } = await made({ game: 'ludo' });

            expect(answer.seated).toBe(true);
            expect(table).toMatchObject({ game: 'ludo', seats: 4, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, hostId: me, roomId: null, status: 'open' });
            expect(await db.getRepository(TableSeat).find({ where: { tableId: table.id }, order: { seat: 'ASC' } })).toMatchObject([
                { seat: 0, userId: me, ready: true },
                { seat: 1, userId: null, ready: false },
                { seat: 2, userId: null, ready: false },
                { seat: 3, userId: null, ready: false }
            ]);
            expect(await inThread(me, table.id)).toBe(true);
        });

        it('opens the table the game makes of what was chosen, and the default where nothing was', async () =>
        {
            expect((await made({ game: 'hokm' })).table).toMatchObject({ seats: 4, target: 7, teams: true });
            expect((await made({ game: 'poker' })).table).toMatchObject({ seats: 6, blinds: 'low', teams: false });
            expect((await made({ game: 'backgammon' })).table).toMatchObject({ seats: 2, target: 1, cube: false });
            expect((await made({ game: 'backgammon', cube: true })).table).toMatchObject({ seats: 2, target: 3, cube: true });
            expect((await made({ game: 'poker', seats: 9, blinds: 'high' })).table).toMatchObject({ seats: 9, blinds: 'high' });
            expect((await made({ game: 'ludo', seats: 2, mode: 'turns' })).table).toMatchObject({ seats: 2, mode: 'turns' });
            expect((await made({ game: 'hokm', teams: false, target: 13 })).table).toMatchObject({ seats: 3, target: 13, teams: false });
        });

        it('opens it with the call the searcher asked for', async () =>
        {
            expect((await made({ game: 'ludo', voice: 'table' })).table.voice).toBe('table');
            expect((await made({ game: 'ludo', seats: 2, voice: 'off' })).table.voice).toBe('off');
        });

        it('opens one the next search with the same choices sits down at', async () =>
        {
            const first = await found({ game: 'backgammon', cube: true });
            const second = await found({ game: 'backgammon', cube: true });

            expect(second).toBe(first);
            expect(await sizes()).toEqual([2]);
        });
    });

    describe('pressed twice', () =>
    {
        it('answers with the table the searcher is already waiting at, and takes no second chair', async () =>
        {
            const me = await makeUser();
            const first = await search(me);

            expect(await search(me)).toEqual({ id: first.id, seated: false });
            expect(await search(me, {}, there)).toEqual({ id: first.id, seated: false });
            expect(await chairsOf(me)).toHaveLength(1);
        });

        it('searches again for somebody whose chair is no longer ready, and for different choices', async () =>
        {
            const me = await makeUser();
            const first = (await search(me)).id;

            await here.setReady(me, first, false);

            const next = await search(me);

            expect(next.seated).toBe(true);
            expect(next.id).not.toBe(first);

            const narrower = await search(me, { seats: 2 });

            expect(narrower.seated).toBe(true);
            expect([first, next.id]).not.toContain(narrower.id);
            expect(await search(me)).toEqual({ id: narrower.id, seated: false });
        });

        it('is one chair at one table when the two presses arrive together', async () =>
        {
            for (let round = 0; round < ROUNDS; round += 1)
            {
                const me = await makeUser();
                const answers = await Promise.all([search(me, {}, here), search(me, {}, there)]);

                expect(answers[0].id, `round ${ round }`).toBe(answers[1].id);
                expect(answers.map((answer) => answer.seated).sort(), `round ${ round }`).toEqual([false, true]);
                expect(await chairsOf(me), `round ${ round }`).toHaveLength(1);
            }
        }, 60_000);

        it('still answers with that table for somebody at as many tables as anybody may hold', async () =>
        {
            const me = await makeUser();

            for (let index = 0; index < SEATED_MAX - 1; index += 1)
            {
                await opened(me, { seats: 2, privacy: 'invite' });
            }

            const last = await search(me);

            expect(last.seated).toBe(true);
            expect(await search(me)).toEqual({ id: last.id, seated: false });
            await expect(search(me, { seats: 3 })).rejects.toMatchObject({ status: 409, code: 'seated-max' });
            expect(await chairsOf(me)).toHaveLength(SEATED_MAX);
        }, 60_000);
    });

    describe('when many search at once', () =>
    {
        it('seats ten searchers at tables of four, four and two, nobody twice and nobody in another’s chair, and starts the two that filled', async () =>
        {
            const searchers = await crowd(10);
            const doors = searchers.map(() => door());

            const answers = await Promise.all(searchers.map((who, index) => doors[index].table.quick(who, { game: 'ludo', voice: 'off' })));

            const chairs = await db.getRepository(TableSeat).findBy({ userId: Not(IsNull()) });
            const full = chairs.map((chair) => chair.tableId).filter((id, _at, all) => all.filter((one) => one === id).length === 4);

            expect(await sizes()).toEqual([2, 4, 4]);
            expect(await db.getRepository(Table).count()).toBe(3);
            expect(chairs).toHaveLength(10);
            expect(new Set(chairs.map((chair) => chair.userId)).size).toBe(10);
            expect(new Set(chairs.map((chair) => `${ chair.tableId }:${ chair.seat }`)).size).toBe(10);
            expect(chairs.every((chair) => chair.ready)).toBe(true);

            for (const [index, answer] of answers.entries())
            {
                const chair = chairs.find((one) => one.userId === searchers[index])!;

                expect(answer.id).toBe(chair.tableId);
                expect(answer.mine).toBe(chair.seat);
            }

            expect(await db.getRepository(Match).countBy({ finishedAt: IsNull() })).toBe(2);

            for (const tableId of new Set(full))
            {
                const match = await db.getRepository(Match).findOneByOrFail({ tableId, finishedAt: IsNull() });
                const dealt = await db.getRepository(MatchPlayer).findBy({ matchId: match.id });

                expect(dealt.map((player) => `${ player.seat }:${ player.userId }`).sort())
                    .toEqual(chairs.filter((chair) => chair.tableId === tableId).map((chair) => `${ chair.seat }:${ chair.userId }`).sort());
            }
        }, 60_000);

        it('gives the last chair to the searcher or to somebody taking it by hand, never both, and sits the searcher somewhere either way', async () =>
        {
            for (let round = 0; round < ROUNDS; round += 1)
            {
                const theirs = await opened(await makeUser(), { seats: 2 });
                const searcher = await makeUser();
                const walker = await makeUser();

                const [searched, claimed] = await Promise.all([search(searcher, {}, here), there.claimSeat(walker, theirs)]);

                const last = await db.getRepository(TableSeat).findOneByOrFail({ tableId: theirs, seat: 1 });

                expect([searcher, walker], `round ${ round }`).toContain(last.userId);
                expect(claimed, `round ${ round }`).toBe(last.userId === walker ? 1 : null);
                expect(searched.id === theirs, `round ${ round }`).toBe(last.userId === searcher);
                expect(await chairsOf(searcher), `round ${ round }`).toMatchObject([{ tableId: searched.id, ready: true }]);

                await db.getRepository(Table).createQueryBuilder().delete().execute();
            }
        }, 60_000);
    });

    describe('when the table is emptied or closed as it sits down', () =>
    {
        const threadOf = async (tableId: string) => (await db.getRepository(Conversation).findOneByOrFail({ tableId, kind: 'game' })).id;

        const sittingAt = async (tableId: string) =>
            (await db.getRepository(TableSeat).findBy({ tableId, userId: Not(IsNull()) })).map((chair) => chair.userId);

        const elsewhere = async (who: string, tableId: string) =>
        {
            const chairs = await chairsOf(who);

            expect(chairs).toMatchObject([{ ready: true }]);
            expect(chairs[0].tableId).not.toBe(tableId);
            expect(await row(chairs[0].tableId)).toMatchObject({ status: 'open', hostId: who });

            return chairs[0].tableId;
        };

        it('keeps the table open for the chair it took before the last one there got up', async () =>
        {
            const host = await makeUser();
            const me = await makeUser();
            const theirs = await opened(host);
            const thread = await threadOf(theirs);

            const [searched, left] = await parkedBehind(
                (tx) => tx.getRepository(ConversationMember).insert({ conversationId: thread, userId: me }),
                [() => search(me, {}, here), () => there.leave(host, theirs, async () => null)]
            );

            expect(searched).toEqual({ status: 'fulfilled', value: { id: theirs, seated: true } });
            expect(left).toMatchObject({ status: 'fulfilled', value: { left: true, closed: false } });
            expect(await row(theirs)).toMatchObject({ status: 'open' });
            expect(await sittingAt(theirs)).toEqual([me]);
            expect(await inThread(me, theirs)).toBe(true);
        });

        it('sits down somewhere else when the last one there got up first, and leaves that table closed and empty', async () =>
        {
            const host = await makeUser();
            const me = await makeUser();
            const theirs = await opened(host);
            const thread = await threadOf(theirs);

            const [left, searched] = await parkedBehind(
                (tx) => tx.getRepository(ConversationMember).findOne({ where: { conversationId: thread, userId: host }, lock: { mode: 'pessimistic_write' } }),
                [() => here.leave(host, theirs, async () => null), () => search(me, {}, there)]
            );

            expect(left).toMatchObject({ status: 'fulfilled', value: { left: true, closed: true } });
            expect(await row(theirs)).toMatchObject({ status: 'closed' });
            expect(await sittingAt(theirs)).toEqual([]);
            expect(await inThread(me, theirs)).toBe(false);
            expect(searched).toEqual({ status: 'fulfilled', value: { id: await elsewhere(me, theirs), seated: true } });
        });

        it('sits down somewhere else when the host was already closing the table', async () =>
        {
            const host = await makeUser();
            const me = await makeUser();
            const theirs = await opened(host);

            const [closed, searched] = await parkedBehind(
                (tx) => tx.getRepository(Table).findOne({ where: { id: theirs }, lock: { mode: 'pessimistic_write' } }),
                [() => here.close(host, theirs), () => search(me, {}, there)]
            );

            expect(closed).toMatchObject({ status: 'fulfilled' });
            expect(await row(theirs)).toMatchObject({ status: 'closed' });
            expect(await sittingAt(theirs)).toEqual([host]);
            expect(await inThread(me, theirs)).toBe(false);
            expect(searched).toEqual({ status: 'fulfilled', value: { id: await elsewhere(me, theirs), seated: true } });
        });
    });

    describe('when it takes the last chair', () =>
    {
        const rung = () => ({ tables: vi.spyOn(listener, 'tableChanged'), games: vi.spyOn(listener, 'gamePushed') });

        it('starts the game for everybody with nobody pressing start, and answers with the game on', async () =>
        {
            const ports = door();
            const [first, second] = await crowd(2);
            const { tables, games } = rung();

            try
            {
                const waiting = await ports.table.quick(first, { game: 'backgammon', voice: 'off' });

                expect(waiting).toMatchObject({ status: 'open', mine: 0, taken: 1 });
                expect(waiting.matchId).toBeUndefined();
                expect(games).not.toHaveBeenCalled();
                expect(tables).toHaveBeenCalledWith(waiting.id, [first]);

                const playing = await ports.table.quick(second, { game: 'backgammon', voice: 'off' });
                const match = await db.getRepository(Match).findOneByOrFail({ tableId: waiting.id, finishedAt: IsNull() });

                expect(playing).toMatchObject({ id: waiting.id, status: 'playing', mine: 1, taken: 2, matchId: match.id });
                expect(games).toHaveBeenCalledTimes(1);
                expect(games.mock.calls[0][0].map((push) => push.userId).sort()).toEqual([first, second].sort());
                expect(tables.mock.calls.at(-1)).toEqual([waiting.id, expect.arrayContaining([first, second])]);
            }
            finally
            {
                vi.restoreAllMocks();
            }
        });

        it('starts one game when two searchers take the last two chairs together', async () =>
        {
            for (let round = 0; round < ROUNDS; round += 1)
            {
                const [host, early, ...late] = await crowd(4);
                const theirs = (await door().table.quick(host, { game: 'ludo', voice: 'off' })).id;

                await door().table.quick(early, { game: 'ludo', voice: 'off' });

                const answers = await Promise.all(late.map((who) => door().table.quick(who, { game: 'ludo', voice: 'off' })));

                expect(answers.map((answer) => answer.id), `round ${ round }`).toEqual([theirs, theirs]);
                expect(await live(theirs), `round ${ round }`).toBe(1);
                expect(await db.getRepository(MatchPlayer).count(), `round ${ round }`).toBe(4);

                await db.getRepository(Table).createQueryBuilder().delete().execute();
            }
        }, 60_000);

        it('still answers with the chair it took when the game would not start, and leaves the table full and ready', async () =>
        {
            const ports = door();
            const [first, second] = await crowd(2);
            const said = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try
            {
                const waiting = await ports.table.quick(first, { game: 'quick-fixture', voice: 'off' });
                const full = await ports.table.quick(second, { game: 'quick-fixture', voice: 'off' });

                expect(full).toMatchObject({ id: waiting.id, status: 'ready', mine: 1, taken: 2 });
                expect(full.chairs.map((chair) => chair.ready)).toEqual([true, true]);
                expect(full.matchId).toBeUndefined();
                expect(await live(waiting.id)).toBe(0);
                expect(said.mock.calls.map((call) => String(call[0])).join('')).toContain('quick start failed');
            }
            finally
            {
                vi.restoreAllMocks();
            }
        });

        it('tells whoever goes first at a turn-based table it started, unless that is the searcher, and nobody at a live one', async () =>
        {
            const ports = door();
            const nobodyHere = door({ present: () => new Set<string>() });
            const slow = { game: 'ludo', seats: 2, mode: 'turns', voice: 'off' } as const;
            const told = async (who: string) => await db.getRepository(Notification).countBy({ kind: 'turn', userId: who });
            const went = new Set<string>();

            for (let round = 0; round < 40 && went.size < 2; round += 1)
            {
                const [away, late] = await crowd(2);

                await ports.table.quick(away, slow);

                expect(await nobodyHere.table.quick(late, slow), `round ${ round }`).toMatchObject({ mode: 'turns', status: 'playing', mine: 1 });

                const first = (await ports.table.mine(away))[0].yourTurn === true ? 'whoever was away' : 'the searcher';

                expect([await told(away), await told(late)], `round ${ round }, ${ first } goes first`).toEqual(first === 'the searcher' ? [0, 0] : [1, 0]);
                went.add(first);
            }

            expect([...went].sort()).toEqual(['the searcher', 'whoever was away']);

            const [one, other] = await crowd(2);

            await ports.table.quick(one, { game: 'ludo', seats: 2, voice: 'off' });

            expect(await ports.table.quick(other, { game: 'ludo', seats: 2, voice: 'off' })).toMatchObject({ mode: 'live', status: 'playing' });
            expect([await told(one), await told(other)]).toEqual([0, 0]);
        }, 60_000);

        it('rings nobody for a second press that changed nothing', async () =>
        {
            const ports = door();
            const me = await makeUser();
            const first = await ports.table.quick(me, { game: 'ludo', voice: 'off' });
            const { tables } = rung();

            try
            {
                expect(await ports.table.quick(me, { game: 'ludo', voice: 'off' })).toEqual(first);
                expect(tables).not.toHaveBeenCalled();
            }
            finally
            {
                vi.restoreAllMocks();
            }
        });

        it('asks the hub who is here, and counts everybody as here when there is no hub', async () =>
        {
            const away = await makeUser();
            const stale = await opened(away);
            const [guest] = await joined(stale, 1);
            const asked: string[][] = [];
            const absent: PresenceReader = {
                present: (userIds) =>
                {
                    asked.push([...userIds].sort());

                    return new Set(userIds.filter((id) => id !== away));
                }
            };

            expect((await door(absent).table.quick(await makeUser(), { game: 'ludo', voice: 'off' })).id).not.toBe(stale);
            expect(asked).toEqual([[away, guest].sort()]);
            expect((await door().table.quick(await makeUser(), { game: 'ludo', voice: 'off' })).id).toBe(stale);
        });
    });

    describe('what it refuses', () =>
    {
        const NO_GAME = { status: 422, body: JSON.stringify({ error: { code: 'quick-game', message: 'That game cannot be played right now.' } }) };

        const NO_TABLE = { status: 422, body: JSON.stringify({ error: { code: 'quick-options', message: 'That is not a table this game makes.' } }) };

        it('says the game cannot be played for one nobody has heard of and for one that is not open yet, in the same bytes', async () =>
        {
            const me = await makeUser();

            expect(await sent(search(me, { game: 'chess' }))).toEqual(NO_GAME);

            await db.getRepository(Game).update({ id: 'quick-fixture' }, { status: 'coming-soon' });

            expect(await sent(search(me, { game: 'quick-fixture' }))).toEqual(NO_GAME);
            expect(await db.getRepository(Table).count()).toBe(0);
        });

        it('says the game makes no such table, whatever else is waiting, and opens nothing', async () =>
        {
            const me = await makeUser();

            await opened(await makeUser(), { game: 'hokm', seats: 4, target: 7, teams: true });

            for (const ask of [{ seats: 5 }, { seats: 3, teams: true }, { seats: 4, teams: false }, { target: 9 }, { blinds: 'low' as const }, { cube: true }])
            {
                expect(await sent(search(me, { game: 'hokm', ...ask })), JSON.stringify(ask)).toEqual(NO_TABLE);
            }

            expect(await sent(search(me, { game: 'poker', mode: 'turns' }))).toEqual(NO_TABLE);
            expect(await sent(search(me, { game: 'backgammon', cube: true, target: 1 }))).toEqual(NO_TABLE);
            expect(await chairsOf(me)).toEqual([]);
            expect(await db.getRepository(Table).count()).toBe(1);
        });

        it('says the searcher holds too many chairs, and takes no other', async () =>
        {
            const me = await makeUser();
            const theirs = await opened(await makeUser());

            for (let index = 0; index < SEATED_MAX; index += 1)
            {
                await opened(me, { seats: 2, privacy: 'invite' });
            }

            await expect(search(me)).rejects.toMatchObject({ status: 409, code: 'seated-max' });
            expect(await chairOf(me, theirs)).toBeNull();
            expect(await chairsOf(me)).toHaveLength(SEATED_MAX);
        }, 60_000);
    });
});
