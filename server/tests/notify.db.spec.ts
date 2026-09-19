import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { createNotifyService, PAGE } from '../src/domains/notify/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { syncSchema } from '../src/db/schema.ts';

/**
 * The two claims a notification list lives or dies on: that twelve of the same thing is one row,
 * and that paging it does not repeat or skip while things keep arriving.
 *
 * Opt-in like the other database suites: `npm run test:db` with `TEST_DATABASE_URL`.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let notify: ReturnType<typeof createNotifyService>;
let social: ReturnType<typeof createSocialService>;

let seq = 0;

async function makeUser(): Promise<string>
{
    seq += 1;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind)
         values ($1, $2, $3, 'guest')
         returning id`,
        [`n${ seq }x${ Math.floor(Math.random() * 100000) }`, `Note ${ seq }`, seq % 360]
    );
    return rowsOf<{ id: string }>(rows)[0].id;
}

describe.skipIf(!active)('notifications, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
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
        await db.query('truncate notifications cascade');
        await db.query('delete from users');
        social = createSocialService(db);
        notify = createNotifyService(db, social);
    });

    /**
     * A path parameter is whatever somebody typed, and a uuid COLUMN raises 22P02 for anything that
     * is not one - which reaches a person as a 500 rather than as the nothing-happened it should be.
     * `POST /notifications/abc/read` was exactly that: a server error any signed-in caller could
     * produce from the address bar, on two routes.
     *
     * Asserted against a real Postgres because that is the only thing that raises 22P02; a fake
     * DataSource would accept the string and agree with the code about nothing.
     */
    describe('an id that is not a uuid', () =>
    {
        it('changes nothing instead of raising 22P02', async () =>
        {
            const me = await makeUser();

            for (const bad of ['abc', '', 'not-a-uuid', '00000000-0000-0000-0000-00000000000'])
            {
                await expect(notify.markRead(me, bad), `markRead accepted ${ bad }`).resolves.toBeUndefined();
                await expect(notify.dismiss(me, bad), `dismiss accepted ${ bad }`).resolves.toBeUndefined();
            }
        });

        it('still answers a well-formed id that is simply not mine', async () =>
        {
            const me = await makeUser();
            const absent = '11111111-2222-3333-4444-555555555555';

            await expect(notify.markRead(me, absent)).resolves.toBeUndefined();
            await expect(notify.dismiss(me, absent)).resolves.toBeUndefined();
        });
    });

    describe('the dedupe key', () =>
    {
        it('turns twelve of the same thing into one row that counts to twelve', async () =>
        {
            const reader = await makeUser();
            const writer = await makeUser();

            for (let index = 0; index < 12; index += 1)
            {
                await notify.tell({
                    userId: reader,
                    kind: 'message',
                    actorId: writer,
                    ref: { conversationId: 'c-1' },
                    dedupeKey: 'chat:c-1'
                });
            }

            const page = await notify.page(reader, null);
            expect(page.items.length).toBe(1);
            expect(page.items[0].count).toBe(12);
            expect(await notify.unread(reader)).toBe(1);
        });

        it('keeps two different conversations apart', async () =>
        {
            const reader = await makeUser();
            const writer = await makeUser();

            for (const conversationId of ['c-1', 'c-2'])
            {
                await notify.tell({
                    userId: reader,
                    kind: 'message',
                    actorId: writer,
                    ref: { conversationId },
                    dedupeKey: `chat:${ conversationId }`
                });
            }

            expect((await notify.page(reader, null)).items.length).toBe(2);
        });

        it('unreads a row that had been read, because it happened again', async () =>
        {
            const reader = await makeUser();
            const writer = await makeUser();

            await notify.tell({ userId: reader, kind: 'message', actorId: writer, ref: {}, dedupeKey: 'chat:c-1' });
            await notify.markAllRead(reader);
            expect(await notify.unread(reader)).toBe(0);

            await notify.tell({ userId: reader, kind: 'message', actorId: writer, ref: {}, dedupeKey: 'chat:c-1' });
            expect(await notify.unread(reader)).toBe(1);
            expect((await notify.page(reader, null)).items[0].count).toBe(2);
        });

        it('gives each recipient their own row', async () =>
        {
            const one = await makeUser();
            const two = await makeUser();
            const writer = await makeUser();

            await notify.tellAll([one, two], {
                kind: 'message',
                actorId: writer,
                ref: { conversationId: 'c-1' },
                dedupeKey: 'chat:c-1'
            });

            expect((await notify.page(one, null)).items.length).toBe(1);
            expect((await notify.page(two, null)).items.length).toBe(1);
        });
    });

    describe('who is told', () =>
    {
        it('never tells somebody about their own doing', async () =>
        {
            const me = await makeUser();

            expect(await notify.tell({ userId: me, kind: 'message', actorId: me, ref: {}, dedupeKey: 'chat:c-1' })).toBe(false);
            expect((await notify.page(me, null)).items.length).toBe(0);
        });

        it('says nothing about a person this account has muted', async () =>
        {
            const reader = await makeUser();
            const noisy = await makeUser();

            await social.setMute(reader, 'person', noisy, true);

            expect(await notify.tell({ userId: reader, kind: 'message', actorId: noisy, ref: {}, dedupeKey: 'chat:c-1' })).toBe(false);
            expect(await notify.unread(reader)).toBe(0);
        });

        it('says nothing about a muted conversation, however many people are in it', async () =>
        {
            const reader = await makeUser();
            const writer = await makeUser();
            const conversationId = '11111111-2222-3333-4444-555555555555';

            await social.setMute(reader, 'conversation', conversationId, true);

            expect(await notify.tell({
                userId: reader,
                kind: 'message',
                actorId: writer,
                ref: { conversationId },
                dedupeKey: `chat:${ conversationId }`
            })).toBe(false);
        });

        it('says nothing from somebody either side has blocked', async () =>
        {
            const reader = await makeUser();
            const blocked = await makeUser();

            await social.block(reader, blocked);

            expect(await notify.tell({ userId: reader, kind: 'friend-request', actorId: blocked, ref: {}, dedupeKey: 'friend:x' })).toBe(false);
        });

        it('refuses a reference field nobody declared', async () =>
        {
            const reader = await makeUser();
            const writer = await makeUser();

            await notify.tell({
                userId: reader,
                kind: 'message',
                actorId: writer,
                ref: { conversationId: 'c-1', text: 'Sara says: meet me at nine', evil: 'x' },
                dedupeKey: 'chat:c-1'
            });

            // The column is jsonb and would take the sentence. The closed set is what stops a
            // "structured" notification from carrying prose that cannot follow a language switch.
            const stored = (await notify.page(reader, null)).items[0].ref;
            expect(stored).toEqual({ conversationId: 'c-1' });
        });
    });

    describe('paging', () =>
    {
        it('walks the whole list by keyset without repeating or skipping one', async () =>
        {
            const reader = await makeUser();
            const writer = await makeUser();

            const total = PAGE + 12;
            for (let index = 0; index < total; index += 1)
            {
                await notify.tell({
                    userId: reader,
                    kind: 'message',
                    actorId: writer,
                    ref: { conversationId: `c-${ index }` },
                    dedupeKey: `chat:c-${ index }`
                });
            }

            const first = await notify.page(reader, null);
            expect(first.items.length).toBe(PAGE);
            expect(first.hasMore).toBe(true);

            const oldest = first.items[first.items.length - 1];
            const second = await notify.page(reader, { at: oldest.created_at, id: oldest.id });

            expect(second.items.length).toBe(12);
            expect(second.hasMore).toBe(false);

            const ids = [...first.items, ...second.items].map((item) => item.id);
            expect(new Set(ids).size).toBe(total);
        });

        it('shows the newest first, and a bumped row counts as new', async () =>
        {
            const reader = await makeUser();
            const writer = await makeUser();

            await notify.tell({ userId: reader, kind: 'message', actorId: writer, ref: {}, dedupeKey: 'chat:old' });
            await notify.tell({ userId: reader, kind: 'message', actorId: writer, ref: {}, dedupeKey: 'chat:new' });
            await notify.tell({ userId: reader, kind: 'message', actorId: writer, ref: {}, dedupeKey: 'chat:old' });

            const page = await notify.page(reader, null);
            expect(page.items.length).toBe(2);
            expect(page.items[0].count).toBe(2);
        });

        it('is mine, and only mine', async () =>
        {
            const mine = await makeUser();
            const theirs = await makeUser();
            const writer = await makeUser();

            await notify.tell({ userId: theirs, kind: 'message', actorId: writer, ref: {}, dedupeKey: 'chat:c-1' });

            const page = await notify.page(mine, null);
            expect(page.items.length).toBe(0);

            // And a read or a dismissal of somebody else's row does nothing at all.
            const theirRow = (await notify.page(theirs, null)).items[0];
            await notify.markRead(mine, theirRow.id);
            await notify.dismiss(mine, theirRow.id);
            expect((await notify.page(theirs, null)).items[0].read_at).toBeNull();
        });
    });

    describe('push subscriptions', () =>
    {
        it('keys on the endpoint, so one browser is one row however often it re-subscribes', async () =>
        {
            const me = await makeUser();

            for (const agent of ['first', 'second', 'third'])
            {
                await notify.subscribe(me, { endpoint: 'https://push.example.com/a', p256dh: 'k', auth: 'a', userAgent: agent });
            }

            const live = await notify.subscriptionsOf(me);
            expect(live.length).toBe(1);
        });

        it('follows the account that claimed the endpoint last', async () =>
        {
            const one = await makeUser();
            const two = await makeUser();

            await notify.subscribe(one, { endpoint: 'https://push.example.com/a', p256dh: 'k', auth: 'a', userAgent: '' });
            await notify.subscribe(two, { endpoint: 'https://push.example.com/a', p256dh: 'k', auth: 'a', userAgent: '' });

            expect((await notify.subscriptionsOf(one)).length).toBe(0);
            expect((await notify.subscriptionsOf(two)).length).toBe(1);
        });

        it('stops offering one the push service says is gone', async () =>
        {
            const me = await makeUser();
            await notify.subscribe(me, { endpoint: 'https://push.example.com/a', p256dh: 'k', auth: 'a', userAgent: '' });

            const [subscription] = await notify.subscriptionsOf(me);
            await notify.retire(subscription.id);

            expect((await notify.subscriptionsOf(me)).length).toBe(0);
        });
    });
});
