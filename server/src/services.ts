import { NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { createCatalogueService } from './domains/catalogue/service.ts';
import { createChatService, type ConversationRow, type MessageRow } from './domains/chat/service.ts';
import { createGroupService, type GroupRow } from './domains/group/service.ts';
import { createIdentityService } from './domains/identity/service.ts';
import { maySeeOnline } from './domains/social/policy.ts';
import { createSocialService, type PersonRow } from './domains/social/service.ts';
import type { ServerConfig } from './env.ts';
import { readSessionToken, SESSION_TTL_SECONDS } from './http/auth.ts';
import type { Ports } from './ports.ts';
import type { Account, ChatMessage, ConversationSummary, GroupSummary, PersonSummary } from './schemas.ts';

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
        kind: 'wallet' | 'demo' | 'guest';
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

            async signInAsDemo(input)
            {
                const result = await identity.signInAsDemo(input);
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
                live?.socialChanged(me, other);
                return outcome;
            },

            async answerRequest(me, requestId, outcome)
            {
                await social.answerRequest(me, requestId, outcome);
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

        chat: {
            async list(me)
            {
                return (await chat.list(me)).map(asConversation);
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
