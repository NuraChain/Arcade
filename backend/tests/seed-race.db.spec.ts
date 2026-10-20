import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { GAME_SEEDS, seedReference } from '../src/db/seed-reference.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const PROBE = 'nura_seed_race_probe';

const ROUNDS = 8;

const probeUrl = () => new URL(url ?? '').toString().replace(/\/[^/]*$/, `/${ PROBE }`);

const at = (where = probeUrl()) => new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url: where, entities, synchronize: false, logging: [] });

let base: DataSource;
let one: DataSource;
let two: DataSource;

const emptied = async () =>
{
    await one.query(`delete from user_achievements`);
    await one.query(`delete from achievements`);
    await one.query(`delete from game_rules`);
    await one.query(`delete from games`);
};

const games = async () => (await one.query<{ count: number }[]>(`select count(*)::int as count from games`))[0].count;

describe.skipIf(!active)('two servers seeding one empty database at once', () =>
{
    beforeAll(async () =>
    {
        base = at(url);
        await base.initialize();
        await base.query(`drop database if exists ${ PROBE }`);
        await base.query(`create database ${ PROBE }`);

        one = at();
        await one.initialize();
        await syncSchema(one);

        two = at();
        await two.initialize();
    }, 180_000);

    afterAll(async () =>
    {
        for (const source of [one, two])
        {
            if (source?.isInitialized)
            {
                await source.destroy();
            }
        }

        if (base?.isInitialized)
        {
            await base.query(`drop database if exists ${ PROBE }`);
            await base.destroy();
        }
    }, 60_000);

    it('both finish, and the catalogue is there once', async () =>
    {
        for (let round = 0; round < ROUNDS; round += 1)
        {
            await emptied();

            const answers = await Promise.allSettled([seedReference(one), seedReference(two)]);

            expect(answers.map((answer) => answer.status), `round ${ round }`).toEqual(['fulfilled', 'fulfilled']);
            expect(await games(), `round ${ round }`).toBe(GAME_SEEDS.length);
        }
    }, 120_000);

    it('waits for a seed that is already under way', async () =>
    {
        await emptied();

        const holder = two.createQueryRunner();

        await holder.connect();
        await holder.startTransaction();

        let settled = false;

        try
        {
            await holder.query(`select pg_advisory_xact_lock(hashtext('nura:seed'))`);

            const seeding = seedReference(one).then(() =>
            {
                settled = true;
            });

            await vi.waitFor(async () =>
            {
                const waiting = await base.query<{ count: number }[]>(
                    `select count(*)::int as count from pg_stat_activity where datname = $1 and wait_event_type = 'Lock'`,
                    [PROBE]
                );

                expect(waiting[0].count).toBeGreaterThan(0);
            }, { timeout: 10_000, interval: 20 });

            expect(settled).toBe(false);
            expect(await games()).toBe(0);

            await holder.commitTransaction();
            await seeding;

            expect(await games()).toBe(GAME_SEEDS.length);
        }
        finally
        {
            if (holder.isTransactionActive)
            {
                await holder.rollbackTransaction();
            }

            await holder.release();
        }
    }, 60_000);
});
