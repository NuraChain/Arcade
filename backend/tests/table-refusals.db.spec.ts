import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, IsNull, Not } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Conversation, Match, Notification, Table, TableSeat, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { createTableService } from '../src/domains/table/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;
let social: ReturnType<typeof createSocialService>;

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
    sessionsRevoked: () => undefined
};

const NOBODY = {
    status: 404,
    body: JSON.stringify({ error: { code: 'no-invitee', message: 'No one by that name can be invited.' } })
};

const NO_TABLE = { status: 404, code: 'not-found', message: 'No table there.' };

const makeUser = async (overrides: Partial<Pick<User, 'isMinor' | 'isSuspended' | 'allowStrangerMessages'>> = {}) =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `r${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Refusal ${ seq }`,
        hue: seq % 360,
        kind: 'guest',
        ...overrides
    });

    return { id: made.id, handle: made.handle };
};

const befriend = async (a: string, b: string) =>
{
    await db.query(
        `insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)
         on conflict do nothing`,
        [a, b]
    );
};

const config = (privacy: 'invite' | 'public', invitees: string[] = [], seats = 4) => ({
    game: 'ludo',
    seats,
    mode: 'live' as const,
    privacy,
    target: 0,
    cube: false,
    blinds: 'low' as const,
    chat: true,
    voice: false,
    teams: false,
    invitees
});

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

const heldAt = async (tableId: string) =>
    await db.getRepository(TableSeat).countBy({ tableId, invitedId: Not(IsNull()) });

const invitations = async () => await db.getRepository(Notification).countBy({ kind: 'table-invite' });

const seated = async (ready: boolean[]) =>
{
    const players = [await makeUser(), await makeUser()];
    const table = await ports.table.create(players[0].id, config('public', [], 2));

    await ports.table.claim(players[1].id, table.id);

    for (const [index, player] of players.entries())
    {
        await ports.table.setReady(player.id, table.id, ready[index]);
    }

    return { players, tableId: table.id };
};

const waitingOnLocks = async () =>
    rowsOf<{ count: number }>(await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ))[0].count;

const heldAtTheDeal = async (starting: () => Promise<unknown>, meanwhile: () => Promise<unknown>) =>
{
    const gate = db.createQueryRunner();

    await gate.connect();
    await gate.startTransaction();
    await gate.query('lock table matches in share mode');

    const answer = starting().then(() => null, (error: unknown) => error);

    try
    {
        await vi.waitFor(async () => expect(await waitingOnLocks()).toBe(1), { timeout: 5_000, interval: 5 });
        await meanwhile();
    }
    finally
    {
        await gate.commitTransaction();
        await gate.release();
    }

    return await answer;
};

describe.skipIf(!active)('what a table refuses, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
        social = createSocialService(db);
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

    describe('an invitation', () =>
    {
        const refusing = async (host: { id: string; handle: string }) =>
        {
            const blocked = await makeUser();
            const blocking = await makeUser();

            await social.block(host.id, blocked.id);
            await social.block(blocking.id, host.id);

            return {
                'a name nobody holds': `nobody${ Math.floor(Math.random() * 1_000_000) }`,
                'a suspended account': (await makeUser({ isSuspended: true })).handle,
                'the inviter themselves': host.handle,
                'somebody the inviter blocked': blocked.handle,
                'somebody who blocked the inviter': blocking.handle,
                'a stranger who takes no strangers': (await makeUser({ allowStrangerMessages: false })).handle,
                'a minor who is a stranger': (await makeUser({ isMinor: true, allowStrangerMessages: false })).handle
            };
        };

        it('is refused in the same bytes for a missing name, a block, a closed door and a minor', async () =>
        {
            const host = await makeUser();
            const table = await ports.table.create(host.id, config('invite'));

            for (const [who, handle] of Object.entries(await refusing(host)))
            {
                expect(await sent(ports.table.invite(host.id, table.id, handle)), who).toEqual(NOBODY);
            }

            expect(await heldAt(table.id)).toBe(0);
            expect(await invitations()).toBe(0);
        });

        it('is refused the same way for an account that went away between the name and the chair', async () =>
        {
            const host = await makeUser();
            const table = await ports.table.create(host.id, config('invite'));
            const gone = '00000000-0000-4000-8000-000000000000';

            expect(await sent(createTableService(db, social).invite(host.id, table.id, gone))).toEqual(NOBODY);
            expect(await heldAt(table.id)).toBe(0);
        });

        it('is refused the same way when the inviter is the minor', async () =>
        {
            const minor = await makeUser({ isMinor: true, allowStrangerMessages: false });
            const adult = await makeUser();
            const table = await ports.table.create(minor.id, config('invite'));

            expect(await sent(ports.table.invite(minor.id, table.id, adult.handle))).toEqual(NOBODY);
            expect(await heldAt(table.id)).toBe(0);
        });

        it('still reaches a stranger whose door is open, and a friend whose door is closed', async () =>
        {
            const host = await makeUser();
            const stranger = await makeUser();
            const friend = await makeUser({ allowStrangerMessages: false });
            const table = await ports.table.create(host.id, config('invite'));

            await befriend(host.id, friend.id);

            const first = await ports.table.invite(host.id, table.id, stranger.handle);
            const second = await ports.table.invite(host.id, table.id, friend.handle);

            expect(first.chairs.map((chair) => chair.invited)).toContain(stranger.handle);
            expect(second.chairs.map((chair) => chair.invited)).toEqual(expect.arrayContaining([stranger.handle, friend.handle]));
            expect(await invitations()).toBe(2);
        });

        it('is refused in those bytes at create too, and opens no table', async () =>
        {
            const host = await makeUser();
            const { 'a name nobody holds': _missing, 'a suspended account': _suspended, ...known } = await refusing(host);

            for (const [who, handle] of Object.entries(known))
            {
                expect(await sent(ports.table.create(host.id, config('invite', [handle]))), who).toEqual(NOBODY);
            }

            expect(await db.getRepository(Table).countBy({ hostId: host.id })).toBe(0);
            expect(await invitations()).toBe(0);
        });
    });

    describe('a refused start', () =>
    {
        it('says a chair is empty', async () =>
        {
            const host = await makeUser();
            const table = await ports.table.create(host.id, config('public', [], 2));

            await ports.table.setReady(host.id, table.id, true);

            await expect(ports.match.start(host.id, table.id)).rejects.toMatchObject({ status: 409, code: 'chairs-empty' });
        });

        it('says somebody is not ready', async () =>
        {
            const { players, tableId } = await seated([true, false]);

            await expect(ports.match.start(players[0].id, tableId)).rejects.toMatchObject({ status: 409, code: 'not-ready' });
        });

        it('says somebody is not ready when they stop being ready between the read and the deal', async () =>
        {
            const { players, tableId } = await seated([true, true]);

            const refused = await heldAtTheDeal(
                () => ports.match.start(players[0].id, tableId),
                () => ports.table.setReady(players[1].id, tableId, false)
            );

            expect(refused).toMatchObject({ status: 409, code: 'not-ready', message: 'That table is not ready to start.' });
            expect(await db.getRepository(Match).countBy({ tableId })).toBe(0);
        }, 15_000);

        it('says the table has closed', async () =>
        {
            const { players, tableId } = await seated([true, true]);

            await ports.table.close(players[0].id, tableId);

            await expect(ports.match.start(players[1].id, tableId)).rejects.toMatchObject({ status: 409, code: 'table-closed' });
        });

        it('tells somebody with no chair nothing but that there is no table, whatever stands in the way', async () =>
        {
            const stranger = await makeUser();
            const host = await makeUser();
            const empty = await ports.table.create(host.id, config('public', [], 2));
            const unready = await seated([true, false]);
            const closed = await seated([true, true]);

            await ports.table.close(closed.players[0].id, closed.tableId);

            for (const tableId of [empty.id, unready.tableId, closed.tableId, '00000000-0000-4000-8000-000000000000'])
            {
                await expect(ports.match.start(stranger.id, tableId)).rejects.toMatchObject(NO_TABLE);
            }
        });
    });

    describe('a table that has closed, or has a game on', () =>
    {
        it('says closed to somebody reaching for a chair, and to a host switching voice', async () =>
        {
            const host = await makeUser();
            const late = await makeUser();
            const table = await ports.table.create(host.id, config('public', [], 2));

            await ports.table.close(host.id, table.id);

            await expect(ports.table.claim(late.id, table.id)).rejects.toMatchObject({ status: 409, code: 'table-closed' });
            await expect(ports.table.setVoice(host.id, table.id, true)).rejects.toMatchObject({ status: 409, code: 'table-closed' });
        });

        it('says a game is being played to a host who closes it and to somebody reaching for a chair', async () =>
        {
            const { players, tableId } = await seated([true, true]);
            const late = await makeUser();

            await ports.match.start(players[0].id, tableId);

            await expect(ports.table.close(players[0].id, tableId)).rejects.toMatchObject({ status: 409, code: 'playing' });
            await expect(ports.table.claim(late.id, tableId)).rejects.toMatchObject({ status: 409, code: 'playing' });
        });

        it('says a game is being played to somebody leaving who did not agree to forfeit it, and frees and rings nothing', async () =>
        {
            const { players, tableId } = await seated([true, true]);
            const rung = [vi.spyOn(listener, 'tableChanged'), vi.spyOn(listener, 'chatChanged'), vi.spyOn(listener, 'gamePushed')];
            const stillIn = async () => ({
                chair: await db.getRepository(TableSeat).existsBy({ tableId, userId: players[1].id }),
                game: await db.getRepository(Match).existsBy({ tableId, finishedAt: IsNull() })
            });

            try
            {
                await ports.match.start(players[0].id, tableId);

                for (const ring of rung)
                {
                    ring.mockClear();
                }

                await expect(ports.table.leave(players[1].id, tableId, false)).rejects.toMatchObject({ status: 409, code: 'playing' });

                expect(rung.map((ring) => ring.mock.calls.length)).toEqual([0, 0, 0]);
                expect(await stillIn()).toEqual({ chair: true, game: true });

                await ports.table.leave(players[1].id, tableId, true);

                expect(rung.map((ring) => ring.mock.calls.length > 0)).toEqual([true, true, true]);
                expect(await stillIn()).toEqual({ chair: false, game: false });
            }
            finally
            {
                for (const ring of rung)
                {
                    ring.mockRestore();
                }
            }
        });

        it('lets somebody leave a table with no game on without agreeing to forfeit one', async () =>
        {
            const { players, tableId } = await seated([true, true]);

            await ports.table.leave(players[1].id, tableId, false);

            expect(await db.getRepository(TableSeat).existsBy({ tableId, userId: players[1].id })).toBe(false);
            await expect(ports.match.start(players[0].id, tableId)).rejects.toMatchObject({ status: 409, code: 'chairs-empty' });
        });
    });
});
