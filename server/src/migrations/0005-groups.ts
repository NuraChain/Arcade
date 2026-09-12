import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Groups, who is in them, and which conversation belongs to each.
 *
 * Three things here are load-bearing, and all three are indexes rather than application code.
 *
 * THE SLUG is `citext` and unique, so a group is claimed by INSERT the way a handle is: the
 * service walks `candidatesFor` and lets the index arbitrate, moving on only for a genuine 23505.
 * "Check then insert" is the same race with extra steps.
 *
 * THE OWNER is a role on the membership row with a PARTIAL UNIQUE index over
 * `(group_id) where role = 'owner'`. An `owner_id` column on the group would let a transfer that
 * promotes before it demotes leave two owners behind — a state nobody notices until one of them
 * removes the other. This makes it unrepresentable, so a transfer has to demote and promote
 * inside one transaction or fail.
 *
 * THE CONVERSATION is one per group, enforced by a partial unique index on
 * `conversations (group_id) where kind = 'group'`. A group with two threads is a group where half
 * the room is talking somewhere the other half cannot see.
 */
export class Groups1789160000000 implements MigrationInterface
{
    name = 'Groups1789160000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table groups
            (
                id         uuid        primary key default gen_random_uuid(),
                slug       citext      not null,
                name       text        not null,
                blurb      text        not null default '',
                crest      varchar(24) not null,
                hue        smallint    not null,
                game       varchar(24),
                created_by uuid        references users (id) on delete set null,
                created_at timestamptz not null default now(),

                -- Mirrored by SHAPE in domains/group/slug.ts. A rule enforced only in application
                -- code is a rule a second code path forgets.
                constraint groups_slug_shape check (slug ~ '^[[:alnum:]][[:alnum:]-]{0,46}[[:alnum:]]$'),
                constraint groups_hue_range check (hue between 0 and 359),
                constraint groups_name_present check (length(btrim(name)) > 0)
            )
        `);

        await queryRunner.query('create unique index groups_slug on groups (slug)');

        await queryRunner.query(`
            create table group_members
            (
                group_id  uuid        not null references groups (id) on delete cascade,
                user_id   uuid        not null references users (id) on delete cascade,
                role      varchar(16) not null default 'member',
                joined_at timestamptz not null default now(),

                primary key (group_id, user_id),

                constraint group_members_role_known check (role in ('owner', 'member'))
            )
        `);

        await queryRunner.query('create index group_members_user on group_members (user_id)');

        // The whole reason role is a row and not a column on the group.
        await queryRunner.query(`
            create unique index group_members_single_owner
                on group_members (group_id)
                where role = 'owner'
        `);

        await queryRunner.query(`
            alter table conversations
                add constraint conversations_group_fk
                foreign key (group_id) references groups (id) on delete cascade
        `);

        await queryRunner.query(`
            create unique index conversations_group_one
                on conversations (group_id)
                where kind = 'group' and group_id is not null
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop index if exists conversations_group_one');
        await queryRunner.query('alter table conversations drop constraint if exists conversations_group_fk');
        await queryRunner.query('drop table if exists group_members');
        await queryRunner.query('drop table if exists groups');
    }
}
