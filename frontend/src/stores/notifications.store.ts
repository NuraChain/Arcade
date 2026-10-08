import { createStore, createMemo, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { client, type Notification } from '../api.ts';
import type { Notice } from '../../../backend/src/domains/notify/notices.ts';
import { createGuesses } from '../lib/guess.ts';
import { useAccount } from './account.store.ts';
import { useRealtime } from './realtime.store.ts';

interface Held
{
    items: Notification[];
    latest: Notification[];
    unread: number;
}

type Change = (rows: Notification[]) => Notification[];

const reading = (id: string) => (rows: Notification[]) => rows.map((row) => (row.id === id ? { ...row, read: true } : row));

const readingAll = (rows: Notification[]) => rows.map((row) => ({ ...row, read: true }));

const without = (id: string) => (rows: Notification[]) => rows.filter((row) => row.id !== id);

const oneFewer = (id: string) => (held: Held) =>
    Math.max(0, held.unread - ([...held.items, ...held.latest].some((row) => row.id === id && !row.read) ? 1 : 0));

const shownAs = (change: Change, count: (held: Held) => number) =>
    (held: Held) => ({ items: change(held.items), latest: change(held.latest), unread: count(held) });

export interface NotificationsApi
{
    items: Getter<Notification[]>;
    latest: Getter<Notification[]>;
    unread: Getter<number>;
    loading: Getter<boolean>;
    failed: Getter<unknown>;

    /** Whether there is another page behind the one already held. */
    hasMore: Getter<boolean>;
    more(): Promise<void>;

    notice: Getter<Notice | null>;
    only(notice: Notice | null): void;

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

    const who = () => account.user()?.id ?? null;

    const [older, setOlder] = createSignal<Notification[]>([]);
    const [tailCursor, setTailCursor] = createSignal<string | undefined>(undefined);
    const [notice, setNotice] = createSignal<Notice | null>(null);

    const asked = (): { notice?: Notice } =>
    {
        const kind = untrack(notice);
        return kind === null ? {} : { notice: kind };
    };

    const key = createMemo(() => (who() === null ? null : `${ who() }:${ notice() ?? '' }`));

    const first = createResource(
        key,
        () => client.notifications.list({ query: asked() }),
        { name: 'notifications.list' }
    );

    const everything = createResource(
        createMemo(() => (notice() === null ? null : who())),
        () => client.notifications.list({ query: {} }),
        { name: 'notifications.latest' }
    );

    /** Where the next page starts: the head's cursor until `more` has run, then the tail's. */
    const nextCursor = () => (older().length === 0 ? first.data()?.cursor : tailCursor());

    let inFlight: Promise<void> = Promise.resolve();

    const queue = (work: () => Promise<unknown>) =>
    {
        inFlight = inFlight.catch(() => undefined).then(async () =>
        {
            await work();
        });
        return inFlight;
    };

    const known = (): Held =>
    {
        const head = first.data()?.items ?? [];
        const seen = new Set(head.map((row) => row.id));

        return {
            items: [...head, ...older().filter((row) => !seen.has(row.id))],
            latest: (notice() === null ? first.data()?.items : everything.data()?.items) ?? [],
            unread: first.data()?.unread ?? 0
        };
    };

    const guessed = createGuesses<Held>();

    const shown = createMemo(() => guessed.over(known()));

    const unreadable = () => untrack(first.error) ?? untrack(everything.error);

    const reread = async () =>
    {
        await Promise.all([first.refetch(), untrack(notice) === null ? undefined : everything.refetch()]);

        if (unreadable() === null)
        {
            guessed.landed();
        }
    };

    /**
     * Refetching drops the older pages.
     *
     * Anything that changes this list changes what its first page holds, and stitching a fresh
     * head onto stale tails is how a list shows one row twice. Somebody who was deep in their
     * history asks for it again, which costs one request and is always right.
     */
    const revalidate = () => queue(async () =>
    {
        setOlder([]);
        setTailCursor(undefined);
        await reread();
    });

    const keep = (change: Change) => queue(async () =>
    {
        setOlder(change(untrack(older)));
        await reread();
    });

    const truth = async (change: Change) =>
    {
        await keep(change);

        const unread = unreadable();

        if (unread !== null)
        {
            throw unread;
        }
    };

    const done = (change: Change, count: (held: Held) => number, send: () => Promise<unknown>) =>
        guessed.during(shownAs(change, count), send, () => truth(change)).then(() => undefined);

    return {
        items: () => shown().items,
        latest: () => shown().latest,
        unread: () => shown().unread,
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
            const page = await client.notifications.list({ query: { cursor, ...asked() } });
            setOlder([...untrack(older), ...page.items]);
            setTailCursor(page.hasMore ? page.cursor : undefined);
        }),

        markRead: (id) => done(reading(id), oneFewer(id), () => client.notifications.read({ params: { id } })),

        markAllRead: () => done(readingAll, () => 0, () => client.notifications.readAll()),

        dismiss: (id) => done(without(id), oneFewer(id), () => client.notifications.dismiss({ params: { id } })),

        refresh: revalidate,

        notice,

        only(kind)
        {
            if (kind === untrack(notice))
            {
                return;
            }
            setOlder([]);
            setTailCursor(undefined);
            setNotice(kind);
        },

        /**
         * Both doorbells ring this.
         *
         * A notification follows something that already happened - a message, a request, a seat
         * held - and those arrive on the chat and social scopes. A third scope would be new
         * vocabulary for the same events.
         */
        start()
        {
            return useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'notifications'))
                {
                    void (id === undefined ? revalidate() : keep((rows) => rows)).catch(() => undefined);
                }
            });
        },

        stop: () => undefined,

        reset()
        {
            setOlder([]);
            setTailCursor(undefined);
            setNotice(null);
            inFlight = Promise.resolve();
            guessed.clear();
            void first.refetch();
        }
    };
});
