import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The social graph, and the three privacy switches the product actually enforces.
 *
 * Two shapes here are deliberate and easy to get wrong.
 *
 * A FRIENDSHIP is stored mirrored - two rows, (a,b) and (b,a) - so "who are my friends" is one
 * index scan rather than a union of two half-queries. Every write goes through one function, and
 * `friendships_mirrored` in `social.spec.ts` is what stops a second code path writing one side.
 *
 * A FRIEND REQUEST is unique on the UNORDERED pair while it is pending. Not on (from, to): that
 * lets A ask B while B is already asking A, which is two rows describing one intention and no
 * answer to which of them accepting resolves. `least`/`greatest` makes the pair the key, so the
 * second request finds the first and accepts it instead.
 */
export class Social1789147000000 implements MigrationInterface
{
    name = 'Social1789147000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            alter table users
                add column allow_stranger_messages boolean not null default true,
                add column show_online             boolean not null default true
        `);

        // Before the constraint, because the seeded minor already exists and would fail it.
        await queryRunner.query('update users set allow_stranger_messages = false where is_minor');

        // Teen safety as a CHECK rather than a rule in a service. A minor whose account says
        // strangers may write to them is a row that must not be representable - not a row some
        // other code path is trusted to avoid writing.
        await queryRunner.query(`
            alter table users add constraint users_minor_no_strangers
                check (not (is_minor and allow_stranger_messages))
        `);

        await queryRunner.query(`
            create table friendships
            (
                user_id    uuid        not null references users (id) on delete cascade,
                friend_id  uuid        not null references users (id) on delete cascade,
                created_at timestamptz not null default now(),

                primary key (user_id, friend_id),
                constraint friendships_not_self check (user_id <> friend_id)
            )
        `);

        await queryRunner.query('create index friendships_friend on friendships (friend_id)');

        await queryRunner.query(`
            create table friend_requests
            (
                id          uuid        primary key default gen_random_uuid(),
                from_user   uuid        not null references users (id) on delete cascade,
                to_user     uuid        not null references users (id) on delete cascade,
                created_at  timestamptz not null default now(),
                answered_at timestamptz,
                outcome     varchar(16),

                constraint friend_requests_not_self check (from_user <> to_user),
                constraint friend_requests_outcome_known
                    check (outcome is null or outcome in ('accepted', 'declined', 'withdrawn')),

                -- Answered and outcome are one fact written in two columns, so they move together.
                constraint friend_requests_answered_pairs
                    check ((answered_at is null) = (outcome is null))
            )
        `);

        await queryRunner.query(`
            create unique index friend_requests_pending_pair
                on friend_requests (least(from_user, to_user), greatest(from_user, to_user))
                where answered_at is null
        `);

        await queryRunner.query('create index friend_requests_inbox on friend_requests (to_user) where answered_at is null');

        await queryRunner.query(`
            create table blocks
            (
                user_id    uuid        not null references users (id) on delete cascade,
                blocked_id uuid        not null references users (id) on delete cascade,
                created_at timestamptz not null default now(),

                primary key (user_id, blocked_id),
                constraint blocks_not_self check (user_id <> blocked_id)
            )
        `);

        // Blocking is asymmetric to write and SYMMETRIC to read: neither side may reach the
        // other, so every check looks both ways and needs the reverse index to do it cheaply.
        await queryRunner.query('create index blocks_blocked on blocks (blocked_id)');

        // One mute table for three kinds of subject. The product had three separate lists - a
        // muted-people list in one store, muted conversations and muted games in another - which
        // is three ways to spell one idea and three places to forget it.
        await queryRunner.query(`
            create table mutes
            (
                user_id      uuid        not null references users (id) on delete cascade,
                subject_kind varchar(16) not null,
                subject_id   text        not null,
                created_at   timestamptz not null default now(),

                primary key (user_id, subject_kind, subject_id),
                constraint mutes_kind_known check (subject_kind in ('person', 'conversation', 'game'))
            )
        `);

        await queryRunner.query(`
            create table reports
            (
                id         uuid        primary key default gen_random_uuid(),
                reporter   uuid        not null references users (id) on delete cascade,
                against    uuid        not null references users (id) on delete cascade,
                category   varchar(24) not null,
                status     varchar(16) not null default 'received',
                created_at timestamptz not null default now(),

                constraint reports_not_self check (reporter <> against),
                constraint reports_category_known
                    check (category in ('harassment', 'spam', 'cheating', 'inappropriate', 'other')),
                constraint reports_status_known
                    check (status in ('received', 'reviewed', 'actioned'))
            )
        `);

        await queryRunner.query('create index reports_against on reports (against, created_at desc)');
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop table if exists reports');
        await queryRunner.query('drop table if exists mutes');
        await queryRunner.query('drop table if exists blocks');
        await queryRunner.query('drop table if exists friend_requests');
        await queryRunner.query('drop table if exists friendships');
        await queryRunner.query('alter table users drop constraint if exists users_minor_no_strangers');
        await queryRunner.query('alter table users drop column if exists show_online');
        await queryRunner.query('alter table users drop column if exists allow_stranger_messages');
    }
}
