import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services } from '../src/services.ts';
import { createSocialService } from '../src/domains/social/service.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;
let social: ReturnType<typeof createSocialService>;

let seq = 0;

async function makeUser(): Promise<{ id: string; handle: string }>
{
    seq += 1;

    const handle = `seen${ seq }x${ Math.floor(Math.random() * 100000) }`;
    const rows = await db.query(
        `insert into users (handle, display_name, hue) values ($1, $2, $3) returning id`,
        [handle, `Seen ${ seq }`, seq % 360]
    );

    return { id: rowsOf<{ id: string }>(rows)[0].id, handle };
}

const seenAt = async (id: string) =>
{
    const rows = rowsOf<{ at: Date | null; ago: number | null }>(await db.query(
        `select last_seen_at as at, extract(epoch from now() - last_seen_at)::float as ago from users where id = $1`,
        [id]
    ));

    return rows[0];
};

describe.skipIf(!active)('when somebody was last seen, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        social = createSocialService(db);
        ports = buildPorts(db, { secret: 'a-test-secret-that-is-long-enough-to-use', origin: 'http://localhost:1', env: 'test' } as Parameters<typeof buildPorts>[1]);
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
        await db.query('truncate friendships, notifications, mutes cascade');
        await db.query('delete from users');
    });

    it('writes the moment somebody leaves however recently they were touched, and nobody else', async () =>
    {
        const alex = await makeUser();
        const sara = await makeUser();

        await db.query(`update users set last_seen_at = now() - interval '10 seconds' where id = $1`, [alex.id]);

        expect(await social.touchSeen([alex.id]), 'a touch within the minute is coalesced').toBe(0);
        expect((await seenAt(alex.id)).ago).toBeGreaterThanOrEqual(9);

        expect(await social.lastSeen([alex.id])).toBe(1);
        expect((await seenAt(alex.id)).ago, 'the moment they left, by Postgres').toBeLessThan(2);
        expect((await seenAt(sara.id)).at, 'nobody else is written').toBeNull();
    });

    it('writes nothing for nobody', async () =>
    {
        await makeUser();

        expect(await social.lastSeen([])).toBe(0);
    });

    it('is the moment a friend is told, and a stranger is told it only where they may see it', async () =>
    {
        const alex = await makeUser();
        const friend = await makeUser();
        const stranger = await makeUser();

        await db.query(`insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1)`, [alex.id, friend.id]);
        await social.lastSeen([alex.id]);

        const stored = (await seenAt(alex.id)).at!.toISOString();

        expect((await ports.social.view(friend.id, alex.handle))?.person.lastSeenAt).toBe(stored);
        expect((await ports.social.view(stranger.id, alex.handle))?.person.lastSeenAt).toBe(stored);

        await db.query(`update users set show_online = false where id = $1`, [alex.id]);

        expect((await ports.social.view(friend.id, alex.handle))?.person.lastSeenAt, 'a friend still sees it').toBe(stored);
        expect((await ports.social.view(stranger.id, alex.handle))?.person, 'hidden from a stranger, absent rather than null').not.toHaveProperty('lastSeenAt');
    });
});
