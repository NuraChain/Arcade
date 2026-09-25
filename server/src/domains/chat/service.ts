import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import type { Franking } from './franking.ts';
import { THREAD_PAGE } from './pages.ts';

import { affectedBy, firstRow, rowsOf } from '../../lib/rows.ts';
import { ConversationMember } from '../../entities/conversation-member.entity.ts';
import { Conversation } from '../../entities/conversation.entity.ts';
import { Table } from '../../entities/table.entity.ts';
import { Message, type MessageKind } from '../../entities/message.entity.ts';
import { User } from '../../entities/user.entity.ts';
import type { SocialService } from '../social/service.ts';

export interface ConversationRow
{
    id: string;
    kind: 'direct' | 'group' | 'game';

    /** The group's SLUG, because that is what the wire names a group by. Null for every other kind. */
    group_slug: string | null;
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
    last_sender_account_id: string | null;
    last_at: Date | null;
    last_epoch: number | null;
    last_seq: string | null;
    last_iv: string | null;
    last_sender_device_id: string | null;
    last_signature: string | null;
    last_client_at: Date | null;
    last_commitment: string | null;
    last_frank: string | null;
    last_expires_at: Date | null;

    /** How long a message in this room lasts, in seconds. Null is off. */
    expire_after: number | null;
    quiet: boolean;
}

export interface MessageRow
{
    id: string;
    conversation_id: string;
    kind: MessageKind;
    body: string | null;
    payload: Record<string, unknown> | null;
    sender: string | null;
    sender_account_id: string | null;
    created_at: Date;

    /** When this stops existing. Null on anything that does not. */
    expires_at: Date | null;

    /** The envelope. Every field together on a sealed message, every field null on a line. */
    epoch: number | null;
    seq: string | null;
    iv: string | null;
    sender_device_id: string | null;
    signature: string | null;
    client_at: Date | null;
    commitment: string | null;

    /** The server's own MAC. Never sent to a client - it is only ever checked here. */
    frank: string | null;
    target_id: string | null;
}

/** What a client states when it sends something sealed. */
export interface SealedInput
{
    id: string;
    kind: 'text' | 'reaction';
    target?: string;
    epoch: number;
    seq: number;
    iv: string;
    body: string;
    senderDeviceId: string;
    signature: string;
    clientAt: string;
    commitment: string;

    /** Epoch milliseconds, or 0 for a message that does not expire. Signed, so it cannot be moved. */
    expiresAt: number;
}

/** How many messages one page of history carries. */
export const PAGE = THREAD_PAGE;

export const LIST_PAGE = 60;

/**
 * How far a message's signed expiry may sit from the room's rule.
 *
 * A sender computes `clientAt + expireAfter` on its own clock, and the setting can change between a
 * client reading it and pressing send. A minute absorbs both without letting anybody choose a
 * materially different lifetime for their own words.
 */
const EXPIRY_SLACK_MS = 60_000;

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

export function createChatService(db: DataSource, social: SocialService, franking: Franking)
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
        const row = await db.getRepository(ConversationMember).findOne({
            select: { pinned: true, lastReadAt: true },
            where: { conversationId, userId: me }
        });
        return row === null ? null : { pinned: row.pinned, last_read_at: row.lastReadAt };
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

    /**
     * The members of a conversation, with both directions of a block removed.
     *
     * The same rule `mustBeMember` and `list` apply, spelled once: a block hides the thread, not
     * only the person. A realtime fan-out that recomputed membership for itself would be a third
     * copy, and the one that decides who is TOLD about a message is the worst place for a copy to
     * drift.
     *
     * A malformed id answers `[]` rather than reaching a uuid comparison - Postgres raises 22P02,
     * which a nudge would turn into a 500 on a path nobody is watching.
     */
    const recipients = async (conversationId: string): Promise<string[]> =>
    {
        if (!UUID.test(conversationId))
        {
            return [];
        }

        const rows = await db.query(
            `select cm.user_id
             from conversation_members cm
             where cm.conversation_id = $1
               and not exists (select 1
                                 from conversation_members other
                                 join blocks b on (b.user_id = cm.user_id and b.blocked_id = other.user_id)
                                               or (b.user_id = other.user_id and b.blocked_id = cm.user_id)
                                where other.conversation_id = cm.conversation_id
                                  and other.user_id <> cm.user_id)`,
            [conversationId]
        );
        return rowsOf<{ user_id: string }>(rows).map((row) => row.user_id);
    };

    /** One person's handle, which two message builders both want and neither owns. */
    const handleOf = async (userId: string): Promise<string | null> =>
    {
        const row = await db.getRepository(User).findOne({ select: { handle: true }, where: { id: userId } });
        return row?.handle ?? null;
    };

    /**
     * Every conversation this account is seated in.
     *
     * For the key schedule rather than for reading: confirming a device or revoking one changes who
     * a conversation may be sealed to, and everybody with that thread open has to find out. It is
     * deliberately unfiltered by blocks - a blocked pair still shares an epoch, and a client that
     * was not told to re-read would go on sealing to a device that is no longer eligible.
     */
    const seatedIn = async (userId: string): Promise<string[]> =>
    {
        const rows = await db.getRepository(ConversationMember).find({
            select: { conversationId: true },
            where: { userId }
        });
        return rows.map((row) => row.conversationId);
    };

    return {
        membership,
        mustBeMember,
        recipients,
        seatedIn,

        /**
         * Every conversation I am in, each with what the list needs and nothing more.
         *
         * The last message and the unread count come back WITH the row, so opening the app costs
         * one query rather than one per thread. Under `nura-e2ee/v1` the server will not be able
         * to read a message to count it, which is why unread is a comparison against my own
         * watermark rather than anything about the content.
         */
        async list(me: string, after: { at: Date | null; id: string } | null = null, size = LIST_PAGE): Promise<{ rows: ConversationRow[]; more: boolean }>
        {
            const rows = await db.query(
                `select c.id, c.kind, c.table_id, c.game, c.title, c.expire_after,
                        (select g.slug::text from groups g where g.id = c.group_id)      as group_slug,
                        coalesce((select not t.chat from tables t where t.id = c.table_id), false) as quiet,
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
                            and (x.expires_at is null or x.expires_at > now())
                            and x.kind not in ('reaction', 'deleted')
                            and (x.sender_id is null or x.sender_id <> $1))             as unread,
                        last.id                                                          as last_id,
                        last.kind                                                        as last_kind,
                        last.body                                                        as last_body,
                        last.payload                                                     as last_payload,
                        last.sender                                                      as last_from,
                        last.sender_account_id                                           as last_sender_account_id,
                        last.created_at                                                  as last_at,
                        last.epoch                                                       as last_epoch,
                        last.seq                                                         as last_seq,
                        last.iv                                                          as last_iv,
                        last.sender_device_id                                            as last_sender_device_id,
                        last.signature                                                   as last_signature,
                        last.client_at                                                   as last_client_at,
                        last.commitment                                                  as last_commitment,
                        last.frank                                                       as last_frank,
                        last.expires_at                                                  as last_expires_at
                 from conversation_members m
                 join conversations c on c.id = m.conversation_id
                 left join lateral (
                     -- The whole envelope, not only the ciphertext: the list renders a preview of
                     -- the last message, and under the sealing that preview is something only this
                     -- browser can produce. A row without its AAD is a row it must refuse to open.
                     select x.id, x.kind, x.body, x.payload, x.created_at, su.handle as sender,
                            x.sender_id as sender_account_id,
                            x.epoch, x.seq, x.iv, x.sender_device_id, x.signature, x.client_at,
                            x.commitment, x.frank, x.expires_at
                     from messages x
                     left join users su on su.id = x.sender_id
                     where x.conversation_id = c.id
                       -- The same filter the thread read applies. Without it the list shows a
                       -- preview of a message that has run out and the thread does not, which is
                       -- the one place a disappearing message would still be visible.
                       and (x.expires_at is null or x.expires_at > now())
                       and x.kind not in ('reaction', 'deleted')
                     order by x.created_at desc, x.id desc
                     limit 1
                 ) last on true
                 where m.user_id = $1
                   and ($2::uuid is null
                        or (not m.pinned and (coalesce(last.created_at, '-infinity'::timestamptz), c.id) < (coalesce($3::timestamptz, '-infinity'::timestamptz), $2::uuid)))
                   -- A block hides the thread, not just the person. Leaving a direct conversation
                   -- listed after a block means a row in the inbox with somebody you have said
                   -- you do not want to hear from.
                   and not exists (select 1 from conversation_members other
                                    join blocks b on (b.user_id = $1 and b.blocked_id = other.user_id)
                                                  or (b.user_id = other.user_id and b.blocked_id = $1)
                                   where other.conversation_id = c.id and other.user_id <> $1)
                 order by m.pinned desc, coalesce(last.created_at, '-infinity'::timestamptz) desc, c.id desc
                 limit $4::int + (case when $2::uuid is null
                                       then (select count(*)::int from conversation_members p where p.user_id = $1 and p.pinned)
                                       else 0 end)`,
                [me, after?.id ?? null, after?.at ?? null, size + 1]
            );
            const found = rowsOf<ConversationRow>(rows);
            const unpinned = found.filter((row) => !row.pinned);

            if (unpinned.length <= size)
            {
                return { rows: found, more: false };
            }

            const dropped = unpinned[unpinned.length - 1];
            return { rows: found.filter((row) => row !== dropped), more: true };
        },

        /**
         * One page of history, newest first, walked by KEYSET.
         *
         * `(created_at, id)` rather than an offset: a conversation is being written to from the
         * other end while somebody scrolls up, and an OFFSET page silently repeats or skips a
         * message every time one arrives. The cursor is the last row of the previous page.
         */
        async messages(me: string, conversationId: string, cursor: { at: Date; id: string } | null, size: number = PAGE): Promise<{ messages: MessageRow[]; hasMore: boolean; reactions: MessageRow[] }>
        {
            await mustBeMember(me, conversationId);

            const rows = await db.query(
                `select x.id, x.conversation_id, x.kind, x.body, x.payload, x.created_at,
                        su.handle as sender, x.sender_id as sender_account_id,
                        x.epoch, x.seq, x.iv, x.sender_device_id, x.signature, x.client_at,
                        x.commitment, x.frank, x.expires_at, x.target_id
                 from messages x
                 left join users su on su.id = x.sender_id
                 where x.conversation_id = $1
                   and x.kind <> 'reaction'
                   -- Gone is gone. The sweep deletes these on a timer, and a reader must not see
                   -- one in the window between its moment and the next pass.
                   and (x.expires_at is null or x.expires_at > now())
                   and ($2::timestamptz is null or (x.created_at, x.id) < ($2::timestamptz, $3::uuid))
                 order by x.created_at desc, x.id desc
                 limit $4`,
                [conversationId, cursor?.at ?? null, cursor?.id ?? null, size + 1]
            );

            const page = rowsOf<MessageRow>(rows);
            const hasMore = page.length > size;
            const shown = page.slice(0, size).reverse();
            const texts = shown.filter((row) => row.kind === 'text').map((row) => row.id);

            const reactions = texts.length === 0 ? [] : await db.getRepository(Message)
                .createQueryBuilder('x')
                .leftJoin(User, 'su', 'su.id = x.sender_id')
                .select('x.id', 'id')
                .addSelect('x.conversation_id', 'conversation_id')
                .addSelect('x.kind', 'kind')
                .addSelect('x.body', 'body')
                .addSelect('x.payload', 'payload')
                .addSelect('x.created_at', 'created_at')
                .addSelect('su.handle', 'sender')
                .addSelect('x.sender_id', 'sender_account_id')
                .addSelect('x.epoch', 'epoch')
                .addSelect('x.seq', 'seq')
                .addSelect('x.iv', 'iv')
                .addSelect('x.sender_device_id', 'sender_device_id')
                .addSelect('x.signature', 'signature')
                .addSelect('x.client_at', 'client_at')
                .addSelect('x.commitment', 'commitment')
                .addSelect('x.frank', 'frank')
                .addSelect('x.expires_at', 'expires_at')
                .addSelect('x.target_id', 'target_id')
                .where('x.target_id in (:...texts)', { texts })
                .andWhere('x.kind = :kind', { kind: 'reaction' })
                .andWhere('(x.expires_at is null or x.expires_at > now())')
                .orderBy('x.created_at', 'ASC')
                .addOrderBy('x.id', 'ASC')
                .getRawMany<MessageRow>();

            return { messages: shown, hasMore, reactions };
        },

        /**
         * Stores something sealed, if the policy allows it.
         *
         * A direct conversation asks `mayMessage` about the OTHER member on every send, not only
         * when the thread was opened: somebody can turn strangers off, or block you, while a
         * thread you already have open is sitting there.
         *
         * What this does NOT do is check the signature. The only thing that would prove is that
         * the client which sent the message could also make it, which was never in question, and
         * the recipient has to verify for itself regardless - a server that vouched for a
         * signature would be a server the recipient was trusting about the one fact it must not.
         *
         * The device is the SESSION's, resolved by the caller, and the envelope has to name it. A
         * message claiming to come from another of the account's devices is refused rather than
         * stored: a device signs its own words, and accepting one device's word about another's is
         * the shape of every re-attribution the AAD exists to bind.
         */
        async send(me: string, conversationId: string, deviceId: string | null, input: SealedInput): Promise<MessageRow>
        {
            await mustBeMember(me, conversationId);

            const quiet = await db.getRepository(Conversation)
                .createQueryBuilder('c')
                .innerJoin(Table, 't', 't.id = c.table_id')
                .where('c.id = :conversationId', { conversationId })
                .andWhere('t.chat = false')
                .getExists();

            if (quiet)
            {
                throw new ForbiddenError('Chat is off at this table.');
            }

            // The device has to be THIS ACCOUNT's, confirmed and unrevoked. It used to have to be
            // the one bound to this session, which sounds stricter and was in practice a lockout:
            // `sessions.device_id` is written only by an enrolment, so signing out and back in left
            // a browser with perfectly good keys unable to send at all - and never offered the
            // enrolment that would fix it, because its keyring is not empty.
            //
            // Nothing is given up. This check is defence in depth; the barrier that actually decides
            // authorship is the per-message SIGNATURE, which every recipient verifies against the
            // named device's published key. A caller naming a device it cannot sign for produces a
            // message that fails to open for everybody, including itself.
            const owned = await db.query(
                `select 1 as ok from devices
                 where id = $1 and user_id = $2 and revoked_at is null and confirmed_at is not null`,
                [input.senderDeviceId, me]
            );

            if (firstRow<{ ok: number }>(owned) === null)
            {
                throw new ForbiddenError('That is not a device this account can seal with.');
            }

            if (deviceId !== null && deviceId !== input.senderDeviceId)
            {
                throw new ForbiddenError('A message has to name the device that is sending it.');
            }

            const clean = input.body.trim();
            if (clean === '')
            {
                throw new BadRequestError('A message needs a body.');
            }

            if (input.kind === 'text' && input.target !== undefined)
            {
                throw new BadRequestError('A message is not about another message; a reaction is.');
            }

            if (input.kind === 'reaction')
            {
                const target = input.target ?? '';

                const found = UUID.test(target) && await db.getRepository(Message)
                    .createQueryBuilder('t')
                    .where('t.id = :target', { target })
                    .andWhere('t.conversation_id = :conversationId', { conversationId })
                    .andWhere('t.kind = :kind', { kind: 'text' })
                    .andWhere('(t.expires_at is null or t.expires_at > now())')
                    .getExists();

                if (!found)
                {
                    throw new NotFoundError('There is no such message here to react to.');
                }
            }

            if (!Number.isSafeInteger(input.seq) || input.seq < 1)
            {
                throw new BadRequestError('A message needs a sequence number.');
            }

            const clientAt = new Date(input.clientAt);
            if (Number.isNaN(clientAt.getTime()))
            {
                throw new BadRequestError('A message needs the time its sender wrote it.');
            }

            if (input.commitment.trim() === '')
            {
                throw new BadRequestError('A message needs a franking commitment.');
            }

            // Taken from the signed envelope and written down, never decided here. A server that
            // chose this could give a disappearing message a longer life than its sender asked for.
            const expiresAt = input.expiresAt === 0 ? null : new Date(input.expiresAt);

            if (expiresAt !== null && Number.isNaN(expiresAt.getTime()))
            {
                throw new BadRequestError('That is not a time this message could expire at.');
            }

            // And CHECKED against what the room agreed to. The server still never chooses the value,
            // so it still cannot lengthen a message's life; it refuses one the room did not ask for.
            // Without this, expiry is per-sender in practice whatever the design says - and somebody
            // sets sixty seconds on their own messages in a room with expiry off, so their words are
            // gone before anybody can report them and the frank goes with the row.
            const room = await db.getRepository(Conversation).findOne({
                select: { expireAfter: true },
                where: { id: conversationId }
            });

            const agreed = room?.expireAfter ?? null;
            const wanted = expiresAt === null ? null : expiresAt.getTime();

            const matchesRoom = agreed === null
                ? wanted === null
                : wanted !== null && Math.abs(wanted - (clientAt.getTime() + agreed * 1000)) <= EXPIRY_SLACK_MS;

            if (!matchesRoom)
            {
                throw new ForbiddenError('That is not how long a message in this conversation lasts.');
            }

            const known = await db.query(
                'select 1 as ok from conversation_epochs where conversation_id = $1 and epoch = $2',
                [conversationId, input.epoch]
            );

            if (firstRow<{ ok: number }>(known) === null)
            {
                throw new NotFoundError('That epoch has not been minted in this conversation.');
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

            // Stamped on the way in, over the commitment and the context it arrived in. This is the
            // only value in the whole format that is the SERVER's own claim, and the only thing it
            // ever claims is "I saw this" - which is exactly what a report needs and all it needs.
            const frank = franking.frank({
                conversationId,
                messageId: input.id,
                senderAccountId: me,
                senderDeviceId: input.senderDeviceId,
                clientAt: clientAt.getTime(),
                commitment: input.commitment
            });

            let inserted;

            try
            {
                inserted = await db.getRepository(Message)
                    .createQueryBuilder()
                    .insert()
                    .values({
                        id: input.id,
                        conversationId,
                        senderId: me,
                        kind: input.kind,
                        body: clean.slice(0, 8000),
                        epoch: input.epoch,
                        seq: String(input.seq),
                        iv: input.iv,
                        senderDeviceId: input.senderDeviceId,
                        signature: input.signature,
                        clientAt,
                        commitment: input.commitment,
                        frank,
                        expiresAt,
                        targetId: input.kind === 'reaction' ? input.target ?? null : null
                    })
                    .returning('*')
                    .execute();
            }
            catch (error)
            {
                // Either this device reused a number inside the epoch or it reused a message id.
                // Both mean the same thing to the sender - the counter it is working from is stale
                // - and both are recoverable by reading the epoch again and resending once.
                if ((error as { code?: string }).code === '23505')
                {
                    throw new ConflictError('That message number has already been used. Read the epoch again and resend.');
                }
                throw error;
            }

            const message = (inserted.raw as Omit<MessageRow, 'sender' | 'sender_account_id'>[])[0];

            // Saying something is reading it. Without this the sender's own line comes back as
            // unread to them on the next list.
            await db.query(
                'update conversation_members set last_read_at = greatest(last_read_at, $3) where conversation_id = $1 and user_id = $2',
                [conversationId, me, message.created_at]
            );

            return {
                ...message,
                sender: await handleOf(me),
                sender_account_id: me
            };
        },

        async remove(me: string, conversationId: string, messageId: string): Promise<'deleted' | 'withdrawn'>
        {
            await mustBeMember(me, conversationId);

            if (!UUID.test(messageId))
            {
                throw new NotFoundError('No such message of yours here.');
            }

            return db.transaction(async (tx) =>
            {
                const messages = tx.getRepository(Message);

                const found = await messages.findOne({
                    select: { id: true, kind: true },
                    where: { id: messageId, conversationId, senderId: me },
                    lock: { mode: 'pessimistic_write' }
                });

                if (found === null || (found.kind !== 'text' && found.kind !== 'reaction'))
                {
                    throw new NotFoundError('No such message of yours here.');
                }

                if (found.kind === 'reaction')
                {
                    await messages.delete({ id: messageId });
                    return 'withdrawn';
                }

                await messages.delete({ targetId: messageId, kind: 'reaction' });
                await messages.update({ id: messageId }, {
                    kind: 'deleted',
                    body: null,
                    iv: null,
                    signature: null,
                    commitment: null,
                    frank: null
                });

                return 'deleted';
            });
        },

        /** A server-authored line: `{ key, params }`, never prose. */
        async post(conversationId: string, kind: 'system' | 'invite' | 'result', payload: Record<string, unknown>, senderId: string | null): Promise<MessageRow>
        {
            const inserted = await db.query(
                `insert into messages (conversation_id, sender_id, kind, payload)
                 values ($1, $2, $3, $4)
                 returning id, conversation_id, kind, body, payload, created_at,
                           epoch, seq, iv, sender_device_id, signature, client_at, commitment,
                           frank, expires_at, target_id`,
                [conversationId, senderId, kind, JSON.stringify(payload)]
            );
            const message = rowsOf<Omit<MessageRow, 'sender' | 'sender_account_id'>>(inserted)[0];

            if (senderId === null)
            {
                return { ...message, sender: null, sender_account_id: null };
            }
            return {
                ...message,
                sender: await handleOf(senderId),
                sender_account_id: senderId
            };
        },

        /** Moves MY watermark forward, never back. */
        /**
         * One message, for a report to be checked against.
         *
         * Deliberately NOT membership-guarded on the reporter's behalf by this function - the caller
         * checks that, because the question here is "what did this server store", and the answer is
         * needed by moderation as well as by the person filing.
         */
        async frankedMessage(conversationId: string, messageId: string): Promise<MessageRow | null>
        {
            const rows = await db.query(
                `select x.id, x.conversation_id, x.kind, x.body, x.payload, x.created_at,
                        su.handle as sender, x.sender_id as sender_account_id,
                        x.epoch, x.seq, x.iv, x.sender_device_id, x.signature, x.client_at,
                        x.commitment, x.frank, x.expires_at
                 from messages x
                 left join users su on su.id = x.sender_id
                 where x.conversation_id = $1 and x.id = $2 and x.kind = 'text'
                   and (x.expires_at is null or x.expires_at > now())`,
                [conversationId, messageId]
            );

            return firstRow<MessageRow>(rows);
        },

        /**
         * How long a message in this room lasts, and who changed it.
         *
         * Anybody in the conversation may set it, because it is a property of the room and not of
         * whoever opened it. It applies to what is said NEXT: messages already sent were sealed with
         * their own expiry signed into them, and nothing here can reach back and shorten or extend
         * one. Turning it on does not delete history, and the copy says so.
         */
        async setExpiry(me: string, conversationId: string, seconds: number | null): Promise<number | null>
        {
            await mustBeMember(me, conversationId);

            if (seconds !== null && (!Number.isSafeInteger(seconds) || seconds < 60))
            {
                throw new BadRequestError('That is not a length of time a message can last.');
            }

            await db.getRepository(Conversation).update({ id: conversationId }, { expireAfter: seconds });
            return seconds;
        },

        /**
         * Deletes what has run out.
         *
         * Time-based rather than read-based: a message that expires only once somebody has seen it
         * is a message that lives forever in a thread nobody opens, which is exactly the archive
         * this feature exists to empty.
         */
        async sweepExpired(): Promise<number>
        {
            const gone = await db.query('delete from messages where expires_at is not null and expires_at <= now()');
            return affectedBy(gone);
        },

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
            await db.getRepository(ConversationMember).update({ conversationId, userId: me }, { pinned });
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
                    const existing = await tx.getRepository(Conversation).findOneOrFail({
                        select: { id: true },
                        where: { kind: 'direct', pairKey: key }
                    });
                    return existing.id;
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
