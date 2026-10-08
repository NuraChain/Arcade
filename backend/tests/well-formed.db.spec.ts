import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, IsNull } from 'typeorm';

import { Conversation, FriendRequest, Table, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const NUL = String.fromCharCode(0);

const ZERO = '00000000-0000-0000-0000-000000000000';

const NOWHERE = '3f0e3c2a-1111-4222-8333-444455556666';

const NOT_IDS = ['not-a-uuid', 'somebody', '', '{}', 'null', '-1', `${ ZERO }x`, 'GGGGGGGG-GGGG-GGGG-GGGG-GGGGGGGGGGGG', `' or 1=1 --`, 'x'.repeat(300)];

const sealed = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

const NOT_CURSORS = [
    'not-a-cursor',
    '%00',
    sealed('not-a-cursor'),
    sealed('|'),
    sealed(`|${ ZERO }x`),
    sealed('2026-10-08T00:00:00.000Z|not-a-uuid'),
    sealed(`2026-10-08T00:00:00.000Z|${ ZERO }x`),
    sealed(`never|${ ZERO }`),
    sealed(`2026-13-45T99:99:99.000Z|${ ZERO }`),
    sealed(`${ NUL }|${ NUL }`),
    '2026-10-08T00:00:00.000Z|not-a-uuid',
    `never|${ ZERO }`,
    `2026-13-45T99:99:99.000Z|${ ZERO }`,
    `2026-10-08T00:00:00.000Z|${ ZERO }|${ ZERO }`
];

const DAYS_THAT_NEVER_WERE = [
    sealed(`2026-02-30T00:00:00.000Z|${ ZERO }`),
    sealed(`2026-04-31T24:00:00.000Z|${ ZERO }`),
    `2026-02-30T00:00:00.000Z|${ ZERO }`,
    `2026-04-31T24:00:00.000Z|${ ZERO }`
];

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
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const makeUser = async (): Promise<Person> =>
{
    seq += 1;

    const handle = `w${ seq }f${ Math.floor(Math.random() * 100000) }`;
    const made = await db.getRepository(User).save({ handle, displayName: `Formed ${ seq }`, hue: seq % 360, kind: 'guest' });

    return { id: made.id, handle };
};

const said = async (run: () => Promise<unknown>) =>
{
    try
    {
        await run();

        return 'answered';
    }
    catch (error)
    {
        const refusal = error as { status?: number; code?: string; message?: string };

        return { status: refusal.status, code: refusal.code, message: refusal.message };
    }
};

describe.skipIf(!active)('a request that is not well formed, against Postgres', () =>
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

    describe('a friend request named by something that is no id', () =>
    {
        it('is answered as a request that is not there, and the real one is left waiting', async () =>
        {
            const asker = await makeUser();
            const asked = await makeUser();

            await ports.social.sendRequest(asker.id, asked.handle);

            const missing = await said(() => ports.social.answerRequest(asked.id, NOWHERE, 'accepted'));

            expect(missing).toMatchObject({ status: 404 });

            for (const id of NOT_IDS)
            {
                expect(await said(() => ports.social.answerRequest(asked.id, id, 'accepted')), `accepting ${ id.slice(0, 40) }`).toEqual(missing);
                expect(await said(() => ports.social.answerRequest(asked.id, id, 'declined')), `declining ${ id.slice(0, 40) }`).toEqual(missing);
            }

            expect(await db.getRepository(FriendRequest).countBy({ toUser: asked.id, answeredAt: IsNull() })).toBe(1);
        });
    });

    describe('a revision a game has not reached', () =>
    {
        it('reads as nothing new, however far past the end it is, and one before the beginning reads the whole game', async () =>
        {
            const host = await makeUser();
            const guest = await makeUser();
            const table = await ports.table.create(host.id, { game: 'ludo', seats: 2, mode: 'turns', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] });

            await ports.table.claim(guest.id, table.id);
            await ports.table.setReady(host.id, table.id, true);
            await ports.table.setReady(guest.id, table.id, true);

            const match = await ports.match.start(host.id, table.id);
            const whole = await ports.match.since(host.id, match.id, 0);

            expect(whole?.events.length).toBeGreaterThan(0);

            for (const rev of [match.rev, match.rev + 1, 2_147_483_646, 2_147_483_647, 2_147_483_648, 99_999_999_999_999, Number.MAX_SAFE_INTEGER])
            {
                expect(await said(() => ports.match.since(host.id, match.id, rev)), String(rev)).toBe('answered');
                expect((await ports.match.since(host.id, match.id, rev))?.events, String(rev)).toEqual([]);
            }

            for (const rev of [-1, -2_147_483_649, -99_999_999_999_999])
            {
                expect((await ports.match.since(host.id, match.id, rev))?.events, String(rev)).toEqual(whole?.events);
            }
        });
    });

    describe('a cursor that is no cursor', () =>
    {
        it('reads the notifications from the top', async () =>
        {
            const asker = await makeUser();
            const asked = await makeUser();

            await ports.social.sendRequest(asker.id, asked.handle);

            const first = await ports.notify.page(asked.id, undefined);

            expect(first.items).toHaveLength(1);

            for (const cursor of NOT_CURSORS)
            {
                expect(await ports.notify.page(asked.id, cursor), cursor).toEqual(first);
            }
        });

        it('reads the conversations from the top', async () =>
        {
            const host = await makeUser();

            await ports.table.create(host.id, { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] });

            const first = await ports.chat.list(host.id);

            for (const cursor of NOT_CURSORS)
            {
                expect(await ports.chat.list(host.id, cursor), cursor).toEqual(first);
            }
        });

        it('reads a thread from its newest line', async () =>
        {
            const host = await makeUser();
            const table = await ports.table.create(host.id, { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] });

            expect(table.conversationId).toBeDefined();

            const first = await ports.chat.messages(host.id, table.conversationId!, undefined);

            for (const cursor of NOT_CURSORS)
            {
                expect(await ports.chat.messages(host.id, table.conversationId!, cursor), cursor).toEqual(first);
            }
        });

        it('reads the games somebody has finished from the newest', async () =>
        {
            const somebody = await makeUser();
            const first = await ports.match.history(somebody.id, null);

            for (const cursor of NOT_CURSORS)
            {
                expect(await ports.match.history(somebody.id, cursor), cursor).toEqual(first);
            }
        });

        it('is answered, never thrown, when it names a day the calendar does not have', async () =>
        {
            const host = await makeUser();
            const table = await ports.table.create(host.id, { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] });

            for (const cursor of DAYS_THAT_NEVER_WERE)
            {
                expect(await said(() => ports.notify.page(host.id, cursor)), cursor).toBe('answered');
                expect(await said(() => ports.chat.list(host.id, cursor)), cursor).toBe('answered');
                expect(await said(() => ports.chat.messages(host.id, table.conversationId!, cursor)), cursor).toBe('answered');
                expect(await said(() => ports.match.history(host.id, cursor)), cursor).toBe('answered');
            }
        });
    });
});
