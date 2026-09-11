import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conversations, who is in them, and what was said.
 *
 * Three shapes here carry the weight.
 *
 * MEMBERSHIP holds what the mock kept on the conversation: `pinned` and `last_read_at` are
 * per-member, because pinning a thread is my opinion and where I read up to is my business.
 * One row per person per conversation, and the unread count is a comparison against that row.
 *
 * A MESSAGE is words XOR a payload. `nura-e2ee/v1` says only user-authored text is sealed, and
 * the server authors the rest as `{ key, params }` rendered through the message catalogue - which
 * is also what lets a system line follow a language switch. The CHECK makes the two impossible to
 * confuse: a text message with a payload, or a system message with words, is not a row that can
 * exist. When the sealing lands, `body` becomes ciphertext and this constraint does not move.
 *
 * A DIRECT conversation is unique on the unordered PAIR, the same trick the friend requests use.
 * Without it, two people opening a chat with each other at the same moment get two conversations
 * and neither can see the other's messages.
 */
export class Chat1789148500000 implements MigrationInterface
{
    name = 'Chat1789148500000';

    public async up(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query(`
            create table conversations
            (
                id         uuid        primary key default gen_random_uuid(),
                kind       varchar(16) not null,
                pair_key   text,
                group_id   uuid,
                table_id   uuid,
                game       varchar(24),
                title      text,
                created_at timestamptz not null default now(),

                constraint conversations_kind_known check (kind in ('direct', 'group', 'game')),

                -- A direct conversation always carries its pair key, and nothing else ever does.
                constraint conversations_direct_has_pair check ((kind = 'direct') = (pair_key is not null))
            )
        `);

        await queryRunner.query(`
            create unique index conversations_direct_pair
                on conversations (pair_key)
                where kind = 'direct'
        `);

        await queryRunner.query(`
            create table conversation_members
            (
                conversation_id uuid        not null references conversations (id) on delete cascade,
                user_id         uuid        not null references users (id) on delete cascade,
                joined_at       timestamptz not null default now(),

                -- Mine, not the conversation's. The mock kept both on the thread, which made one
                -- person pinning it pin it for everybody.
                pinned          boolean     not null default false,
                last_read_at    timestamptz not null default 'epoch',

                primary key (conversation_id, user_id)
            )
        `);

        await queryRunner.query('create index conversation_members_user on conversation_members (user_id)');

        await queryRunner.query(`
            create table messages
            (
                id              uuid        primary key default gen_random_uuid(),
                conversation_id uuid        not null references conversations (id) on delete cascade,
                sender_id       uuid        references users (id) on delete set null,
                kind            varchar(16) not null,
                body            text,
                payload         jsonb,
                created_at      timestamptz not null default now(),

                constraint messages_kind_known check (kind in ('text', 'system', 'invite', 'result')),

                constraint messages_body_xor_payload check (
                    (kind = 'text' and body is not null and payload is null)
                    or (kind <> 'text' and payload is not null and body is null)
                ),

                -- Only the server authors the other kinds, so only text is required to have an
                -- author. A deleted account leaves its messages with a null sender rather than
                -- taking the conversation with it.
                constraint messages_text_has_sender check (kind <> 'text' or sender_id is not null)
            )
        `);

        // The keyset index. Paging by (created_at, id) descending walks backwards through history
        // without an OFFSET, which is the only kind of pagination that stays correct while new
        // messages are arriving at the other end.
        await queryRunner.query('create index messages_keyset on messages (conversation_id, created_at desc, id desc)');
    }

    public async down(queryRunner: QueryRunner): Promise<void>
    {
        await queryRunner.query('drop table if exists messages');
        await queryRunner.query('drop table if exists conversation_members');
        await queryRunner.query('drop table if exists conversations');
    }
}
