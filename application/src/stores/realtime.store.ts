import { createStore, createSignal, type Getter } from 'azerothjs';

import type { PresenceEntry, ServerFrame } from '../api.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';
import { createSocketSource, type RealtimeSource } from '../services/realtime.source.ts';

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'down';

/** Deltas inside this window become one refetch. */
export const NUDGE_WINDOW_MS = 250;

/** One rung per consecutive failure, the last one repeating forever. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Up for this long and the next drop starts from the beginning again.
 *
 * Connecting is NOT what resets the backoff - STAYING connected is. A socket that opens and dies
 * two hundred milliseconds later, over and over, is a failing loop that a reset-on-open would
 * hammer at one second forever.
 */
export const STEADY_MS = 30_000;

/**
 * Close codes this client must not retry.
 *
 * 4401 means the session is gone - retrying would hammer the handshake for something only a
 * sign-in can fix. 4429 means this account already holds enough sockets, and a sixteenth tab is
 * the user's own doing. 4400 means this client sent something the server could not parse, which
 * is a bug here; a retry loop would hide it.
 */
const TERMINAL = new Set([4400, 4401, 4429]);

export interface RealtimeApi
{
    status: Getter<RealtimeStatus>;

    /**
     * Whether a socket that WAS connected has dropped.
     *
     * Not "is it down": a socket that has never connected leaves the app exactly as it is
     * today - a working pull-model app - and says nothing. Announcing a connection problem on
     * every page of an environment where the socket cannot be established is worse than being
     * quiet, and it is the same rule the landing page follows about WebGL.
     */
    interrupted: Getter<boolean>;

    presence: Getter<PresenceEntry[] | null>;
    typing: Getter<{ who: string; id: string; at: number } | null>;

    onNudge(listener: (scope: 'chat' | 'social', id: string | undefined) => void): () => void;

    sync(): void;
    setState(state: 'online' | 'away'): void;
    startTyping(conversationId: string): void;

    /** Closes and suppresses reconnection for `ms`. The settings affordance uses it. */
    simulateDrop(ms: number): void;

    start(): () => void;
    stop(): void;
    reset(): void;
}

let active: RealtimeSource = createSocketSource();

export function setRealtimeSource(next: RealtimeSource | null): void
{
    active = next ?? createSocketSource();
}

/**
 * The socket, as the rest of the app sees it.
 *
 * It owns exactly one connection, the backoff that re-opens it, and the dispatch of what arrives.
 * What it does NOT own is any content: a frame says "something about this conversation changed",
 * and the stores that care go and re-read it through the routes that already enforce membership,
 * blocks and the read watermark. One delivery path, one set of rules.
 */
export const useRealtime = createStore((): RealtimeApi =>
{
    const [status, setStatus] = createSignal<RealtimeStatus>('idle');
    const [everConnected, setEverConnected] = createSignal(false);
    const [presence, setPresence] = createSignal<PresenceEntry[] | null>(null);
    const [typing, setTyping] = createSignal<{ who: string; id: string; at: number } | null>(null);

    const listeners = new Set<(scope: 'chat' | 'social', id: string | undefined) => void>();
    const pending = new Map<string, { scope: 'chat' | 'social'; id: string | undefined }>();

    let close: (() => void) | null = null;
    let retry: (() => void) | null = null;
    let coalesce: (() => void) | null = null;
    let attempt = 0;
    let connectedAt = 0;
    let suppressUntil = 0;
    let wanted = false;
    let watching: (() => void) | null = null;

    const clearRetry = (): void =>
    {
        retry?.();
        retry = null;
    };

    const flush = (): void =>
    {
        coalesce = null;
        const batch = [...pending.values()];
        pending.clear();
        for (const { scope, id } of batch)
        {
            for (const listener of listeners)
            {
                listener(scope, id);
            }
        }
    };

    const nudge = (scope: 'chat' | 'social', id: string | undefined): void =>
    {
        pending.set(`${ scope }:${ id ?? '' }`, { scope, id });
        if (coalesce === null)
        {
            coalesce = runtime().clock.after(NUDGE_WINDOW_MS, flush);
        }
    };

    const receive = (frame: ServerFrame): void =>
    {
        if (frame.t === 'presence')
        {
            setPresence((current) =>
            {
                if (frame.full || current === null)
                {
                    return frame.people;
                }
                const merged = new Map(current.map((entry) => [entry.who, entry]));
                for (const entry of frame.people)
                {
                    merged.set(entry.who, entry);
                }

                // A delta naming somebody with an empty list is how the server says they went
                // dark, so anybody a non-full frame does not mention keeps their state and
                // anybody it mentions with nothing is removed by the sender's own snapshot.
                return [...merged.values()];
            });
            return;
        }

        if (frame.t === 'nudge')
        {
            nudge(frame.scope, frame.id);
            return;
        }

        if (frame.t === 'typing')
        {
            setTyping({ who: frame.who, id: frame.id, at: runtime().clock.now() });
        }
    };

    const schedule = (): void =>
    {
        if (!wanted || retry !== null)
        {
            return;
        }

        // Jittered from the seeded generator, not Math.random: a test drives the clock, and a
        // schedule it cannot predict is a schedule it cannot assert.
        const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        const spread = createRandom(hashSeed(runtime().seed, 'backoff', attempt)).next();
        const jitter = base * 0.2 * (spread - 0.5);
        const wait = Math.max(0, suppressUntil - runtime().clock.now()) + base + jitter;

        retry = runtime().clock.after(wait, () =>
        {
            retry = null;
            open();
        });
    };

    function open(): void
    {
        if (!wanted || close !== null)
        {
            return;
        }
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
        {
            return;
        }

        setStatus('connecting');

        close = active.open({
            onOpen()
            {
                connectedAt = runtime().clock.now();
                setEverConnected(true);
                setStatus('connected');
            },

            onFrame: receive,

            onClose(code)
            {
                close = null;
                setPresence(null);
                setStatus('down');

                if (TERMINAL.has(code))
                {
                    wanted = false;
                    return;
                }

                // A socket that stood up for a while and then dropped starts its backoff from the
                // beginning: the last failure says nothing about this one.
                if (connectedAt !== 0 && runtime().clock.now() - connectedAt >= STEADY_MS)
                {
                    attempt = 0;
                }

                connectedAt = 0;
                schedule();
                attempt += 1;
            }
        });
    }

    /**
     * Two signals that a wait is pointless, wired to one handler.
     *
     * A hidden tab is not reconnected at all - a backgrounded phone would otherwise spend its
     * battery reopening a socket nobody is looking at - and coming back is the moment to try
     * again rather than the moment the old backoff happened to expire. `online` is the same
     * argument for a laptop leaving a tunnel.
     *
     * It is deliberately idempotent: the browser fires `online` more than once, and `close` is
     * already assigned by the time `open()` returns, so a second event finds a connection in
     * progress and does nothing.
     */
    const watchEnvironment = (): void =>
    {
        if (typeof document === 'undefined' || typeof window === 'undefined' || watching !== null)
        {
            return;
        }

        const resume = (): void =>
        {
            if (!wanted || close !== null || document.visibilityState === 'hidden')
            {
                return;
            }
            if (runtime().clock.now() < suppressUntil)
            {
                return;
            }
            clearRetry();
            open();
        };

        document.addEventListener('visibilitychange', resume);
        window.addEventListener('online', resume);

        watching = () =>
        {
            document.removeEventListener('visibilitychange', resume);
            window.removeEventListener('online', resume);
            watching = null;
        };
    };

    const teardown = (): void =>
    {
        wanted = false;
        clearRetry();
        coalesce?.();
        coalesce = null;
        pending.clear();
        close?.();
        close = null;
        watching?.();
        setStatus('idle');
        setPresence(null);
        setTyping(null);
    };

    return {
        status,
        interrupted: () => everConnected() && status() === 'down',
        presence,
        typing,

        onNudge(listener)
        {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        sync: () => active.send({ t: 'sync' }),
        setState: (state) => active.send({ t: 'presence', state }),
        startTyping: (conversationId) => active.send({ t: 'typing', id: conversationId }),

        simulateDrop(ms)
        {
            clearRetry();
            suppressUntil = runtime().clock.now() + ms;
            close?.();
            close = null;
            setStatus('down');
            attempt = 0;
            schedule();
        },

        start()
        {
            if (typeof window === 'undefined')
            {
                return () => undefined;
            }

            wanted = true;
            attempt = 0;
            watchEnvironment();
            open();
            return teardown;
        },

        stop: teardown,

        reset()
        {
            teardown();
            listeners.clear();
            attempt = 0;
            suppressUntil = 0;
            connectedAt = 0;
            setEverConnected(false);
        }
    };
});
