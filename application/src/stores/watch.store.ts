import { createResource, createSignal, createStore, type Getter } from 'azerothjs';

import { ApiError, client } from '../api.ts';
import { runtime } from '../lib/runtime.ts';
import type { MatchWatch } from '../api.ts';

/**
 * A game somebody else is playing, as a spectator is allowed to see it.
 *
 * Separate from `match.store.ts` on purpose, and the separation is the safety property. That store
 * holds the board a PLAYER acts on - it knows their seat, their legal moves, and how to send a
 * roll. This one holds a board two minutes old and has no verbs at all: there is nothing here to
 * press, because there is nothing a watcher may do. One store serving both would be one place to
 * hand a spectator a move button.
 *
 * **The delay is the server's and this store cannot shorten it.** The board that arrives is already
 * old; nothing here waits, buffers or holds anything back, because a delay a client implements is
 * a delay the network tab undoes.
 *
 * It POLLS rather than subscribing. A `game` doorbell would tell a watcher the instant something
 * happened, which is a live signal about a game they are supposed to be behind - and refetching on
 * it would be a refetch that returns the same two-minute-old board. Ten seconds is well under the
 * delay, so nothing is ever more stale than the delay itself.
 */

/** How often a watched game is re-read. Well under the delay, so the lag is the delay and nothing else. */
export const WATCH_POLL_MS = 10_000;

export interface WatchApi
{
    /** The delayed board, or null while nothing is being watched or nothing is old enough yet. */
    view: Getter<MatchWatch | null>;

    loading: Getter<boolean>;

    /** True once a game has been asked for and the server had nothing old enough to show. */
    waiting: Getter<boolean>;

    open(matchId: string): void;
    close(): void;

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
                /**
                 * A 404 here is an ANSWER, and rethrowing it put an error in the console on the
                 * ordinary path.
                 *
                 * It is three answers the server deliberately does not tell apart: no such game, a
                 * table a stranger may not watch, and a game too young to have a board old enough
                 * to show. The last is what every watcher meets in the first two minutes of a match,
                 * so it is a state the page renders - and the other two look the same on purpose,
                 * because a 403 would confirm a private table is there.
                 *
                 * Every other status still throws. A dropped connection and "there is nothing to
                 * show yet" are different things, and a store that swallowed both would make the
                 * first one invisible.
                 */
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

        start()
        {
            if (stop === null)
            {
                const cancel = runtime().clock.every(WATCH_POLL_MS, () =>
                {
                    if (matchId() !== null)
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
