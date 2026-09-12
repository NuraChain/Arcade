import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notifications, and the push subscriptions that carry them off the page.
 *
 * TWO INDEXES do the work here, and both are about the same thing: a notification list is read far
 * more often than it is written, and it grows forever.
 *
 * `notifications_dedupe` is a unique index over `(user_id, dedupe_key)`. Twelve messages in one
 * conversation are ONE notification with a count of twelve, not twelve rows somebody has to swipe
 * away - so the write is an upsert that bumps the count and the timestamp and clears the read
 * mark. The key is composed by the producer (`chat:<conversationId>`, `friend-request:<id>`), and
 * choosing it is the only interesting decision in writing one.
 *
 * `notifications_keyset` is `(user_id, created_at desc, id desc)`, because the list pages by
 * keyset for the same reason chat history does: an OFFSET page repeats or skips a row every time
 * something arrives at the other end while somebody is scrolling.
 *
 * A notification carries `{ key, params }` and never prose. The version this replaces baked a
 * bilingual sentence into every row at generation, which could not follow a language switch -
 * exactly the defect `nura-e2ee/v1` calls out for chat lines, and the same fix.
 */
export class Notifications1789190000000 implements MigrationInterface
{
    name = 'Notifications1789190000000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table notifications
            (
                id         uuid        primary key default gen_random_uuid(),
                user_id    uuid        not null references users (id) on delete cascade,
                kind       varchar(24) not null,

                -- Who caused it. Null for anything the product itself announces.
                actor_id   uuid        references users (id) on delete set null,

                -- What it points at: a conversation, a table, a group, a request. Closed shape,
                -- validated on the wire, never free-form prose.
                ref        jsonb       not null default '{}'::jsonb,

                -- What makes two of these the SAME notification.
                dedupe_key text        not null,

                -- How many times it has happened since it was last read.
                count      integer     not null default 1,

                created_at timestamptz not null default now(),
                read_at    timestamptz,

                constraint notifications_kind_known check (
                    kind in ('friend-request', 'friend-accepted', 'group-added', 'table-invite', 'message')
                ),
                constraint notifications_count_positive check (count > 0)
            )
        `);

        await queryRunner.query('create unique index notifications_dedupe on notifications (user_id, dedupe_key)');

        await queryRunner.query('create index notifications_keyset on notifications (user_id, created_at desc, id desc)');

        await queryRunner.query(`
            create index notifications_unread
                on notifications (user_id)
                where read_at is null
        `);

        /**
         * One row per browser that asked to be told.
         *
         * The endpoint is the identity: a push service hands out a unique url per subscription,
         * and re-subscribing on the same device produces a new one. `p256dh` and `auth` are the
         * keys a payload would be encrypted to - stored because the standard says a subscription
         * has them, and unused, because this product sends CONTENTLESS pushes.
         */
        await queryRunner.query(`
            create table push_subscriptions
            (
                id         uuid        primary key default gen_random_uuid(),
                user_id    uuid        not null references users (id) on delete cascade,
                endpoint   text        not null unique,
                p256dh     text        not null,
                auth       text        not null,
                user_agent text        not null default '',
                created_at timestamptz not null default now(),
                failed_at  timestamptz
            )
        `);

        await queryRunner.query('create index push_subscriptions_user on push_subscriptions (user_id)');
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop table if exists push_subscriptions');
        await queryRunner.query('drop table if exists notifications');
    }
}
