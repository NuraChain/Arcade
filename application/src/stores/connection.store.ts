import { createStore, createSignal, type Getter } from 'azerothjs';

import { runtime } from '../lib/runtime.ts';

export type ConnectionState = 'online' | 'offline' | 'reconnecting';

export const RECONNECT_DELAY = 1800;

export interface ConnectionApi
{
    state: Getter<ConnectionState>;
    latency: Getter<number>;
    simulateDrop(ms: number): void;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useConnection = createStore((): ConnectionApi =>
{
    const [state, setState] = createSignal<ConnectionState>('online');
    const [latency, setLatency] = createSignal(1);
    const pending = new Set<() => void>();
    let stopListeners: (() => void) | null = null;

    const later = (ms: number, fn: () => void): void =>
    {
        const cancel = runtime().clock.after(ms, () =>
        {
            pending.delete(cancel);
            fn();
        });
        pending.add(cancel);
    };

    const recover = (): void =>
    {
        if (state() === 'online')
        {
            return;
        }
        setState('reconnecting');
        setLatency(2.5);
        later(RECONNECT_DELAY, () =>
        {
            setState('online');
            setLatency(1);
        });
    };

    const drop = (): void =>
    {
        for (const cancel of pending)
        {
            cancel();
        }
        pending.clear();
        setState('offline');
    };

    return {
        state,
        latency,

        simulateDrop(ms)
        {
            drop();
            later(ms, recover);
        },

        start()
        {
            if (stopListeners !== null || typeof window === 'undefined')
            {
                return stopListeners ?? (() => undefined);
            }
            const onOffline = (): void => drop();
            const onOnline = (): void => recover();
            window.addEventListener('offline', onOffline);
            window.addEventListener('online', onOnline);
            if (typeof navigator !== 'undefined' && navigator.onLine === false)
            {
                drop();
            }
            stopListeners = () =>
            {
                window.removeEventListener('offline', onOffline);
                window.removeEventListener('online', onOnline);
                stopListeners = null;
            };
            return stopListeners;
        },

        stop()
        {
            stopListeners?.();
        },

        reset()
        {
            stopListeners?.();
            for (const cancel of pending)
            {
                cancel();
            }
            pending.clear();
            setState('online');
            setLatency(1);
        }
    };
});
