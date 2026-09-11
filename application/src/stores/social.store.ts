import { createStore, createSignal, type Getter } from 'azerothjs';

import { dataset, personById } from '../data/mock/index.ts';
import type { FriendRequest, Person, Report, ReportCategory } from '../data/mock/types.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';
import { recallJson, rememberJson } from '../lib/storage.ts';
import { planRequestReply, rankSuggestions, reasonFor } from '../services/social.service.ts';
import { useSession } from './session.store.ts';

export type Relation = 'me' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';

const STORAGE_KEY = 'nura-games.social';

interface Kept
{
    blocked: string[];
    muted: string[];
    reports: Report[];
}

function isKept(value: unknown): value is Kept
{
    const candidate = value as Kept | null;
    return candidate !== null
        && typeof candidate === 'object'
        && Array.isArray(candidate.blocked)
        && Array.isArray(candidate.muted)
        && Array.isArray(candidate.reports);
}

export interface SocialApi
{
    friends: Getter<string[]>;
    incoming: Getter<FriendRequest[]>;
    outgoing: Getter<FriendRequest[]>;
    suggestions: Getter<Person[]>;
    blocked: Getter<string[]>;
    muted: Getter<string[]>;
    reports: Getter<Report[]>;
    relation(id: string): Relation;
    isBlocked(id: string): boolean;
    isMuted(id: string): boolean;
    reasonFor(id: string): ReturnType<typeof reasonFor>;
    visible(ids: readonly string[]): string[];
    people(): Person[];
    add(id: string): void;
    accept(requestId: string): void;
    decline(requestId: string): void;
    withdraw(id: string): void;
    remove(id: string): void;
    block(id: string): void;
    unblock(id: string): void;
    toggleMute(id: string): void;
    report(id: string, category: ReportCategory): string;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useSocial = createStore((): SocialApi =>
{
    const session = useSession();

    const meId = (): string => session.record()?.id ?? 'you';

    const [added, setAdded] = createSignal<string[]>([]);
    const [dropped, setDropped] = createSignal<string[]>([]);
    const [sent, setSent] = createSignal<FriendRequest[]>([]);
    const [answered, setAnswered] = createSignal<string[]>([]);
    const [blocked, setBlocked] = createSignal<string[]>([]);
    const [muted, setMuted] = createSignal<string[]>([]);
    const [reports, setReports] = createSignal<Report[]>([]);

    const timers = new Set<() => void>();
    let counter = 0;

    const later = (ms: number, fn: () => void): void =>
    {
        const cancel = runtime().clock.after(ms, () =>
        {
            timers.delete(cancel);
            fn();
        });
        timers.add(cancel);
    };

    const clearTimers = (): void =>
    {
        for (const cancel of timers)
        {
            cancel();
        }
        timers.clear();
    };

    const keep = (): void =>
    {
        rememberJson(STORAGE_KEY, { blocked: blocked(), muted: muted(), reports: reports() });
    };

    const restored = recallJson(STORAGE_KEY, isKept);
    if (restored !== null)
    {
        setBlocked(restored.blocked);
        setMuted(restored.muted);
        setReports(restored.reports);
    }

    const seeded = (): string[] => dataset().friends[meId()] ?? [];

    const friends = (): string[] =>
    {
        const out = new Set([...seeded(), ...added()]);
        for (const id of dropped())
        {
            out.delete(id);
        }
        for (const id of blocked())
        {
            out.delete(id);
        }
        return [...out];
    };

    const incoming = (): FriendRequest[] => dataset().requests
        .filter((request) => request.to === meId() && !answered().includes(request.id) && !blocked().includes(request.from));

    const outgoing = (): FriendRequest[] =>
    {
        const mine = dataset().requests.filter((request) => request.from === meId() && !answered().includes(request.id));
        return [...mine, ...sent()].filter((request) => !added().includes(request.to));
    };

    const relation = (id: string): Relation =>
    {
        if (id === meId())
        {
            return 'me';
        }
        if (blocked().includes(id))
        {
            return 'blocked';
        }
        if (friends().includes(id))
        {
            return 'friend';
        }
        if (incoming().some((request) => request.from === id))
        {
            return 'incoming';
        }
        if (outgoing().some((request) => request.to === id))
        {
            return 'outgoing';
        }
        return 'none';
    };

    const answer = (requestId: string, accepted: boolean): void =>
    {
        const request = dataset().requests.find((entry) => entry.id === requestId);
        setAnswered([...answered(), requestId]);
        if (request !== undefined && accepted)
        {
            setAdded([...added(), request.from]);
            setDropped(dropped().filter((id) => id !== request.from));
        }
    };

    return {
        friends,
        incoming,
        outgoing,
        blocked,
        muted,
        reports,

        suggestions()
        {
            const me = personById(meId());
            if (me === undefined)
            {
                return [];
            }
            const excluded = new Set([...friends(), ...blocked(), ...outgoing().map((request) => request.to), ...incoming().map((request) => request.from)]);
            return rankSuggestions(me, dataset().people, dataset().friends, excluded, createRandom(hashSeed(runtime().seed, 'suggest', me.id)));
        },

        relation,
        isBlocked: (id) => blocked().includes(id),
        isMuted: (id) => muted().includes(id),

        reasonFor(id)
        {
            const me = personById(meId());
            const person = personById(id);
            if (me === undefined || person === undefined)
            {
                return { kind: 'new' };
            }
            return reasonFor(me, person, dataset().friends);
        },

        visible: (ids) => ids.filter((id) => !blocked().includes(id)),

        people: () => dataset().people.filter((person) => !blocked().includes(person.id)),

        add(id)
        {
            if (relation(id) !== 'none')
            {
                return;
            }
            counter += 1;
            const request: FriendRequest = { id: `req-out-${ counter }`, from: meId(), to: id, at: runtime().clock.now() };
            setSent([...sent(), request]);
            const person = personById(id);
            if (person === undefined)
            {
                return;
            }
            const reply = planRequestReply(person, createRandom(hashSeed(runtime().seed, 'reply', id)));
            later(reply.after, () =>
            {
                setSent(sent().filter((entry) => entry.id !== request.id));
                if (reply.accepted)
                {
                    setAdded([...added(), id]);
                    setDropped(dropped().filter((entry) => entry !== id));
                }
            });
        },

        accept: (requestId) => answer(requestId, true),
        decline: (requestId) => answer(requestId, false),

        withdraw(id)
        {
            setSent(sent().filter((request) => request.to !== id));
            const seededRequest = dataset().requests.find((request) => request.from === meId() && request.to === id);
            if (seededRequest !== undefined)
            {
                setAnswered([...answered(), seededRequest.id]);
            }
        },

        remove(id)
        {
            setAdded(added().filter((entry) => entry !== id));
            setDropped([...dropped(), id]);
        },

        block(id)
        {
            if (blocked().includes(id))
            {
                return;
            }
            setBlocked([...blocked(), id]);
            setAdded(added().filter((entry) => entry !== id));
            setDropped([...dropped(), id]);
            setSent(sent().filter((request) => request.to !== id));
            keep();
        },

        unblock(id)
        {
            setBlocked(blocked().filter((entry) => entry !== id));
            keep();
        },

        toggleMute(id)
        {
            setMuted(muted().includes(id) ? muted().filter((entry) => entry !== id) : [...muted(), id]);
            keep();
        },

        report(id, category)
        {
            counter += 1;
            const report: Report = { id: `report-${ counter }`, against: id, category, at: runtime().clock.now(), status: 'received' };
            setReports([...reports(), report]);
            keep();
            later(20000, () =>
            {
                setReports(reports().map((entry) => (entry.id === report.id ? { ...entry, status: 'reviewed' } : entry)));
                keep();
            });
            return report.id;
        },

        start()
        {
            return clearTimers;
        },

        stop: clearTimers,

        reset()
        {
            clearTimers();
            counter = 0;
            setAdded([]);
            setDropped([]);
            setSent([]);
            setAnswered([]);
            setBlocked([]);
            setMuted([]);
            setReports([]);
        }
    };
});
