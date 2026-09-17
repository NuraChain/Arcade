import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { checkHandle } from '../src/domains/identity/handle.ts';
import { slugFromName } from '../src/domains/group/slug.ts';

/**
 * The database accepts every name the product does.
 *
 * `users_handle_shape` and `groups_slug_shape` were written with POSIX `[[:alnum:]]`, which
 * Postgres evaluates against the database's ctype - ASCII only here. The application's own
 * `SHAPE` is `/^[\p{L}\p{N}].../u`, which is Unicode-aware. So the two halves disagreed about
 * exactly one population: a Persian handle passed `checkHandle`, reached the INSERT, and came
 * back as 23514 - a 500 on the guest sign-in path, which is the main onboarding route, for the
 * language half this product is built for. A Persian group name hit the same wall, and CLAUDE.md
 * describes Persian slugs as a designed feature: `تخته‌نرد` is meant to become `تخته-نرد`.
 *
 * Both constraints are denylists now rather than alnum allowlists: length, no whitespace or
 * control characters, no leading or trailing separator, and none of the characters that would
 * break a URL path segment. That accepts any letter in any script without the database having an
 * opinion about which alphabets exist.
 *
 * This is the test that holds the two halves together: whatever the application accepts, the
 * database must store.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

let db: DataSource;

const HANDLES = ['sara.k', 'Dana-W', 'a1', 'علیرضا', 'مینا_ک', 'تخته-نرد'];

const NAMES = ['Friday Night Crew', 'تخته‌نرد', 'Tuesday Backgammon', 'حکم شبانه'];

describe.skipIf(!active)('what the database will store', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
    }, 180_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query('delete from groups');
            await db.query('delete from users');
            await db.destroy();
        }
    });

    it('stores every handle checkHandle accepts, in any script', async () =>
    {
        const refused: string[] = [];

        for (const handle of HANDLES)
        {
            expect(checkHandle(handle), `the application refused ${ handle }`).toBeNull();

            try
            {
                await db.query(
                    `insert into users (handle, display_name, hue, kind) values ($1, $2, 1, 'guest')`,
                    [handle, handle]
                );
            }
            catch (error)
            {
                refused.push(`${ handle }: ${ (error as Error).message }`);
            }
        }

        expect(refused, 'the application accepted a handle the database refused').toEqual([]);
    });

    it('stores every slug slugFromName produces, in any script', async () =>
    {
        const refused: string[] = [];

        for (const name of NAMES)
        {
            const slug = slugFromName(name);
            expect(slug.length, `${ name } folded to nothing`).toBeGreaterThan(1);

            try
            {
                await db.query(
                    `insert into groups (slug, name, crest, hue, privacy) values ($1, $2, 'crown', 1, 'public')`,
                    [slug, name]
                );
            }
            catch (error)
            {
                refused.push(`${ name } -> ${ slug }: ${ (error as Error).message }`);
            }
        }

        expect(refused, 'a name the product folds into a slug the database refused').toEqual([]);
    });

    it('still refuses what the shape exists to refuse', async () =>
    {
        const accepted: string[] = [];

        for (const bad of ['a b', '.ab', 'ab-', 'a/b', 'a#b', 'a', 'a\tb'])
        {
            try
            {
                await db.query(
                    `insert into users (handle, display_name, hue, kind) values ($1, 'x', 1, 'guest')`,
                    [bad]
                );
                accepted.push(bad);
            }
            catch
            {
                // refused, which is the point
            }
        }

        expect(accepted, 'the database stored a handle that is not a handle').toEqual([]);
    });
});
