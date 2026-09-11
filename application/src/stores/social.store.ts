import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client, type MuteSubject, type Privacy } from '../api.ts';

import { dataset, personById } from '../data/mock/index.ts';
import type { FriendRequest, Person, Report, ReportCategory } from '../data/mock/types.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';
import { recallJson, rememberJson } from '../lib/storage.ts';
import { planRequestReply, rankSuggestions, reasonFor } from '../services/social.service.ts';
import { useAccount } from './account.store.ts';

export type Relation = 'me' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';

const STORAGE_KEY = 'nura-games.social';

interface Kept
{
    blocked: string[];
    reports: Report[];
}

function isKept(value: unknown): value is Kept
{
    const candidate = value as Kept | null;
    return candidate !== null
        && typeof candidate === 'object'
        && Array.isArray(candidate.blocked)
        && Array.isArray(candidate.reports);
}

export interface SocialApi
{
    friends: Getter<string[]>;
    incoming: Getter<FriendRequest[]>;
    outgoing: Getter<FriendRequest[]>;
    suggestions: Getter<Person[]>;
    blocked: Getter<string[]>;
    reports: Getter<Report[]>;

    /**
     * Silence, for a person, a conversation or a game. ONE mechanism: the product used to keep a
     * muted-people list in this store and muted conversations and games in the settings store,
     * which is three spellings of one idea and three places for a feature to forget one.
     */
    mutes: Getter<{ kind: MuteSubject; id: string }[]>;
    isMuted(kind: MuteSubject, id: string): boolean;
    toggleMute(kind: MuteSubject, id: string): Promise<void>;

    /**
     * The two switches this account controls, as the SERVER holds them. A minor's stranger
     * setting comes back false however it was set, which is why this is the server's answer
     * rather than what the client asked for.
     */
    privacy: Getter<Privacy>;
    setPrivacy(patch: Partial<Pick<Privacy, 'allowStrangerMessages' | 'showOnline'>>): Promise<void>;
    privacyLoading: Getter<boolean>;
    relation(id: string): Relation;
    isBlocked(id: string): boolean;

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

    report(id: string, category: ReportCategory): string;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useSocial = createStore((): SocialApi =>
{
    const account = useAccount();

    const meId = (): string => account.user()?.id ?? 'you';

    const [added, setAdded] = createSignal<string[]>([]);
    const [dropped, setDropped] = createSignal<string[]>([]);
    const [sent, setSent] = createSignal<FriendRequest[]>([]);
    const [answered, setAnswered] = createSignal<string[]>([]);
    const [blocked, setBlocked] = createSignal<string[]>([]);
    const [reports, setReports] = createSignal<Report[]>([]);
    const [pendingMutes, setPendingMutes] = createSignal<Record<string, boolean>>({});
    const [held, setHeld] = createSignal<Privacy | null>(null);

    const graph = createResource(
        () => account.user()?.id ?? null,
        () => client.social.graph(),
        { name: 'social.graph' }
    );

    const privacyRead = createResource(
        () => account.user()?.id ?? null,
        () => client.social.privacy(),
        { name: 'social.privacy' }
    );

    const OPEN: Privacy = { allowStrangerMessages: true, showOnline: true, isMinor: false };

    const privacy = (): Privacy => held() ?? privacyRead.data() ?? OPEN;

    const muteKey = (kind: MuteSubject, id: string): string => `${ kind }:${ id }`;

    const mutes = (): { kind: MuteSubject; id: string }[] => graph.data()?.mutes ?? [];

    const isMuted = (kind: MuteSubject, id: string): boolean =>
        pendingMutes()[muteKey(kind, id)] ?? mutes().some((entry) => entry.kind === kind && entry.id === id);

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
        rememberJson(STORAGE_KEY, { blocked: blocked(), reports: reports() });
    };

    const restored = recallJson(STORAGE_KEY, isKept);
    if (restored !== null)
    {
        setBlocked(restored.blocked);
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
        reports,

        mutes,
        isMuted,

        /**
         * Flips a mute and tells the server, showing the new state at once.
         *
         * The overlay is cleared in `finally`, so a call that fails reverts to whatever the
         * server last said rather than leaving a switch showing a state nobody holds.
         */
        async toggleMute(kind, id)
        {
            const key = muteKey(kind, id);
            const next = !untrack(() => isMuted(kind, id));
            setPendingMutes({ ...untrack(pendingMutes), [key]: next });
            try
            {
                await client.social.mute({ input: { kind, id, muted: next } });
            }
            finally
            {
                // Refetched on BOTH paths. After a refusal the question is not "what did I ask
                // for" but "what does the server hold", and the overlay is dropped either way.
                await graph.refetch().catch(() => undefined);
                const current = { ...untrack(pendingMutes) };
                delete current[key];
                setPendingMutes(current);
            }
        },

        privacy,
        privacyLoading: () => privacyRead.loading(),

        /**
         * Writes the switches and adopts what came BACK.
         *
         * A minor asking to be reachable by strangers is answered with `false`, so the control
         * settles on the truth in one round trip instead of showing what was asked for until
         * something else happens to reload it.
         */
        async setPrivacy(patch)
        {
            const current = privacy();
            const stored = await client.social.setPrivacy({
                input: {
                    allowStrangerMessages: patch.allowStrangerMessages ?? current.allowStrangerMessages,
                    showOnline: patch.showOnline ?? current.showOnline
                }
            });
            setHeld(stored);
        },

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
            setReports([]);
            setPendingMutes({});
            setHeld(null);
            void graph.refetch();
            void privacyRead.refetch();
        }
    };
});
