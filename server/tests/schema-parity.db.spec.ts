import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { migrations } from '../src/migrations/index.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * The entities and the migrated schema describe the same tables.
 *
 * Nothing checked this, and nothing NOTICED for a long time, because every query in this server is
 * raw SQL through `DataSource.query()` - which never loads entity metadata. So an entity could be
 * missing a column the schema has had for fifteen migrations and every gate stayed green:
 *
 *   - `users.allow_stranger_messages` and `users.show_online`, added by `0003-social.ts` and read
 *     by `PERSON_COLUMNS` on every person payload, were absent from `User`.
 *   - `reports.message_id`, `disclosed`, `disclosed_key` and `disclosed_at`, the whole franking
 *     disclosure from `0014`, were absent from `Report` - whose docblock still said the franking
 *     "arrives with the E2EE work".
 *   - `GameRule.stakes` carried a DUPLICATE `@Column`, a stray decorator with a blank line after
 *     it, so the property was registered twice.
 *
 * None of that is cosmetic the moment anything reads through a repository, which is the direction
 * this server is moving: a missing column is silently absent from a `find()`, and a duplicate
 * decorator is a column definition nobody chose. This is the test that would have said so.
 *
 * Both directions are checked. A column in the entity and not in the table is a query that will
 * fail; a column in the table and not in the entity is the drift above, which fails silently.
 *
 * OPT-IN, like the other `.db.spec` suites: it needs the migrated schema to compare against.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

let db: DataSource;

interface ColumnRow
{
    table_name: string;
    column_name: string;
}

describe.skipIf(!active)('the entities and the schema agree', () =>
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

    it('declares every column its table has, and no column its table does not', async () =>
    {
        const rows = rowsOf<ColumnRow>(await db.query(
            `select table_name, column_name
               from information_schema.columns
              where table_schema = 'public'`
        ));

        const inDatabase = new Map<string, Set<string>>();
        for (const row of rows)
        {
            const columns = inDatabase.get(row.table_name) ?? new Set<string>();
            columns.add(row.column_name);
            inDatabase.set(row.table_name, columns);
        }

        const missingFromEntity: string[] = [];
        const missingFromTable: string[] = [];

        for (const meta of db.entityMetadatas)
        {
            const table = meta.tableName;
            const columns = inDatabase.get(table);

            if (columns === undefined)
            {
                missingFromTable.push(`${ table } (the whole table)`);
                continue;
            }

            const declared = new Set(meta.columns.map((column) => column.databaseName));

            for (const name of declared)
            {
                if (!columns.has(name))
                {
                    missingFromTable.push(`${ table }.${ name }`);
                }
            }

            for (const name of columns)
            {
                if (!declared.has(name))
                {
                    missingFromEntity.push(`${ table }.${ name }`);
                }
            }
        }

        expect(missingFromTable, 'an entity declares a column the migrations never made').toEqual([]);
        expect(missingFromEntity, 'the migrations made a column no entity declares').toEqual([]);
    });

    /**
     * A duplicate `@Column` registers the property twice, which is how `GameRule.stakes` looked.
     * TypeORM does not complain; it simply has two definitions and uses one of them.
     */
    it('declares each column exactly once', async () =>
    {
        const doubled: string[] = [];

        for (const meta of db.entityMetadatas)
        {
            const seen = new Set<string>();
            for (const column of meta.columns)
            {
                if (seen.has(column.databaseName))
                {
                    doubled.push(`${ meta.tableName }.${ column.databaseName }`);
                }
                seen.add(column.databaseName);
            }
        }

        expect(doubled, 'a stray second @Column registers the property twice').toEqual([]);
    });
});
