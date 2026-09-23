import { createStore, createSignal, type Getter } from 'azerothjs';

import type { PresenceEntry, ServerFrame } from '../api.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';
import { createSocketSource, type RealtimeSource } from '../services/realtime.source.ts';

export type VoiceFrame = Extract<ServerFrame, { t: 'voice' }>;

export type SignalFrame = Extract<ServerFrame, { t: 'signal' }>;

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
 * How long a tab may sit hidden before its socket is let go.
 *
 * The store already refused to OPEN while hidden, and never closed one that was already open - so a
 * backgrounded tab kept taking every frame the server sent, and every store subscribed to the
 * doorbell kept refetching behind a window nobody was looking at. On a machine with the app left
 * open in a tab that is the whole day's traffic for nothing.
 *
 * Not immediate, and the delay is the whole design. Alt-tabbing to check something and coming
 * straight back is the common case, and a socket that closed and reopened on every one of those
 * would cost a handshake, a full re-read and a visible "reconnecting" each time - which is worse
 * than the thing it fixes. A minute is long enough that a glance costs nothing and short enough
 * that a tab left behind stops working within a minute of being abandoned.
 */
export const IDLE_MS = 60_000;

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

    /** Whether a socket has ever stood up in this session. */
    everConnected: Getter<boolean>;

    /**
     * Whether this client has stopped trying.
     *
     * A terminal close code is not a network problem and will not heal on its own, so the shell
     * must be able to tell the difference between "reconnecting" and "this is as good as it gets".
     */
    stalled: Getter<boolean>;

    presence: Getter<PresenceEntry[] | null>;

    onNudge(listener: (scope: 'chat' | 'social' | 'game', id: string | undefined) => void): () => void;

    /**
     * Somebody is typing, right now, in one conversation.
     *
     * An event rather than a getter: two people typing in two rooms are two facts, and a single
     * slot would have one of them overwrite the other. Who is typing where, and for how long, is
     * the chat store's business - this only says what arrived.
     */
    onTyping(listener: (who: string, conversationId: string) => void): () => void;

    onVoice(listener: (frame: VoiceFrame) => void): () => void;

    onSignal(listener: (frame: SignalFrame) => void): () => void;

    voice(table: string, on: boolean, muted: boolean): void;

    signal(table: string, to: string, kind: SignalFrame['kind'], data: string): void;

    /**
     * Every status change, in order.
     *
     * A getter cannot carry a transition, and `connected` after an interruption is a different
     * event from `connected` on first boot - one of them is worth telling somebody about.
     */
    onStatus(listener: (status: RealtimeStatus) => void): () => void;

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

export function onBack(live: Pick<RealtimeApi, 'onStatus'>, listener: () => void): () => void
{
    let dropped = false;

    return live.onStatus((status) =>
    {
        if (status === 'down')
        {
            dropped = true;
            return;
        }

        if (status === 'connected' && dropped)
        {
            dropped = false;
            listener();
        }
    });
}

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
    const [stalled, setStalled] = createSignal(false);
    const [presence, setPresence] = createSignal<PresenceEntry[] | null>(null);

    const listeners = new Set<(scope: 'chat' | 'social' | 'game', id: string | undefined) => void>();
    const watchers = new Set<(status: RealtimeStatus) => void>();
    const typists = new Set<(who: string, conversationId: string) => void>();
    const voices = new Set<(frame: VoiceFrame) => void>();
    const signals = new Set<(frame: SignalFrame) => void>();
    const pending = new Map<string, { scope: 'chat' | 'social' | 'game'; id: string | undefined }>();

    let close: (() => void) | null = null;
    let retry: (() => void) | null = null;
    let coalesce: (() => void) | null = null;
    let attempt = 0;
    let connectedAt = 0;
    let suppressUntil = 0;

    /** Cancels the pending "the tab has been hidden long enough" timer, if one is armed. */
    let cancelSleep: (() => void) | null = null;
    let wanted = false;
    let watching: (() => void) | null = null;

    const announce = (next: RealtimeStatus): void =>
    {
        setStatus(next);
        for (const watcher of watchers)
        {
            watcher(next);
        }
    };

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

    const nudge = (scope: 'chat' | 'social' | 'game', id: string | undefined): void =>
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

                // `gone` is how a departure arrives, and it has to be a separate field: somebody
                // who went dark has no presence record left to describe, so the server used to
                // announce it as `people: []` - a frame naming nobody, which merged to no change
                // at all. A tab left open showed people who had left hours earlier.
                //
                // Removing them leaves them UNKNOWN rather than offline, which is the honest
                // answer: a person who left and a person who turned presence off are the same
                // thing from here, and `presence.dot()` draws nothing for either.
                for (const who of frame.gone ?? [])
                {
                    merged.delete(who);
                }

                // Anybody a delta does not mention keeps whatever they had.
                return [...merged.values()];
            });
            return;
        }

        if (frame.t === 'nudge')
        {
            nudge(frame.scope, frame.id);
            return;
        }

        if (frame.t === 'voice')
        {
            for (const listener of voices)
            {
                listener(frame);
            }
            return;
        }

        if (frame.t === 'signal')
        {
            for (const listener of signals)
            {
                listener(frame);
            }
            return;
        }

        if (frame.t === 'typing')
        {
            for (const typist of typists)
            {
                typist(frame.who, frame.id);
            }
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

        announce('connecting');

        close = active.open({
            onOpen()
            {
                connectedAt = runtime().clock.now();
                setEverConnected(true);
                announce('connected');
            },

            onFrame: receive,

            onClose(code)
            {
                close = null;
                setPresence(null);
                announce('down');

                if (TERMINAL.has(code))
                {
                    wanted = false;
                    setStalled(true);
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

        /**
         * Lets an open socket go once the tab has been hidden for a while, and never before.
         *
         * `announce('idle')` rather than `'down'`: nothing is wrong and nobody is looking, so the
         * connection banner must not claim the network is broken - `connection.store.ts` turns
         * `down` into a reconnecting strip, which would be waiting on the screen when somebody
         * comes back to a tab that was working perfectly.
         */
        const sleep = (): void =>
        {
            if (close === null || document.visibilityState !== 'hidden')
            {
                return;
            }

            clearRetry();
            close();
            close = null;
            announce('idle');
        };

        const watchVisibility = (): void =>
        {
            cancelSleep?.();
            cancelSleep = null;

            if (document.visibilityState === 'hidden')
            {
                cancelSleep = runtime().clock.after(IDLE_MS, () =>
                {
                    cancelSleep = null;
                    sleep();
                });
                return;
            }

            resume();
        };

        document.addEventListener('visibilitychange', watchVisibility);
        window.addEventListener('online', resume);

        watching = () =>
        {
            cancelSleep?.();
            cancelSleep = null;
            document.removeEventListener('visibilitychange', watchVisibility);
            window.removeEventListener('online', resume);
            watching = null;
        };
    };

    const teardown = (): void =>
    {
        wanted = false;
        clearRetry();
        cancelSleep?.();
        cancelSleep = null;
        coalesce?.();
        coalesce = null;
        pending.clear();
        close?.();
        close = null;
        watching?.();
        announce('idle');
        setPresence(null);
    };

    return {
        status,
        interrupted: () => everConnected() && status() === 'down',
        everConnected,
        stalled,
        presence,

        onNudge(listener)
        {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        onVoice(listener)
        {
            voices.add(listener);
            return () => voices.delete(listener);
        },

        onSignal(listener)
        {
            signals.add(listener);
            return () => signals.delete(listener);
        },

        voice: (table, on, muted) => active.send({ t: 'voice', table, on, muted }),

        signal: (table, to, kind, data) => active.send({ t: 'signal', table, to, kind, data }),

        onTyping(listener)
        {
            typists.add(listener);
            return () => typists.delete(listener);
        },

        onStatus(listener)
        {
            watchers.add(listener);
            return () => watchers.delete(listener);
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
            announce('down');
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
            setStalled(false);
            watchEnvironment();
            open();
            return teardown;
        },

        stop: teardown,

        reset()
        {
            teardown();
            listeners.clear();
            watchers.clear();
            typists.clear();
            voices.clear();
            signals.clear();
            setStalled(false);
            attempt = 0;
            suppressUntil = 0;
            connectedAt = 0;
            setEverConnected(false);
        }
    };
});
