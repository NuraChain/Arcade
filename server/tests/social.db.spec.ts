import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { createSocialService } from '../src/domains/social/service.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * The half of the social domain only a real Postgres can answer.
 *
 * Everything here is a claim about the DATABASE: that a friendship is mirrored, that two people
 * asking each other at the same instant produce one request rather than two, that a CHECK refuses
 * a minor who allows strangers, that blocking clears what it contradicts. A fake DataSource
 * cannot prove any of it - it would only prove that the fake agrees with the code.
 *
 * OPT-IN, because `npm test` promises to run with no Postgres on a laptop. Point
 * `TEST_DATABASE_URL` at a database you do not mind losing and run `npm run test:db`; every test
 * truncates first, so the suite owns whatever it is pointed at.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let social: ReturnType<typeof createSocialService>;

let seq = 0;

async function makeUser(options: { minor?: boolean; strangers?: boolean; online?: boolean } = {}): Promise<string>
{
    seq += 1;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind, is_minor, allow_stranger_messages, show_online, last_seen_at)
         values ($1, $2, $3, 'guest', $4, $5, $6, now())
         returning id`,
        [
            `t${ seq }x${ Math.floor(Math.random() * 100000) }`,
            `Test ${ seq }`,
            seq % 360,
            options.minor ?? false,
            options.minor === true ? false : (options.strangers ?? true),
            options.online ?? true
        ]
    );
    return rowsOf<{ id: string }>(rows)[0].id;
}

describe.skipIf(!active)('the social graph, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', url, entities, migrations, synchronize: false, logging: ['error'] });
        await db.initialize();
        await db.runMigrations();
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
        social = createSocialService(db);
    });

    it('writes both directions of a friendship, so neither side is a half-friend', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        await social.sendRequest(a, b);
        const { incoming } = await social.requests(b);
        await social.answerRequest(b, incoming[0].id, 'accepted');

        expect((await social.friends(a)).map((row) => row.id)).toEqual([b]);
        expect((await social.friends(b)).map((row) => row.id)).toEqual([a]);

        const rows = await db.query('select count(*)::int as n from friendships');
        expect(rowsOf<{ n: number }>(rows)[0].n).toBe(2);
    });

    it('turns two people asking each other at once into one friendship, not two requests', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];

        const [first, second] = await Promise.all([
            social.sendRequest(a, b).catch((error: Error) => error),
            social.sendRequest(b, a).catch((error: Error) => error)
        ]);

        // The invariant, not the timing. Serialized, the second call finds the first and accepts
        // it, leaving nothing pending; genuinely simultaneous, the loser hits the pair index and
        // swallows it, leaving the one request that already exists. Either way there is exactly
        // ONE row, and never two describing the same intention.
        const total = await db.query('select count(*)::int as n from friend_requests');
        expect(rowsOf<{ n: number }>(total)[0].n).toBe(1);

        const pending = await db.query('select count(*)::int as n from friend_requests where answered_at is null');
        expect(rowsOf<{ n: number }>(pending)[0].n).toBeLessThanOrEqual(1);

        const outcomes = [first, second].map((one) => (one instanceof Error ? 'error' : one.outcome));
        expect(outcomes).toContain('sent');
    });

    it('accepts the request already waiting instead of opening a second one', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        await social.sendRequest(a, b);

        const answer = await social.sendRequest(b, a);
        expect(answer.outcome).toBe('accepted');
        expect((await social.friends(a)).map((row) => row.id)).toEqual([b]);
    });

    it('refuses a second ask while the first is still open', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        await social.sendRequest(a, b);
        await expect(social.sendRequest(a, b)).rejects.toThrow();
    });

    it('lets the same pair ask again after a decline', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        await social.sendRequest(a, b);
        const { incoming } = await social.requests(b);
        await social.answerRequest(b, incoming[0].id, 'declined');

        await expect(social.sendRequest(a, b)).resolves.toEqual({ outcome: 'sent' });
    });

    it('will not let somebody answer a request that was not addressed to them', async () =>
    {
        const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
        await social.sendRequest(a, b);
        const { incoming } = await social.requests(b);

        await expect(social.answerRequest(c, incoming[0].id, 'accepted')).rejects.toThrow();
        expect(await social.friends(a)).toEqual([]);
    });

    it('clears the friendship and any pending request when somebody is blocked', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        await social.sendRequest(a, b);
        const { incoming } = await social.requests(b);
        await social.answerRequest(b, incoming[0].id, 'accepted');
        await social.sendRequest(a, b).catch(() => undefined);

        await social.block(a, b);

        expect(await social.friends(a)).toEqual([]);
        expect(await social.friends(b)).toEqual([]);
        const pending = await db.query('select count(*)::int as n from friend_requests where answered_at is null');
        expect(rowsOf<{ n: number }>(pending)[0].n).toBe(0);
    });

    it('makes a block symmetric even though only one side wrote it', async () =>
    {
        const [a, b] = [await makeUser(), await makeUser()];
        await social.block(a, b);

        expect((await social.relationOf(a, b)).relation).toBe('blocked');
        expect((await social.relationOf(b, a)).relation).toBe('blocked');
        expect(await social.mayMessage(b, a)).toBe('blocked');
        expect((await social.directory(b, 50)).map((row) => row.id)).not.toContain(a);
    });

    it('refuses to store a minor who allows stranger messages', async () =>
    {
        const child = await makeUser({ minor: true });
        await expect(db.query('update users set allow_stranger_messages = true where id = $1', [child]))
            .rejects.toThrow();
    });

    it('clamps a minor asking to be reachable, and answers with what was stored', async () =>
    {
        const child = await makeUser({ minor: true });
        const held = await social.setPrivacy(child, { allowStrangerMessages: true, showOnline: false });

        expect(held.allow_stranger_messages).toBe(false);
        expect(held.show_online).toBe(false);
    });

    it('enforces the three switches through the service, not through the caller', async () =>
    {
        const open = await makeUser();
        const closed = await makeUser({ strangers: false });
        const child = await makeUser({ minor: true });
        const stranger = await makeUser();

        expect(await social.mayMessage(stranger, open)).toBeNull();
        expect(await social.mayMessage(stranger, closed)).toBe('strangers-off');
        expect(await social.mayMessage(stranger, child)).toBe('minor-safety');
        expect(await social.mayMessage(child, stranger)).toBe('minor-safety');

        await social.sendRequest(stranger, closed);
        const { incoming } = await social.requests(closed);
        await social.answerRequest(closed, incoming[0].id, 'accepted');
        expect(await social.mayMessage(stranger, closed)).toBeNull();
    });

    it('hides presence exactly where the policy says it should', async () =>
    {
        const hidden = await makeUser({ online: false });
        const child = await makeUser({ minor: true });
        const stranger = await makeUser();

        expect(await social.maySeeOnline(stranger, hidden)).toBe(false);
        expect(await social.maySeeOnline(stranger, child)).toBe(false);

        await social.sendRequest(stranger, hidden);
        const { incoming } = await social.requests(hidden);
        await social.answerRequest(hidden, incoming[0].id, 'accepted');
        expect(await social.maySeeOnline(stranger, hidden)).toBe(true);
    });

    it('counts mutual friends, and suggests friends of friends before anyone else', async () =>
    {
        const [me, bridge, target, nobody] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];

        const befriend = async (x: string, y: string): Promise<void> =>
        {
            await social.sendRequest(x, y);
            const { incoming } = await social.requests(y);
            await social.answerRequest(y, incoming[0].id, 'accepted');
        };

        await befriend(me, bridge);
        await befriend(bridge, target);

        const mutual = await social.mutualWith(me, [target, nobody]);
        expect(mutual.get(target)).toBe(1);
        expect(mutual.get(nobody)).toBeUndefined();

        const suggestions = await social.suggestions(me, 10);
        expect(suggestions[0].person.id).toBe(target);
        expect(suggestions[0].mutual).toBe(1);
    });

    it('keeps one row per mute however many times it is set', async () =>
    {
        const me = await makeUser();
        await social.setMute(me, 'person', 'abc', true);
        await social.setMute(me, 'person', 'abc', true);
        await social.setMute(me, 'conversation', 'abc', true);

        expect(await social.mutes(me)).toEqual([
            { kind: 'person', id: 'abc' },
            { kind: 'conversation', id: 'abc' }
        ]);

        await social.setMute(me, 'person', 'abc', false);
        expect(await social.mutes(me)).toEqual([{ kind: 'conversation', id: 'abc' }]);
    });
});
