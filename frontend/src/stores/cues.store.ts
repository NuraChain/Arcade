import { createEffect, createRoot, createStore, untrack } from 'azerothjs';

import type { NotificationKind } from '../api.ts';
import type { GameId } from '../data/games.ts';
import type { SoundHandle } from '../game/sound.ts';
import { NOTIFICATION_ICON, sayOf, targetOf } from '../lib/notifications.ts';
import { useCatalogue } from './catalogue.store.ts';
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

const SAID_ELSEWHERE: ReadonlySet<NotificationKind> = new Set(['friend-request', 'message']);

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
    let newest = 0;
    let chatSeeded = false;
    let chatSeenBusy = false;

    let requestCount = 0;
    let requestSeeded = false;
    let requestSeenBusy = false;

    let noticeCount = 0;
    let noticeSeeded = false;
    let noticeSeenBusy = false;

    const begun = new Set<string>();

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
        const catalogue = useCatalogue();

        const nameOf = (handle: string) => people.byHandle(handle)?.displayName ?? handle;

        /**
         * The chime, imported on first use. The sound engine must not sit in the shell chunk.
         */
        let sound: SoundHandle | null = null;
        const soundOn = (): boolean => untrack(() => settings.settings().sound);

        const chime = () =>
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

        const announceChat = (id: string, from: string) =>
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

        const trackChat = () => createEffect(() =>
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
                    const at = chat.lastOf(conversation.id)?.at ?? 0;

                    lastAt.set(conversation.id, at);
                    newest = Math.max(newest, at);
                }
                chatSeeded = true;
                return;
            }

            const liveNow = live.status() === 'connected';
            const open = chat.openId();
            const me = lobby.me();
            let latest = newest;

            for (const conversation of rows)
            {
                const last = chat.lastOf(conversation.id);
                const at = last?.at ?? 0;
                const arrived = at > (lastAt.get(conversation.id) ?? newest);

                if (arrived && last?.kind === 'text' && last.from !== me && conversation.id !== open && liveNow)
                {
                    announceChat(conversation.id, last.from);
                }

                lastAt.set(conversation.id, at);
                latest = Math.max(latest, at);
            }

            newest = latest;
        }, { name: 'cues.chat' });

        const trackRequests = () => createEffect(() =>
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

        const trackNotices = () => createEffect(() =>
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

                if (item !== undefined && !SAID_ELSEWHERE.has(item.kind))
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

        const trackTitle = () => createEffect(() =>
        {
            const total = chat.totalUnread() + notifications.unread() + social.incoming().length + lobby.waiting().length;

            if (typeof document !== 'undefined')
            {
                document.title = total > 0 ? `${ total } · ${ locale.t('app.title') }` : locale.t('app.title');
            }
        }, { name: 'cues.title' });

        const offGame = live.onGame((frame) =>
        {
            const match = frame.match;

            if (match.finishedAt !== undefined || match.mine === undefined || begun.has(match.id))
            {
                return;
            }

            const table = lobby.seated().find((one) => one.id === match.tableId);

            if (table === undefined || table.matchId !== undefined)
            {
                return;
            }

            begun.add(match.id);

            if (lobby.openId() === table.id || lobby.finding().includes(table.game as GameId))
            {
                return;
            }

            toasts.show({
                kind: 'live',
                icon: 'play',
                text: locale.t('quickMatch.started', { game: locale.t(catalogue.byId(table.game as GameId).nameKey) }),
                action: { label: locale.t('quickMatch.go'), run: () => go.current?.(`/app/play/${ table.id }`) },
                dedupe: `cue.started.${ table.id }`
            });
            chime();
        });

        const end = createRoot((dispose) =>
        {
            trackChat();
            trackRequests();
            trackNotices();
            trackTitle();

            return dispose;
        });

        return () =>
        {
            end();
            offGame();
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
            newest = 0;
            chatSeeded = false;
            chatSeenBusy = false;
            requestCount = 0;
            requestSeeded = false;
            requestSeenBusy = false;
            noticeCount = 0;
            noticeSeeded = false;
            noticeSeenBusy = false;
            begun.clear();
        },

        navigateTo(navigate)
        {
            go.current = navigate;
        }
    };
});
