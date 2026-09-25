import { createEffect, createStore, untrack } from 'azerothjs';

import type { SoundHandle } from '../game/sound.ts';
import { NOTIFICATION_ICON, sayOf, targetOf } from '../lib/notifications.ts';
import { useChat } from './chat.store.ts';
import { useLobby } from './lobby.store.ts';
import { useLocale } from './locale.store.ts';
import { useNotifications } from './notifications.store.ts';
import { usePeople } from './people.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useSettings } from './settings.store.ts';
import { useSocial } from './social.store.ts';
import { useToasts } from './toasts.store.ts';

export interface CuesApi
{
    start(): () => void;
    stop(): void;
    reset(): void;

    /**
     * Hands the store the one thing only a component can have.
     *
     * `useNavigate()` resolves a router from ownership context, and a store holds none - so the
     * shell, which lives inside `<RouterProvider>`, passes its own `navigate` down once. A store
     * that called `useNavigate()` itself would throw "found no router" on the first cue.
     */
    navigateTo(go: (to: string) => void): void;
}

/**
 * What arrival looks like when nobody is looking at the page it changes.
 *
 * Every store here already refetches when the doorbell rings; what none of them did was TELL
 * anybody. A message that landed in a room the reader is not in moved a badge on a page they
 * would have to go and find, which is why the product read as one that needs refreshing.
 *
 * Arming is the whole discipline. A tracker seeds its baseline from the first settled fetch that
 * followed an actual load - not from nothing, or the boot payload would read as an arrival. After
 * that, only an INCREASE fires, and only while the socket is up: a refetch that lands while it is
 * down is recovery, not news. Dedupe keys are per subject, so a burst in one room refreshes one
 * toast instead of stacking three.
 */
export const useCues = createStore((): CuesApi =>
{
    const go: { current: ((to: string) => void) | null } = { current: null };

    let stop: (() => void) | null = null;

    const lastAt = new Map<string, number>();
    let chatSeeded = false;
    let chatSeenBusy = false;

    let requestCount = 0;
    let requestSeeded = false;
    let requestSeenBusy = false;

    let noticeCount = 0;
    let noticeSeeded = false;
    let noticeSeenBusy = false;

    const run = (): (() => void) =>
    {
        const toasts = useToasts();
        const locale = useLocale();
        const people = usePeople();
        const chat = useChat();
        const social = useSocial();
        const notifications = useNotifications();
        const lobby = useLobby();
        const live = useRealtime();
        const settings = useSettings();

        const nameOf = (handle: string): string => people.byHandle(handle)?.displayName ?? handle;

        /**
         * The chime, imported on first use. The sound engine must not sit in the shell chunk.
         */
        let sound: SoundHandle | null = null;
        const soundOn = (): boolean => untrack(() => settings.settings().sound);

        const chime = (): void =>
        {
            if (!soundOn())
            {
                return;
            }

            void import('../game/sound.ts')
                .then((module) =>
                {
                    sound ??= module.createSound(true);
                    sound.play('bonus', { gain: 0.6 });
                })
                .catch(() => undefined);
        };

        const announceChat = (id: string, from: string): void =>
        {
            toasts.show({
                kind: 'live',
                icon: 'chats',
                text: locale.t('cue.chatBody', { who: nameOf(from) }),
                action: { label: locale.t('cue.open'), run: () => go.current?.(`/app/chats/${ id }`) },
                dedupe: `cue.chat.${ id }`
            });
            chime();
        };

        const trackChat = createEffect(() =>
        {
            const rows = chat.conversations();
            const busy = chat.listLoading();

            if (busy)
            {
                chatSeenBusy = true;
                return;
            }

            if (!chatSeeded)
            {
                if (!chatSeenBusy)
                {
                    return;
                }

                for (const conversation of rows)
                {
                    lastAt.set(conversation.id, chat.lastOf(conversation.id)?.at ?? 0);
                }
                chatSeeded = true;
                return;
            }

            const liveNow = live.status() === 'connected';
            const open = chat.openId();

            for (const conversation of rows)
            {
                const at = chat.lastOf(conversation.id)?.at ?? 0;
                const before = lastAt.get(conversation.id);

                if (before !== undefined && at > before && conversation.id !== open && liveNow)
                {
                    announceChat(conversation.id, chat.lastOf(conversation.id)?.from ?? '');
                }

                lastAt.set(conversation.id, at);
            }
        }, { name: 'cues.chat' });

        const trackRequests = createEffect(() =>
        {
            const requests = social.incoming();
            const busy = social.loading();

            if (busy)
            {
                requestSeenBusy = true;
                return;
            }

            if (!requestSeeded)
            {
                if (!requestSeenBusy)
                {
                    return;
                }

                requestCount = requests.length;
                requestSeeded = true;
                return;
            }

            if (requests.length > requestCount && live.status() === 'connected')
            {
                toasts.show({
                    kind: 'live',
                    icon: 'friend-add',
                    text: locale.t('cue.requestBody', { who: nameOf(requests[requests.length - 1].from) }),
                    action: { label: locale.t('cue.requests'), run: () => go.current?.('/app/friends') },
                    dedupe: 'cue.request'
                });
                chime();
            }
            requestCount = requests.length;
        }, { name: 'cues.requests' });

        const trackNotices = createEffect(() =>
        {
            const unread = notifications.unread();
            const busy = notifications.loading();

            if (busy)
            {
                noticeSeenBusy = true;
                return;
            }

            if (!noticeSeeded)
            {
                if (!noticeSeenBusy)
                {
                    return;
                }

                noticeCount = unread;
                noticeSeeded = true;
                return;
            }

            if (unread > noticeCount && live.status() === 'connected')
            {
                const item = notifications.items().find((row) => !row.read);

                if (item !== undefined)
                {
                    toasts.show({
                        kind: 'live',
                        icon: NOTIFICATION_ICON[item.kind],
                        text: sayOf(item, nameOf(item.actor ?? ''), locale),
                        action: { label: locale.t('cue.view'), run: () => go.current?.(targetOf(item) ?? '/app/notifications') },
                        dedupe: 'cue.notice'
                    });
                    chime();
                }
            }
            noticeCount = unread;
        }, { name: 'cues.notices' });

        const trackTitle = createEffect(() =>
        {
            const total = chat.totalUnread() + notifications.unread() + social.incoming().length + lobby.waiting().length;

            if (typeof document !== 'undefined')
            {
                document.title = total > 0 ? `${ total } · ${ locale.t('app.title') }` : locale.t('app.title');
            }
        }, { name: 'cues.title' });

        return () =>
        {
            trackChat();
            trackRequests();
            trackNotices();
            trackTitle();
            sound?.dispose();

            if (typeof document !== 'undefined')
            {
                document.title = locale.t('app.title');
            }
        };
    };

    return {
        start()
        {
            if (stop === null)
            {
                stop = run();
            }
            return () =>
            {
                stop?.();
                stop = null;
            };
        },

        stop()
        {
            stop?.();
            stop = null;
        },

        reset()
        {
            stop?.();
            stop = null;
            lastAt.clear();
            chatSeeded = false;
            chatSeenBusy = false;
            requestCount = 0;
            requestSeeded = false;
            requestSeenBusy = false;
            noticeCount = 0;
            noticeSeeded = false;
            noticeSeenBusy = false;
        },

        navigateTo(navigate)
        {
            go.current = navigate;
        }
    };
});
