import { batch, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { ApiError, client } from '../api.ts';
import { runOf } from '../game/stage/feed.ts';
import { runtime } from '../lib/runtime.ts';
import { NO_EVENTS, OPENING_MS, type EventBatch } from './match.store.ts';
import { useRealtime } from './realtime.store.ts';
import type { MatchWatch } from '../api.ts';

export const WATCH_POLL_MS = 30_000;

export type Watched = Omit<MatchWatch, 'events'>;

export interface WatchApi
{
    view: Getter<Watched | null>;

    events: Getter<EventBatch>;

    refused: Getter<boolean>;

    failed: Getter<boolean>;

    open(matchId: string): void;
    close(): void;
    settle(): void;
    retry(): void;

    start(): () => void;
    reset(): void;
}

export const useWatch = createStore((): WatchApi =>
{
    const [matchId, setMatchId] = createSignal<string | null>(null);
    const [view, setView] = createSignal<Watched | null>(null);
    const [events, setEvents] = createSignal<EventBatch>(NO_EVENTS);
    const [missing, setMissing] = createSignal(false);
    const [lost, setLost] = createSignal(false);

    const opened = new Set<string>();

    let held = -1;
    let seq = 0;
    let reading: Promise<void> | null = null;
    let again = false;
    let stop: (() => void) | null = null;

    const once = (id: string, at: number) => () =>
    {
        if (opened.has(id) || runtime().clock.now() - at > OPENING_MS)
        {
            return false;
        }

        opened.add(id);

        return true;
    };

    const fold = (id: string, answer: MatchWatch) =>
    {
        const { events: told, ...shown } = answer;
        const first = held < 0;

        if (!first && shown.match.rev < held)
        {
            return;
        }

        const run = runOf(told, first ? 0 : held, shown.match.rev);
        const opening = first && told.length === 1 && told[0].seat === -1 && told[0].rev === shown.match.rev;
        const explained = first ? opening : run.whole && run.fresh.length > 0;

        held = shown.match.rev;

        batch(() =>
        {
            setMissing(false);
            setLost(false);
            setView(shown);

            if (explained)
            {
                seq += 1;
                setEvents({
                    seq,
                    id,
                    events: first ? told : run.fresh,
                    live: true,
                    jump: false,
                    ...(opening ? { opens: once(id, runtime().clock.now()) } : {})
                });
            }
        });
    };

    const ask = async (id: string) =>
    {
        try
        {
            const answer = await client.matches.watch({ params: { id }, query: { rev: String(Math.max(held, 0)) } });

            if (untrack(matchId) === id)
            {
                fold(id, answer);
            }
        }
        catch (error)
        {
            if (untrack(matchId) !== id)
            {
                return;
            }

            if (error instanceof ApiError && error.status === 404)
            {
                held = -1;
                batch(() =>
                {
                    setMissing(true);
                    setLost(false);
                    setView(null);
                });
            }
            else
            {
                setLost(true);
            }
        }
    };

    const read = (): Promise<void> =>
    {
        const id = untrack(matchId);

        if (id === null)
        {
            return Promise.resolve();
        }

        if (reading !== null)
        {
            again = true;

            return reading;
        }

        const mine = ask(id).finally(() =>
        {
            if (reading === mine)
            {
                reading = null;
            }

            if (again)
            {
                again = false;
                void read();
            }
        });

        reading = mine;

        return mine;
    };

    const forget = () =>
    {
        held = -1;
        again = false;
        reading = null;
        batch(() =>
        {
            setView(null);
            setMissing(false);
            setLost(false);
        });
    };

    const live = () => untrack(matchId) !== null && untrack(view)?.live !== false;

    return {
        view,
        events,
        refused: () => missing() && matchId() !== null,
        failed: () => lost() && view() === null && matchId() !== null,

        open(id)
        {
            if (untrack(matchId) === id)
            {
                return;
            }

            forget();
            setMatchId(id);
            void read();
        },

        close()
        {
            if (untrack(matchId) === null)
            {
                return;
            }

            forget();
            setMatchId(null);
        },

        settle()
        {
            if (live())
            {
                void read();
            }
        },

        retry()
        {
            void read();
        },

        start()
        {
            if (stop === null)
            {
                const cancel = runtime().clock.every(WATCH_POLL_MS, () =>
                {
                    const away = typeof document !== 'undefined' && (document.visibilityState === 'hidden' || navigator.onLine === false);

                    if (live() && !away)
                    {
                        void read();
                    }
                });

                const offNudge = useRealtime().onNudge((scope, id) =>
                {
                    if (scope === 'game' && live() && (id === undefined || id === untrack(matchId)))
                    {
                        void read();
                    }
                });

                stop = () =>
                {
                    cancel();
                    offNudge();
                    stop = null;
                };
            }

            return stop;
        },

        reset()
        {
            stop?.();
            forget();
            opened.clear();
            setMatchId(null);
            setEvents(NO_EVENTS);
        }
    };
});
