import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { dataset } from '../data/mock/index.ts';
import type { Notification, NotificationKind, NotificationRef } from '../data/mock/types.ts';
import { runtime } from '../lib/runtime.ts';
import type { LocalizedText } from '../lib/text.ts';
import { useAccount } from './account.store.ts';
import { useSocial } from './social.store.ts';

export interface NotificationInput
{
    kind: NotificationKind;
    from?: string | null;
    text: LocalizedText;
    ref?: NotificationRef;
}

export interface NotificationsApi
{
    items: Getter<Notification[]>;
    unread: Getter<number>;
    markRead(id: string): void;
    markAllRead(): void;
    push(input: NotificationInput): string;
    remove(id: string): void;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useNotifications = createStore((): NotificationsApi =>
{
    const social = useSocial();
    const account = useAccount();

    const [added, setAdded] = createSignal<Notification[]>([]);
    const [seen, setSeen] = createSignal<string[]>([]);
    const [removed, setRemoved] = createSignal<string[]>([]);

    let counter = 0;

    const mine = (item: Notification): boolean =>
    {
        if (item.kind !== 'friend-request' || item.ref.requestId === undefined)
        {
            return true;
        }
        const request = dataset().requests.find((entry) => entry.id === item.ref.requestId);
        return request !== undefined && request.to === (account.user()?.id ?? 'you');
    };

    const items = (): Notification[] => [...dataset().notifications, ...added()]
        .filter((item) => !removed().includes(item.id))
        .filter(mine)
        .filter((item) => item.from === null || !social.isBlocked(item.from))
        .map((item) => (seen().includes(item.id) ? { ...item, read: true } : item))
        .sort((a, b) => b.at - a.at);

    return {
        items,

        unread: () => items().filter((item) => !item.read).length,

        markRead(id)
        {
            const current = untrack(seen);
            if (!current.includes(id))
            {
                setSeen([...current, id]);
            }
        },

        markAllRead()
        {
            setSeen(items().map((item) => item.id));
        },

        push(input)
        {
            counter += 1;
            const item: Notification = {
                id: `note-live-${ counter }`,
                kind: input.kind,
                at: runtime().clock.now(),
                read: false,
                from: input.from ?? null,
                text: input.text,
                ref: input.ref ?? {}
            };
            setAdded([...untrack(added), item]);
            return item.id;
        },

        remove(id)
        {
            setRemoved([...untrack(removed), id]);
        },

        start()
        {
            return () => undefined;
        },

        stop()
        {
            return;
        },

        reset()
        {
            counter = 0;
            setAdded([]);
            setSeen([]);
            setRemoved([]);
        }
    };
});
