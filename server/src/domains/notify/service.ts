import { IsNull, type DataSource } from 'typeorm';

import type { NotificationKind } from '../../entities/notification.entity.ts';
import { rowsOf } from '../../lib/rows.ts';
import { Mute } from '../../entities/mute.entity.ts';
import { NOTICE_OF } from './notices.ts';
import { Notification } from '../../entities/notification.entity.ts';
import { PushSubscription } from '../../entities/push-subscription.entity.ts';
import type { SocialService } from '../social/service.ts';

export interface NotificationRow
{
    id: string;
    kind: NotificationKind;
    actor: string | null;
    ref: Record<string, string>;
    count: number;
    created_at: Date;
    read_at: Date | null;
}

export interface NotificationPage
{
    items: NotificationRow[];
    hasMore: boolean;
}

/** How many notifications one page carries. */
export const PAGE = 30;

/**
 * What a notification may point at.
 *
 * A closed set, checked on the way IN. The column is `jsonb` and would take anything; this is what
 * stops a producer from putting a sentence in it, which is how a "structured" notification ends up
 * carrying prose that cannot follow a language switch.
 */
const REF_FIELDS = new Set(['conversationId', 'tableId', 'groupId', 'requestId', 'personId']);

/**
 * The shape a uuid has, checked before one is compared against a uuid COLUMN.
 *
 * Postgres raises 22P02 for a malformed uuid rather than matching nothing, and that surfaces as a
 * 500 - so `POST /notifications/abc/read` was a server error any signed-in caller could produce
 * from the address bar. Six other services in this server already carry this guard with this
 * reasoning; this one had none, and it is the only domain that takes a raw uuid from a path
 * parameter straight into a query.
 *
 * A row that is not this reader's already answers by matching nothing, so a bad id answers the same
 * way a wrong-but-well-formed one does: silently, with nothing changed.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createNotifyService(db: DataSource, social: SocialService)
{
    const clean = (ref: Record<string, string>): Record<string, string> =>
    {
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(ref))
        {
            if (REF_FIELDS.has(key) && typeof value === 'string' && value.length <= 64)
            {
                out[key] = value;
            }
        }
        return out;
    };

    return {
        /**
         * Tells somebody something, or tells them again.
         *
         * The upsert on `(user_id, dedupe_key)` is the whole design: twelve messages in one
         * conversation are one row with a count of twelve, and the second arrival bumps the count,
         * moves the row to the top and clears the read mark. Twelve rows would be twelve things to
         * swipe away for one thing that happened.
         *
         * Never notifies somebody about their own action, and never writes a row for a subject
         * this account has muted - the mute is checked HERE rather than at render, because a
         * notification that exists and is hidden is still a badge somebody has to clear.
         */
        async tell(input: {
            userId: string;
            kind: NotificationKind;
            actorId: string | null;
            ref: Record<string, string>;
            dedupeKey: string;
        }): Promise<boolean>
        {
            if (input.actorId === input.userId)
            {
                return false;
            }

            const subjects = [
                ...(input.actorId === null ? [] : [{ userId: input.userId, subjectKind: 'person' as const, subjectId: input.actorId }]),
                ...(input.ref.conversationId === undefined ? [] : [{ userId: input.userId, subjectKind: 'conversation' as const, subjectId: input.ref.conversationId }]),
                { userId: input.userId, subjectKind: 'notice' as const, subjectId: NOTICE_OF[input.kind] }
            ];

            if (await db.getRepository(Mute).exists({ where: subjects }))
            {
                return false;
            }

            if (input.actorId !== null && await social.mayMessage(input.userId, input.actorId) === 'blocked')
            {
                return false;
            }

            await db.query(
                `insert into notifications (user_id, kind, actor_id, ref, dedupe_key)
                 values ($1, $2, $3, $4::jsonb, $5)
                 on conflict (user_id, dedupe_key) do update set
                    count      = case when notifications.kind = excluded.kind then notifications.count + 1 else 1 end,
                    kind       = excluded.kind,
                    created_at = now(),
                    read_at    = null,
                    actor_id   = excluded.actor_id,
                    ref        = excluded.ref`,
                [input.userId, input.kind, input.actorId, JSON.stringify(clean(input.ref)), input.dedupeKey]
            );
            return true;
        },

        async retract(userId: string, kind: NotificationKind, dedupeKey: string): Promise<void>
        {
            await db.getRepository(Notification).delete({ userId, kind, dedupeKey });
        },

        /**
         * Tells several people the same thing in ONE statement, with every rule `tell` applies.
         *
         * Raw SQL because it is an `insert ... select` over `unnest` ending in an upsert that counts
         * up - the same two shapes `tell` needs, asked once for a whole room rather than five queries
         * per recipient. Answers who was told, so the caller rings exactly those.
         */
        async tellAll(userIds: readonly string[], input: {
            kind: NotificationKind;
            actorId: string | null;
            ref: Record<string, string>;
            dedupeKey: string;
        }): Promise<string[]>
        {
            const targets = [...new Set(userIds)].filter((id) => id !== input.actorId);

            if (targets.length === 0)
            {
                return [];
            }

            const rows = await db.query(
                `insert into notifications (user_id, kind, actor_id, ref, dedupe_key)
                 select t.id, $2, $3::uuid, $4::jsonb, $5
                   from unnest($1::uuid[]) as t(id)
                  where not exists (
                            select 1 from mutes m
                             where m.user_id = t.id
                               and ((m.subject_kind = 'person' and m.subject_id = $3::text)
                                 or (m.subject_kind = 'conversation' and m.subject_id = $6::text)
                                 or (m.subject_kind = 'notice' and m.subject_id = $7::text)))
                    and ($3::uuid is null or not exists (
                            select 1 from blocks b
                             where (b.user_id = t.id and b.blocked_id = $3::uuid)
                                or (b.user_id = $3::uuid and b.blocked_id = t.id)))
                 on conflict (user_id, dedupe_key) do update set
                    count      = case when notifications.kind = excluded.kind then notifications.count + 1 else 1 end,
                    kind       = excluded.kind,
                    created_at = now(),
                    read_at    = null,
                    actor_id   = excluded.actor_id,
                    ref        = excluded.ref
                 returning user_id`,
                [targets, input.kind, input.actorId, JSON.stringify(clean(input.ref)), input.dedupeKey, input.ref.conversationId ?? null, NOTICE_OF[input.kind]]
            );

            return rowsOf<{ user_id: string }>(rows).map((row) => row.user_id);
        },

        /**
         * One page, newest first, by KEYSET.
         *
         * `(created_at, id)` descending, the same shape chat history uses. An OFFSET page repeats
         * or skips a row every time something arrives at the other end while somebody is reading.
         */
        async page(me: string, cursor: { at: Date; id: string } | null, kinds: readonly string[] | null = null): Promise<NotificationPage>
        {
            const rows = await db.query(
                `select n.id, n.kind, n.ref, n.count, n.created_at, n.read_at,
                        (select u.handle::text from users u where u.id = n.actor_id) as actor
                 from notifications n
                 where n.user_id = $1
                   and ($2::timestamptz is null or (n.created_at, n.id) < ($2, $3::uuid))
                   and ($5::text[] is null or n.kind = any($5::text[]))
                 order by n.created_at desc, n.id desc
                 limit $4`,
                [me, cursor?.at ?? null, cursor?.id ?? null, PAGE + 1, kinds === null ? null : [...kinds]]
            );

            const page = rowsOf<NotificationRow>(rows);
            return { items: page.slice(0, PAGE), hasMore: page.length > PAGE };
        },

        async unread(me: string): Promise<number>
        {
            const rows = await db.query(
                'select count(*)::int as n from notifications where user_id = $1 and read_at is null',
                [me]
            );
            return rowsOf<{ n: number }>(rows)[0].n;
        },

        /** Marks one read. Mine only - the where clause is the authorisation. */
        async markRead(me: string, id: string): Promise<void>
        {
            if (!UUID.test(id))
            {
                return;
            }

            await db.query(
                'update notifications set read_at = now() where user_id = $1 and id = $2 and read_at is null',
                [me, id]
            );
        },

        async markAllRead(me: string): Promise<void>
        {
            await db.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [me]);
        },

        async dismiss(me: string, id: string): Promise<void>
        {
            if (!UUID.test(id))
            {
                return;
            }

            await db.getRepository(Notification).delete({ userId: me, id });
        },

        /**
         * Records a browser that asked to be told.
         *
         * The endpoint is the identity, and it is unique across the table: the same browser
         * re-subscribing replaces its own row rather than accumulating, and an endpoint that moves
         * between accounts follows the account that claimed it last.
         */
        async subscribe(me: string, input: { endpoint: string; p256dh: string; auth: string; userAgent: string }): Promise<void>
        {
            await db.query(
                `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
                 values ($1, $2, $3, $4, $5)
                 on conflict (endpoint) do update set
                    user_id    = excluded.user_id,
                    p256dh     = excluded.p256dh,
                    auth       = excluded.auth,
                    user_agent = excluded.user_agent,
                    failed_at  = null`,
                [me, input.endpoint, input.p256dh, input.auth, input.userAgent.slice(0, 400)]
            );
        },

        async unsubscribe(me: string, endpoint: string): Promise<void>
        {
            await db.getRepository(PushSubscription).delete({ userId: me, endpoint });
        },

        /** Every live subscription for an account. What the push sender walks. */
        async subscriptionsOf(userId: string): Promise<{ id: string; endpoint: string }[]>
        {
            return await db.getRepository(PushSubscription).find({
                select: { id: true, endpoint: true },
                where: { userId, failedAt: IsNull() }
            });
        },

        /** A push service that says a subscription is gone. Marked, then swept. */
        async retire(id: string): Promise<void>
        {
            await db.query('update push_subscriptions set failed_at = now() where id = $1', [id]);
        }
    };
}
