import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { Conversation, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NOTIFICATIONS = 30;

const THREAD = 40;

const LIST = 60;

const HISTORY = 20;

const MORE = 5;

interface Person
{
    id: string;
    handle: string;
}

let db: DataSource;
let ports: Services;

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
    catalogueChanged: () => undefined,
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const makeUser = async (): Promise<Person> =>
{
    seq += 1;

    const handle = `k${ seq }s${ Math.floor(Math.random() * 100000) }`;
    const made = await db.getRepository(User).save({ handle, displayName: `Keyed ${ seq }`, hue: seq % 360 });

    return { id: made.id, handle };
};

const twoToAMillisecond = (index: number) =>
    `2026-10-20 09:00:00.${ String(Math.floor(index / 2)).padStart(3, '0') }${ index % 2 === 0 ? '100' : '900' }+00`;

const line = async (conversationId: string, index: number) =>
{
    const [row] = await db.query(
        `insert into messages (conversation_id, kind, payload, created_at)
         values ($1, 'system', $2, $3::timestamptz)
         returning id`,
        [conversationId, JSON.stringify({ key: 'chat.line.group.renamed', params: { name: `Line ${ index }` } }), twoToAMillisecond(index)]
    ) as { id: string }[];

    return row.id;
};

describe.skipIf(!active)('a list read a page at a time through rows made two to a millisecond, against Postgres', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: false });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
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
            await db.getRepository(Table).createQueryBuilder().delete().execute();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        await db.getRepository(Table).createQueryBuilder().delete().execute();
        await db.getRepository(Conversation).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    it('reads every notification once, newest first', async () =>
    {
        const reader = await makeUser();
        const askers: Person[] = [];

        for (let index = 0; index < NOTIFICATIONS + MORE; index += 1)
        {
            const asker = await makeUser();

            await ports.social.sendRequest(asker.id, reader.handle);
            await db.query('update notifications set created_at = $1::timestamptz where user_id = $2 and actor_id = $3', [twoToAMillisecond(index), reader.id, asker.id]);
            askers.push(asker);
        }

        const first = await ports.notify.page(reader.id, undefined);
        const second = await ports.notify.page(reader.id, first.cursor);
        const read = [...first.items, ...second.items].map((item) => item.actor);

        expect(first.items).toHaveLength(NOTIFICATIONS);
        expect(second.cursor).toBeUndefined();
        expect(read).toEqual(askers.map((asker) => asker.handle).reverse());
    });

    it('reads every line of a thread once, oldest first within a page', async () =>
    {
        const [reader, other] = [await makeUser(), await makeUser()];
        const conversationId = await ports.chat.openDirect(reader.id, other.handle);
        const lines: string[] = [];

        await db.query('delete from messages where conversation_id = $1', [conversationId]);

        for (let index = 0; index < THREAD + MORE; index += 1)
        {
            lines.push(await line(conversationId, index));
        }

        const first = await ports.chat.messages(reader.id, conversationId, undefined);
        const second = await ports.chat.messages(reader.id, conversationId, first.cursor);
        const read = [...second.messages, ...first.messages].map((message) => message.id);

        expect(first.messages).toHaveLength(THREAD);
        expect(second.cursor).toBeUndefined();
        expect(read).toEqual(lines);
    });

    it('offers no next page after a thread exactly one page long', async () =>
    {
        const [reader, other] = [await makeUser(), await makeUser()];
        const conversationId = await ports.chat.openDirect(reader.id, other.handle);

        await db.query('delete from messages where conversation_id = $1', [conversationId]);

        for (let index = 0; index < THREAD; index += 1)
        {
            await line(conversationId, index);
        }

        const only = await ports.chat.messages(reader.id, conversationId, undefined);

        expect(only.messages).toHaveLength(THREAD);
        expect(only.hasMore).toBe(false);
        expect(only.cursor).toBeUndefined();
    });

    it('reads every conversation once, the most recently active first', async () =>
    {
        const reader = await makeUser();
        const rooms: string[] = [];

        for (let index = 0; index < LIST + MORE; index += 1)
        {
            const room = await ports.chat.openDirect(reader.id, (await makeUser()).handle);

            await db.query('delete from messages where conversation_id = $1', [room]);
            await line(room, index);
            rooms.push(room);
        }

        const first = await ports.chat.list(reader.id);
        const second = await ports.chat.list(reader.id, first.cursor);
        const read = [...first.conversations, ...second.conversations].map((room) => room.id);

        expect(first.conversations).toHaveLength(LIST);
        expect(second.cursor).toBeUndefined();
        expect(read).toEqual([...rooms].reverse());
    });

    it('reads every game somebody has finished once, the newest first', async () =>
    {
        const player = await makeUser();
        const games: string[] = [];

        for (let index = 0; index < HISTORY + MORE; index += 1)
        {
            const other = await makeUser();
            const table = await ports.table.create(player.id, { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] });

            await ports.table.claim(other.id, table.id);
            await ports.table.setReady(player.id, table.id, true);
            await ports.table.setReady(other.id, table.id, true);

            const match = await ports.match.start(player.id, table.id);

            await ports.table.leave(player.id, table.id, true);
            await db.query('update matches set finished_at = $1::timestamptz where id = $2', [twoToAMillisecond(index), match.id]);
            games.push(match.id);
        }

        const first = await ports.match.history(player.id, null);
        const second = await ports.match.history(player.id, first.cursor ?? null);
        const read = [...first.matches, ...second.matches].map((game) => game.id);

        expect(first.matches).toHaveLength(HISTORY);
        expect(second.cursor).toBeUndefined();
        expect(read).toEqual([...games].reverse());
    });
});
