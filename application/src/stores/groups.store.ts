import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type GroupPrivacy, type GroupSummary } from '../api.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';

export interface GroupDraft
{
    name: string;
    blurb: string;
    crest: string;
    hue: number;
    game: string;
    privacy: GroupPrivacy;
}

export interface GroupsApi
{
    /** Every group this account is in. Read on boot, because the shell counts them. */
    mine: Getter<GroupSummary[]>;
    loading: Getter<boolean>;
    failed: Getter<unknown>;

    /** Groups this account is not in. Lazy: only the discover page ever shows them. */
    elsewhere: Getter<GroupSummary[]>;
    want(): void;

    /** One group by slug, from whichever list already holds it. */
    byId(slug: string): GroupSummary | undefined;

    /** The group a conversation belongs to, for the chat header. */
    forConversation(conversationId: string): GroupSummary | undefined;

    open(slug: string): void;
    close(): void;
    openId: Getter<string>;
    viewing: Getter<GroupSummary | null>;
    viewLoading: Getter<boolean>;
    viewFailed: Getter<unknown>;

    create(draft: GroupDraft): Promise<GroupSummary>;
    edit(slug: string, draft: Omit<GroupDraft, 'hue'>): Promise<GroupSummary>;
    join(slug: string): Promise<void>;
    leave(slug: string): Promise<void>;
    add(slug: string, handle: string): Promise<void>;
    remove(slug: string, handle: string): Promise<void>;
    transfer(slug: string, handle: string): Promise<void>;

    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

/**
 * Groups, according to the SERVER.
 *
 * A group is named by its slug everywhere in this store, because that is what the url carries and
 * what the api takes - the same rule people follow with handles. There is no local copy of a
 * group any more: the mock's five were a fixture, and every one of them is now a row.
 */
export const useGroups = createStore((): GroupsApi =>
{
    const account = useAccount();

    const who = (): string | null => account.user()?.id ?? null;

    const [openId, setOpenId] = createSignal('');
    const [wanted, setWanted] = createSignal(false);

    const mine = createResource(who, () => client.groups.mine(), { name: 'groups.mine' });

    const elsewhere = createResource(
        () => (wanted() ? who() : null),
        () => client.groups.discover(),
        { name: 'groups.discover' }
    );

    /**
     * The open group, fetched by slug.
     *
     * Separate from the list rather than filtered out of it, because a group page can be opened
     * for a group this account is not in - that is what discover leads to - and because the view
     * carries the member list the list rows do not need.
     */
    const viewing = createResource(
        () => (openId() === '' ? null : { slug: openId(), who: who() }),
        async (current) =>
        {
            try
            {
                return await client.groups.view({ params: { slug: current.slug } });
            }
            catch (error)
            {
                // A slug nobody has claimed is not a failure to load, it is an answer: there is
                // no group there. The page says so plainly instead of offering to try again,
                // which would try the same missing thing.
                if (error instanceof ApiError && error.status === 404)
                {
                    return null;
                }
                throw error;
            }
        },
        { name: 'groups.view' }
    );

    let inFlight: Promise<void> = Promise.resolve();

    const queue = (work: () => Promise<unknown>): Promise<void> =>
    {
        inFlight = inFlight.catch(() => undefined).then(async () =>
        {
            await work();
        });
        return inFlight;
    };

    const revalidate = (): Promise<void> => queue(async () =>
    {
        await Promise.all([
            mine.refetch(),
            untrack(openId) === '' ? Promise.resolve() : viewing.refetch(),
            untrack(wanted) ? elsewhere.refetch() : Promise.resolve()
        ]);
    });

    const listed = (): GroupSummary[] => mine.data()?.groups ?? [];

    const others = (): GroupSummary[] => elsewhere.data()?.groups ?? [];

    return {
        mine: listed,
        loading: () => mine.loading(),
        failed: () => mine.error(),

        elsewhere: others,

        want()
        {
            if (!untrack(wanted))
            {
                setWanted(true);
            }
        },

        byId: (slug) => listed().find((group) => group.id === slug) ?? others().find((group) => group.id === slug),

        forConversation: (conversationId) => listed().find((group) => group.conversationId === conversationId),

        open: (slug) => setOpenId(slug),
        close: () => setOpenId(''),
        openId,
        viewing: () => viewing.data() ?? null,
        viewLoading: () => viewing.loading(),
        viewFailed: () => viewing.error(),

        async create(draft)
        {
            const made = await client.groups.create({ input: draft });
            await revalidate();
            return made;
        },

        async edit(slug, draft)
        {
            const saved = await client.groups.edit({ params: { slug }, input: draft });
            await revalidate();
            return saved;
        },

        async join(slug)
        {
            await client.groups.join({ params: { slug } });
            await revalidate();
        },

        async leave(slug)
        {
            await client.groups.leave({ params: { slug } });

            // The group may be gone entirely - the last member out takes it - so the open view is
            // dropped rather than refetched into a 404.
            if (untrack(openId) === slug)
            {
                setOpenId('');
            }
            await revalidate();
        },

        async add(slug, handle)
        {
            await client.groups.add({ params: { slug }, input: { id: handle } });
            await revalidate();
        },

        async remove(slug, handle)
        {
            await client.groups.remove({ params: { slug }, input: { id: handle } });
            await revalidate();
        },

        async transfer(slug, handle)
        {
            await client.groups.transfer({ params: { slug }, input: { id: handle } });
            await revalidate();
        },

        refresh: revalidate,

        /**
         * A group change rings the SOCIAL doorbell.
         *
         * Nothing new is on the wire for it: joining a group moves a relationship and moves a
         * thread, and both scopes already exist. A third scope would be new vocabulary for
         * information the other two already carry.
         */
        start()
        {
            return useRealtime().onNudge((scope) =>
            {
                if (scope === 'social')
                {
                    void revalidate().catch(() => undefined);
                }
            });
        },

        stop: () => undefined,

        reset()
        {
            setOpenId('');
            setWanted(false);
            inFlight = Promise.resolve();
            void mine.refetch();
        }
    };
});
