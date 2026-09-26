import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import { buildPorts, type Services } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

let db: DataSource;
let ports: Services;

const count = async (table: string): Promise<number> =>
    rowsOf<{ n: number }>(await db.query(`select count(*)::int as n from ${ table }`))[0].n;

describe.skipIf(!active)('housekeeping, against a real database', () =>
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

    it('drops what has run out and keeps what is still in use', async () =>
    {
        await db.query('truncate siwe_nonces, push_subscriptions, sessions, conversations cascade');
        await db.query('delete from users');

        const user = rowsOf<{ id: string }>(await db.query(
            `insert into users (handle, display_name, hue, kind) values ('tidy', 'Tidy', 1, 'guest') returning id`
        ))[0].id;

        await db.query(
            `insert into siwe_nonces (nonce, address, message, issued_at, expires_at)
             select 'n' || g, '0x0000000000000000000000000000000000000001', 'm', now() - interval '3 days', now() - (g || ' days')::interval
               from (values (0), (5)) as v(g)`
        );

        await db.query(
            `insert into push_subscriptions (user_id, endpoint, p256dh, auth, failed_at)
             values ($1, 'https://push.example/one', 'k', 'a', now()), ($1, 'https://push.example/two', 'k', 'a', null)`,
            [user]
        );

        await db.query(
            `insert into sessions (user_id, token_hash, expires_at)
             values ($1, repeat('a', 64), now() - interval '40 days'), ($1, repeat('b', 64), now() + interval '1 day')`,
            [user]
        );

        const gone = await ports.jobs.tidy();

        expect(gone.nonces).toBe(1);
        expect(await count('siwe_nonces')).toBe(1);
        expect(gone.pushes).toBe(1);
        expect(gone.sessions).toBe(1);
        expect(await count('push_subscriptions')).toBe(1);
        expect(await count('sessions')).toBe(1);
    });
});
