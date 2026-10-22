import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { errorResponse } from '@azerothjs/http';

import { Conversation, Escrow, Match, StaffAction, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'
];

const OWNER = 5;

const REASON = { reason: 'Left open by a fault, nobody can play here' };

let tables: string[] = [];
let chats: string[] = [];

const listener: WriteListener = {
    chatChanged: (conversationId) =>
    {
        chats.push(conversationId);
    },
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: (tableId) =>
    {
        tables.push(tableId);
    },
    tableViewed: () => undefined,
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    vaultAddress: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

let db: DataSource;
let ports: Services;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number | null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `c${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Sitter ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, WALLETS[wallet]]
        );
    }

    return { id: made.id, handle: made.handle };
};

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return null;
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string } };

    return `${ response.status } ${ body.error.code }`;
};

const grant = (owner: Person, target: Person, role: 'moderator' | 'admin') =>
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Runs the games on weekends' });

const waiting = async (people: Person[], seats = 4) =>
{
    const [host, ...guests] = people;
    const table = await ports.table.create(host.id, {
        game: 'ludo',
        seats,
        mode: 'live',
        privacy: 'public',
        target: 0,
        cube: false,
        blinds: 'low',
        chat: true,
        voice: 'off',
        teams: false,
        invitees: []
    });

    for (const guest of guests)
    {
        await ports.table.claim(guest.id, table.id);
    }

    return { tableId: table.id, code: table.code };
};

const rowOf = (tableId: string) => db.getRepository(Table).findOneByOrFail({ id: tableId });

const closes = () => db.getRepository(StaffAction).countBy({ kind: 'close' });

const waitingOnLocks = async () =>
    (await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ) as { count: number }[])[0].count;

describe.skipIf(!active)('closing a waiting table, against a real database', () =>
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
            await db.query('truncate table users cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        tables = [];
        chats = [];
        await db.query('truncate table users cascade');
    });

    it('closes it with a reason: nobody sits or starts there again, it leaves the list, the people at it read that Nura\'s team closed it, and the log says who, why and which table', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const host = await makeUser(null);
        const guest = await makeUser(null);
        const stranger = await makeUser(null);

        await grant(owner, admin, 'admin');

        const shut = await waiting([host, guest]);
        const kept = await waiting([await makeUser(null)]);

        await ports.table.setReady(host.id, shut.tableId, true);

        const before = (await ports.admin.play(admin.id))?.games.find((one) => one.game === 'ludo')?.tables;

        tables = [];
        chats = [];

        const answer = await ports.admin.closeTable(admin.id, shut.tableId, REASON);
        const room = await db.getRepository(Conversation).findOneByOrFail({ tableId: shut.tableId, kind: 'game' });

        expect(answer?.games.find((one) => one.game === 'ludo')?.tables).toBe((before ?? 0) - 1);
        expect([(await rowOf(shut.tableId)).status, (await rowOf(shut.tableId)).closedAt !== null]).toEqual(['closed', true]);
        expect((await rowOf(kept.tableId)).status).toBe('open');
        expect((await ports.table.view(host.id, shut.tableId))).toMatchObject({ status: 'closed', closedBy: 'staff' });
        expect((await ports.table.view(guest.id, shut.tableId))).toMatchObject({ status: 'closed', closedBy: 'staff' });
        expect((await ports.admin.waitingTables(admin.id, {}))?.rows.map((row) => row.id)).toEqual([kept.tableId]);
        expect([tables, chats]).toEqual([[shut.tableId], [room.id]]);
        expect(await word(ports.table.claim(stranger.id, shut.tableId))).toBe('409 table-closed');

        const rows = await db.getRepository(StaffAction).find({ where: { kind: 'close' } });

        expect(rows.map((row) => [row.staffHandle, row.staffRole, row.personId, row.personHandle, row.reason, row.details])).toEqual([
            [admin.handle, 'admin', null, null, REASON.reason, { id: shut.tableId, table: shut.code, game: 'ludo' }]
        ]);
    });

    it('says nothing of the staff on a table its host closed', async () =>
    {
        const host = await makeUser(null);
        const shut = await waiting([host]);

        await ports.table.close(host.id, shut.tableId);

        const seen = await ports.table.view(host.id, shut.tableId);

        expect(seen?.status).toBe('closed');
        expect(seen?.closedBy).toBeUndefined();
    });

    it('refuses a table with a game on, one whose stakes are being locked and one already closed, and writes nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const host = await makeUser(null);
        const guest = await makeUser(null);
        const playing = await waiting([host, guest], 2);

        await ports.table.setReady(host.id, playing.tableId, true);
        await ports.table.setReady(guest.id, playing.tableId, true);
        await ports.match.start(host.id, playing.tableId);

        const locking = await waiting([await makeUser(null)]);

        await db.getRepository(Escrow).save({ tableId: locking.tableId, game: 'ludo', amount: '10000000000000000000', feeBps: 500, state: 'locking' });

        const gone = await waiting([await makeUser(null)]);

        await db.query(`update tables set status = 'closed', closed_at = now() where id = $1`, [gone.tableId]);

        tables = [];
        chats = [];

        expect(await word(ports.admin.closeTable(owner.id, playing.tableId, REASON))).toBe('409 staff-table-playing');
        expect(await word(ports.admin.closeTable(owner.id, locking.tableId, REASON))).toBe('409 staff-table-playing');
        expect(await word(ports.admin.closeTable(owner.id, gone.tableId, REASON))).toBe('409 staff-table-closed');
        expect((await rowOf(playing.tableId)).status).toBe('open');
        expect((await rowOf(locking.tableId)).status).toBe('open');
        expect(await db.getRepository(Match).countBy({ tableId: playing.tableId })).toBe(1);
        expect(await closes()).toBe(0);
        expect([tables, chats]).toEqual([[], []]);
    });

    it('refuses whoever sits at the table and a table with somebody at or above them at it, and lets the owner close a table an admin sits at', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const other = await makeUser(2);
        const moderator = await makeUser(3);

        await grant(owner, admin, 'admin');
        await grant(owner, other, 'admin');
        await grant(owner, moderator, 'moderator');

        const own = await waiting([admin, await makeUser(null)]);
        const owners = await waiting([await makeUser(null), owner]);
        const peer = await waiting([other]);
        const below = await waiting([moderator, await makeUser(null)]);

        expect((await ports.admin.waitingTables(admin.id, {}))?.rows.find((row) => row.id === owners.tableId)?.people.map((one) => one.staff ?? null)).toEqual([null, 'owner']);

        expect(await word(ports.admin.closeTable(admin.id, own.tableId, REASON))).toBe('409 staff-seated');
        expect(await word(ports.admin.closeTable(admin.id, owners.tableId, REASON))).toBe('409 staff-rank');
        expect(await word(ports.admin.closeTable(admin.id, peer.tableId, REASON))).toBe('409 staff-rank');
        expect(await word(ports.admin.closeTable(owner.id, owners.tableId, REASON))).toBe('409 staff-seated');

        for (const refused of [own, owners, peer])
        {
            expect((await rowOf(refused.tableId)).status).toBe('open');
        }

        expect(await closes()).toBe(0);
        expect(await word(ports.admin.closeTable(admin.id, below.tableId, REASON))).toBeNull();
        expect(await word(ports.admin.closeTable(owner.id, peer.tableId, REASON))).toBeNull();
        expect(await closes()).toBe(2);
    });

    it('names the people at each waiting table in their seats with their role on the staff, a suspended one holding none', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const other = await makeUser(2);

        await grant(owner, admin, 'admin');
        await grant(owner, other, 'admin');

        const host = await makeUser(null);
        const table = await waiting([host, other]);
        const people = async () => (await ports.admin.waitingTables(admin.id, {}))?.rows.find((row) => row.id === table.tableId)?.people;

        expect(await people()).toEqual([
            { seat: 0, handle: host.handle, displayName: expect.any(String), hue: expect.any(Number) },
            { seat: 1, handle: other.handle, displayName: expect.any(String), hue: expect.any(Number), staff: 'admin' }
        ]);
        expect(await word(ports.admin.closeTable(admin.id, table.tableId, REASON))).toBe('409 staff-rank');

        await db.getRepository(User).update({ id: other.id }, { isSuspended: true });

        expect((await people())?.map((one) => one.staff ?? null)).toEqual([null, null]);
        expect(await word(ports.admin.closeTable(admin.id, table.tableId, REASON))).toBeNull();
    });

    it('answers a moderator, a player, a suspended admin, a table nobody holds and an id that is no id as nothing, and changes nothing', async () =>
    {
        const owner = await makeUser(OWNER);
        const moderator = await makeUser(1);
        const suspended = await makeUser(2);
        const player = await makeUser(null);

        await grant(owner, moderator, 'moderator');
        await grant(owner, suspended, 'admin');
        await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

        const table = await waiting([await makeUser(null)]);

        for (const who of [moderator, suspended, player])
        {
            expect(await ports.admin.closeTable(who.id, table.tableId, REASON)).toBeNull();
        }

        expect(await ports.admin.closeTable(owner.id, randomUUID(), REASON)).toBeNull();
        expect(await ports.admin.closeTable(owner.id, 'not-a-table', REASON)).toBeNull();
        expect((await rowOf(table.tableId)).status).toBe('open');
        expect(await closes()).toBe(0);
    });

    it('waits for whatever holds the table, and says it closed when that was the last one out', async () =>
    {
        const owner = await makeUser(OWNER);
        const table = await waiting([await makeUser(null)]);
        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select pg_advisory_xact_lock(hashtext($1::uuid::text))`, [table.tableId]);

        const closing = word(ports.admin.closeTable(owner.id, table.tableId, REASON));

        while (await waitingOnLocks() < 1)
        {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        await gate.query(`update tables set status = 'closed', closed_at = now() where id = $1`, [table.tableId]);
        await gate.commitTransaction();
        await gate.release();

        expect(await closing).toBe('409 staff-table-closed');
        expect(await closes()).toBe(0);
    });

    it('closes a table once when two of the staff close it at once', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        const table = await waiting([await makeUser(null)]);
        const answers = await Promise.all([
            word(ports.admin.closeTable(owner.id, table.tableId, REASON)),
            word(ports.admin.closeTable(admin.id, table.tableId, REASON))
        ]);

        expect(answers.sort()).toEqual(['409 staff-table-closed', null].sort());
        expect(await closes()).toBe(1);
    });
});
