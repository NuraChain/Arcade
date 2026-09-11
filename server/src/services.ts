import { NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { createCatalogueService } from './domains/catalogue/service.ts';
import { createChatService, type ConversationRow, type MessageRow } from './domains/chat/service.ts';
import { createIdentityService } from './domains/identity/service.ts';
import { maySeeOnline } from './domains/social/policy.ts';
import { createSocialService, type PersonRow } from './domains/social/service.ts';
import type { ServerConfig } from './env.ts';
import { readSessionToken, SESSION_TTL_SECONDS } from './http/auth.ts';
import type { Ports } from './ports.ts';
import type { Account, ChatMessage, ConversationSummary, PersonSummary } from './schemas.ts';

/**
 * Builds the real implementations behind `Ports`.
 *
 * SERVER-ONLY. This is the first file in the chain that may touch the DataSource and the
 * entities, and nothing the browser imports may ever reach it.
 */
export function buildPorts(db: DataSource, config: ServerConfig): Ports
{
    // Secure cookies require TLS, and the browser silently drops a Secure cookie on plain http -
    // which in development is every request. Decided from configuration, never from a header a
    // caller controls.
    const secureCookies = config.origin.startsWith('https://');

    const social = createSocialService(db);
    const chat = createChatService(db, social);

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
        if (row.group_id !== null)
        {
            summary.groupId = row.group_id;
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
            id: row.id,
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

            signOut: (sessionId) => identity.signOut(sessionId),
            signOutEverywhere: (userId) => identity.signOutEverywhere(userId),
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

                return {
                    // A friend's presence is always visible to them, which is why the relation is
                    // passed as 'friend' rather than looked up again per row.
                    friends: friends.map((row) => seenBy(viewer, row, 'friend')),
                    incoming: requests.incoming.map((row) => ({
                        id: row.id,
                        from: row.from_user,
                        to: row.to_user,
                        at: row.created_at.toISOString()
                    })),
                    outgoing: requests.outgoing.map((row) => ({
                        id: row.id,
                        from: row.from_user,
                        to: row.to_user,
                        at: row.created_at.toISOString()
                    })),
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

            sendRequest: (me, otherId) => social.sendRequest(me, otherId),
            answerRequest: (me, requestId, outcome) => social.answerRequest(me, requestId, outcome),
            withdrawRequest: (me, otherId) => social.withdrawRequest(me, otherId),
            removeFriend: (me, otherId) => social.removeFriend(me, otherId),
            block: (me, otherId) => social.block(me, otherId),
            unblock: (me, otherId) => social.unblock(me, otherId),
            setMute: (me, kind, subjectId, muted) => social.setMute(me, kind, subjectId, muted),
            report: (me, againstId, category) => social.report(me, againstId, category as Parameters<typeof social.report>[2]),

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
                return {
                    allowStrangerMessages: row.allow_stranger_messages,
                    showOnline: row.show_online,
                    isMinor: row.is_minor
                };
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
                return asMessage(await chat.send(me, conversationId, body));
            },

            markRead: (me, conversationId) => chat.markRead(me, conversationId),
            setPinned: (me, conversationId, pinned) => chat.setPinned(me, conversationId, pinned),

            async openDirect(me, handle)
            {
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }
                return chat.openDirect(me, other.id);
            }
        }
    };
}
