import type { DataSource } from 'typeorm';

export const REQUIRED_EXTENSIONS = ['citext', 'pgcrypto'] as const;

export const INDEXES_TYPEORM_CANNOT_EXPRESS = [
    `create unique index if not exists friend_requests_pending_pair
        on friend_requests (least(from_user, to_user), greatest(from_user, to_user))
        where answered_at is null`,

    `create index if not exists groups_public
        on groups (created_at desc)
        where privacy = 'public'`,

    `create index if not exists messages_keyset
        on messages (conversation_id, created_at desc, id desc)`,

    `create index if not exists notifications_keyset
        on notifications (user_id, created_at desc, id desc)`,

    `create index if not exists reports_against
        on reports (against, created_at desc)`,

    `create index if not exists tables_open
        on tables (game, created_at desc)
        where status = 'open'`
] as const;

export async function createExtensions(db: DataSource): Promise<void>
{
    for (const extension of REQUIRED_EXTENSIONS)
    {
        await db.query(`create extension if not exists ${ extension }`);
    }
}

export async function createUnexpressibleIndexes(db: DataSource): Promise<void>
{
    for (const statement of INDEXES_TYPEORM_CANNOT_EXPRESS)
    {
        await db.query(statement);
    }
}

export async function syncSchema(db: DataSource): Promise<void>
{
    await createExtensions(db);
    await db.synchronize();
    await createUnexpressibleIndexes(db);
}
