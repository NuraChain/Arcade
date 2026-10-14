import { createEffect, createRoot, createStore, untrack } from 'azerothjs';

import type { NotificationKind } from '../api.ts';
import type { Notice } from '../../../backend/src/domains/notify/notices.ts';
import type { GameId } from '../data/games.ts';
import type { SoundHandle } from '../game/sound.ts';
import { CUE_KEYS, REQUEST_TAG, chatTag, keepWords, rowTag, wordsOf } from '../lib/notice-words.ts';
import { NOTIFICATION_ICON, sayOf, targetOf } from '../lib/notifications.ts';
import { keepReach } from '../lib/push.ts';
import { clearSystem, onWent, tellSystem } from '../lib/system-notice.ts';
import { useCatalogue } from './catalogue.store.ts';
import { useChat } from './chat.store.ts';
import { useLobby } from './lobby.store.ts';
import { useLocale } from './locale.store.ts';
import { useNotifications } from './notifications.store.ts';
import { usePeople } from './people.store.ts';
import { useRealtime, type GameFrame } from './realtime.store.ts';
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

const LEADS_NOWHERE: ReadonlySet<NotificationKind> = new Set(['table-removed']);

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

    const asked = new Set<string>();
    let requestSeeded = false;
    let requestSeenBusy = false;

    let noticedAt = 0;
    let noticeSeeded = false;
    let noticeSeenBusy = false;

    const begun = new Set<string>();

    const turns = new Map<string, boolean>();

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

        let running = true;

        const hushed = (notice: Notice, from?: string, thread?: string) => untrack(() =>
            social.isMuted('notice', notice)
            || (from !== undefined && social.isMuted('person', from))
            || (thread !== undefined && social.isMuted('conversation', thread)));

        const named = (handle: string, say: (who: string) => void) =>
        {
            void people.want([handle]).then(() =>
            {
                if (running)
                {
                    say(untrack(() => people.byHandle(handle)?.displayName ?? handle));
                }
            });
        };

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

        const system = (title: string, tag: string, target: string, pushed: boolean) =>
        {
            const to = untrack(() => (settings.settings().notify ? { lang: locale.locale(), dir: locale.dir() } : null));

            if (to !== null)
            {
                void tellSystem({ title, tag, target, pushed, ...to }).catch(() => undefined);
            }
        };

        const gameSays = (key: 'notify.system.turn' | 'quickMatch.started', game: string) =>
            locale.t(key, { game: locale.t(catalogue.byId(game as GameId).nameKey) });

        const announceChat = (id: string, from: string) => named(from, (who) =>
        {
            const text = locale.t(CUE_KEYS.message, { who });

            toasts.show({
                kind: 'live',
                icon: 'chats',
                text,
                action: { label: locale.t('cue.open'), run: () => go.current?.(`/app/chats/${ id }`) },
                dedupe: `cue.chat.${ id }`
            });
            system(text, chatTag(id), `/app/chats/${ id }`, true);
            chime();
        });

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

                if (arrived && last?.kind === 'text' && last.from !== me && conversation.id !== open && liveNow && !hushed('messages', last.from, conversation.id))
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

            if (!requestSeeded && !requestSeenBusy)
            {
                return;
            }

            const arrived = requests.find((request) => !asked.has(request.id));

            for (const request of requests)
            {
                asked.add(request.id);
            }

            if (requestSeeded && arrived !== undefined && live.status() === 'connected' && !hushed('requests', arrived.from))
            {
                named(arrived.from, (who) =>
                {
                    const text = locale.t(CUE_KEYS['friend-request'], { who });

                    toasts.show({
                        kind: 'live',
                        icon: 'friend-add',
                        text,
                        action: { label: locale.t('cue.requests'), run: () => go.current?.('/app/friends?tab=requests') },
                        dedupe: 'cue.request'
                    });
                    system(text, REQUEST_TAG, '/app/friends?tab=requests', true);
                    chime();
                });
            }
            requestSeeded = true;
        }, { name: 'cues.requests' });

        const trackNotices = () => createEffect(() =>
        {
            const rows = notifications.latest();
            const busy = notifications.loading();

            if (busy)
            {
                noticeSeenBusy = true;
                return;
            }

            if (!noticeSeeded && !noticeSeenBusy)
            {
                return;
            }

            const fresh = rows.filter((row) => !row.read && Date.parse(row.at) > noticedAt);
            const shown = untrack(() => lobby.openId());
            const item = fresh.find((row) => !SAID_ELSEWHERE.has(row.kind) && !(row.kind === 'turn' && row.ref.tableId === shown));

            noticedAt = Math.max(noticedAt, ...(noticeSeeded ? fresh : rows).map((row) => Date.parse(row.at)));

            if (noticeSeeded && item !== undefined && live.status() === 'connected')
            {
                named(item.actor ?? '', (who) =>
                {
                    const told = { kind: 'live' as const, icon: NOTIFICATION_ICON[item.kind], text: sayOf(item, who, locale) };
                    const action = { label: locale.t(item.ref.tableId === undefined ? 'cue.view' : 'quickMatch.go'), run: () => go.current?.(targetOf(item) ?? '/app/notifications') };
                    const game = item.kind === 'turn' ? untrack(lobby.seated).find((one) => one.id === item.ref.tableId)?.game : undefined;

                    toasts.show(LEADS_NOWHERE.has(item.kind) ? { ...told, dedupe: 'cue.told' } : { ...told, action, dedupe: 'cue.notice' });
                    system(
                        game === undefined ? told.text : gameSays('notify.system.turn', game),
                        rowTag(item),
                        targetOf(item) ?? '/app/notifications',
                        true
                    );
                    chime();
                });
            }
            noticeSeeded = true;
        }, { name: 'cues.notices' });

        let untitle: (() => void) | null = null;

        const trackTitle = () =>
        {
            if (typeof document === 'undefined' || typeof MutationObserver === 'undefined')
            {
                return;
            }

            let page = document.title;
            let written = page;

            const count = () => chat.totalUnread() + notifications.unread() + social.incoming().length + lobby.waiting().length;

            const write = (total: number) =>
            {
                if (document.title !== written)
                {
                    page = document.title;
                }

                const own = page === '' ? locale.t('app.title') : page;

                written = total > 0 ? `${ locale.n(total) } · ${ own }` : own;

                if (document.title !== written)
                {
                    document.title = written;
                }
            };

            const watcher = new MutationObserver(() =>
            {
                if (document.title !== written)
                {
                    write(untrack(count));
                }
            });

            watcher.observe(document.head, { childList: true, subtree: true, characterData: true });
            createEffect(() => write(count()), { name: 'cues.title' });

            untitle = () =>
            {
                watcher.disconnect();
                write(0);
            };
        };

        const yourTurn = (match: GameFrame['match'], opening: boolean) =>
        {
            const table = lobby.seated().find((one) => one.id === match.tableId);
            const mine = match.finishedAt === undefined && match.mine !== undefined && match.turn === match.mine;
            const was = turns.get(match.id) ?? (table?.matchId === match.id && table.yourTurn === true);

            if (match.finishedAt !== undefined)
            {
                turns.delete(match.id);

                return;
            }

            turns.set(match.id, mine);

            if (!mine || was || opening || hushed('turns'))
            {
                return;
            }

            const text = gameSays('notify.system.turn', match.game);
            const target = `/app/play/${ match.tableId }`;

            system(text, `turn:${ match.tableId }`, target, false);

            if (lobby.openId() !== match.tableId && table?.mode !== 'turns')
            {
                toasts.show({ kind: 'live', icon: 'dice', text, action: { label: locale.t('quickMatch.go'), run: () => go.current?.(target) }, dedupe: `cue.turn.${ match.tableId }` });
                chime();
            }
        };

        const started = (match: GameFrame['match']) =>
        {
            if (match.finishedAt !== undefined || match.mine === undefined || begun.has(match.id))
            {
                return false;
            }

            const table = lobby.seated().find((one) => one.id === match.tableId);

            if (table === undefined || table.matchId !== undefined)
            {
                return false;
            }

            begun.add(match.id);

            if (hushed('turns'))
            {
                return true;
            }

            const text = gameSays('quickMatch.started', table.game);
            const target = `/app/play/${ table.id }`;

            system(text, `table:${ table.id }`, target, false);

            if (lobby.openId() === table.id || lobby.finding().includes(table.game as GameId))
            {
                return true;
            }

            toasts.show({
                kind: 'live',
                icon: 'play',
                text,
                action: { label: locale.t('quickMatch.go'), run: () => go.current?.(target) },
                dedupe: `cue.started.${ table.id }`
            });
            chime();

            return true;
        };

        const offGame = live.onGame((frame) =>
        {
            yourTurn(frame.match, started(frame.match));
        });

        const offWent = onWent((to) => go.current?.(to));

        void keepReach(untrack(() => settings.settings().notify)).catch(() => undefined);

        const back = () =>
        {
            if (document.visibilityState === 'visible')
            {
                void clearSystem().catch(() => undefined);
            }
        };

        if (typeof document !== 'undefined')
        {
            document.addEventListener('visibilitychange', back);
            back();
        }

        const trackWords = () => createEffect(() =>
        {
            if (settings.settings().notify)
            {
                void keepWords(wordsOf(locale.locale())).catch(() => undefined);
            }
        }, { name: 'cues.words' });

        const end = createRoot((dispose) =>
        {
            trackChat();
            trackRequests();
            trackNotices();
            trackTitle();
            trackWords();

            return dispose;
        });

        return () =>
        {
            running = false;
            end();
            offGame();
            offWent();
            sound?.dispose();
            untitle?.();

            if (typeof document !== 'undefined')
            {
                document.removeEventListener('visibilitychange', back);
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
            asked.clear();
            requestSeeded = false;
            requestSeenBusy = false;
            noticedAt = 0;
            noticeSeeded = false;
            noticeSeenBusy = false;
            begun.clear();
            turns.clear();
        },

        navigateTo(navigate)
        {
            go.current = navigate;
        }
    };
});
