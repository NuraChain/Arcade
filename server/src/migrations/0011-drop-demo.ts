import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Demo accounts, removed.
 *
 * They were three seeded personas anybody could sign into through `POST /auth/demo`, so somebody
 * could look around without connecting anything. What they actually were is three fake people
 * whose profiles the product presented exactly like a real one's - and the whole direction of this
 * work has been the opposite: a person is who the server says they are, a device is one that
 * signed for itself, and a number on a screen is one something measured.
 *
 * A guest account already covers "let me look around without a wallet", and it is REAL: a typed
 * name, a claimed handle, a session of their own. The difference is that nobody else can sign into
 * it. `/auth/demo` existed so several people could share one identity, which is the property that
 * made it a demo and the property that makes it worth deleting.
 *
 * The CHECK is rewritten rather than relaxed. Leaving `demo` legal in the column with no route to
 * create one is exactly the dead weight this repository keeps removing: a value nothing writes is
 * a value somebody will eventually write by accident.
 */
export class DropDemo1789220000000 implements MigrationInterface
{
    name = 'DropDemo1789220000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        // Nothing to migrate: every database is built from this sequence and the seed that wrote
        // these rows is gone in the same commit. The delete is here so a database created BEFORE
        // this migration in the same sequence cannot carry one past the new CHECK.
        await queryRunner.query(`delete from users where kind = 'demo'`);

        await queryRunner.query('alter table users drop constraint users_kind_known');

        await queryRunner.query(`
            alter table users
                add constraint users_kind_known check (kind in ('wallet', 'guest'))
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('alter table users drop constraint users_kind_known');

        await queryRunner.query(`
            alter table users
                add constraint users_kind_known check (kind in ('wallet', 'demo', 'guest'))
        `);
    }
}
