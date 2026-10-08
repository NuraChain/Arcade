import { createMemo, createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client, type MuteSubject, type Privacy } from '../api.ts';
import { createGuesses, type Guess } from '../lib/guess.ts';
import { runtime } from '../lib/runtime.ts';

import type { Person } from '../data/person.ts';
import type { FriendRequest, Report, ReportCategory } from '../data/chat.ts';
import type { reasonFor } from '../services/social.service.ts';
import { useAccount } from './account.store.ts';
import { usePeople } from './people.store.ts';
import { useRealtime } from './realtime.store.ts';

export type Relation = 'me' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';

export interface SocialApi
{
    friends: Getter<string[]>;
    incoming: Getter<FriendRequest[]>;
    outgoing: Getter<FriendRequest[]>;
    suggestions: Getter<Person[]>;
    blocked: Getter<string[]>;
    reports: Getter<Report[]>;

    mutes: Getter<{ kind: MuteSubject; id: string }[]>;
    isMuted(kind: MuteSubject, id: string): boolean;
    toggleMute(kind: MuteSubject, id: string): Promise<void>;

    privacy: Getter<Privacy>;
    setPrivacy(patch: Partial<Pick<Privacy, 'allowStrangerMessages' | 'showOnline'>>): Promise<void>;
    privacyLoading: Getter<boolean>;

    relation(id: string): Relation;
    isBlocked(id: string): boolean;
    reasonFor(id: string): ReturnType<typeof reasonFor>;
    visible(ids: readonly string[]): string[];
    people(): Person[];

    add(id: string): Promise<void>;
    accept(requestId: string): Promise<void>;
    decline(requestId: string): Promise<void>;
    withdraw(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    block(id: string): Promise<void>;
    unblock(id: string): Promise<void>;
    /**
     * Files a report. `disclose` attaches ONE message, and only one, ever.
     *
     * Bulk disclosure is not an oversight this could grow out of - a report carries the message the
     * reporter picked and proves nothing about any other, which is the entire shape of moderation
     * on a product whose server cannot read a conversation.
     */
    report(id: string, category: ReportCategory, disclose?: {
        conversationId: string;
        messageId: string;
        text: string;
        frankingKey: string;
    }): Promise<string>;

    /**
     * Asks for a list this page needs.
     *
     * The graph and the privacy switches are fetched on boot because the shell reads both on
     * every route. The directory, the suggestions and my own reports are not: three more requests
     * on every navigation, for three lists that two pages between them ever show. A page that
     * needs one says so in its `mount`.
     */
    want(what: 'people' | 'suggestions' | 'reports'): void;

    loading: Getter<boolean>;
    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

/**
 * Who this account knows, according to the SERVER.
 *
 * Everything here is a handle: friends, blocks, both directions of a request, the people a
 * suggestion names. The browser's mock is no longer a social graph - it is a profile cache
 * (portrait, favourite game, region, statistics) that this store joins to by handle, because no
 * domain owns those fields yet.
 *
 * Nothing is kept in `localStorage` any more. Blocks, mutes and reports belong to the account,
 * and a block that only exists in one browser is a block the other device does not honour.
 */
export const useSocial = createStore((): SocialApi =>
{
    const account = useAccount();
    const people = usePeople();

    const meId = () => account.user()?.id ?? '';

    const [pendingMutes, setPendingMutes] = createSignal<Record<string, boolean>>({});
    const [held, setHeld] = createSignal<Privacy | null>(null);

    const who = () => account.user()?.id ?? null;

    // Every payload that carries a person files them with `people.store`, which is the only thing
    // that knows a handle's name now. A store that fetched people and did not hand them over would
    // leave every OTHER screen rendering bare handles for somebody it had just loaded.
    const graph = createResource(who, async () =>
    {
        const answer = await client.social.graph();
        // The people on the other end of a request are filed too. Without them the Requests tab
        // counted a request in its badge and rendered an empty panel, because the row is built from
        // this cache and a stranger is exactly who has never been in it.
        people.remember([
            ...answer.friends,
            ...answer.blocked,
            ...answer.incoming.map((request) => request.person),
            ...answer.outgoing.map((request) => request.person)
        ]);
        return answer;
    }, { name: 'social.graph' });

    const privacyRead = createResource(who, () => client.social.privacy(), { name: 'social.privacy' });

    const [wanted, setWanted] = createSignal<Record<string, boolean>>({});

    const asked = (what: string) => () => (wanted()[what] === true ? who() : null);

    const suggested = createResource(asked('suggestions'), async () =>
    {
        const answer = await client.social.suggestions();
        people.remember(answer.suggestions.map((entry) => entry.person));
        return answer;
    }, { name: 'social.suggestions' });

    const directory = createResource(asked('people'), async () =>
    {
        const answer = await client.social.people();
        people.remember(answer.people);
        return answer;
    }, { name: 'social.people' });

    const filed = createResource(asked('reports'), () => client.social.reports(), { name: 'social.reports' });

    const OPEN: Privacy = { allowStrangerMessages: true, showOnline: true, isMinor: false };

    const privacy = () => held() ?? privacyRead.data() ?? OPEN;

    const muteKey = (kind: MuteSubject, id: string) => `${ kind }:${ id }`;

    const mutes = (): { kind: MuteSubject; id: string }[] => graph.data()?.mutes ?? [];

    const isMuted = (kind: MuteSubject, id: string) =>
        pendingMutes()[muteKey(kind, id)] ?? mutes().some((entry) => entry.kind === kind && entry.id === id);

    const stable = (): ((next: string[]) => string[]) =>
    {
        let held: string[] = [];
        return (next) =>
        {
            if (held.length === next.length && held.every((id, at) => id === next[at]))
            {
                return held;
            }
            held = next;
            return held;
        };
    };

    const heldFriends = stable();
    const heldBlocked = stable();

    const asRequest = (wire: { id: string; from: string; to: string; at: string }): FriendRequest => ({
        id: wire.id,
        from: wire.from,
        to: wire.to,
        at: Date.parse(wire.at)
    });

    interface Known
    {
        friends: string[];
        blocked: string[];
        incoming: FriendRequest[];
        outgoing: FriendRequest[];
    }

    const known = createMemo((): Known =>
    {
        const read = graph.data();

        return {
            friends: (read?.friends ?? []).map((person) => person.id),
            blocked: (read?.blocked ?? []).map((person) => person.id),
            incoming: (read?.incoming ?? []).map(asRequest),
            outgoing: (read?.outgoing ?? []).map(asRequest)
        };
    });

    const guessed = createGuesses<Known>();

    const shown = createMemo(() => guessed.over(known()));

    const friends = () => heldFriends(shown().friends);

    const blocked = () => heldBlocked(shown().blocked);

    const incoming = () => shown().incoming;

    const outgoing = () => shown().outgoing;

    /**
     * The mutual-friend count the "why this person" line needs.
     *
     * It rides along with the suggestions rather than costing a query each, and a person who was
     * not suggested simply has no number - which the reason line reads as "no mutuals" and falls
     * through to the other reasons.
     */
    const mutuals = (): Map<string, number> =>
        new Map((suggested.data()?.suggestions ?? []).map((entry) => [entry.person.id, entry.mutual]));

    let inFlight: Promise<void> = Promise.resolve();

    const landed = () =>
    {
        if (untrack(graph.error) === null)
        {
            guessed.landed();
        }
    };

    /**
     * Re-reads the graph always, and the lazily-asked lists only when they were asked for.
     *
     * The directory and the suggestions are `want()`-gated reads; when they HAVE been asked for
     * they must follow the graph, or a block would leave a person sitting in a directory already
     * on screen.
     */
    const revalidate = () =>
    {
        inFlight = inFlight
            .catch(() => undefined)
            .then(async () =>
            {
                const asks = untrack(wanted);
                await Promise.all([
                    graph.refetch(),
                    ...(asks.people === true ? [directory.refetch()] : []),
                    ...(asks.suggestions === true ? [suggested.refetch()] : [])
                ]);
                landed();
            });
        return inFlight;
    };

    const truth = async () =>
    {
        await revalidate();

        const unread = untrack(graph.error);

        if (unread !== null)
        {
            throw unread;
        }
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

    let sending: Promise<unknown> = Promise.resolve();

    const inTurn = <R>(send: () => Promise<R>) =>
    {
        const sent = sending.catch(() => undefined).then(send);

        sending = sent;

        return sent;
    };

    const out = new Map<string, Promise<void>>();

    const once = (key: string, guess: Guess<Known>, call: () => Promise<unknown>) =>
    {
        const running = out.get(key);

        if (running !== undefined)
        {
            return running;
        }

        const started = guessed.during(guess, () => inTurn(call), truth).then(() => undefined).finally(() => out.delete(key));

        out.set(key, started);

        return started;
    };

    const without = <T>(list: T[], gone: (one: T) => boolean) => (list.some(gone) ? list.filter((one) => !gone(one)) : list);

    const befriended = (id: string): Guess<Known> => (held) => ({
        ...held,
        incoming: without(held.incoming, (request) => request.from === id),
        outgoing: without(held.outgoing, (request) => request.to === id),
        friends: held.friends.includes(id) ? held.friends : [...held.friends, id]
    });

    const asking = (id: string): Guess<Known> =>
    {
        const mine: FriendRequest = { id: `asked:${ id }`, from: untrack(meId), to: id, at: runtime().clock.now() };

        return (held) =>
        {
            if (held.incoming.some((request) => request.from === id))
            {
                return befriended(id)(held);
            }

            return held.friends.includes(id) || held.blocked.includes(id) || held.outgoing.some((request) => request.to === id)
                ? held
                : { ...held, outgoing: [...held.outgoing, mine] };
        };
    };

    const answered = (requestId: string, yes: boolean): Guess<Known> =>
    {
        const from = untrack(incoming).find((request) => request.id === requestId)?.from;

        return (held) => (yes && from !== undefined
            ? befriended(from)(held)
            : { ...held, incoming: without(held.incoming, (request) => request.id === requestId) });
    };

    const shut = (id: string): Guess<Known> => (held) => ({
        friends: without(held.friends, (one) => one === id),
        incoming: without(held.incoming, (request) => request.from === id),
        outgoing: without(held.outgoing, (request) => request.to === id),
        blocked: held.blocked.includes(id) ? held.blocked : [...held.blocked, id]
    });

    return {
        friends,
        incoming,
        outgoing,
        blocked,

        suggestions: () => (suggested.data()?.suggestions ?? []).map((entry) => entry.person),

        reports: () => (filed.data()?.reports ?? []).map((report): Report => ({
            id: report.id,
            against: report.against,
            category: report.category as ReportCategory,
            at: Date.parse(report.at),
            status: report.status as Report['status']
        })),

        mutes,
        isMuted,

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
                await graph.refetch().catch(() => undefined);
                const current = { ...untrack(pendingMutes) };
                delete current[key];
                setPendingMutes(current);
            }
        },

        privacy,
        privacyLoading: () => privacyRead.loading(),

        async setPrivacy(patch)
        {
            const before = untrack(held);
            const current = untrack(privacy);
            const wanted = {
                allowStrangerMessages: patch.allowStrangerMessages ?? current.allowStrangerMessages,
                showOnline: patch.showOnline ?? current.showOnline
            };

            setHeld({ ...current, ...wanted });

            try
            {
                setHeld(await inTurn(() => client.social.setPrivacy({ input: wanted })));
            }
            catch (error)
            {
                setHeld(before);
                throw error;
            }
        },

        relation,
        isBlocked: (id) => blocked().includes(id),

        reasonFor(id)
        {
            const mutual = mutuals().get(id) ?? 0;
            return mutual > 0 ? { kind: 'mutual', count: mutual } : { kind: 'new' };
        },

        visible: (ids) => ids.filter((id) => !blocked().includes(id)),

        people: () => directory.data()?.people ?? [],

        add: (id) => once(`add:${ id }`, asking(id), () => client.social.request({ input: { id } })),
        accept: (requestId) => once(`answer:${ requestId }`, answered(requestId, true), () => client.social.answer({ input: { id: requestId, outcome: 'accepted' } })),
        decline: (requestId) => once(`answer:${ requestId }`, answered(requestId, false), () => client.social.answer({ input: { id: requestId, outcome: 'declined' } })),
        withdraw: (id) => once(
            `withdraw:${ id }`,
            (held) => ({ ...held, outgoing: without(held.outgoing, (request) => request.to === id) }),
            () => client.social.withdraw({ input: { id } })
        ),
        remove: (id) => once(
            `remove:${ id }`,
            (held) => ({ ...held, friends: without(held.friends, (one) => one === id) }),
            () => client.social.unfriend({ input: { id } })
        ),
        block: (id) => once(`block:${ id }`, shut(id), () => client.social.block({ input: { id } })),
        unblock: (id) => once(
            `unblock:${ id }`,
            (held) => ({ ...held, blocked: without(held.blocked, (one) => one === id) }),
            () => client.social.unblock({ input: { id } })
        ),

        /**
         * Files a report, optionally showing ONE message.
         *
         * The disclosure is what makes a report about a sealed conversation worth reading: this
         * server cannot see what was said, so moderation sees exactly what the reporter chose to
         * show - and the franking key is what lets it tell a real message from a typed-out
         * accusation. Reporting a person without attaching one stays a legitimate thing to do.
         */
        async report(id, category, disclose)
        {
            const filedReport = await client.social.report({
                input: {
                    id,
                    category,
                    ...(disclose === undefined ? {} : {
                        conversationId: disclose.conversationId,
                        messageId: disclose.messageId,
                        text: disclose.text,
                        frankingKey: disclose.frankingKey
                    })
                }
            });

            await filed.refetch();
            return filedReport.id;
        },

        want(what)
        {
            if (untrack(wanted)[what] !== true)
            {
                setWanted({ ...untrack(wanted), [what]: true });
            }
        },

        loading: () => graph.loading(),
        refresh: revalidate,

        /**
         * One doorbell, one re-read of the graph.
         *
         * Only the graph: the suggestion and directory reads are expensive, they are gated behind
         * `want()` for exactly that reason, and nothing the server nudges about - a request, an
         * acceptance, a block, a mute, a privacy change - moves either of them. The frame carries
         * no content, so what lands here is the same answer the page would have asked for.
         */
        start()
        {
            return useRealtime().onNudge((scope) =>
            {
                if (scope === 'social')
                {
                    void graph.refetch().then(landed, () => undefined);
                }
            });
        },

        stop: () => undefined,

        reset()
        {
            setPendingMutes({});
            setHeld(null);
            inFlight = Promise.resolve();
            sending = Promise.resolve();
            out.clear();
            guessed.clear();
            setWanted({});
            void graph.refetch();
            void privacyRead.refetch();
        }
    };
});
