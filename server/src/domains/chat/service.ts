import { ForbiddenError, NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { firstRow, rowsOf } from '../../lib/rows.ts';
import type { MessageKind } from '../../entities/message.entity.ts';
import type { SocialService } from '../social/service.ts';

export interface ConversationRow
{
    id: string;
    kind: 'direct' | 'group' | 'game';
    group_id: string | null;
    table_id: string | null;
    game: string | null;
    title: string | null;
    pinned: boolean;
    last_read_at: Date;
    members: string[];
    unread: number;
    last_id: string | null;
    last_kind: MessageKind | null;
    last_body: string | null;
    last_payload: Record<string, unknown> | null;
    last_from: string | null;
    last_at: Date | null;
}

export interface MessageRow
{
    id: string;
    conversation_id: string;
    kind: MessageKind;
    body: string | null;
    payload: Record<string, unknown> | null;
    sender: string | null;
    created_at: Date;
}

/** How many messages one page of history carries. */
export const PAGE = 40;

/**
 * The pair key a direct conversation is unique on.
 *
 * Sorted, so (a,b) and (b,a) are the same string and the unique index can arbitrate. Built here
 * and nowhere else: a second spelling of this function is a second conversation for a pair that
 * already has one.
 */
export function pairKeyOf(a: string, b: string): string
{
    return a < b ? `${ a }:${ b }` : `${ b }:${ a }`;
}

/**
 * Whether a path parameter could be a conversation id at all.
 *
 * Checked BEFORE it reaches a query. Postgres coerces the parameter to uuid and raises 22P02 on
 * anything else, which surfaces as a 500 - so any visitor could turn a typed url into a server
 * error. A shape that cannot be an id answers exactly as an id that is not there.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createChatService(db: DataSource, social: SocialService)
{
    /**
     * The membership row, which IS the authorisation.
     *
     * Every read and every write starts here. A conversation you are not in does not 404 and it
     * does not 403 differently depending on whether it exists - both would tell somebody probing
     * ids which ones are real.
     */
    const membership = async (me: string, conversationId: string): Promise<{ pinned: boolean; last_read_at: Date } | null> =>
    {
        if (!UUID.test(conversationId))
        {
            return null;
        }
        const rows = await db.query(
            'select pinned, last_read_at from conversation_members where conversation_id = $1 and user_id = $2',
            [conversationId, me]
        );
        return firstRow<{ pinned: boolean; last_read_at: Date }>(rows);
    };

    /**
     * Membership AND reachability.
     *
     * A block does not remove the membership row - unblocking has to give the thread back - so it
     * is checked here instead, and it answers exactly as a conversation that does not exist. Any
     * other answer tells somebody whether the person who blocked them is still in there.
     */
    const mustBeMember = async (me: string, conversationId: string): Promise<{ pinned: boolean; last_read_at: Date }> =>
    {
        const row = await membership(me, conversationId);
        if (row === null)
        {
            throw new NotFoundError('No conversation with that id.');
        }

        const blocked = await db.query(
            `select 1
             from conversation_members other
             join blocks b on (b.user_id = $2 and b.blocked_id = other.user_id)
                           or (b.user_id = other.user_id and b.blocked_id = $2)
             where other.conversation_id = $1 and other.user_id <> $2
             limit 1`,
            [conversationId, me]
        );
        if (rowsOf(blocked).length > 0)
        {
            throw new NotFoundError('No conversation with that id.');
        }
        return row;
    };

    return {
        membership,

        /**
         * Every conversation I am in, each with what the list needs and nothing more.
         *
         * The last message and the unread count come back WITH the row, so opening the app costs
         * one query rather than one per thread. Under `nura-e2ee/v1` the server will not be able
         * to read a message to count it, which is why unread is a comparison against my own
         * watermark rather than anything about the content.
         */
        async list(me: string): Promise<ConversationRow[]>
        {
            const rows = await db.query(
                `select c.id, c.kind, c.group_id, c.table_id, c.game, c.title,
                        m.pinned, m.last_read_at,
                        -- The cast is load-bearing. handle is citext, and array_agg over it
                        -- yields citext[], whose OID node-pg does not recognise - so the driver
                        -- hands back the raw literal '{alex,sara.k}' as a STRING and the wire
                        -- contract check is what catches it. Casting makes it text[], which the
                        -- driver parses into a real array.
                        (select coalesce(array_agg(u.handle::text order by u.handle), '{}')
                           from conversation_members cm
                           join users u on u.id = cm.user_id
                          where cm.conversation_id = c.id)                              as members,
                        (select count(*)::int from messages x
                          where x.conversation_id = c.id
                            and x.created_at > m.last_read_at
                            and (x.sender_id is null or x.sender_id <> $1))             as unread,
                        last.id                                                          as last_id,
                        last.kind                                                        as last_kind,
                        last.body                                                        as last_body,
                        last.payload                                                     as last_payload,
                        last.sender                                                      as last_from,
                        last.created_at                                                  as last_at
                 from conversation_members m
                 join conversations c on c.id = m.conversation_id
                 left join lateral (
                     select x.id, x.kind, x.body, x.payload, x.created_at, su.handle as sender
                     from messages x
                     left join users su on su.id = x.sender_id
                     where x.conversation_id = c.id
                     order by x.created_at desc, x.id desc
                     limit 1
                 ) last on true
                 where m.user_id = $1
                   -- A block hides the thread, not just the person. Leaving a direct conversation
                   -- listed after a block means a row in the inbox with somebody you have said
                   -- you do not want to hear from.
                   and not exists (select 1 from conversation_members other
                                    join blocks b on (b.user_id = $1 and b.blocked_id = other.user_id)
                                                  or (b.user_id = other.user_id and b.blocked_id = $1)
                                   where other.conversation_id = c.id and other.user_id <> $1)
                 order by m.pinned desc, last.created_at desc nulls last`,
                [me]
            );
            return rowsOf<ConversationRow>(rows);
        },

        /**
         * One page of history, newest first, walked by KEYSET.
         *
         * `(created_at, id)` rather than an offset: a conversation is being written to from the
         * other end while somebody scrolls up, and an OFFSET page silently repeats or skips a
         * message every time one arrives. The cursor is the last row of the previous page.
         */
        async messages(me: string, conversationId: string, cursor: { at: Date; id: string } | null): Promise<{ messages: MessageRow[]; hasMore: boolean }>
        {
            await mustBeMember(me, conversationId);

            const rows = await db.query(
                `select x.id, x.conversation_id, x.kind, x.body, x.payload, x.created_at,
                        su.handle as sender
                 from messages x
                 left join users su on su.id = x.sender_id
                 where x.conversation_id = $1
                   and ($2::timestamptz is null or (x.created_at, x.id) < ($2::timestamptz, $3::uuid))
                 order by x.created_at desc, x.id desc
                 limit $4`,
                [conversationId, cursor?.at ?? null, cursor?.id ?? null, PAGE + 1]
            );

            const page = rowsOf<MessageRow>(rows);
            const hasMore = page.length > PAGE;
            return { messages: page.slice(0, PAGE).reverse(), hasMore };
        },

        /**
         * Says something, if the policy allows it.
         *
         * A direct conversation asks `mayMessage` about the OTHER member on every send, not only
         * when the thread was opened: somebody can turn strangers off, or block you, while a
         * thread you already have open is sitting there.
         */
        async send(me: string, conversationId: string, body: string): Promise<MessageRow>
        {
            await mustBeMember(me, conversationId);

            const clean = body.trim();
            if (clean === '')
            {
                throw new ForbiddenError('A message needs some words.');
            }

            const others = await db.query(
                `select cm.user_id, c.kind
                 from conversation_members cm
                 join conversations c on c.id = cm.conversation_id
                 where cm.conversation_id = $1 and cm.user_id <> $2`,
                [conversationId, me]
            );

            for (const other of rowsOf<{ user_id: string; kind: string }>(others))
            {
                if (other.kind !== 'direct')
                {
                    continue;
                }
                const refusal = await social.mayMessage(me, other.user_id);
                if (refusal !== null)
                {
                    throw new ForbiddenError(refusal === 'blocked'
                        ? 'You cannot reach that account.'
                        : 'They are not taking messages from people they have not added.');
                }
            }

            const inserted = await db.query(
                `insert into messages (conversation_id, sender_id, kind, body)
                 values ($1, $2, 'text', $3)
                 returning id, conversation_id, kind, body, payload, created_at`,
                [conversationId, me, clean.slice(0, 4000)]
            );

            const message = rowsOf<Omit<MessageRow, 'sender'>>(inserted)[0];

            // Saying something is reading it. Without this the sender's own line comes back as
            // unread to them on the next list.
            await db.query(
                'update conversation_members set last_read_at = greatest(last_read_at, $3) where conversation_id = $1 and user_id = $2',
                [conversationId, me, message.created_at]
            );

            const who = await db.query('select handle from users where id = $1', [me]);
            return { ...message, sender: firstRow<{ handle: string }>(who)?.handle ?? null };
        },

        /** A server-authored line: `{ key, params }`, never prose. */
        async post(conversationId: string, kind: Exclude<MessageKind, 'text'>, payload: Record<string, unknown>, senderId: string | null): Promise<MessageRow>
        {
            const inserted = await db.query(
                `insert into messages (conversation_id, sender_id, kind, payload)
                 values ($1, $2, $3, $4)
                 returning id, conversation_id, kind, body, payload, created_at`,
                [conversationId, senderId, kind, JSON.stringify(payload)]
            );
            const message = rowsOf<Omit<MessageRow, 'sender'>>(inserted)[0];

            if (senderId === null)
            {
                return { ...message, sender: null };
            }
            const who = await db.query('select handle from users where id = $1', [senderId]);
            return { ...message, sender: firstRow<{ handle: string }>(who)?.handle ?? null };
        },

        /** Moves MY watermark forward, never back. */
        async markRead(me: string, conversationId: string): Promise<void>
        {
            await mustBeMember(me, conversationId);
            await db.query(
                'update conversation_members set last_read_at = now() where conversation_id = $1 and user_id = $2',
                [conversationId, me]
            );
        },

        async setPinned(me: string, conversationId: string, pinned: boolean): Promise<void>
        {
            await mustBeMember(me, conversationId);
            await db.query(
                'update conversation_members set pinned = $3 where conversation_id = $1 and user_id = $2',
                [conversationId, me, pinned]
            );
        },

        /**
         * The direct conversation with somebody, created if it does not exist.
         *
         * The INSERT carries the pair key and `on conflict do nothing`, so two people opening a
         * chat with each other simultaneously cannot end up with two threads. The loser reads the
         * winner's row - which is the row it wanted.
         */
        async openDirect(me: string, otherId: string): Promise<string>
        {
            const refusal = await social.mayMessage(me, otherId);
            if (refusal !== null)
            {
                throw new ForbiddenError(refusal === 'blocked'
                    ? 'You cannot reach that account.'
                    : 'They are not taking messages from people they have not added.');
            }

            const key = pairKeyOf(me, otherId);

            return db.transaction(async (tx) =>
            {
                const inserted = await tx.query(
                    `insert into conversations (kind, pair_key)
                     values ('direct', $1)
                     on conflict (pair_key) where kind = 'direct' do nothing
                     returning id`,
                    [key]
                );

                const created = firstRow<{ id: string }>(inserted);
                if (created === null)
                {
                    const existing = await tx.query(
                        `select id from conversations where kind = 'direct' and pair_key = $1`,
                        [key]
                    );
                    return rowsOf<{ id: string }>(existing)[0].id;
                }

                await tx.query(
                    `insert into conversation_members (conversation_id, user_id)
                     values ($1, $2), ($1, $3)
                     on conflict do nothing`,
                    [created.id, me, otherId]
                );
                return created.id;
            });
        }
    };
}

export type ChatService = ReturnType<typeof createChatService>;
