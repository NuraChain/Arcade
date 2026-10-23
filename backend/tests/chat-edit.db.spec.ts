import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { EDIT_HOURS } from '../src/domains/chat/edits.ts';
import { createFranking } from '../src/domains/chat/franking.ts';
import { createChatService, type SealedInput } from '../src/domains/chat/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

/**
 * A line changed by whoever wrote it: an edit is a sealed row about the line, handed to every reader
 * with it (the newest, and only the author's), counted as nothing new, kept to the line's own life,
 * and taken away with the line.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;
let chat: ReturnType<typeof createChatService>;
let seq = 0;

const changed: string[] = [];

const listener: WriteListener = {
    chatChanged: (conversationId) =>
    {
        changed.push(conversationId);
    },
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

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: ''
} as Parameters<typeof buildPorts>[1];

const NO_SESSION = '00000000-0000-4000-8000-000000000000';

const makeUser = async () =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `e${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Editor ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    return made.id;
};

const deviceOf = new Map<string, string>();
const seqOf = new Map<string, number>();
const minted = new Set<string>();

/** The envelope the schema requires and none of the cryptography, as `chat.db.spec.ts` does. */
const sealed = async (userId: string, conversationId: string, kind: SealedInput['kind'], body: string, options: { target?: string; expiresAt?: number; clientAt?: number } = {}): Promise<SealedInput> =>
{
    let device = deviceOf.get(userId);

    if (device === undefined)
    {
        device = `ed${ deviceOf.size.toString().padStart(20, '0') }`;
        await db.query(
            `insert into devices (id, user_id, label, exchange_key, signing_key, attested,
                                  attested_address, attested_message, attested_signature)
             values ($1, $2, 'Test', 'exchange', 'signing', 'wallet',
                     '0x0000000000000000000000000000000000000000', 'message', 'signature')`,
            [device, userId]
        );
        deviceOf.set(userId, device);
    }

    if (!minted.has(conversationId))
    {
        await db.query(
            `insert into conversation_epochs (conversation_id, epoch, minted_by, recipients, signature, confirmation)
             values ($1, 1, $2, $3, 'signature', 'confirmation')`,
            [conversationId, device, device]
        );
        minted.add(conversationId);
    }

    const key = `${ conversationId }:${ device }`;
    const next = (seqOf.get(key) ?? 0) + 1;

    seqOf.set(key, next);

    return {
        id: crypto.randomUUID(),
        epoch: 1,
        seq: next,
        iv: 'nonce',
        body,
        senderDeviceId: device,
        signature: 'signature',
        clientAt: new Date(options.clientAt ?? Date.now()).toISOString(),
        kind,
        ...(options.target === undefined ? {} : { target: options.target }),
        commitment: 'a-commitment',
        expiresAt: options.expiresAt ?? 0
    };
};

const say = async (userId: string, conversationId: string, body: string, options: { expiresAt?: number; clientAt?: number } = {}) =>
    chat.send(userId, conversationId, null, await sealed(userId, conversationId, 'text', body, options));

const amend = async (userId: string, conversationId: string, target: string, body: string, expiresAt = 0) =>
    chat.send(userId, conversationId, null, await sealed(userId, conversationId, 'edit', body, { target, expiresAt }));

const refusalOf = async (attempt: Promise<unknown>) =>
{
    try
    {
        await attempt;
        return null;
    }
    catch (error)
    {
        return { status: (error as { status?: number }).status ?? 0, message: (error as Error).message };
    }
};

const pageOf = async (reader: string, conversationId: string) => (await ports.chat.messages(reader, conversationId, undefined)).messages;

const rowOf = async (reader: string, conversationId: string) => (await ports.chat.list(reader)).conversations.find((row) => row.id === conversationId);

describe.skipIf(!active)('a line its author changes, against a real database', () =>
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
        minted.clear();
        changed.length = 0;
        chat = createChatService(db, createSocialService(db), createFranking(CONFIG.secret));
        ports = buildPorts(db, CONFIG, listener);
    });

    it('hands every reader the newest edit with its line, and never an edit as a line of its own', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const line = await say(a, room, 'first words');

        await amend(a, room, line.id, 'second words');
        await amend(a, room, line.id, 'third words');

        const page = await pageOf(b, room);

        expect(page.map((one) => one.body), 'one line, as it was written').toEqual(['first words']);
        expect(page[0].edits?.map((one) => [one.body, one.target, one.kind]), 'the newest edit, about it').toEqual([['third words', line.id, 'edit']]);
        expect(page[0].edits?.[0].senderAccountId, 'signed by whoever wrote the line').toBe(a);

        const row = await rowOf(b, room);

        expect(row?.last?.body, 'the list’s last line is the line').toBe('first words');
        expect(row?.last?.edits?.map((one) => one.body), 'with what it says now').toEqual(['third words']);
    });

    it('counts an edit as nothing unread, and moves no room up the list', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        const first = await chat.openDirect(a, b);
        const second = await chat.openDirect(c, b);
        const line = await say(a, first, 'an older line');

        await say(c, second, 'a newer line');
        await ports.chat.markRead(b, first);
        await ports.chat.markRead(b, second);
        await amend(a, first, line.id, 'an older line, changed');

        expect((await rowOf(b, first))?.unread, 'nothing new to read').toBe(0);
        expect((await ports.chat.list(b)).conversations.map((row) => row.id), 'the room with the newer line stays first').toEqual([second, first]);
    });

    it('refuses an edit of somebody else’s line, of a reaction, of a line in another room, of a deleted line and with nothing to edit, in one answer', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const elsewhere = await chat.openDirect(a, await makeUser());
        const theirs = await say(b, room, 'not yours');
        const mine = await say(a, room, 'yours');
        const reaction = await chat.send(a, room, null, await sealed(a, room, 'reaction', 'sealed emoji', { target: theirs.id }));
        const gone = await say(a, room, 'about to go');
        const away = await say(a, elsewhere, 'in another room');

        await chat.remove(a, room, gone.id);

        const attempts: Record<string, () => Promise<unknown>> = {
            'somebody else’s': () => amend(a, room, theirs.id, 'x'),
            'a reaction': () => amend(a, room, reaction.id, 'x'),
            'deleted': () => amend(a, room, gone.id, 'x'),
            'in another room': () => amend(a, room, away.id, 'x'),
            'no id at all': () => amend(a, room, 'not-an-id', 'x'),
            'nothing named': async () => chat.send(a, room, null, await sealed(a, room, 'edit', 'x'))
        };

        for (const [what, attempt] of Object.entries(attempts))
        {
            expect(await refusalOf(attempt()), what).toEqual({ status: 404, message: 'There is no line of yours here to edit.' });
        }

        expect(await refusalOf(amend(a, room, mine.id, 'fine')), 'the reader’s own line').toBeNull();
    });

    it('refuses an edit two days after the line, and of a line that has run out', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const old = await say(a, room, 'said long ago');
        const fresh = await say(a, room, 'said just now');
        const ended = await say(a, room, 'already gone');

        await db.query(`update messages set created_at = now() - make_interval(hours => $2) - interval '1 minute' where id = $1`, [old.id, EDIT_HOURS]);
        await db.query(`update messages set created_at = now() - make_interval(hours => $2) + interval '1 minute' where id = $1`, [fresh.id, EDIT_HOURS]);
        await db.query(`update messages set expires_at = now() - interval '1 minute' where id = $1`, [ended.id]);

        expect((await refusalOf(amend(a, room, old.id, 'too late')))?.status, 'two days and a minute').toBe(404);
        expect(await refusalOf(amend(a, room, fresh.id, 'just in time')), 'a minute short of two days').toBeNull();
        expect((await refusalOf(amend(a, room, ended.id, 'gone')))?.status, 'run out').toBe(404);
    });

    it('holds an edit to the life of the line it changes', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const lasting = await say(a, room, 'lasts');

        await chat.setExpiry(a, room, 3600);

        const at = Date.now();
        const passing = await say(a, room, 'passes', { clientAt: at, expiresAt: at + 3_600_000 });
        const life = passing.expires_at!.getTime();

        expect(await refusalOf(amend(a, room, passing.id, 'as long as it', life)), 'its own life').toBeNull();
        expect(await refusalOf(amend(a, room, passing.id, 'a second more', life + 1000)), 'longer').toEqual({ status: 403, message: 'An edit lasts exactly as long as the line it changes.' });
        expect((await refusalOf(amend(a, room, passing.id, 'for ever', 0)))?.status, 'for ever').toBe(403);
        expect(await refusalOf(amend(a, room, lasting.id, 'a line that lasts', 0)), 'a line that lasts, while the room’s lines now pass').toBeNull();
        expect((await refusalOf(amend(a, room, lasting.id, 'passing', Date.now() + 3_600_000)))?.status, 'a line that lasts, given an end').toBe(403);
    });

    it('takes a line’s edits away with it when it is deleted', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const line = await say(a, room, 'soon gone');

        await amend(a, room, line.id, 'soon gone, changed');
        await chat.remove(a, room, line.id);

        const left = await db.query('select count(*)::int as n from messages where target_id = $1', [line.id]) as { n: number }[];

        expect(left[0].n).toBe(0);
        expect((await pageOf(b, room)).map((one) => [one.kind, one.edits]), 'a tombstone with nothing about it').toEqual([['deleted', undefined]]);
    });

    it('hands nobody an edit of a line by anybody but whoever wrote it', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const line = await say(a, room, 'mine to change');
        const forged = await sealed(b, room, 'edit', 'words put in a mouth', { target: line.id });

        await db.query(
            `insert into messages (id, conversation_id, sender_id, kind, body, epoch, seq, iv, sender_device_id, signature, client_at, commitment, frank, target_id)
             values ($1, $2, $3, 'edit', $4, 1, $5, 'nonce', $6, 'signature', now(), 'a-commitment', 'frank', $7)`,
            [forged.id, room, b, forged.body, forged.seq, forged.senderDeviceId, line.id]
        );

        expect((await pageOf(a, room))[0].edits, 'with its line').toBeUndefined();
        expect((await rowOf(a, room))?.last?.edits, 'on the list').toBeUndefined();
    });

    it('rings the room for an edit and tells nobody about it', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const line = await say(a, room, 'a line');
        const before = await db.query('select count(*)::int as n from notifications where user_id = $1', [b]) as { n: number }[];

        changed.length = 0;
        await ports.chat.send(a, NO_SESSION, room, await sealed(a, room, 'edit', 'a line, changed', { target: line.id }));

        const after = await db.query('select count(*)::int as n from notifications where user_id = $1', [b]) as { n: number }[];

        expect(changed, 'everybody in the room reads it again').toEqual([room]);
        expect(after[0].n, 'and nobody is notified').toBe(before[0].n);
    });

    it('takes an edit as what a report may disclose', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        const room = await chat.openDirect(a, b);
        const line = await say(a, room, 'harmless at first');
        const edit = await amend(a, room, line.id, 'and then not');

        expect((await chat.frankedMessage(room, edit.id))?.body).toBe('and then not');
    });
});
