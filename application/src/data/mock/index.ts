import { runtime } from '../../lib/runtime.ts';
import { PEOPLE } from './people.ts';
import { THREADS } from './threads.ts';
import type { Conversation, FriendRequest, Message, Person } from './types.ts';

export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface Dataset
{
    seed: number;
    now: number;
    people: Person[];
    conversations: Conversation[];
    messages: Message[];
    requests: FriendRequest[];
    friends: Record<string, string[]>;
}

const FRIENDS: Record<string, string[]> = {
    'alex': ['sara.k', 'reza.t', 'parisa', 'farhad', 'dariush', 'nima.f', 'omid.j', 'nilou', 'babak.r', 'leila.a', 'yas', 'tara.y'],
    'sara.k': ['alex', 'leila.a', 'mahsa', 'mina', 'babak.r', 'elham.b', 'maya.c', 'shirin'],
    'kian16': ['roya.m', 'yas', 'hamed.z', 'tara.y']
};

const REQUESTS: Array<{ from: string; to: string; minutesAgo: number }> = [
    { from: 'mahsa', to: 'alex', minutesAgo: 35 },
    { from: 'hamed.z', to: 'alex', minutesAgo: 620 },
    { from: 'alex', to: 'maya.c', minutesAgo: 900 },
    { from: 'arash', to: 'sara.k', minutesAgo: 80 },
    { from: 'peyman', to: 'kian16', minutesAgo: 200 }
];

function buildThreads(now: number): { conversations: Conversation[]; messages: Message[] }
{
    const conversations: Conversation[] = [];
    const messages: Message[] = [];
    for (const thread of THREADS)
    {
        const ordered = [...thread.messages].sort((a, b) => b.minutesAgo - a.minutesAgo);
        ordered.forEach((seed, index) =>
        {
            messages.push({
                id: `m-${ thread.id }-${ index + 1 }`,
                conversationId: thread.id,
                from: seed.from,
                kind: seed.kind ?? 'text',
                text: seed.text,
                at: now - seed.minutesAgo * MINUTE,
                ref: seed.game === undefined ? null : { game: seed.game, tableId: `t-${ thread.id }-${ index + 1 }`, winnerId: seed.winnerId }
            });
        });
        const unreadIndex = Math.max(0, ordered.length - thread.unreadFrom);
        const lastReadAt = thread.unreadFrom === 0
            ? now
            : now - ordered[unreadIndex].minutesAgo * MINUTE - 1;
        conversations.push({
            id: thread.id,
            kind: thread.kind,
            participants: thread.participants,
            groupId: thread.groupId,
            tableId: null,
            game: thread.game,
            title: null,
            pinned: thread.pinned,
            lastReadAt
        });
    }
    return { conversations, messages };
}

function buildRequests(now: number): FriendRequest[]
{
    return REQUESTS.map((request, index) => ({
        id: `req-${ index + 1 }`,
        from: request.from,
        to: request.to,
        at: now - request.minutesAgo * MINUTE
    }));
}

/**
 * The group slugs the development fixtures seed.
 *
 * `server/tests/fixture-parity.spec.ts` fails if this list stops matching `GROUP_FIXTURES`, the
 * same way it does for people.
 */
export const GROUP_SLUGS = [
    'friday-night-crew',
    'balcony-backgammon',
    'lunch-ludo',
    'midnight-table',
    'newcomers-table'
];

/**
 * The mock friend graph.
 *
 * Only the explicit pairs now. It used to link everyone who shared a group, but a group is a row
 * on the server and the real graph is `social.friends()` - this is a profile-cache convenience
 * for the things no domain owns yet, and inventing edges from data that no longer lives here
 * would be inventing them from nothing.
 */
function buildFriends(people: Person[]): Record<string, string[]>
{
    const friends: Record<string, Set<string>> = {};
    const link = (a: string, b: string): void =>
    {
        if (a === b)
        {
            return;
        }
        (friends[a] ??= new Set()).add(b);
        (friends[b] ??= new Set()).add(a);
    };
    for (const [id, list] of Object.entries(FRIENDS))
    {
        for (const other of list)
        {
            link(id, other);
        }
    }
    const out: Record<string, string[]> = {};
    for (const person of people)
    {
        out[person.id] = [...(friends[person.id] ?? new Set<string>())];
    }
    return out;
}

export function buildDataset(seed: number, now: number): Dataset
{
    const people: Person[] = [...PEOPLE];
    const { conversations, messages } = buildThreads(now);
    const requests = buildRequests(now);
    return {
        seed,
        now,
        people,
        conversations,
        messages,
        requests,
        friends: buildFriends(people)
    };
}

let cache: Dataset | null = null;

export function dataset(): Dataset
{
    const seed = runtime().seed;
    if (cache === null || cache.seed !== seed)
    {
        cache = buildDataset(seed, runtime().clock.now());
    }
    return cache;
}

export function resetDataset(): void
{
    cache = null;
}

export function personById(id: string): Person | undefined
{
    return dataset().people.find((person) => person.id === id);
}

export function personByHandle(handle: string): Person | undefined
{
    const wanted = handle.trim().toLowerCase();
    return dataset().people.find((person) => person.handle.toLowerCase() === wanted || person.id === wanted);
}
