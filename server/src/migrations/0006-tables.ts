import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tables, and the seats at them.
 *
 * A table is a SEAT CONTAINER and nothing more. There is no game engine behind it and none is
 * pretended: a table opens, people sit down, and it stops there. Whatever plays the hand plugs
 * into this and reads the seats.
 *
 * SEATS ARE ROWS, created with the table and empty. That is what turns "claim a seat" from a
 * read-then-write into a single UPDATE the database can arbitrate — see `claimSeat` in
 * `domains/table/service.ts` and the race in `tests/seat-race.spec.ts`. Deciding the seat in
 * application code and inserting it is the same race with extra steps, and the symptom is two
 * people in the last chair.
 *
 * `table_seats_one_per_person` is the other half: a partial unique index over
 * `(table_id, user_id)`, so one person cannot hold two seats however many requests they send.
 * The claim's `skip locked` keeps concurrent claimers off each other's rows; this keeps one
 * claimer off their own.
 */
export class Tables1789170000000 implements MigrationInterface
{
    name = 'Tables1789170000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table tables
            (
                id         uuid        primary key default gen_random_uuid(),

                -- What a person reads out or pastes into a chat. Claimed against the unique index
                -- the way a handle and a group slug are.
                code       citext      not null,

                game       varchar(32) not null references games (id),
                seats      smallint    not null,
                mode       varchar(16) not null,
                privacy    varchar(16) not null,

                -- Shape, not rules. What a target of 7 MEANS is the game's business.
                target     smallint    not null default 0,
                cube       boolean     not null default false,
                blinds     varchar(8)  not null default 'low',

                status     varchar(16) not null default 'open',
                host_id    uuid        references users (id) on delete set null,
                group_id   uuid        references groups (id) on delete set null,
                created_at timestamptz not null default now(),
                closed_at  timestamptz,

                constraint tables_seats_range    check (seats between 2 and 8),
                constraint tables_mode_known     check (mode in ('live', 'turns')),
                constraint tables_privacy_known  check (privacy in ('private', 'friends', 'public')),
                constraint tables_status_known   check (status in ('open', 'ready', 'closed')),
                constraint tables_blinds_known   check (blinds in ('low', 'mid', 'high')),
                constraint tables_closed_has_at  check ((status = 'closed') = (closed_at is not null))
            )
        `);

        await queryRunner.query('create unique index tables_code on tables (code)');

        // What "find me a table" reads: open, public, this game, newest first.
        await queryRunner.query(`
            create index tables_open
                on tables (game, created_at desc)
                where status = 'open'
        `);

        await queryRunner.query(`
            create table table_seats
            (
                table_id   uuid     not null references tables (id) on delete cascade,
                seat       smallint not null,
                user_id    uuid     references users (id) on delete cascade,

                -- Held for one person. A stranger's claim skips this seat rather than taking it.
                invited_id uuid     references users (id) on delete set null,

                ready      boolean  not null default false,
                joined_at  timestamptz,

                primary key (table_id, seat),

                constraint table_seats_occupied_has_joined check ((user_id is null) = (joined_at is null)),
                constraint table_seats_empty_is_not_ready  check (user_id is not null or ready = false)
            )
        `);

        await queryRunner.query('create index table_seats_user on table_seats (user_id) where user_id is not null');

        await queryRunner.query(`
            create unique index table_seats_one_per_person
                on table_seats (table_id, user_id)
                where user_id is not null
        `);

        await queryRunner.query(`
            alter table conversations
                add constraint conversations_table_fk
                foreign key (table_id) references tables (id) on delete cascade
        `);

        await queryRunner.query(`
            create unique index conversations_table_one
                on conversations (table_id)
                where kind = 'game' and table_id is not null
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop index if exists conversations_table_one');
        await queryRunner.query('alter table conversations drop constraint if exists conversations_table_fk');
        await queryRunner.query('drop table if exists table_seats');
        await queryRunner.query('drop table if exists tables');
    }
}
