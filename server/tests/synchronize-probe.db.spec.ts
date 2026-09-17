import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * What a `synchronize: true` schema would and would not be.
 *
 * This is here because "drop the migrations and let TypeORM synchronize" is a reasonable-sounding
 * idea that this schema cannot survive, and the argument should be a MEASUREMENT rather than an
 * opinion. It builds one database from the migration sequence and another from the entities alone,
 * and lists what the second is missing.
 *
 * The answer is not close. Five indexes cannot be expressed through `@Index` at all:
 *
 *   - `friend_requests_pending_pair` is UNIQUE over `LEAST(from_user, to_user)` and
 *     `GREATEST(from_user, to_user)` where the request is unanswered. It is a functional index, and
 *     it is the reason A asking B while B is asking A cannot become two rows describing one
 *     intention. Losing it does not degrade anything: it makes a documented guarantee false.
 *   - `messages_keyset`, `notifications_keyset`, `reports_against`, `groups_public` and
 *     `tables_open` order a column DESC. `@Index` takes column NAMES, so the direction is lost, and
 *     keyset pagination over chat history quietly stops using its index.
 *
 * And that is before the things `synchronize` is not FOR: the `citext` and `pgcrypto` extensions it
 * will not create, the data migrations in the sequence (`0003` turning stranger messages off for
 * every minor), the two hard cutovers (`0012` deleting pre-sealing rows, `0014` re-signing every
 * envelope), and the fact that it reconciles by DROPPING whatever the entities do not mention.
 *
 * So the 56 CHECK constraints are ported into the entities - they belong there, they make
 * `migration:generate` see the schema it really has, and they are the half of this that was worth
 * doing - and the migrations stay. This test is what stops that conclusion from rotting: if TypeORM
 * ever learns to express these, it goes green and the decision can be revisited with evidence.
 *
 * OPT-IN, like the other `.db.spec` suites. It needs two databases and creates the second itself.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

const PROBE = 'nura_synchronize_probe';

let migrated: DataSource;
let synchronized: DataSource;

const probeUrl = (): string => new URL(url ?? '').toString().replace(/\/[^/]*$/, `/${ PROBE }`);

interface NameRow { name: string }

async function indexNames(db: DataSource): Promise<Set<string>>
{
    const rows = rowsOf<NameRow>(await db.query(
        `select indexname as name from pg_indexes
          where schemaname = 'public' and indexname not like '%_pkey' and tablename <> 'migrations'`
    ));
    return new Set(rows.map((row) => row.name));
}

async function checkNames(db: DataSource): Promise<Set<string>>
{
    const rows = rowsOf<NameRow>(await db.query(
        `select c.conname as name
           from pg_constraint c
           join pg_class t on t.oid = c.conrelid
           join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'public' and c.contype = 'c'`
    ));
    return new Set(rows.map((row) => row.name));
}

describe.skipIf(!active)('what synchronize would build', () =>
{
    beforeAll(async () =>
    {
        migrated = new DataSource({ type: 'postgres', url, entities, migrations, synchronize: false, logging: ['error'] });
        await migrated.initialize();
        await migrated.runMigrations();

        await migrated.query(`drop database if exists ${ PROBE }`);
        await migrated.query(`create database ${ PROBE }`);

        synchronized = new DataSource({ type: 'postgres', url: probeUrl(), entities, synchronize: false, logging: ['error'] });
        await synchronized.initialize();

        // The extensions `synchronize` does not know it needs. Creating them by hand here is
        // itself part of the finding: a citext column cannot exist without this statement, and
        // nothing in the entities can carry it.
        await synchronized.query('create extension if not exists citext');
        await synchronized.query('create extension if not exists pgcrypto');
        await synchronized.synchronize();
    }, 120_000);

    afterAll(async () =>
    {
        if (synchronized?.isInitialized)
        {
            await synchronized.destroy();
        }
        if (migrated?.isInitialized)
        {
            await migrated.query(`drop database if exists ${ PROBE }`);
            await migrated.destroy();
        }
    });

    it('carries every CHECK constraint, because they are declared on the entities', async () =>
    {
        const want = await checkNames(migrated);
        const got = await checkNames(synchronized);

        const missing = [...want].filter((name) => !got.has(name)).sort();
        expect(missing, 'a CHECK the entities do not declare').toEqual([]);
    });

    /**
     * The measurement this file exists for. It asserts the CURRENT answer rather than the one
     * anybody wants, so the day it changes somebody has to come and read this.
     */
    it('cannot carry a functional index or a descending one', async () =>
    {
        const want = await indexNames(migrated);
        const got = await indexNames(synchronized);

        const missing = [...want].filter((name) => !got.has(name)).sort();

        // Everything expressible is declared on an entity now, so what is left is the list this
        // file's docblock names - and nothing else. A NEW name appearing here means somebody added
        // an index to a migration and not to its entity.
        expect(missing).toEqual([
            // Inexpressible, and each one is described in this file's docblock.
            'friend_requests_pending_pair',
            'groups_public',
            'messages_keyset',
            'notifications_keyset',
            'reports_against',
            'tables_open',

            // Present under a different NAME. These are Postgres's automatic names for a
            // column-level UNIQUE, and `@Column({ unique: true })` produces the same constraint
            // with TypeORM's own generated name - so the guarantee is there and the name is not,
            // which is a real difference for anything that mentions an index by name (`on
            // conflict on constraint`, an explain plan somebody is reading, a DROP in a
            // migration) and no difference at all to correctness.
            'games_slug_key',
            'push_subscriptions_endpoint_key',
            'sessions_token_hash_key',
            'users_handle_key',
            'wallets_address_key'
        ].sort());
    });
});
