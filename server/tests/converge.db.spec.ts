import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema, INDEXES_TYPEORM_CANNOT_EXPRESS } from '../src/db/schema.ts';

/**
 * `syncSchema` settles. Running it again finds almost nothing left to do.
 *
 * This matters because it runs on EVERY development boot. A sync that never converges is one that
 * rewrites part of the schema every time the server starts, and the day one of those rewrites is
 * destructive rather than idempotent, nobody would notice it had been happening all along.
 *
 * Two differences are expected, and both are listed here rather than waved through, so a THIRD one
 * appearing fails this test:
 *
 *  - The seven DESC indexes get dropped and rebuilt. TypeORM cannot express a descending index, so
 *    it does not know they are wanted and removes them as strays; `syncSchema` puts them back
 *    afterwards, which is why the order inside it matters. `friend_requests_pending_pair` survives
 *    because it is functional and TypeORM leaves it alone.
 *  - `conversation_members.last_read_at` re-issues its default. TypeORM compares column defaults as
 *    strings and Postgres renders `to_timestamp(0)` back as `to_timestamp((0)::double precision)`,
 *    so no spelling of it ever compares equal. The statement sets the value it already has.
 *
 * OPT-IN, like the other `.db.spec` suites.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

const PROBE = 'nura_converge_probe';

let base: DataSource;
let built: DataSource;

const probeUrl = (): string => new URL(url ?? '').toString().replace(/\/[^/]*$/, `/${ PROBE }`);

describe.skipIf(!active)('syncSchema settles', () =>
{
    beforeAll(async () =>
    {
        base = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await base.initialize();
        await base.query(`drop database if exists ${ PROBE }`);
        await base.query(`create database ${ PROBE }`);

        built = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url: probeUrl(), entities, synchronize: false, logging: ['error'] });
        await built.initialize();
        await syncSchema(built);
    }, 180_000);

    afterAll(async () =>
    {
        if (built?.isInitialized)
        {
            await built.destroy();
        }
        if (base?.isInitialized)
        {
            await base.query(`drop database if exists ${ PROBE }`);
            await base.destroy();
        }
    });

    it('has nothing to change on a second pass beyond the two known wrinkles', async () =>
    {
        const plan = await built.driver.createSchemaBuilder().log();
        const pending = plan.upQueries.map((query) => query.query);

        const dropped = pending.filter((query) => query.startsWith('DROP INDEX')).sort();
        const rest = pending.filter((query) => !query.startsWith('DROP INDEX'));

        expect(dropped).toEqual([
            'DROP INDEX "public"."groups_public"',
            'DROP INDEX "public"."match_actions_feed"',
            'DROP INDEX "public"."matches_finished"',
            'DROP INDEX "public"."matches_history"',
            'DROP INDEX "public"."messages_keyset"',
            'DROP INDEX "public"."notifications_keyset"',
            'DROP INDEX "public"."reports_against"',
            'DROP INDEX "public"."tables_open"'
        ].sort());

        expect(rest).toEqual([
            'ALTER TABLE "conversation_members" ALTER COLUMN "last_read_at" SET DEFAULT to_timestamp((0)::double precision)'
        ]);
    });

    it('still has every hand-built index after a second sync', async () =>
    {
        await syncSchema(built);

        const names = ((await built.query(
            `select indexname as k from pg_indexes where schemaname = 'public'`
        )) as { k: string }[]).map((row) => row.k);

        for (const statement of INDEXES_TYPEORM_CANNOT_EXPRESS)
        {
            const name = /if not exists (\w+)/.exec(statement)?.[1];
            expect(names, `${ name } did not survive a second sync`).toContain(name);
        }
    });
});
