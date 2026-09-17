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
        where status = 'open'`,

    `create index if not exists matches_history
        on matches (table_id, started_at desc)`,

    `create index if not exists match_actions_feed
        on match_actions (match_id, rev desc)`
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

/**
 * Rewrites every `@Check` the entities declare, because `synchronize()` will not.
 *
 * This is the third thing `syncSchema` exists for, and it was found the way the other two were - by
 * something not working. A CHECK that CHANGES is left exactly as it was on a table that already
 * exists: `notifications_kind_known` gained a sixth kind in the entity, the development database
 * went on refusing it, and a perfectly good roll came back a 500 because the notification after it
 * could not be written.
 *
 * **No test could have caught it, and that is the part worth keeping.** `schema.db.spec.ts`,
 * `converge.db.spec.ts` and the snapshot recorder all build a database FROM NOTHING, where a
 * changed constraint and a new one are the same thing. Every gate was green while both real
 * databases held the old rule - and production runs this same function through
 * `npm run schema:sync`, so a deployed database would have kept it forever.
 *
 * Dropped and re-added rather than compared: Postgres stores a check normalised
 * (`(kind)::text = ANY (ARRAY[...])`) and the entity declares it as somebody wrote it, so any
 * textual comparison is a guess that fails open. The cost is a validating scan per constraint on a
 * sync, which is a deliberate act - a development boot or `npm run schema:sync` - and not something
 * a request ever waits for.
 *
 * `not valid` is deliberately NOT used. A constraint that is not validated is one that lets the
 * rows it was added to stop obeying it, which is the opposite of why any of these exist.
 */
export async function rewriteChecks(db: DataSource): Promise<void>
{
    for (const entity of db.entityMetadatas)
    {
        for (const check of entity.checks)
        {
            if (check.name === undefined || check.expression === undefined)
            {
                continue;
            }

            await db.query(`alter table ${ entity.tablePath } drop constraint if exists "${ check.name }"`);
            await db.query(`alter table ${ entity.tablePath } add constraint "${ check.name }" check (${ check.expression })`);
        }
    }
}

export async function syncSchema(db: DataSource): Promise<void>
{
    await createExtensions(db);
    await db.synchronize();
    await createUnexpressibleIndexes(db);
    await rewriteChecks(db);
}
