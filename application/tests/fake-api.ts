import { ApiError, applyFieldErrors } from '@azerothjs/http/api/shared';

import { handleFromAddress, handleFromName } from '../../server/src/domains/identity/handle.ts';
import type { Account, ChatMessage, ConversationSummary, MuteSubject, Privacy } from '../../server/src/schemas.ts';
import { THREAD_FIXTURES } from '../../server/src/db/seed-fixtures.ts';

export type Refusal = 'challenge-unreachable' | 'bad-signature' | 'wallet-unreachable' | 'guest-taken';

function hueOf(text: string): number
{
    return [...text].reduce((total, character) => total + character.codePointAt(0)!, 0) % 360;
}

export const server =
{
    account: null as Account | null,
    issued: null as { nonce: string; message: string; address: string } | null,
    received: null as { address: string; nonce: string; signature: string; providerRdns?: string } | null,
    refuse: null as Refusal | null,
    calls: [] as string[],
    sessions: 3,

    /** The social half: mutes the fake server holds, and the privacy it enforces. */
    mutes: [] as { kind: MuteSubject; id: string }[],
    allowStrangerMessages: true,
    showOnline: true,
    minor: false,
    refuseMute: false,

    /**
     * The chat half: the same fixtures the development server seeds, in memory.
     *
     * Sharing the fixture file with the server is the point - a test that builds its own
     * conversations proves the client agrees with the test, not with the product.
     */
    me: 'alex',
    conversations: [] as ConversationSummary[],
    messages: [] as ChatMessage[],
    refuseSend: null as string | null,

    reset(): void
    {
        server.account = null;
        server.issued = null;
        server.received = null;
        server.refuse = null;
        server.calls = [];
        server.sessions = 3;
        server.mutes = [];
        server.allowStrangerMessages = true;
        server.showOnline = true;
        server.minor = false;
        server.refuseMute = false;
        server.me = 'alex';
        server.refuseSend = null;
        loadFixtures();
    }
};

const DEMO: Record<string, Account> = {
    alex: { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, kind: 'demo', isMinor: false },
    'sara.k': { id: 'u-sara', handle: 'sara.k', displayName: 'Sara Kamali', bio: '', hue: 340, kind: 'demo', isMinor: false },
    kian16: { id: 'u-kian', handle: 'kian16', displayName: 'Kian Nazari', bio: '', hue: 200, kind: 'demo', isMinor: true }
};

let counter = 0;

/**
 * Rebuilds the in-memory chat from the shared fixtures.
 *
 * Conversation ids are the fixture slugs rather than uuids, so a test can name `c-sara` while the
 * real server hands out uuids the client treats as opaque - which is exactly what the client does
 * with either.
 */
function loadFixtures(): void
{
    counter = 0;
    server.conversations = [];
    server.messages = [];

    const at = (minutesAgo: number): string => new Date(1_700_000_000_000 - minutesAgo * 60_000).toISOString();

    for (const thread of THREAD_FIXTURES)
    {
        if (!thread.members.includes(server.me))
        {
            continue;
        }

        for (const message of thread.messages)
        {
            counter += 1;
            server.messages.push({
                id: `m-${ counter }`,
                conversationId: thread.slug,
                kind: message.kind ?? 'text',
                from: message.from,
                at: at(message.minutesAgo),
                ...(message.body === undefined ? {} : { body: message.body }),
                ...(message.payload === undefined ? {} : { payload: message.payload })
            });
        }

        const mine = server.messages.filter((one) => one.conversationId === thread.slug);
        const last = mine[mine.length - 1];

        server.conversations.push({
            id: thread.slug,
            kind: thread.kind,
            members: thread.members,
            pinned: thread.pinnedFor === server.me,
            unread: thread.unreadFrom,
            ...(thread.game === null ? {} : { game: thread.game }),
            ...(last === undefined ? {} : { last })
        });
    }
}

loadFixtures();

export function demoAccount(handle: string): Account | undefined
{
    return DEMO[handle];
}

export function guestAccount(name: string): Account
{
    const handle = handleFromName(name);
    return { id: `u-${ handle }`, handle, displayName: name.trim(), bio: '', hue: hueOf(name), kind: 'guest', isMinor: false };
}

export function walletAccount(address: string): Account
{
    const lower = address.toLowerCase();
    return {
        id: `u-${ lower.slice(2, 10) }`,
        handle: handleFromAddress(address),
        displayName: `${ address.slice(0, 6) }…${ address.slice(-4) }`,
        bio: '',
        hue: Number.parseInt(lower.slice(2, 8), 16) % 360,
        kind: 'wallet',
        isMinor: false,
        address: lower
    };
}

export const client =
{
    meta:
    {
        async info()
        {
            server.calls.push('meta.info');
            return { wire: 'nura-e2ee/v1', env: 'test' };
        }
    },

    catalogue:
    {
        async games()
        {
            server.calls.push('catalogue.games');
            return { games: [] };
        },
        async achievements()
        {
            server.calls.push('catalogue.achievements');
            return { achievements: [] };
        }
    },

    chat:
    {
        async list()
        {
            server.calls.push('chat.list');
            return { conversations: server.conversations.map((row) => ({ ...row })) };
        },

        async messages({ params }: { params: { id: string } })
        {
            server.calls.push('chat.messages');
            const found = server.conversations.some((row) => row.id === params.id);
            if (!found)
            {
                throw new ApiError(404, 'not-found', 'No conversation with that id.', undefined);
            }
            return {
                messages: server.messages.filter((one) => one.conversationId === params.id),
                hasMore: false
            };
        },

        async send({ params, input }: { params: { id: string }; input: { body: string } })
        {
            server.calls.push('chat.send');
            if (server.refuseSend !== null)
            {
                throw new ApiError(403, 'forbidden', server.refuseSend, undefined);
            }
            counter += 1;
            const message: ChatMessage = {
                id: `m-${ counter }`,
                conversationId: params.id,
                kind: 'text',
                from: server.me,
                body: input.body,
                at: new Date(1_700_000_000_000 + counter * 1000).toISOString()
            };
            server.messages.push(message);

            const row = server.conversations.find((one) => one.id === params.id);
            if (row !== undefined)
            {
                row.last = message;
                row.unread = 0;
            }
            return message;
        },

        async read({ params }: { params: { id: string } })
        {
            server.calls.push('chat.read');
            const row = server.conversations.find((one) => one.id === params.id);
            if (row !== undefined)
            {
                row.unread = 0;
            }
            return { ok: true };
        },

        async pin({ params, input }: { params: { id: string }; input: { pinned: boolean } })
        {
            server.calls.push('chat.pin');
            const row = server.conversations.find((one) => one.id === params.id);
            if (row !== undefined)
            {
                row.pinned = input.pinned;
            }
            return { ok: true };
        },

        async direct({ input }: { input: { id: string } })
        {
            server.calls.push('chat.direct');
            const existing = server.conversations.find((row) => row.kind === 'direct'
                && row.members.length === 2
                && row.members.includes(input.id)
                && row.members.includes(server.me));
            if (existing !== undefined)
            {
                return { id: existing.id };
            }

            const id = `c-new-${ input.id }`;
            server.conversations.push({
                id,
                kind: 'direct',
                members: [server.me, input.id],
                pinned: false,
                unread: 0
            });
            return { id };
        }
    },

    social:
    {
        async graph()
        {
            server.calls.push('social.graph');
            return { friends: [], incoming: [], outgoing: [], blocked: [], mutes: [...server.mutes] };
        },

        async privacy(): Promise<Privacy>
        {
            server.calls.push('social.privacy');
            return {
                allowStrangerMessages: server.minor ? false : server.allowStrangerMessages,
                showOnline: server.showOnline,
                isMinor: server.minor
            };
        },

        // The clamp is the server's, not the caller's: a minor asking for strangers is answered
        // with false, exactly as the real one does.
        async setPrivacy({ input }: { input: { allowStrangerMessages: boolean; showOnline: boolean } }): Promise<Privacy>
        {
            server.calls.push('social.set-privacy');
            server.allowStrangerMessages = server.minor ? false : input.allowStrangerMessages;
            server.showOnline = input.showOnline;
            return {
                allowStrangerMessages: server.allowStrangerMessages,
                showOnline: server.showOnline,
                isMinor: server.minor
            };
        },

        async mute({ input }: { input: { kind: MuteSubject; id: string; muted: boolean } })
        {
            server.calls.push('social.mute');
            if (server.refuseMute)
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            server.mutes = server.mutes.filter((entry) => !(entry.kind === input.kind && entry.id === input.id));
            if (input.muted)
            {
                server.mutes.push({ kind: input.kind, id: input.id });
            }
            return { ok: true };
        }
    },

    auth:
    {
        async me()
        {
            server.calls.push('auth.me');
            return server.account === null ? {} : { account: server.account };
        },

        async challenge({ input }: { input: { address: string } })
        {
            server.calls.push('auth.challenge');
            if (server.refuse === 'challenge-unreachable')
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            server.issued = {
                address: input.address,
                nonce: `nonce-${ server.calls.length }`,
                message: `nura.games wants you to sign in with your Ethereum account:\n${ input.address }`
            };
            return { ...server.issued, expiresAt: '2026-01-01T00:00:00.000Z' };
        },

        async wallet({ input }: { input: { address: string; nonce: string; signature: string; providerRdns?: string } })
        {
            server.calls.push('auth.wallet');
            server.received = input;
            if (server.refuse === 'bad-signature')
            {
                throw new ApiError(401, 'unauthorized', 'That signature did not match the address.', undefined);
            }
            if (server.refuse === 'wallet-unreachable')
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            server.account = walletAccount(input.address);
            return { account: server.account };
        },

        async guest({ input }: { input: { name: string } })
        {
            server.calls.push('auth.guest');
            if (server.refuse === 'guest-taken')
            {
                throw new ApiError(409, 'conflict', 'That name is taken. Try another.', undefined);
            }
            server.account = guestAccount(input.name);
            return { account: server.account };
        },

        async demo({ input }: { input: { handle: string } })
        {
            server.calls.push('auth.demo');
            const account = demoAccount(input.handle);
            if (account === undefined)
            {
                throw new ApiError(404, 'not-found', 'That demo identity is not available.', undefined);
            }
            server.account = account;
            return { account };
        },

        async signOut()
        {
            server.calls.push('auth.sign-out');
            server.account = null;
            return { ended: 1 };
        },

        async signOutEverywhere()
        {
            server.calls.push('auth.sign-out-everywhere');
            server.account = null;
            const ended = server.sessions;
            server.sessions = 0;
            return { ended };
        },

        async claimHandle({ input }: { input: { handle: string } })
        {
            server.calls.push('auth.handle');
            if (server.account !== null)
            {
                server.account = { ...server.account, handle: input.handle };
            }
            return { handle: input.handle };
        }
    }
};

export { ApiError, applyFieldErrors };
