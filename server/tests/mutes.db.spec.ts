import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services } from '../src/services.ts';
import { createNotifyService } from '../src/domains/notify/service.ts';
import { createSocialService } from '../src/domains/social/service.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;

let seq = 0;

async function makeUser(): Promise<{ id: string; handle: string }>
{
    seq += 1;

    const handle = `m${ seq }x${ Math.floor(Math.random() * 100000) }`;
    const rows = await db.query(
        `insert into users (handle, display_name, hue, kind) values ($1, $2, $3, 'guest') returning id`,
        [handle, `Mute ${ seq }`, seq % 360]
    );

    return { id: rowsOf<{ id: string }>(rows)[0].id, handle };
}

describe.skipIf(!active)('a mute asked for at the edge, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
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
        await db.query('truncate notifications, mutes, conversations cascade');
        await db.query('delete from users');
    });

    it('silences a person named by their handle, and says the handle back', async () =>
    {
        const reader = await makeUser();
        const noisy = await makeUser();

        await ports.social.setMute(reader.id, 'person', noisy.handle, true);

        const notify = createNotifyService(db, createSocialService(db));

        expect(await notify.tell({ userId: reader.id, kind: 'friend-request', actorId: noisy.id, ref: {}, dedupeKey: `friend:${ noisy.id }` })).toBe(false);
        expect((await ports.social.graph(reader.id)).mutes).toEqual([{ kind: 'person', id: noisy.handle }]);

        await ports.social.setMute(reader.id, 'person', noisy.handle, false);

        expect((await ports.social.graph(reader.id)).mutes).toEqual([]);
    });

    it('refuses a handle nobody holds rather than muting a string', async () =>
    {
        const reader = await makeUser();

        await expect(ports.social.setMute(reader.id, 'person', 'nobody-at-all', true)).rejects.toThrow();
    });
});
