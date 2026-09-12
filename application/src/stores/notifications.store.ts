import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client, type Notification } from '../api.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';

export interface NotificationsApi
{
    items: Getter<Notification[]>;
    unread: Getter<number>;
    loading: Getter<boolean>;
    failed: Getter<unknown>;

    /** Whether there is another page behind the one already held. */
    hasMore: Getter<boolean>;
    more(): Promise<void>;

    markRead(id: string): Promise<void>;
    markAllRead(): Promise<void>;
    dismiss(id: string): Promise<void>;

    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

/**
 * Notifications, according to the SERVER.
 *
 * No text arrives here. A notification is a kind, whoever caused it, a count and a reference, and
 * the sentence is composed at DISPLAY time through the message catalogue - so it follows a
 * language switch, and so twelve messages in one conversation say "12 new messages" from one row
 * rather than stacking twelve rows to swipe away.
 *
 * The list pages by KEYSET. `more()` appends rather than refetching everything, because a
 * notification list only grows and an offset page repeats or skips a row every time one arrives
 * while somebody is reading it.
 */
export const useNotifications = createStore((): NotificationsApi =>
{
    const account = useAccount();

    const who = (): string | null => account.user()?.id ?? null;

    const [older, setOlder] = createSignal<Notification[]>([]);
    const [tailCursor, setTailCursor] = createSignal<string | undefined>(undefined);

    const first = createResource(who, () => client.notifications.list({ query: {} }), { name: 'notifications.list' });

    /** Where the next page starts: the head's cursor until `more` has run, then the tail's. */
    const nextCursor = (): string | undefined => (older().length === 0 ? first.data()?.cursor : tailCursor());

    let inFlight: Promise<void> = Promise.resolve();

    const queue = (work: () => Promise<unknown>): Promise<void> =>
    {
        inFlight = inFlight.catch(() => undefined).then(async () =>
        {
            await work();
        });
        return inFlight;
    };

    /**
     * Refetching drops the older pages.
     *
     * Anything that changes this list changes what its first page holds, and stitching a fresh
     * head onto stale tails is how a list shows one row twice. Somebody who was deep in their
     * history asks for it again, which costs one request and is always right.
     */
    const revalidate = (): Promise<void> => queue(async () =>
    {
        setOlder([]);
        setTailCursor(undefined);
        await first.refetch();
    });

    return {
        items: () => [...(first.data()?.items ?? []), ...older()],
        unread: () => first.data()?.unread ?? 0,
        loading: () => first.loading(),
        failed: () => first.error(),

        hasMore: () => nextCursor() !== undefined,

        more: () => queue(async () =>
        {
            const cursor = untrack(nextCursor);
            if (cursor === undefined)
            {
                return;
            }
            const page = await client.notifications.list({ query: { cursor } });
            setOlder([...untrack(older), ...page.items]);
            setTailCursor(page.hasMore ? page.cursor : undefined);
        }),

        async markRead(id)
        {
            await client.notifications.read({ params: { id } });
            await revalidate();
        },

        async markAllRead()
        {
            await client.notifications.readAll();
            await revalidate();
        },

        async dismiss(id)
        {
            await client.notifications.dismiss({ params: { id } });
            await revalidate();
        },

        refresh: revalidate,

        /**
         * Both doorbells ring this.
         *
         * A notification follows something that already happened - a message, a request, a seat
         * held - and those arrive on the chat and social scopes. A third scope would be new
         * vocabulary for the same events.
         */
        start()
        {
            return useRealtime().onNudge(() =>
            {
                void revalidate().catch(() => undefined);
            });
        },

        stop: () => undefined,

        reset()
        {
            setOlder([]);
            setTailCursor(undefined);
            inFlight = Promise.resolve();
            void first.refetch();
        }
    };
});
