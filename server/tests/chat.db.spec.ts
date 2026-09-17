import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, PAGE, pairKeyOf } from '../src/domains/chat/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { syncSchema } from '../src/db/schema.ts';

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
async function say(userId: string, conversationId: string, body: string): Promise<unknown>
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

    it('hides the conversation from both sides of a block, and gives it back on unblock', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);
        await say(a, conversation, 'hello');

        await social.block(a, b);
        expect(await chat.list(a)).toEqual([]);
        expect(await chat.list(b)).toEqual([]);
        await expect(chat.messages(b, conversation, null)).rejects.toThrow();

        await social.unblock(a, b);
        expect((await chat.list(a)).length).toBe(1);
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

        const forA = (await chat.list(a))[0];
        const forB = (await chat.list(b))[0];
        expect(forA.unread).toBe(2);
        expect(forB.unread).toBe(0);

        await chat.markRead(a, conversation);
        expect((await chat.list(a))[0].unread).toBe(0);
    });

    it('pins for one member and nobody else', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const conversation = await chat.openDirect(a, b);

        await chat.setPinned(a, conversation, true);
        expect((await chat.list(a))[0].pinned).toBe(true);
        expect((await chat.list(b))[0].pinned).toBe(false);
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

        const row = (await chat.list(a))[0];
        expect(row.last_body).toBe('the last word');
        expect(Array.isArray(row.members)).toBe(true);
        expect(row.members.length).toBe(2);
    });
});
