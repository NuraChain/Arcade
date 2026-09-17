import 'reflect-metadata';

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { rowsOf } from '../src/lib/rows.ts';

const url = process.env.TEST_DATABASE_URL;
const active = (url !== undefined && url !== '') && process.env.RECORD_SNAPSHOT === '1';

const PROBE = 'nura_record_probe';

let base: DataSource;
let built: DataSource;

const probeUrl = (): string => new URL(url ?? '').toString().replace(/\/[^/]*$/, `/${ PROBE }`);

const pick = async (db: DataSource, sql: string): Promise<string[]> =>
    rowsOf<{ k: string }>(await db.query(sql)).map((row) => row.k).sort();

describe.skipIf(!active)('recording', () =>
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

    it('writes schema-snapshot.json from the schema the entities build', async () =>
    {
        const snapshot = {
            tables: await pick(built, `select tablename as k from pg_tables where schemaname='public'`),
            columns: await pick(built, `select table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'-') as k
                from information_schema.columns where table_schema='public'`),
            checks: await pick(built, `select c.conname||' :: '||pg_get_constraintdef(c.oid) as k
                from pg_constraint c join pg_class t on t.oid=c.conrelid
                join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='c'`),
            foreignKeys: await pick(built, `select t.relname||' '||pg_get_constraintdef(c.oid) as k
                from pg_constraint c join pg_class t on t.oid=c.conrelid
                join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='f'`),
            primaryKeys: await pick(built, `select t.relname||' '||pg_get_constraintdef(c.oid) as k
                from pg_constraint c join pg_class t on t.oid=c.conrelid
                join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='p'`),
            uniques: await pick(built, `select t.relname||' '||pg_get_constraintdef(c.oid) as k
                from pg_constraint c join pg_class t on t.oid=c.conrelid
                join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='u'`),
            indexShapes: await pick(built, `select tablename||' '||regexp_replace(indexdef, 'INDEX [^ ]+ ON', 'INDEX ON') as k
                from pg_indexes where schemaname='public'`),
            handBuiltIndexes: await pick(built, `select indexname as k from pg_indexes where schemaname='public' and indexname in
                ('friend_requests_pending_pair','groups_public','match_actions_feed','matches_history','messages_keyset','notifications_keyset','reports_against','tables_open')`)
        };

        const target = join(dirname(fileURLToPath(import.meta.url)), 'schema-snapshot.json');
        writeFileSync(target, `${ JSON.stringify(snapshot, null, 4) }\n`, 'utf8');
    });
});
