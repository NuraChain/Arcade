import { createResource, createSignal, createStore, type Getter } from 'azerothjs';

import { ApiError, client } from '../api.ts';
import { runtime } from '../lib/runtime.ts';
import type { MatchWatch } from '../api.ts';

export const WATCH_POLL_MS = 10_000;

export interface WatchApi
{
    view: Getter<MatchWatch | null>;

    loading: Getter<boolean>;

    waiting: Getter<boolean>;

    failed: Getter<boolean>;

    open(matchId: string): void;
    close(): void;
    retry(): void;

    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useWatch = createStore((): WatchApi =>
{
    const [matchId, setMatchId] = createSignal<string | null>(null);
    const [missing, setMissing] = createSignal(false);

    let stop: (() => void) | null = null;

    const watched = createResource(
        () => matchId(),
        async (id) =>
        {
            try
            {
                const found = await client.matches.watch({ params: { id } });

                setMissing(false);
                return found;
            }
            catch (error)
            {
                if (error instanceof ApiError && error.status === 404)
                {
                    setMissing(true);
                    return null;
                }

                throw error;
            }
        },
        { name: 'watch.match' }
    );

    return {
        view: () => watched.data() ?? null,
        loading: () => watched.loading(),
        waiting: () => missing() && matchId() !== null,
        failed: () => watched.error() !== null && watched.data() == null && matchId() !== null,

        open(id)
        {
            setMissing(false);
            setMatchId(id);
        },

        close()
        {
            setMatchId(null);
            setMissing(false);
        },

        retry()
        {
            if (matchId() !== null)
            {
                watched.refetch();
            }
        },

        start()
        {
            if (stop === null)
            {
                const cancel = runtime().clock.every(WATCH_POLL_MS, () =>
                {
                    const away = typeof document !== 'undefined' && (document.visibilityState === 'hidden' || navigator.onLine === false);

                    if (matchId() !== null && !away)
                    {
                        watched.refetch();
                    }
                });

                stop = () =>
                {
                    cancel();
                    stop = null;
                };
            }

            return stop;
        },

        stop()
        {
            stop?.();
        },

        reset()
        {
            stop?.();
            setMatchId(null);
            setMissing(false);
        }
    };
});
