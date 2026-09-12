import { NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { createCatalogueService } from './domains/catalogue/service.ts';
import { createChatService, type ConversationRow, type MessageRow } from './domains/chat/service.ts';
import { createPeerDevices, type PeerDeviceRow } from './domains/device/peers.ts';
import { createDeviceService, type DeviceRow } from './domains/device/service.ts';
import { createGroupService, type GroupRow } from './domains/group/service.ts';
import { createNotifyService, type NotificationRow } from './domains/notify/service.ts';
import { sendPush, type VapidKeys } from './domains/notify/push.ts';
import { createTableService, type TableRow } from './domains/table/service.ts';
import { createIdentityService } from './domains/identity/service.ts';
import { maySeeOnline } from './domains/social/policy.ts';
import { createSocialService, type PersonRow } from './domains/social/service.ts';
import type { ServerConfig } from './env.ts';
import { readSessionToken, SESSION_TTL_SECONDS } from './http/auth.ts';
import type { Ports } from './ports.ts';
import type {
    Account,
    ChatMessage,
    ConversationDevices,
    ConversationSummary,
    Device,
    GroupSummary,
    Notification,
    PersonSummary,
    TableSummary
} from './schemas.ts';

/**
 * Builds the real implementations behind `Ports`.
 *
 * SERVER-ONLY. This is the first file in the chain that may touch the DataSource and the
 * entities, and nothing the browser imports may ever reach it.
 */
/**
 * What the realtime layer needs to be told, and nothing about how it says it.
 *
 * A structural type rather than the `Hub` itself, so this file does not import the gateway and
 * the client-safe line stays where it is: `api.ts` never learns a socket exists.
 */
export interface WriteListener
{
    chatChanged(conversationId: string): void;
    socialChanged(...userIds: string[]): void;
    sessionsRevoked(sessionIds: readonly string[]): void;
}

export function buildPorts(db: DataSource, config: ServerConfig, live?: WriteListener): Ports
{
    // Secure cookies require TLS, and the browser silently drops a Secure cookie on plain http -
    // which in development is every request. Decided from configuration, never from a header a
    // caller controls.
    const secureCookies = config.origin.startsWith('https://');

    const social = createSocialService(db);
    const chat = createChatService(db, social);
    const group = createGroupService(db, social);
    const table = createTableService(db, social);
    const notify = createNotifyService(db, social);

    /**
     * Push, if this deployment has it.
     *
     * All three variables together or none: a half-configured push is one that asks for permission
     * and then never delivers, which is worse than not asking.
     */
    const vapid: VapidKeys | null = config.vapidPublicKey !== '' && config.vapidPrivateKey !== '' && config.vapidSubject !== ''
        ? { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject }
        : null;

    /**
     * Wakes somebody's browsers, and never makes a request wait for it.
     *
     * The push carries nothing. It is a nudge to open the app, where the content comes over a
     * session the reader is already authorised on - which is the only shape that survives
     * `nura-e2ee/v1`, because this server will not be able to read the message either.
     *
     * Fire and forget on purpose: a push service being slow must not make sending a message slow,
     * and a push service being down must not make it fail.
     */
    const wake = (userId: string): void =>
    {
        if (vapid === null)
        {
            return;
        }

        void (async () =>
        {
            for (const subscription of await notify.subscriptionsOf(userId))
            {
                const outcome = await sendPush(subscription.endpoint, vapid, Date.now());
                if (outcome === 'gone')
                {
                    await notify.retire(subscription.id);
                }
            }
        })().catch(() => undefined);
    };

    /** Tells somebody, then wakes them if they asked to be woken. */
    const tell = async (input: {
        userId: string;
        kind: Notification['kind'];
        actorId: string | null;
        ref: Record<string, string>;
        dedupeKey: string;
    }): Promise<void> =>
    {
        if (await notify.tell(input))
        {
            wake(input.userId);
        }
    };

    const asNotification = (row: NotificationRow): Notification =>
    {
        const item: Notification = {
            id: row.id,
            kind: row.kind,
            ref: row.ref,
            count: row.count,
            at: row.created_at.toISOString(),
            read: row.read_at !== null
        };
        if (row.actor !== null)
        {
            item.actor = row.actor;
        }
        return item;
    };

    /**
     * The cursor, as one opaque string.
     *
     * The client never takes it apart - it hands back the last one it was given - which is what
     * lets the keyset change shape later without a client release.
     */
    const encodeCursor = (at: Date, id: string): string =>
        Buffer.from(`${ at.toISOString() }|${ id }`, 'utf8').toString('base64url');

    const decodeCursor = (cursor: string | undefined): { at: Date; id: string } | null =>
    {
        if (cursor === undefined || cursor === '')
        {
            return null;
        }
        const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
        const when = new Date(at ?? '');
        return id === undefined || Number.isNaN(when.getTime()) ? null : { at: when, id };
    };

    const asMessage = (row: MessageRow): ChatMessage =>
    {
        const message: ChatMessage = {
            id: row.id,
            conversationId: row.conversation_id,
            kind: row.kind,
            at: row.created_at.toISOString()
        };
        if (row.sender !== null)
        {
            message.from = row.sender;
        }
        if (row.body !== null)
        {
            message.body = row.body;
        }
        if (row.payload !== null)
        {
            message.payload = row.payload as ChatMessage['payload'];
        }
        return message;
    };

    /**
     * A handle, as the uuid the tables are keyed on.
     *
     * Every person-taking route goes through here, so "the wire speaks handles" is one
     * translation at the edge rather than a rule each route is trusted to remember.
     */
    const mustResolve = async (handle: string): Promise<string> =>
    {
        const row = await social.personByHandle(handle);
        if (row === null)
        {
            throw new NotFoundError('No account with that name.');
        }
        return row.id;
    };

    const asRequest = (row: { id: string; from_user: string; to_user: string; created_at: Date }, handles: Map<string, string>) => ({
        id: row.id,
        from: handles.get(row.from_user) ?? '',
        to: handles.get(row.to_user) ?? '',
        at: row.created_at.toISOString()
    });

    const asConversation = (row: ConversationRow): ConversationSummary =>
    {
        const summary: ConversationSummary = {
            id: row.id,
            kind: row.kind,
            members: row.members,
            pinned: row.pinned,
            unread: row.unread
        };
        if (row.game !== null)
        {
            summary.game = row.game;
        }
        if (row.title !== null)
        {
            summary.title = row.title;
        }
        if (row.group_slug !== null)
        {
            summary.groupId = row.group_slug;
        }
        if (row.table_id !== null)
        {
            summary.tableId = row.table_id;
        }
        if (row.last_id !== null && row.last_at !== null && row.last_kind !== null)
        {
            summary.last = asMessage({
                id: row.last_id,
                conversation_id: row.id,
                kind: row.last_kind,
                body: row.last_body,
                payload: row.last_payload,
                sender: row.last_from,
                created_at: row.last_at
            });
        }
        return summary;
    };

    const asGroup = (row: GroupRow): GroupSummary =>
    {
        const summary: GroupSummary = {
            id: row.slug,
            slug: row.slug,
            name: row.name,
            blurb: row.blurb,
            crest: row.crest,
            hue: row.hue,
            owner: row.owner ?? '',
            members: row.members,
            memberCount: row.member_count,
            createdAt: row.created_at.toISOString()
        };
        if (row.game !== null)
        {
            summary.game = row.game;
        }
        if (row.role !== null)
        {
            summary.role = row.role;

            // Only a member is given the thread. A non-member holding the id could not read it -
            // `mustBeMember` sees to that - but an id it has no use for is an id it should not
            // have been sent.
            if (row.conversation_id !== null)
            {
                summary.conversationId = row.conversation_id;
            }
        }
        return summary;
    };

    const mustSee = async (me: string, slug: string): Promise<GroupRow> =>
    {
        const found = await group.bySlug(me, slug);
        if (found === null)
        {
            throw new NotFoundError('No group there.');
        }
        return found;
    };

    const reread = async (me: string, groupId: string): Promise<GroupRow> =>
    {
        const found = await group.byId(me, groupId);
        if (found === null)
        {
            throw new NotFoundError('No group there.');
        }
        return found;
    };

    /**
     * Writes the line that says what just happened, into the group's own thread.
     *
     * `{ key, params }`, never prose - which is what lets it follow a language switch, and what
     * stops a server-authored row from reading like something a person said. An explicit `who`
     * wins over the actor's handle, because "Sara was removed" names Sara while the row records
     * that the owner wrote it.
     *
     * A failed line does not undo the change it describes: the membership is the fact and the
     * announcement is the courtesy, so this is deliberately outside the transaction.
     */
    const announce = async (
        row: GroupRow,
        actor: string | null,
        what: 'created' | 'joined' | 'left' | 'removed' | 'renamed' | 'owner',
        params: Record<string, string>
    ): Promise<void> =>
    {
        if (row.conversation_id === null)
        {
            return;
        }

        const named = params.who ?? (actor === null ? undefined : (await social.handlesOf([actor])).get(actor));
        await chat.post(
            row.conversation_id,
            'system',
            { key: `chat.line.group.${ what }`, params: { ...params, ...(named === undefined ? {} : { who: named }) } },
            actor
        );
    };

    /**
     * The doorbell for a group that changed.
     *
     * Two scopes, not a third: the thread's membership moved (`chat`) and so did everybody's
     * group list (`social`). A `group` scope would carry no information the other two do not
     * already carry, and a wire grows for new information rather than for new vocabulary.
     */
    const ring = async (row: GroupRow, ...also: string[]): Promise<void> =>
    {
        if (row.conversation_id !== null)
        {
            live?.chatChanged(row.conversation_id);
        }
        live?.socialChanged(...await group.memberIds(row.id), ...also);
    };

    const asTable = (row: TableRow): TableSummary =>
    {
        const summary: TableSummary = {
            id: row.id,
            code: row.code,
            game: row.game,
            seats: row.seats,
            mode: row.mode,
            privacy: row.privacy,
            target: row.target,
            cube: row.cube,
            blinds: row.blinds,
            status: row.status,
            chairs: row.chairs.map((chair) => ({
                seat: chair.seat,
                ready: chair.ready,
                host: chair.host,
                ...(chair.who === null ? {} : { who: chair.who }),
                ...(chair.invited === null ? {} : { invited: chair.invited })
            })),
            taken: row.taken,
            createdAt: row.created_at.toISOString()
        };

        if (row.host !== null)
        {
            summary.host = row.host;
        }
        if (row.mine !== null)
        {
            summary.mine = row.mine;

            // Only somebody sitting here is given the thread. A non-player holding the id could
            // not read it anyway, and an id with no use is an id that should not have been sent.
            if (row.conversation_id !== null)
            {
                summary.conversationId = row.conversation_id;
            }
        }
        return summary;
    };

    const mustTable = async (me: string, tableId: string): Promise<TableRow> =>
    {
        const found = await table.byId(me, tableId);
        if (found === null)
        {
            throw new NotFoundError('No table there.');
        }
        return found;
    };

    /**
     * The doorbell for a table that changed.
     *
     * The same two scopes groups use, for the same reason: the table thread's membership moved
     * (`chat`) and so did everybody's list of where they are sitting (`social`). A third scope
     * would be new vocabulary for information these two already carry.
     */
    const ringTable = async (row: TableRow, ...also: string[]): Promise<void> =>
    {
        if (row.conversation_id !== null)
        {
            live?.chatChanged(row.conversation_id);
        }
        live?.socialChanged(...await table.seatedIds(row.id), ...also);
    };

    const peers = createPeerDevices(db);

    /**
     * Folds the join back into one entry per member.
     *
     * The LEFT JOIN gives one row per (member, device) and one null-device row for a member with
     * none. Grouping here rather than in SQL keeps the empty case obvious: the member is created
     * with an empty array the first time their handle is seen, and a null device id simply adds
     * nothing to it.
     */
    const asConversationDevices = (rows: PeerDeviceRow[]): ConversationDevices =>
    {
        const byHandle = new Map<string, ConversationDevices['members'][number]>();

        for (const row of rows)
        {
            let member = byHandle.get(row.handle);
            if (member === undefined)
            {
                member = { handle: row.handle, kind: row.kind, devices: [] };
                byHandle.set(row.handle, member);
            }

            // Every proof field is non-null together by CHECK constraint, so one test covers the
            // set; the casts are the compiler catching up with what the database already refuses.
            if (row.device_id !== null && row.attested !== null && row.attested_address !== null)
            {
                member.devices.push({
                    id: row.device_id,
                    exchangeKey: row.exchange_key!,
                    signingKey: row.signing_key!,
                    attested: row.attested,
                    address: row.attested_address,
                    message: row.attested_message!,
                    signature: row.attested_signature!
                });
            }
        }

        return { members: [...byHandle.values()] };
    };

    const device = createDeviceService(db, {
        origin: config.origin,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl
    });

    /**
     * A device as the browser reads it.
     *
     * Both public keys go out, because the client re-derives the id from them on every read and a
     * row it cannot check is a row it has to take on trust. `confirmed` and `revoked` are booleans
     * rather than the timestamps behind them: nothing renders when a device was confirmed, and a
     * date on the wire is a date somebody eventually displays in the wrong timezone.
     */
    const asDevice = (row: DeviceRow): Device => ({
        id: row.id,
        label: row.label,
        exchangeKey: row.exchange_key,
        signingKey: row.signing_key,
        attested: row.attested,
        confirmed: row.confirmed_at !== null,
        revoked: row.revoked_at !== null,
        createdAt: row.created_at.toISOString(),
        ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at.toISOString() })
    });

    const identity = createIdentityService(db, {
        origin: config.origin,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        sessionTtlSeconds: SESSION_TTL_SECONDS
    });

    const present = (row: {
        id: string;
        handle: string;
        display_name: string;
        bio: string;
        hue: number;
        kind: 'wallet' | 'guest';
        is_minor: boolean;
        address: string | null;
    }): Account => ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        bio: row.bio,
        hue: row.hue,
        kind: row.kind,
        isMinor: row.is_minor,
        address: row.address ?? undefined
    });

    /**
     * A person, with what the viewer may not know REMOVED rather than flagged.
     *
     * `lastSeenAt` is the only field privacy touches today, and it is omitted - not nulled, not
     * sent with a "don't show this" flag - because a payload the client has to be trusted to
     * filter is a payload one component forgets to filter. If it is not in the JSON, no render
     * path can leak it.
     */
    const seenBy = (viewer: PersonRow, row: PersonRow, relation: Parameters<typeof maySeeOnline>[2]): PersonSummary =>
    {
        const summary: PersonSummary = {
            // The handle, not the uuid. The browser keys people by handle - it is the public
            // identifier, it is what the URL carries, and it is what a message's author is - so
            // the wire says the same thing everywhere rather than two names for one person.
            id: row.handle,
            handle: row.handle,
            displayName: row.display_name,
            bio: row.bio,
            hue: row.hue,
            isMinor: row.is_minor
        };

        if (row.last_seen_at !== null && maySeeOnline(social.partyOf(viewer), social.partyOf(row), relation))
        {
            summary.lastSeenAt = row.last_seen_at.toISOString();
        }
        return summary;
    };

    return {
        meta: {
            info: () => ({ wire: 'nura-e2ee/v1', env: process.env.NODE_ENV ?? 'development' })
        },

        catalogue: createCatalogueService(db),

        identity: {
            secureCookies,

            async principal(request)
            {
                const token = readSessionToken(request, secureCookies);
                return token === null ? null : identity.principalFor(token);
            },

            async me(userId)
            {
                const row = await identity.profileFor(userId);
                return row === null ? null : present(row);
            },

            challenge: (address) => identity.challenge(address),

            async signInWithWallet(input)
            {
                const result = await identity.signInWithWallet(input);
                const row = await identity.profileFor(result.principal.userId);
                return { token: result.token, account: present(row!) };
            },

            async signInAsGuest(input)
            {
                const result = await identity.signInAsGuest(input);
                const row = await identity.profileFor(result.principal.userId);
                return { token: result.token, account: present(row!) };
            },

            async signOut(sessionId)
            {
                await identity.signOut(sessionId);
                live?.sessionsRevoked([sessionId]);
            },

            async signOutEverywhere(userId)
            {
                const ended = await identity.signOutEverywhere(userId);

                // Every socket this account holds, not only the one that asked. Signing out
                // everywhere that leaves a live socket open is the feature not working.
                live?.socialChanged(userId);
                live?.sessionsRevoked(await identity.sessionsOf(userId));
                return ended;
            },
            claimHandle: (userId, handle) => identity.claimHandle(userId, handle)
        },

        social: {
            async graph(me)
            {
                const viewer = await social.person(me);
                if (viewer === null)
                {
                    return { friends: [], incoming: [], outgoing: [], blocked: [], mutes: [] };
                }

                const [friends, requests, blocked, mutes] = await Promise.all([
                    social.friends(me),
                    social.requests(me),
                    social.blocked(me),
                    social.mutes(me)
                ]);

                // A request names two people, and the wire names people by handle - so the two
                // uuids on the row have to be resolved before it leaves.
                const handles = await social.handlesOf([
                    ...requests.incoming.flatMap((row) => [row.from_user, row.to_user]),
                    ...requests.outgoing.flatMap((row) => [row.from_user, row.to_user])
                ]);

                return {
                    // A friend's presence is always visible to them, which is why the relation is
                    // passed as 'friend' rather than looked up again per row.
                    friends: friends.map((row) => seenBy(viewer, row, 'friend')),
                    incoming: requests.incoming.map((row) => asRequest(row, handles)),
                    outgoing: requests.outgoing.map((row) => asRequest(row, handles)),
                    blocked: blocked.map((row) => seenBy(viewer, row, 'blocked')),
                    mutes
                };
            },

            async directory(me, limit)
            {
                const viewer = await social.person(me);
                if (viewer === null)
                {
                    return [];
                }
                const people = await social.directory(me, limit);
                const friends = new Set((await social.friends(me)).map((row) => row.id));
                return people.map((row) => seenBy(viewer, row, friends.has(row.id) ? 'friend' : 'none'));
            },

            async suggestions(me, limit)
            {
                const viewer = await social.person(me);
                if (viewer === null)
                {
                    return [];
                }
                const ranked = await social.suggestions(me, limit);
                return ranked.map((entry) => ({ person: seenBy(viewer, entry.person, 'none'), mutual: entry.mutual }));
            },

            async view(me, handle)
            {
                const [viewer, subject] = await Promise.all([social.person(me), social.personByHandle(handle)]);
                if (viewer === null || subject === null)
                {
                    return null;
                }

                const { relation } = await social.relationOf(me, subject.id);
                const mutual = (await social.mutualWith(me, [subject.id])).get(subject.id) ?? 0;
                const refusal = await social.mayMessage(me, subject.id);

                return {
                    person: seenBy(viewer, subject, relation),
                    relation,
                    mutual,
                    ...(refusal === null ? {} : { refusal })
                };
            },

            // Every one of these moves who may see or reach whom, so every one of them tells the
            // hub - including `setPrivacy` below, which writes the very column `maySeeOnline`
            // reads. A write that forgets leaves a cached edge standing until its ceiling.
            async sendRequest(me, handle)
            {
                const other = await mustResolve(handle);
                const outcome = await social.sendRequest(me, other);

                // Deduped on the SENDER, so asking twice is one notification. A request that was
                // answered by the asking - both sides wanted it - tells the other person they
                // were accepted rather than that they were asked.
                await tell({
                    userId: other,
                    kind: outcome.outcome === 'accepted' ? 'friend-accepted' : 'friend-request',
                    actorId: me,
                    ref: {},
                    dedupeKey: `friend:${ me }`
                });

                live?.socialChanged(me, other);
                return outcome;
            },

            async answerRequest(me, requestId, outcome)
            {
                const asker = await social.requesterOf(me, requestId);
                await social.answerRequest(me, requestId, outcome);

                // Only an acceptance is worth telling somebody about. A decline that announced
                // itself would be a product that makes saying no cost something.
                if (outcome === 'accepted' && asker !== null)
                {
                    await tell({
                        userId: asker,
                        kind: 'friend-accepted',
                        actorId: me,
                        ref: {},
                        dedupeKey: `friend:${ me }`
                    });
                }

                live?.socialChanged(me);
            },

            async withdrawRequest(me, handle)
            {
                const other = await mustResolve(handle);
                await social.withdrawRequest(me, other);
                live?.socialChanged(me, other);
            },

            async removeFriend(me, handle)
            {
                const other = await mustResolve(handle);
                await social.removeFriend(me, other);
                live?.socialChanged(me, other);
            },

            async block(me, handle)
            {
                const other = await mustResolve(handle);
                await social.block(me, other);
                live?.socialChanged(me, other);
            },

            async unblock(me, handle)
            {
                const other = await mustResolve(handle);
                await social.unblock(me, other);
                live?.socialChanged(me, other);
            },
            setMute: (me, kind, subjectId, muted) => social.setMute(me, kind, subjectId, muted),

            report: async (me, handle, category) =>
                social.report(me, await mustResolve(handle), category as Parameters<typeof social.report>[2]),

            async reports(me)
            {
                const rows = await social.reportsBy(me);
                const handles = await social.handlesOf(rows.map((row) => row.against));
                return rows.map((row) => ({
                    id: row.id,
                    against: handles.get(row.against) ?? '',
                    category: row.category,
                    status: row.status,
                    at: row.created_at.toISOString()
                }));
            },

            async privacy(me)
            {
                const row = await social.person(me);
                if (row === null)
                {
                    return { allowStrangerMessages: false, showOnline: false, isMinor: false };
                }
                return {
                    allowStrangerMessages: row.allow_stranger_messages,
                    showOnline: row.show_online,
                    isMinor: row.is_minor
                };
            },

            async setPrivacy(me, wanted)
            {
                const row = await social.setPrivacy(me, wanted);
                live?.socialChanged(me);
                return {
                    allowStrangerMessages: row.allow_stranger_messages,
                    showOnline: row.show_online,
                    isMinor: row.is_minor
                };
            }
        },

        group: {
            async mine(me)
            {
                return (await group.mine(me)).map(asGroup);
            },

            async discover(me, limit)
            {
                return (await group.discover(me, limit)).map(asGroup);
            },

            async view(me, slug)
            {
                const found = await group.bySlug(me, slug);
                return found === null ? null : asGroup(found);
            },

            async create(me, input)
            {
                const made = await group.create(me, {
                    name: input.name,
                    blurb: input.blurb,
                    crest: input.crest,
                    hue: input.hue,
                    game: input.game === '' ? null : input.game
                });

                await announce(made, me, 'created', {});
                live?.socialChanged(me);
                return asGroup(made);
            },

            async edit(me, slug, input)
            {
                const before = await mustSee(me, slug);
                const after = await group.update(me, before.id, {
                    name: input.name,
                    blurb: input.blurb,
                    crest: input.crest,
                    game: input.game === '' ? null : input.game
                });

                if (after.name !== before.name)
                {
                    await announce(after, me, 'renamed', { name: after.name });
                }
                await ring(after);
                return asGroup(after);
            },

            async join(me, slug)
            {
                const found = await mustSee(me, slug);
                const arrived = await group.join(me, found.id);

                const after = await reread(me, found.id);
                if (arrived)
                {
                    await announce(after, me, 'joined', {});
                    await ring(after);
                }
                return asGroup(after);
            },

            async leave(me, slug)
            {
                const found = await mustSee(me, slug);
                const members = await group.memberIds(found.id);

                // The line goes in BEFORE the seat does, or it is written into a thread this
                // account has just been removed from - and a conversation it can no longer read.
                await announce(found, me, 'left', {});
                const outcome = await group.leave(me, found.id);

                if (outcome.newOwner !== null)
                {
                    await announce(found, null, 'owner', { who: outcome.newOwner });
                }
                if (!outcome.deleted)
                {
                    live?.chatChanged(found.conversation_id ?? '');
                }
                live?.socialChanged(...members);
                return null;
            },

            async add(me, slug, handle)
            {
                const found = await mustSee(me, slug);
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                const arrived = await group.add(me, found.id, other.id);
                const after = await reread(me, found.id);

                if (arrived)
                {
                    await announce(after, me, 'joined', { who: other.handle });
                    await tell({
                        userId: other.id,
                        kind: 'group-added',
                        actorId: me,
                        ref: { groupId: after.slug },
                        dedupeKey: `group:${ after.id }`
                    });
                    await ring(after, other.id);
                }
                return asGroup(after);
            },

            async remove(me, slug, handle)
            {
                const found = await mustSee(me, slug);
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                const removed = await group.remove(me, found.id, other.id);
                const after = await reread(me, found.id);

                if (removed)
                {
                    await announce(after, me, 'removed', { who: other.handle });
                    await ring(after, other.id);
                }
                return asGroup(after);
            },

            async transfer(me, slug, handle)
            {
                const found = await mustSee(me, slug);
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                await group.transfer(me, found.id, other.id);
                const after = await reread(me, found.id);

                await announce(after, me, 'owner', { who: other.handle });
                await ring(after);
                return asGroup(after);
            }
        },

        table: {
            async open(me, game, limit)
            {
                return (await table.open(me, game ?? null, limit)).map(asTable);
            },

            async mine(me)
            {
                return (await table.mine(me)).map(asTable);
            },

            async view(me, tableId)
            {
                const found = await table.byId(me, tableId);
                return found === null ? null : asTable(found);
            },

            async byCode(me, code)
            {
                const found = await table.byCode(me, code);
                return found === null ? null : asTable(found);
            },

            async create(me, input)
            {
                const guests = await Promise.all(input.invitees.map((handle) => social.personByHandle(handle)));
                const known = guests.filter((person): person is NonNullable<typeof person> => person !== null);

                const made = await table.create(me, { ...input, invitees: known.map((person) => person.id) });
                live?.socialChanged(me, ...known.map((person) => person.id));
                return asTable(made);
            },

            async claim(me, tableId)
            {
                const seat = await table.claimSeat(me, tableId);
                const after = await mustTable(me, tableId);

                if (seat !== null)
                {
                    await ringTable(after);
                }
                return { table: asTable(after), seat };
            },

            async leave(me, tableId)
            {
                const before = await mustTable(me, tableId);
                const seated = await table.seatedIds(before.id);

                await table.leave(me, before.id);

                if (before.conversation_id !== null)
                {
                    live?.chatChanged(before.conversation_id);
                }
                live?.socialChanged(...seated);
            },

            async setReady(me, tableId, ready)
            {
                await table.setReady(me, tableId, ready);
                const after = await mustTable(me, tableId);
                await ringTable(after);
                return asTable(after);
            },

            async invite(me, tableId, handle)
            {
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                await table.invite(me, tableId, other.id);
                const after = await mustTable(me, tableId);

                await tell({
                    userId: other.id,
                    kind: 'table-invite',
                    actorId: me,
                    ref: { tableId: after.id },
                    dedupeKey: `table:${ after.id }`
                });

                await ringTable(after, other.id);
                return asTable(after);
            },

            async close(me, tableId)
            {
                const before = await mustTable(me, tableId);
                const seated = await table.seatedIds(before.id);

                await table.close(me, before.id);

                if (before.conversation_id !== null)
                {
                    live?.chatChanged(before.conversation_id);
                }
                live?.socialChanged(...seated);
            }
        },

        notify: {
            async page(me, cursor)
            {
                const page = await notify.page(me, decodeCursor(cursor));
                const oldest = page.items[page.items.length - 1];

                return {
                    items: page.items.map(asNotification),
                    hasMore: page.hasMore,
                    unread: await notify.unread(me),
                    ...(page.hasMore && oldest !== undefined
                        ? { cursor: encodeCursor(oldest.created_at, oldest.id) }
                        : {})
                };
            },

            markRead: (me, id) => notify.markRead(me, id),
            markAllRead: (me) => notify.markAllRead(me),
            dismiss: (me, id) => notify.dismiss(me, id),

            pushKey: () => (vapid === null ? undefined : vapid.publicKey),

            subscribe: (me, input) => notify.subscribe(me, input),
            unsubscribe: (me, endpoint) => notify.unsubscribe(me, endpoint)
        },

        device: {
            async list(me, sessionId)
            {
                const [devices, current] = await Promise.all([
                    device.list(me),
                    device.deviceOfSession(sessionId)
                ]);
                return { devices: devices.map(asDevice), ...(current === null ? {} : { current }) };
            },

            challenge: (me, deviceId) => device.challenge(me, deviceId),

            async enrol(me, sessionId, input)
            {
                return asDevice(await device.enrol(me, sessionId, input));
            },

            async confirm(me, sessionId, deviceId)
            {
                const caller = await device.deviceOfSession(sessionId);
                return asDevice(await device.confirm(me, caller, deviceId));
            },

            async rename(me, deviceId, label)
            {
                return asDevice(await device.rename(me, deviceId, label));
            },

            /**
             * Revoking has to REACH the device, not merely mark it.
             *
             * The sessions bound to it are revoked in the same transaction, and their sockets are
             * closed here - a revoked device holding a live connection is a device that has not
             * been revoked yet.
             */
            async revoke(me, deviceId)
            {
                const { device: row, sessions } = await device.revoke(me, deviceId);
                if (sessions.length > 0)
                {
                    live?.sessionsRevoked(sessions);
                }
                return asDevice(row);
            }
        },

        chat: {
            async list(me)
            {
                return (await chat.list(me)).map(asConversation);
            },

            /**
             * Membership IS the authorisation, exactly as it is for reading the messages.
             *
             * `mustBeMember` throws the same NotFoundError a missing conversation does, so an id
             * cannot be probed for existence by asking who is in it.
             */
            async devices(me, conversationId)
            {
                await chat.mustBeMember(me, conversationId);
                return asConversationDevices(await peers.forConversation(conversationId));
            },

            async messages(me, conversationId, cursor)
            {
                const page = await chat.messages(me, conversationId, decodeCursor(cursor));
                const oldest = page.messages[0];
                return {
                    messages: page.messages.map(asMessage),
                    hasMore: page.hasMore,
                    ...(page.hasMore && oldest !== undefined
                        ? { cursor: encodeCursor(oldest.created_at, oldest.id) }
                        : {})
                };
            },

            async send(me, conversationId, body)
            {
                const message = asMessage(await chat.send(me, conversationId, body));

                // One notification per conversation, counting up. Twelve messages while somebody
                // was away is one row saying twelve, not twelve rows to swipe through - and the
                // count resets when they read it, because that is what reading it means.
                for (const recipient of await chat.recipients(conversationId))
                {
                    if (recipient !== me)
                    {
                        await tell({
                            userId: recipient,
                            kind: 'message',
                            actorId: me,
                            ref: { conversationId },
                            dedupeKey: `chat:${ conversationId }`
                        });
                    }
                }

                live?.chatChanged(conversationId);
                return message;
            },

            async markRead(me, conversationId)
            {
                await chat.markRead(me, conversationId);

                // Nobody is excluded, including the person who just read it: their OTHER tabs are
                // the ones that would otherwise keep showing the badge.
                live?.chatChanged(conversationId);
            },

            async setPinned(me, conversationId, pinned)
            {
                await chat.setPinned(me, conversationId, pinned);
                live?.chatChanged(conversationId);
            },

            async openDirect(me, handle)
            {
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }
                const conversationId = await chat.openDirect(me, other.id);
                live?.chatChanged(conversationId);
                return conversationId;
            }
        }
    };
}
