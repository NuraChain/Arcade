import { ApiError, applyFieldErrors } from '@azerothjs/http/api/shared';

import { handleFromAddress, handleFromName } from '../../server/src/domains/identity/handle.ts';
import type { Account, ChatMessage, ConversationSummary, MuteSubject, Privacy } from '../../server/src/schemas.ts';
import {
    FRIENDSHIP_FIXTURES,
    GROUP_FIXTURES,
    PEOPLE_FIXTURES,
    REQUEST_FIXTURES,
    THREAD_FIXTURES
} from '../../server/src/db/seed-fixtures.ts';

export type Refusal = 'challenge-unreachable' | 'bad-signature' | 'wallet-unreachable' | 'guest-taken';

function hueOf(text: string): number
{
    return [...text].reduce((total, character) => total + character.codePointAt(0)!, 0) % 360;
}

interface GroupWire
{
    id: string;
    slug: string;
    name: string;
    blurb: string;
    crest: string;
    hue: number;
    game?: string;
    owner: string;
    role?: 'owner' | 'member';
    members: string[];
    memberCount: number;
    conversationId?: string;
    createdAt: string;
}

interface SeatWire
{
    seat: number;
    who?: string;
    invited?: string;
    ready: boolean;
    host: boolean;
}

interface TableWire
{
    id: string;
    code: string;
    game: string;
    seats: number;
    mode: 'live' | 'turns';
    privacy: 'private' | 'friends' | 'public';
    target: number;
    cube: boolean;
    blinds: string;
    status: 'open' | 'ready' | 'closed';
    host?: string;
    chairs: SeatWire[];
    taken: number;
    mine?: number;
    conversationId?: string;
    createdAt: string;
}

/**
 * The seat claim, in memory.
 *
 * The RACE is the server's business and `seat-race.spec.ts` owns it against a real Postgres.
 * What this fake exists to prove is the other half: that the client sends what it said it would,
 * renders what came back, and treats "no chair" as an answer rather than an error.
 */
function restate(table: TableWire): TableWire
{
    table.taken = table.chairs.filter((chair) => chair.who !== undefined).length;
    if (table.status !== 'closed')
    {
        table.status = table.taken >= table.seats ? 'ready' : 'open';
    }
    const mine = table.chairs.find((chair) => chair.who === server.me);
    if (mine === undefined)
    {
        delete table.mine;
        delete table.conversationId;
    }
    else
    {
        table.mine = mine.seat;
        table.conversationId = `conv-${ table.id }`;
    }
    return table;
}

function mustTable(id: string): TableWire
{
    const table = server.tables.find((one) => one.id === id);
    if (table === undefined)
    {
        throw new ApiError(404, 'not-found', 'No table there.', undefined);
    }
    return table;
}

function mustGroup(slug: string): GroupWire
{
    const group = server.groups.find((one) => one.slug === slug);
    if (group === undefined)
    {
        throw new ApiError(404, 'not-found', 'No group there.', undefined);
    }
    return group;
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

    /**
     * The groups, from the same fixtures the development server seeds.
     *
     * Held as rows rather than built per call, because every write answers with the group as it
     * now stands and a test that joins one then reads the list has to see the same object twice.
     */
    groups: [] as GroupWire[],
    refuseGroup: null as string | null,
    tableSeq: 0,

    /** Tables, in memory. Empty until a test opens one - nobody is sitting anywhere on boot. */
    tables: [] as TableWire[],

    /** The graph, from the same fixtures the development server seeds. */
    friends: [] as string[],
    incoming: [] as { id: string; from: string; to: string; at: string }[],
    outgoing: [] as { id: string; from: string; to: string; at: string }[],
    blocks: [] as string[],
    reports: [] as { id: string; against: string; category: string; status: string; at: string }[],

    reset(): void
    {
        server.groups = GROUP_FIXTURES.map((group) => ({
            id: group.slug,
            slug: group.slug,
            name: group.name,
            blurb: group.blurb,
            crest: group.crest,
            hue: group.hue,
            ...(group.game === null ? {} : { game: group.game }),
            owner: group.owner,
            members: [...group.members],
            memberCount: group.members.length,
            ...(group.members.includes('alex') ? { role: group.owner === 'alex' ? 'owner' as const : 'member' as const } : {}),
            ...(group.members.includes('alex') ? { conversationId: `conv-${ group.slug }` } : {}),
            createdAt: new Date(0).toISOString()
        }));
        server.refuseGroup = null;
        server.tables = [];
        server.tableSeq = 0;
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
        loadGraph();
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

/**
 * The social graph for whoever `server.me` is, from the fixtures.
 *
 * Handles all the way through, exactly as the real wire does - there is no uuid anywhere in a
 * payload the browser sees, so a test that passes here is a test that would pass against the
 * server.
 */
function loadGraph(): void
{
    server.friends = FRIENDSHIP_FIXTURES
        .filter(([a, b]) => a === server.me || b === server.me)
        .map(([a, b]) => (a === server.me ? b : a));

    const asRequest = (request: { from: string; to: string; minutesAgo: number }, index: number) => ({
        id: `req-${ index }`,
        from: request.from,
        to: request.to,
        at: new Date(1_700_000_000_000 - request.minutesAgo * 60_000).toISOString()
    });

    server.incoming = REQUEST_FIXTURES.map(asRequest).filter((request) => request.to === server.me);
    server.outgoing = REQUEST_FIXTURES.map(asRequest).filter((request) => request.from === server.me);
    server.blocks = [];
    server.reports = [];
}

const reachable = (handle: string): boolean => !server.blocks.includes(handle) && handle !== server.me;

const personWire = (handle: string) =>
{
    const person = PEOPLE_FIXTURES.find((one) => one.handle === handle);
    return {
        id: handle,
        handle,
        displayName: person?.displayName ?? handle,
        hue: person?.hue ?? 0,
        isMinor: person?.isMinor ?? false
    };
};

loadFixtures();
loadGraph();

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

    /**
     * Groups, in memory.
     *
     * The slug claim is the server's business - `groups.db.spec.ts` owns that race - so this
     * fake takes the folded name and appends a counter when it is taken. What it exists to prove
     * is that the CLIENT sends what it said it would and renders what came back.
     */
    groups:
    {
        async mine()
        {
            server.calls.push('groups.mine');
            return { groups: server.groups.filter((group) => group.members.includes(server.me)) };
        },

        async discover()
        {
            server.calls.push('groups.discover');
            return { groups: server.groups.filter((group) => !group.members.includes(server.me)) };
        },

        async view({ params }: { params: { slug: string } })
        {
            server.calls.push('groups.view');
            const group = server.groups.find((one) => one.slug === params.slug);
            if (group === undefined)
            {
                throw new ApiError(404, 'not-found', 'No group there.', undefined);
            }
            return group;
        },

        async create({ input }: { input: { name: string; blurb: string; crest: string; hue: number; game: string } })
        {
            server.calls.push('groups.create');
            if (server.refuseGroup !== null)
            {
                throw new ApiError(409, 'conflict', server.refuseGroup, undefined);
            }

            const wanted = input.name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'group';
            let slug = wanted;
            for (let attempt = 1; server.groups.some((one) => one.slug === slug); attempt += 1)
            {
                slug = `${ wanted }-${ attempt }`;
            }

            const made: GroupWire = {
                id: slug,
                slug,
                name: input.name.trim(),
                blurb: input.blurb.trim(),
                crest: input.crest,
                hue: input.hue,
                ...(input.game === '' ? {} : { game: input.game }),
                owner: server.me,
                members: [server.me],
                memberCount: 1,
                role: 'owner',
                conversationId: `conv-${ slug }`,
                createdAt: new Date(0).toISOString()
            };
            server.groups.push(made);
            return made;
        },

        async edit({ params, input }: { params: { slug: string }; input: { name: string; blurb: string; crest: string; game: string } })
        {
            server.calls.push('groups.edit');
            const group = mustGroup(params.slug);
            group.name = input.name.trim();
            group.blurb = input.blurb.trim();
            group.crest = input.crest;
            if (input.game === '')
            {
                delete group.game;
            }
            else
            {
                group.game = input.game;
            }
            return group;
        },

        async join({ params }: { params: { slug: string } })
        {
            server.calls.push('groups.join');
            const group = mustGroup(params.slug);
            if (!group.members.includes(server.me))
            {
                group.members.push(server.me);
                group.memberCount = group.members.length;
                group.role = 'member';
                group.conversationId = `conv-${ group.slug }`;
            }
            return group;
        },

        async leave({ params }: { params: { slug: string } })
        {
            server.calls.push('groups.leave');
            const group = mustGroup(params.slug);
            group.members = group.members.filter((handle) => handle !== server.me);
            group.memberCount = group.members.length;
            delete group.role;
            delete group.conversationId;
            if (group.members.length === 0)
            {
                server.groups = server.groups.filter((one) => one.slug !== group.slug);
            }
            return { ok: true };
        },

        async add({ params, input }: { params: { slug: string }; input: { id: string } })
        {
            server.calls.push('groups.add');
            const group = mustGroup(params.slug);
            if (!group.members.includes(input.id))
            {
                group.members.push(input.id);
                group.memberCount = group.members.length;
            }
            return group;
        },

        async remove({ params, input }: { params: { slug: string }; input: { id: string } })
        {
            server.calls.push('groups.remove');
            const group = mustGroup(params.slug);
            group.members = group.members.filter((handle) => handle !== input.id);
            group.memberCount = group.members.length;
            return group;
        },

        async transfer({ params, input }: { params: { slug: string }; input: { id: string } })
        {
            server.calls.push('groups.transfer');
            const group = mustGroup(params.slug);
            group.owner = input.id;
            group.role = 'member';
            return group;
        }
    },

    tables:
    {
        async open({ query }: { query: { game?: string } })
        {
            server.calls.push('tables.open');
            return {
                tables: server.tables.filter((table) =>
                    table.status === 'open'
                    && table.privacy === 'public'
                    && (query.game === undefined || table.game === query.game)
                    && table.chairs.some((chair) => chair.who === undefined)
                    && !table.chairs.some((chair) => chair.who === server.me))
            };
        },

        async mine()
        {
            server.calls.push('tables.mine');
            return {
                tables: server.tables.filter((table) =>
                    table.status !== 'closed' && table.chairs.some((chair) => chair.who === server.me))
            };
        },

        async view({ params }: { params: { id: string } })
        {
            server.calls.push('tables.view');
            return restate(mustTable(params.id));
        },

        async byCode({ params }: { params: { code: string } })
        {
            server.calls.push('tables.byCode');
            const table = server.tables.find((one) => one.code.toLowerCase() === params.code.toLowerCase());
            if (table === undefined)
            {
                throw new ApiError(404, 'not-found', 'No table there.', undefined);
            }
            return restate(table);
        },

        async create({ input }: { input: {
            game: string;
            seats: number;
            mode: 'live' | 'turns';
            privacy: 'private' | 'friends' | 'public';
            target: number;
            cube: boolean;
            blinds: string;
            invitees: string[];
        } })
        {
            server.calls.push('tables.create');
            server.tableSeq += 1;

            const made: TableWire = {
                id: `table-${ server.tableSeq }`,
                code: `code${ server.tableSeq }`,
                game: input.game,
                seats: input.seats,
                mode: input.mode,
                privacy: input.privacy,
                target: input.target,
                cube: input.cube,
                blinds: input.blinds,
                status: 'open',
                host: server.me,
                chairs: Array.from({ length: input.seats }, (_, seat) => ({
                    seat,
                    ready: false,
                    host: seat === 0,
                    ...(seat === 0 ? { who: server.me } : {}),
                    ...(input.invitees[seat - 1] === undefined ? {} : { invited: input.invitees[seat - 1] })
                })),
                taken: 1,
                createdAt: new Date(0).toISOString()
            };
            server.tables.push(made);
            return restate(made);
        },

        async claim({ params }: { params: { id: string } })
        {
            server.calls.push('tables.claim');
            const table = mustTable(params.id);
            if (table.status === 'closed')
            {
                throw new ApiError(409, 'conflict', 'That table has closed.', undefined);
            }

            const held = table.chairs.find((chair) => chair.who === server.me);
            if (held !== undefined)
            {
                return { table: restate(table), seat: held.seat };
            }

            const free = table.chairs.find((chair) =>
                chair.who === undefined && (chair.invited === undefined || chair.invited === server.me));

            if (free === undefined)
            {
                return { table: restate(table) };
            }

            free.who = server.me;
            return { table: restate(table), seat: free.seat };
        },

        async leave({ params }: { params: { id: string } })
        {
            server.calls.push('tables.leave');
            const table = mustTable(params.id);
            for (const chair of table.chairs)
            {
                if (chair.who === server.me)
                {
                    delete chair.who;
                    chair.ready = false;
                }
            }
            restate(table);
            if (table.taken === 0)
            {
                table.status = 'closed';
            }
            return { ok: true };
        },

        async ready({ params, input }: { params: { id: string }; input: { ready: boolean } })
        {
            server.calls.push('tables.ready');
            const table = mustTable(params.id);
            const mine = table.chairs.find((chair) => chair.who === server.me);
            if (mine !== undefined)
            {
                mine.ready = input.ready;
            }
            return restate(table);
        },

        async invite({ params, input }: { params: { id: string }; input: { id: string } })
        {
            server.calls.push('tables.invite');
            const table = mustTable(params.id);
            const free = table.chairs.find((chair) => chair.who === undefined && chair.invited === undefined);
            if (free !== undefined)
            {
                free.invited = input.id;
            }
            return restate(table);
        },

        async close({ params }: { params: { id: string } })
        {
            server.calls.push('tables.close');
            const table = mustTable(params.id);
            table.status = 'closed';
            return { ok: true };
        }
    },

    social:
    {
        async graph()
        {
            server.calls.push('social.graph');
            return {
                friends: server.friends.filter(reachable).map(personWire),
                incoming: server.incoming.filter((request) => reachable(request.from)),
                outgoing: server.outgoing.filter((request) => reachable(request.to)),
                blocked: server.blocks.map(personWire),
                mutes: [...server.mutes]
            };
        },

        async people()
        {
            server.calls.push('social.people');
            return { people: PEOPLE_FIXTURES.map((one) => one.handle).filter(reachable).map(personWire) };
        },

        async suggestions()
        {
            server.calls.push('social.suggestions');
            const known = new Set([...server.friends, ...server.incoming.map((one) => one.from), ...server.outgoing.map((one) => one.to)]);
            return {
                suggestions: PEOPLE_FIXTURES
                    .map((one) => one.handle)
                    .filter((handle) => reachable(handle) && !known.has(handle))
                    .map((handle) => ({ person: personWire(handle), mutual: 0 }))
            };
        },

        async request({ input }: { input: { id: string } })
        {
            server.calls.push('social.request');
            counter += 1;
            server.outgoing.push({
                id: `req-out-${ counter }`,
                from: server.me,
                to: input.id,
                at: new Date(1_700_000_000_000).toISOString()
            });
            return { outcome: 'sent' as const };
        },

        async answer({ input }: { input: { id: string; outcome: 'accepted' | 'declined' } })
        {
            server.calls.push('social.answer');
            const request = server.incoming.find((one) => one.id === input.id);
            server.incoming = server.incoming.filter((one) => one.id !== input.id);
            if (request !== undefined && input.outcome === 'accepted')
            {
                server.friends.push(request.from);
            }
            return { ok: true };
        },

        async withdraw({ input }: { input: { id: string } })
        {
            server.calls.push('social.withdraw');
            server.outgoing = server.outgoing.filter((one) => one.to !== input.id);
            return { ok: true };
        },

        async unfriend({ input }: { input: { id: string } })
        {
            server.calls.push('social.unfriend');
            server.friends = server.friends.filter((one) => one !== input.id);
            return { ok: true };
        },

        async block({ input }: { input: { id: string } })
        {
            server.calls.push('social.block');
            if (!server.blocks.includes(input.id))
            {
                server.blocks.push(input.id);
            }
            server.friends = server.friends.filter((one) => one !== input.id);
            server.incoming = server.incoming.filter((one) => one.from !== input.id);
            server.outgoing = server.outgoing.filter((one) => one.to !== input.id);
            return { ok: true };
        },

        async unblock({ input }: { input: { id: string } })
        {
            server.calls.push('social.unblock');
            server.blocks = server.blocks.filter((one) => one !== input.id);
            return { ok: true };
        },

        async report({ input }: { input: { id: string; category: string } })
        {
            server.calls.push('social.report');
            counter += 1;
            const id = `report-${ counter }`;
            server.reports.push({
                id,
                against: input.id,
                category: input.category,
                status: 'received',
                at: new Date(1_700_000_000_000).toISOString()
            });
            return { id };
        },

        async reports()
        {
            server.calls.push('social.reports');
            return { reports: [...server.reports] };
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
