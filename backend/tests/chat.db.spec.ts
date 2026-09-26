import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, PAGE, pairKeyOf } from '../src/domains/chat/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';

/**
 * The chat claims only Postgres can settle: the keyset, the exclusive-or, the pair race, and
 * whose watermark is whose.
 *
 * Opt-in, exactly like `social.db.spec.ts`: `npm run test:db` with `TEST_DATABASE_URL`.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let chat: ReturnType<typeof createChatService>;
let social: ReturnType<typeof createSocialService>;

let seq = 0;

async function makeUser(options: { strangers?: boolean } = {}): Promise<string>
{
    seq += 1;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind, allow_stranger_messages)
         values ($1, $2, $3, 'guest', $4)
         returning id`,
        [`c${ seq }x${ Math.floor(Math.random() * 100000) }`, `Chat ${ seq }`, seq % 360, options.strangers ?? true]
    );
    return rowsOf<{ id: string }>(rows)[0].id;
}

async function befriend(a: string, b: string): Promise<void>
{
    await social.sendRequest(a, b);
    const { incoming } = await social.requests(b);
    await social.answerRequest(b, incoming[0].id, 'accepted');
}

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const mintedIn = new Set<string>();

/**
 * Says something, with the envelope the schema now requires and none of the cryptography.
 *
 * This suite is about the READS - the keyset, the watermark, the exclusive-or, the pair race - and
 * every one of those is indifferent to whether the body is ciphertext. Standing up real keys for
 * each would make the tests slower and no more true, so the device and the epoch are written
 * directly and the body goes in as itself. `epochs.db.spec.ts` owns the key schedule, with real
 * devices and the real service, and this borrows nothing from it.
 */
async function say(userId: string, conversationId: string, body: string, reactTo?: string): Promise<{ id: string }>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `dev${ deviceOf.size.toString().padStart(19, '0') }`;
        await db.query(
            `insert into devices (id, user_id, label, exchange_key, signing_key, attested, confirmed_at)
             values ($1, $2, 'Test', 'exchange', 'signing', 'server', now())`,
            [device, userId]
        );
        deviceOf.set(userId, device);
    }

    if (!mintedIn.has(conversationId))
    {
        await db.query(
            `insert into conversation_epochs (conversation_id, epoch, minted_by, recipients, signature, confirmation)
             values ($1, 1, $2, $3, 'signature', 'confirmation')`,
            [conversationId, device, device]
        );
        mintedIn.add(conversationId);
    }

    const key = `${ conversationId }:${ device }`;
    const next = (seqOf.get(key) ?? 0) + 1;
    seqOf.set(key, next);

    return chat.send(userId, conversationId, device, {
        id: crypto.randomUUID(),
        epoch: 1,
        seq: next,
        iv: 'nonce',
        body,
        senderDeviceId: device,
        signature: 'signature',
        clientAt: new Date().toISOString(),
        ...(reactTo === undefined ? { kind: 'text' as const } : { kind: 'reaction' as const, target: reactTo }),
        commitment: 'a-commitment',
        expiresAt: 0
    });
}

describe.skipIf(!active)('chat, against a real database', () =>
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
        await db.query('truncate users cascade');
        await db.query('truncate conversations cascade');
        deviceOf.clear();
        seqOf.clear();
        mintedIn.clear();
        social = createSocialService(db);
        chat = createChatService(db, social, createFranking('test-secret'));
    });

    it('opens one conversation for a pair, whichever of them asks first', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];

        const [first, second] = await Promise.all([chat.openDirect(a, b), chat.openDirect(b, a)]);
        expect(first).toBe(second);

        const rows = await db.query('select count(*)::int as n from conversations');
        expect(rowsOf<{ n: number }>(rows)[0].n).toBe(1);
    });

    it('builds the pair key the same way whichever order it is given', () =>
    {
        expect(pairKeyOf('b', 'a')).toBe(pairKeyOf('a', 'b'));
    });

    it('refuses to open a conversation the policy would not allow', async () =>
    {
        const closed = await makeUser({ strangers: false });
        const stranger = await makeUser();

        await expect(chat.openDirect(stranger, closed)).rejects.toThrow();

        await befriend(stranger, closed);
        await expect(chat.openDirect(stranger, closed)).resolves.toBeTypeOf('string');
    });

    it('checks the policy again on every send, not only when the thread was opened', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        await say(a, conversation, 'still here?');

        await social.setPrivacy(b, { allowStrangerMessages: false, showOnline: true });
        await expect(say(a, conversation, 'hello?')).rejects.toThrow();

        await befriend(a, b);
        await expect(say(a, conversation, 'now?')).resolves.toBeDefined();
    });

    it('answers a conversation somebody is not in exactly as one that does not exist', async () =>
    {
        const [a, b, stranger] = [await makeUser(), await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await expect(chat.messages(stranger, conversation, null)).rejects.toThrow('No conversation with that id.');
        await expect(chat.messages(stranger, '00000000-0000-0000-0000-000000000000', null)).rejects.toThrow('No conversation with that id.');
    });

    it('lists every pinned room and the sixty most recent, and pages the rest without repeating one', async () =>
    {
        const me = await makeUser();
        const rooms: string[] = [];

        for (let index = 0; index < 63; index += 1)
        {
            rooms.push(await chat.openDirect(me, await makeUser()));
        }
        await say(me, rooms[5], 'the newest');
        await chat.setPinned(me, rooms[0], true);

        const first = await chat.list(me, null, 60);
        const unpinned = first.rows.filter((row) => !row.pinned);

        expect(first.rows.length).toBe(61);
        expect(first.more).toBe(true);
        expect(first.rows[0].id).toBe(rooms[0]);
        expect(unpinned[0].id).toBe(rooms[5]);

        const last = unpinned[unpinned.length - 1];
        const second = await chat.list(me, { at: last.last_at, id: last.id }, 60);
        const seen = new Set([...first.rows, ...second.rows].map((row) => row.id));

        expect(second.more).toBe(false);
        expect(second.rows.length).toBe(2);
        expect(second.rows.some((row) => row.pinned)).toBe(false);
        expect(seen.size).toBe(63);
    });

    it('hides the conversation from both sides of a block, and gives it back on unblock', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        await say(a, conversation, 'hello');

        await social.block(a, b);
        expect((await chat.list(a)).rows).toEqual([]);
        expect((await chat.list(b)).rows).toEqual([]);
        await expect(chat.messages(b, conversation, null)).rejects.toThrow();

        await social.unblock(a, b);
        expect(((await chat.list(a)).rows).length).toBe(1);
    });

    it('refuses a message that is words AND a payload, or neither', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await expect(db.query(
            `insert into messages (conversation_id, sender_id, kind, body, payload)
             values ($1, $2, 'text', 'hello', '{"key":"x"}'::jsonb)`,
            [conversation, a]
        )).rejects.toThrow();

        await expect(db.query(
            `insert into messages (conversation_id, sender_id, kind) values ($1, $2, 'text')`,
            [conversation, a]
        )).rejects.toThrow();

        await expect(db.query(
            `insert into messages (conversation_id, kind, body) values ($1, 'system', 'the server said so')`,
            [conversation]
        )).rejects.toThrow();
    });

    it('lets the server author a line with no author at all', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        const line = await chat.post(conversation, 'system', { key: 'chat.line.system', params: {} }, null);
        expect(line.sender).toBeNull();
        expect(line.body).toBeNull();
        expect(line.payload).toEqual({ key: 'chat.line.system', params: {} });
    });

    it('counts unread against MY watermark, and saying something reads it', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await say(b, conversation, 'one');
        await say(b, conversation, 'two');

        const forA = ((await chat.list(a)).rows)[0];
        const forB = ((await chat.list(b)).rows)[0];
        expect(forA.unread).toBe(2);
        expect(forB.unread).toBe(0);

        await chat.markRead(a, conversation);
        expect(((await chat.list(a)).rows)[0].unread).toBe(0);
    });

    it('pins for one member and nobody else', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await chat.setPinned(a, conversation, true);
        expect(((await chat.list(a)).rows)[0].pinned).toBe(true);
        expect(((await chat.list(b)).rows)[0].pinned).toBe(false);
    });

    it('walks history by keyset, without repeating or skipping a line', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        const total = PAGE + 15;
        for (let index = 0; index < total; index += 1)
        {
            await say(index % 2 === 0 ? a : b, conversation, `line ${ index }`);
        }

        const first = await chat.messages(a, conversation, null);
        expect(first.messages.length).toBe(PAGE);
        expect(first.hasMore).toBe(true);

        const oldest = first.messages[0];
        const second = await chat.messages(a, conversation, { at: oldest.created_at, id: oldest.id });
        expect(second.messages.length).toBe(15);
        expect(second.hasMore).toBe(false);

        const seen = [...second.messages, ...first.messages].map((message) => message.body);
        expect(new Set(seen).size).toBe(total);
        expect(seen[0]).toBe('line 0');
        expect(seen[seen.length - 1]).toBe(`line ${ total - 1 }`);
    });

    it('answers as much history as the reader has already scrolled through, in one read', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        const total = PAGE + 15;
        for (let index = 0; index < total; index += 1)
        {
            await say(a, conversation, `line ${ index }`);
        }

        const deeper = await chat.messages(a, conversation, null, PAGE + 10);
        expect(deeper.messages.length).toBe(PAGE + 10);
        expect(deeper.hasMore).toBe(true);
        expect(deeper.messages[deeper.messages.length - 1].body).toBe(`line ${ total - 1 }`);

        const everything = await chat.messages(a, conversation, null, total);
        expect(everything.messages.length).toBe(total);
        expect(everything.hasMore).toBe(false);
        expect(everything.messages[0].body).toBe('line 0');
    });

    it('keeps a page stable while the other end is being written to', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        for (let index = 0; index < PAGE + 5; index += 1)
        {
            await say(a, conversation, `old ${ index }`);
        }

        const first = await chat.messages(a, conversation, null);
        const oldest = first.messages[0];

        // Somebody says something while the reader is scrolling up. An OFFSET page would shift
        // by one and repeat a line; the keyset does not move.
        await say(b, conversation, 'arriving now');

        const second = await chat.messages(a, conversation, { at: oldest.created_at, id: oldest.id });
        expect(second.messages.map((message) => message.body)).toEqual(['old 0', 'old 1', 'old 2', 'old 3', 'old 4']);
    });

    it('puts the last message and the member handles on the list row', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        await say(b, conversation, 'the last word');

        const row = ((await chat.list(a)).rows)[0];
        expect(row.last_body).toBe('the last word');
        expect(Array.isArray(row.members)).toBe(true);
        expect(row.members.length).toBe(2);
    });

    it('refuses a line at a table whose host turned the chat off, and says so on the list row', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = async (chatOn: boolean): Promise<string> =>
        {
            const table = rowsOf<{ id: string }>(await db.query(
                `insert into tables (game, code, host_id, seats, mode, privacy, target, cube, blinds, chat, voice)
                 values ('ludo', $2, $1, 2, 'live', 'public', 0, false, 'low', $3, false)
                 returning id`,
                [a, `q${ Math.floor(Math.random() * 1000000) }`, chatOn]
            ))[0].id;
            const conversation = rowsOf<{ id: string }>(await db.query(
                `insert into conversations (kind, table_id, game) values ('game', $1, 'ludo') returning id`,
                [table]
            ))[0].id;
            await db.query(
                'insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)',
                [conversation, a, b]
            );
            return conversation;
        };

        const quiet = await room(false);
        const talking = await room(true);

        await expect(say(b, quiet, 'hello')).rejects.toThrow('Chat is off at this table.');
        await expect(say(b, talking, 'hello')).resolves.toBeDefined();

        const rows = (await chat.list(a)).rows;
        expect(rows.find((row) => row.id === quiet)?.quiet).toBe(true);
        expect(rows.find((row) => row.id === talking)?.quiet).toBe(false);
    });

    it('carries a reaction on its target and never as a line of its own', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        const said = await say(a, conversation, 'good game');
        const reaction = await say(b, conversation, 'sealed-emoji', said.id);

        const page = await chat.messages(a, conversation, null);

        expect(page.messages.map((row) => row.id)).toEqual([said.id]);
        expect(page.reactions.map((row) => [row.id, row.target_id, row.kind])).toEqual([[reaction.id, said.id, 'reaction']]);
    });

    it('refuses a reaction to nothing, to a line, or to a message in another room', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const here = await chat.openDirect(a, b);
        const elsewhere = await chat.openDirect(a, c);
        const there = await say(a, elsewhere, 'over there');

        await expect(say(b, here, 'x', crypto.randomUUID())).rejects.toThrow('There is no such message here to react to.');
        await expect(say(b, here, 'x', 'not-a-uuid')).rejects.toThrow('There is no such message here to react to.');
        await expect(say(b, here, 'x', there.id)).rejects.toThrow('There is no such message here to react to.');
    });

    it('does not count a reaction as unread, nor show it as the last thing said', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        await say(a, conversation, 'first');
        const second = await say(b, conversation, 'second');
        await chat.markRead(a, conversation);
        await say(b, conversation, 'sealed-emoji', second.id);

        const row = ((await chat.list(a)).rows).find((one) => one.id === conversation)!;

        expect(row.unread).toBe(0);
        expect(row.last_id).toBe(second.id);
    });

    it('lets only the author delete, leaves a tombstone, and takes the reactions with it', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        const said = await say(a, conversation, 'regrettable');
        await say(b, conversation, 'sealed-emoji', said.id);

        await expect(chat.remove(b, conversation, said.id)).rejects.toThrow('No such message of yours here.');
        expect(await chat.remove(a, conversation, said.id)).toBe('deleted');

        const rows = rowsOf<{ kind: string; body: string | null; signature: string | null; seq: string | null }>(
            await db.query('select kind, body, signature, seq from messages where id = $1', [said.id])
        );
        expect(rows).toEqual([{ kind: 'deleted', body: null, signature: null, seq: '1' }]);

        const page = await chat.messages(a, conversation, null);
        expect(page.messages.map((row) => row.kind)).toEqual(['deleted']);
        expect(page.reactions).toEqual([]);

        const reactions = await db.query(`select count(*)::int as n from messages where kind = 'reaction'`);
        expect(rowsOf<{ n: number }>(reactions)[0].n).toBe(0);

        const row = ((await chat.list(b)).rows).find((one) => one.id === conversation)!;
        expect(row.last_id).toBeNull();
    });

    it('takes a reaction back outright', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        const said = await say(a, conversation, 'hello');
        const reaction = await say(b, conversation, 'sealed-emoji', said.id);

        expect(await chat.remove(b, conversation, reaction.id)).toBe('withdrawn');
        expect((await chat.messages(a, conversation, null)).reactions).toEqual([]);
    });
});
