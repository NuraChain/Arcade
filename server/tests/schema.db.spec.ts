import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';
import snapshot from './schema-snapshot.json' with { type: 'json' };

/**
 * The schema `syncSchema` builds is the schema this product had when it was built by migrations.
 *
 * `tests/schema-snapshot.json` was recorded from a database built by the migration sequence on the
 * day the migrations were deleted. It is the frozen definition of "correct", and every part of it
 * has to survive the entities being the only source of truth:
 *
 *   - 27 tables, 213 columns with their types and nullability
 *   - 56 CHECK constraints, every one carrying a product rule
 *   - 43 foreign keys WITH their delete rules - 32 CASCADE and 8 SET NULL. These are behaviour, not
 *     hygiene: deleting an account has to take its devices, sessions and seats with it, and
 *     `reports.message_id ON DELETE SET NULL` is the rule that stops a reported disappearing
 *     message wedging the expiry sweep.
 *   - 39 indexes, six of which TypeORM cannot express and `syncSchema` creates by hand.
 *
 * A diff here means the entities and the recorded truth have parted company. Either the entity is
 * wrong, or the schema genuinely changed and the snapshot is what to re-record - deliberately, as
 * its own commit, so the change is visible rather than absorbed.
 *
 * OPT-IN, like the other `.db.spec` suites: `npm run test:db --workspace server` with
 * `TEST_DATABASE_URL` pointing at a database you do not mind losing.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

const PROBE = 'nura_schema_probe';

let base: DataSource;
let built: DataSource;

const probeUrl = (): string => new URL(url ?? '').toString().replace(/\/[^/]*$/, `/${ PROBE }`);

const pick = async (db: DataSource, sql: string): Promise<string[]> =>
    rowsOf<{ k: string }>(await db.query(sql)).map((row) => row.k).sort();

describe.skipIf(!active)('the schema the entities build', () =>
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

    it('creates every table, with every column at the right type, nullability and default', async () =>
    {
        expect(await pick(built, `select tablename as k from pg_tables where schemaname='public'`))
            .toEqual(snapshot.tables);

        expect(await pick(built, `select table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'-') as k
            from information_schema.columns where table_schema='public'`))
            .toEqual(snapshot.columns);
    });

    it('carries every CHECK constraint, with the same expression', async () =>
    {
        expect(await pick(built, `select c.conname||' :: '||pg_get_constraintdef(c.oid) as k
            from pg_constraint c join pg_class t on t.oid=c.conrelid
            join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='c'`))
            .toEqual(snapshot.checks);
    });

    it('carries every foreign key, with its delete rule', async () =>
    {
        expect(await pick(built, `select t.relname||' '||pg_get_constraintdef(c.oid) as k
            from pg_constraint c join pg_class t on t.oid=c.conrelid
            join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='f'`))
            .toEqual(snapshot.foreignKeys);
    });

    it('carries every primary key', async () =>
    {
        expect(await pick(built, `select t.relname||' '||pg_get_constraintdef(c.oid) as k
            from pg_constraint c join pg_class t on t.oid=c.conrelid
            join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='p'`))
            .toEqual(snapshot.primaryKeys);
    });

    /**
     * The six in `INDEXES_TYPEORM_CANNOT_EXPRESS` are the reason `syncSchema` exists rather than a
     * bare `synchronize()`. `friend_requests_pending_pair` is the sharpest: it is UNIQUE over
     * `LEAST(from_user, to_user)`/`GREATEST(...)` where the request is unanswered, and it is the
     * only thing stopping A asking B while B is asking A from becoming two rows for one intention.
     */
    it('carries every unique constraint', async () =>
    {
        expect(await pick(built, `select t.relname||' '||pg_get_constraintdef(c.oid) as k
            from pg_constraint c join pg_class t on t.oid=c.conrelid
            join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='u'`))
            .toEqual(snapshot.uniques);
    });

    /**
     * Compared by SHAPE, with the index name stripped out: TypeORM names what it generates
     * `PK_<hash>` and `UQ_<hash>`, so a name comparison would fail on every primary key while the
     * guarantee behind it is identical. What has to match is the table, the columns, the
     * uniqueness and the partial predicate.
     */
    it('carries every index by shape, whatever TypeORM decided to call it', async () =>
    {
        expect(await pick(built, `select tablename||' '||regexp_replace(indexdef, 'INDEX [^ ]+ ON', 'INDEX ON') as k
            from pg_indexes where schemaname='public'`))
            .toEqual(snapshot.indexShapes);
    });

    /**
     * The six in `INDEXES_TYPEORM_CANNOT_EXPRESS` are the reason `syncSchema` exists rather than a
     * bare `synchronize()`. `friend_requests_pending_pair` is the sharpest: it is UNIQUE over
     * `LEAST(from_user, to_user)`/`GREATEST(...)` where the request is unanswered, and it is the
     * only thing stopping A asking B while B is asking A from becoming two rows for one intention.
     * These keep their real names, because nothing renames them.
     */
    it('creates the six indexes no decorator can declare', async () =>
    {
        expect(await pick(built, `select indexname as k from pg_indexes where schemaname='public' and indexname in
            ('friend_requests_pending_pair','groups_public','messages_keyset','notifications_keyset','reports_against','tables_open')`))
            .toEqual(snapshot.handBuiltIndexes);
    });

    it('installs the extensions the columns are built on', async () =>
    {
        const present = await pick(built, `select extname as k from pg_extension`);
        expect(present).toContain('citext');
        expect(present).toContain('pgcrypto');
    });
});
