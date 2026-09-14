import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Groups can be private.
 *
 * Every group has been discoverable by anybody signed in - `discover` returned whatever you were not
 * already in, and `bySlug` never asked who was looking. That is a reasonable default for a product
 * about finding people to play with, and it left no way to make a room for a handful of them.
 *
 * TWO levels, not three. `tables` carries private, friends and public, and nothing has ever read the
 * middle one: `open()` filters on public strictly, so a friends table is invisible to friends as
 * well as to strangers. A level arrives here when a WHERE clause needs it.
 *
 * NO DEFAULT, deliberately, and this is the interesting line. Postgres materialises a column default
 * into every existing row at the moment the column is added, which is precisely the backfill this
 * project forbids - code describing rows from a past that does not exist. `tables.privacy` has no
 * default either. The consequence is worth stating: a development database that already holds a
 * group will refuse this migration rather than silently deciding the answer for it. The migration
 * runs in a transaction, so it rolls back whole, and the documented fix is the one this project
 * already prescribes for a changed sequence - drop the databases and run it from nothing.
 *
 * Privacy is a column on the GROUP, not on a membership row, so an owner who leaves hands on a group
 * that stays exactly as private as it was.
 */
export class GroupPrivacy1789280000000 implements MigrationInterface
{
    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            alter table groups
                add column privacy varchar(16) not null,
                add constraint groups_privacy_known check (privacy in ('private', 'public'))
        `);

        // What the discover list reads: public, newest first. Partial on the same predicate the
        // query states, so the index is the one Postgres can use for it.
        await queryRunner.query(`
            create index groups_public
                on groups (created_at desc)
                where privacy = 'public'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop index if exists groups_public');
        await queryRunner.query('alter table groups drop constraint if exists groups_privacy_known');
        await queryRunner.query('alter table groups drop column if exists privacy');
    }
}
