import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client, type MuteSubject, type Privacy } from '../api.ts';

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

    const meId = (): string => account.user()?.id ?? '';

    const [pendingMutes, setPendingMutes] = createSignal<Record<string, boolean>>({});
    const [held, setHeld] = createSignal<Privacy | null>(null);

    const who = (): string | null => account.user()?.id ?? null;

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

    const asked = (what: string) => (): string | null => (wanted()[what] === true ? who() : null);

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

    const privacy = (): Privacy => held() ?? privacyRead.data() ?? OPEN;

    const muteKey = (kind: MuteSubject, id: string): string => `${ kind }:${ id }`;

    const mutes = (): { kind: MuteSubject; id: string }[] => graph.data()?.mutes ?? [];

    const isMuted = (kind: MuteSubject, id: string): boolean =>
        pendingMutes()[muteKey(kind, id)] ?? mutes().some((entry) => entry.kind === kind && entry.id === id);

    const friends = (): string[] => (graph.data()?.friends ?? []).map((person) => person.id);

    const blocked = (): string[] => (graph.data()?.blocked ?? []).map((person) => person.id);

    const asRequest = (wire: { id: string; from: string; to: string; at: string }): FriendRequest => ({
        id: wire.id,
        from: wire.from,
        to: wire.to,
        at: Date.parse(wire.at)
    });

    const incoming = (): FriendRequest[] => (graph.data()?.incoming ?? []).map(asRequest);

    const outgoing = (): FriendRequest[] => (graph.data()?.outgoing ?? []).map(asRequest);

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

    const revalidate = (): Promise<void> =>
    {
        inFlight = inFlight
            .catch(() => undefined)
            .then(async () =>
            {
                await Promise.all([graph.refetch(), suggested.refetch(), directory.refetch()]);
            });
        return inFlight;
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

    const write = async (call: () => Promise<unknown>): Promise<void> =>
    {
        await call();
        await revalidate();
    };

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
            const current = privacy();
            const stored = await client.social.setPrivacy({
                input: {
                    allowStrangerMessages: patch.allowStrangerMessages ?? current.allowStrangerMessages,
                    showOnline: patch.showOnline ?? current.showOnline
                }
            });
            setHeld(stored);
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

        add: (id) => write(() => client.social.request({ input: { id } })),
        accept: (requestId) => write(() => client.social.answer({ input: { id: requestId, outcome: 'accepted' } })),
        decline: (requestId) => write(() => client.social.answer({ input: { id: requestId, outcome: 'declined' } })),
        withdraw: (id) => write(() => client.social.withdraw({ input: { id } })),
        remove: (id) => write(() => client.social.unfriend({ input: { id } })),
        block: (id) => write(() => client.social.block({ input: { id } })),
        unblock: (id) => write(() => client.social.unblock({ input: { id } })),

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
                    void graph.refetch().catch(() => undefined);
                }
            });
        },

        stop: () => undefined,

        reset()
        {
            setPendingMutes({});
            setHeld(null);
            inFlight = Promise.resolve();
            setWanted({});
            void graph.refetch();
            void privacyRead.refetch();
        }
    };
});
