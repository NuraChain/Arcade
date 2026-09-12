import { createRandom, hashSeed } from '../../lib/random.ts';
import { runtime } from '../../lib/runtime.ts';
import { GAMES, type GameId } from '../games.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { PEOPLE, type PersonSeed } from './people.ts';
import { THREADS } from './threads.ts';
import type { Activity, Conversation, FriendRequest, GameRecord, Message, Person, Skill } from './types.ts';

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
    activity: Activity[];
    requests: FriendRequest[];
    friends: Record<string, string[]>;
}

const SKILL_PLAYED: Record<Skill, [number, number]> = {
    new: [1, 8],
    casual: [10, 40],
    regular: [40, 120],
    sharp: [120, 320],
    expert: [300, 800]
};

const SKILL_WIN_RATE: Record<Skill, number> = { new: 0.3, casual: 0.42, regular: 0.5, sharp: 0.57, expert: 0.64 };

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

function buildPerson(seed: PersonSeed, now: number, datasetSeed: number): Person
{
    const random = createRandom(hashSeed(datasetSeed, 'person', seed.id));
    const [low, high] = SKILL_PLAYED[seed.skill];
    const favouritePlayed = random.int(low, high);
    const stats = {} as Record<GameId, GameRecord>;
    let total = 0;
    for (const game of GAMES)
    {
        const played = game.id === seed.favourite ? favouritePlayed : Math.round(favouritePlayed * random.next() * 0.6);
        const won = Math.round(played * (SKILL_WIN_RATE[seed.skill] + (random.next() - 0.5) * 0.12));
        stats[game.id] = { played, won: Math.min(played, Math.max(0, won)), streak: played > 0 ? random.int(0, 4) : 0 };
        total += played;
    }
    const thresholds = [1, 1, 8, 12, 25, 40, 60, 90, 120, 200, 100, 50];
    const earned = ACHIEVEMENTS.filter((_achievement, index) => total >= thresholds[index] && random.chance(0.85))
        .map((achievement) => achievement.id);
    return {
        ...seed,
        level: Math.max(1, Math.round(Math.sqrt(total) * 1.6)),
        reliability: Math.min(100, Math.round(88 + random.next() * 12 - (seed.skill === 'new' ? 4 : 0))),
        joinedAt: now - random.int(seed.skill === 'new' ? 3 : 20, seed.skill === 'expert' ? 700 : 300) * DAY,
        stats,
        achievements: earned
    };
}

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
 * The groups a "joined" activity may point at.
 *
 * Slugs only - a group's name, crest and members are the server's now, and the activity row
 * carries an id the way every other row does. `server/tests/fixture-parity.spec.ts` fails if
 * this list stops matching `GROUP_FIXTURES`, the same way it does for people.
 *
 * The whole activity feed is mock furniture until the activity domain lands.
 */
export const GROUP_SLUGS = [
    'friday-night-crew',
    'balcony-backgammon',
    'lunch-ludo',
    'midnight-table',
    'newcomers-table'
];

function buildActivity(people: Person[], now: number, datasetSeed: number): Activity[]
{
    const random = createRandom(hashSeed(datasetSeed, 'activity'));
    const kinds: Activity['kind'][] = ['played', 'won', 'won', 'joined', 'achievement', 'invited'];
    const activity: Activity[] = [];
    for (let index = 0; index < 40; index += 1)
    {
        const person = random.pick(people);
        const kind = random.pick(kinds);
        activity.push({
            id: `act-${ index + 1 }`,
            personId: person.id,
            kind,
            game: kind === 'joined' ? null : (random.chance(0.7) ? person.favourite : random.pick(GAMES).id),
            at: now - random.int(2, 60 * 36) * MINUTE,
            targetId: kind === 'achievement'
                ? (person.achievements[0] ?? null)
                : (kind === 'joined' ? random.pick(GROUP_SLUGS) : (kind === 'invited' ? random.pick(people).id : null))
        });
    }
    return activity.sort((a, b) => b.at - a.at);
}

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
    const people = PEOPLE.map((person) => buildPerson(person, now, seed));
    const { conversations, messages } = buildThreads(now);
    const requests = buildRequests(now);
    return {
        seed,
        now,
        people,
        conversations,
        messages,
        activity: buildActivity(people, now, seed),
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
