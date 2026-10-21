import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { buildPorts } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const named = (applicationName: string, at = url) =>
    new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url: at, entities, synchronize: false, logging: ['error'], applicationName });

const maintenance = url?.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');

const config = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: ''
} as Parameters<typeof buildPorts>[1];

describe.skipIf(!active)('the other servers using the database', () =>
{
    let mine: DataSource;

    beforeAll(async () =>
    {
        mine = named('baziche mine');
        await mine.initialize();
        await syncSchema(mine);
    }, 60_000);

    afterAll(async () =>
    {
        if (mine?.isInitialized)
        {
            await mine.destroy();
        }
    });

    it('are counted by the name their connections carry, never this server itself, and each one once', async () =>
    {
        const ports = buildPorts(mine, config);
        const other = named('baziche other');
        const third = named('baziche third');
        const tool = named('psql');
        const elsewhere = named('baziche elsewhere', maintenance);

        expect(await ports.jobs.otherServers()).toBe(0);

        await other.initialize();
        await tool.initialize();
        await elsewhere.initialize();

        try
        {
            await Promise.all([other.query('select pg_sleep(0.2)'), other.query('select pg_sleep(0.2)'), tool.query('select 1'), elsewhere.query('select 1')]);

            expect(await ports.jobs.otherServers()).toBe(1);

            await third.initialize();
            await third.query('select 1');

            expect(await ports.jobs.otherServers()).toBe(2);
        }
        finally
        {
            await other.destroy();
            await tool.destroy();
            await elsewhere.destroy();

            if (third.isInitialized)
            {
                await third.destroy();
            }
        }

        await expect.poll(() => ports.jobs.otherServers(), { timeout: 5000 }).toBe(0);
    });
});
