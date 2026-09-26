import { createStore, createSignal, type Getter } from 'azerothjs';

import { runtime } from '../lib/runtime.ts';
import { useRealtime } from './realtime.store.ts';

export type ConnectionState = 'online' | 'reconnecting' | 'offline' | 'restored';

/** How long "Back online" stays up. Long enough to read, short enough not to become furniture. */
export const RESTORED_MS = 2500;

export interface ConnectionApi
{
    state: Getter<ConnectionState>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

/**
 * What the shell says about the connection, and nothing it cannot see.
 *
 * The version this replaces invented all of it: a `latency` that no request ever measured, a
 * fixed 1800ms "reconnecting" animation that had nothing to do with a reconnection, and a state
 * machine driven entirely by `window.online`. Every value here is now either the socket's own
 * status or `navigator.onLine`, both of which are measurements.
 *
 * It deliberately does NOT report the socket's every flap. Between drop and retry the socket is
 * `down`, during the retry it is `connecting`, and at the first backoff rung it alternates once a
 * second - a banner that followed it would strobe. `offline` means something that will not fix
 * itself: the browser says there is no network, or the client has stopped trying. Everything else
 * in between is one steady `reconnecting`.
 */
export const useConnection = createStore((): ConnectionApi =>
{
    const live = useRealtime();

    const [restored, setRestored] = createSignal(false);
    const [offline, setOffline] = createSignal(false);

    let clearRestored: (() => void) | null = null;
    let unwatch: (() => void) | null = null;
    let stopListeners: (() => void) | null = null;

    const forget = (): void =>
    {
        clearRestored?.();
        clearRestored = null;
        setRestored(false);
    };

    const troubled = (): boolean =>
    {
        if (!live.everConnected())
        {
            return false;
        }
        const status = live.status();
        return status === 'down' || status === 'connecting';
    };

    const state = (): ConnectionState =>
    {
        if (offline() || live.stalled())
        {
            return 'offline';
        }
        if (troubled())
        {
            return 'reconnecting';
        }
        return restored() ? 'restored' : 'online';
    };

    return {
        state,

        start()
        {
            if (typeof window === 'undefined')
            {
                return () => undefined;
            }

            if (unwatch === null)
            {
                let seenTrouble = false;
                unwatch = live.onStatus((status) =>
                {
                    if (status === 'down' || status === 'connecting')
                    {
                        seenTrouble = live.everConnected();
                        forget();
                        return;
                    }
                    if (status === 'connected' && seenTrouble)
                    {
                        seenTrouble = false;
                        setRestored(true);
                        clearRestored = runtime().clock.after(RESTORED_MS, () =>
                        {
                            clearRestored = null;
                            setRestored(false);
                        });
                    }
                });
            }

            if (stopListeners === null)
            {
                const went = (): void => setOffline(true);
                const came = (): void => setOffline(false);

                window.addEventListener('offline', went);
                window.addEventListener('online', came);
                setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);

                stopListeners = () =>
                {
                    window.removeEventListener('offline', went);
                    window.removeEventListener('online', came);
                    stopListeners = null;
                };
            }

            return () =>
            {
                unwatch?.();
                unwatch = null;
                stopListeners?.();
                forget();
            };
        },

        stop()
        {
            unwatch?.();
            unwatch = null;
            stopListeners?.();
            forget();
        },

        reset()
        {
            unwatch?.();
            unwatch = null;
            stopListeners?.();
            forget();
            setOffline(false);
        }
    };
});
