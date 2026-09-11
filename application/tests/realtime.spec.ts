import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import {
    BACKOFF_MS,
    NUDGE_WINDOW_MS,
    STEADY_MS,
    useRealtime
} from '../src/stores/realtime.store.ts';
import { socket } from './fake-realtime.ts';

let clock: ManualClock;
let visibility: DocumentVisibilityState = 'visible';

const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_000_000);
    setRuntime({ clock, seed: 3 });

    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibility
    });

    socket.reset();
    useRealtime().reset();
});

afterEach(() =>
{
    useRealtime().reset();
    if (original !== undefined)
    {
        Object.defineProperty(Document.prototype, 'visibilityState', original);
    }
    resetRuntime();
});

const hide = (): void =>
{
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
};

const show = (): void =>
{
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
};

describe('the realtime store', () =>
{
    it('opens exactly one socket and reports the handshake as it happens', () =>
    {
        const live = useRealtime();

        expect(live.status()).toBe('idle');

        live.start();
        expect(socket.opens).toBe(1);
        expect(live.status()).toBe('connecting');

        socket.accept();
        expect(live.status()).toBe('connected');
        expect(live.interrupted()).toBe(false);
    });

    it('backs off along the schedule it publishes, one rung per consecutive failure', () =>
    {
        expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 15000]);

        const live = useRealtime();
        live.start();
        socket.accept();
        socket.drop();

        for (const base of BACKOFF_MS)
        {
            const before = socket.opens;

            // The jitter is +/-10% of the rung, so the window either side of it is unambiguous
            // without the test having to recompute the seeded draw.
            clock.advance(base * 0.89);
            expect(socket.opens).toBe(before);

            clock.advance(base * 0.22);
            expect(socket.opens).toBe(before + 1);

            socket.drop();
        }

        // The last rung repeats rather than growing without bound.
        const before = socket.opens;
        clock.advance(15_000 * 0.89);
        expect(socket.opens).toBe(before);
        clock.advance(15_000 * 0.22);
        expect(socket.opens).toBe(before + 1);
    });

    it('resets the backoff only after a connection has held, not merely opened', () =>
    {
        const live = useRealtime();
        live.start();

        socket.accept();
        socket.drop();
        clock.advance(BACKOFF_MS[0] * 1.11);
        socket.drop();
        clock.advance(BACKOFF_MS[1] * 1.11);
        expect(socket.opens).toBe(3);

        socket.accept();
        clock.advance(STEADY_MS);
        socket.drop();

        const before = socket.opens;
        clock.advance(BACKOFF_MS[0] * 0.89);
        expect(socket.opens).toBe(before);
        clock.advance(BACKOFF_MS[0] * 0.22);
        expect(socket.opens).toBe(before + 1);
    });

    it('does not reset the backoff for a connection that opens and dies immediately', () =>
    {
        const live = useRealtime();
        live.start();

        socket.accept();
        socket.drop();
        clock.advance(BACKOFF_MS[0] * 1.11);

        socket.accept();
        clock.advance(STEADY_MS - 1);
        socket.drop();

        const before = socket.opens;
        clock.advance(BACKOFF_MS[1] * 0.89);
        expect(socket.opens).toBe(before);
        clock.advance(BACKOFF_MS[1] * 0.22);
        expect(socket.opens).toBe(before + 1);
    });

    for (const code of [4400, 4401, 4429])
    {
        it('never retries after ' + String(code), () =>
        {
            const live = useRealtime();
            live.start();
            socket.accept();

            socket.drop(code);

            clock.advance(10 * 60_000);
            expect(socket.opens).toBe(1);
            expect(live.status()).toBe('down');
            expect(clock.pending()).toBe(0);
        });
    }

    it('holds still while the tab is hidden and reconnects the moment it is shown', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();

        hide();
        expect(socket.opens).toBe(1);

        socket.drop();
        clock.advance(BACKOFF_MS[0] * 1.11);

        // The retry fired into a hidden tab and declined to open anything.
        expect(socket.opens).toBe(1);
        expect(clock.pending()).toBe(0);

        show();
        expect(socket.opens).toBe(2);
        expect(live.status()).toBe('connecting');
    });

    it('treats two online events as one reconnection', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();
        socket.drop();

        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('online'));

        expect(socket.opens).toBe(2);
        expect(clock.pending()).toBe(0);
    });

    it('lets a simulated drop cancel the retry that was already pending', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();
        socket.drop();

        live.simulateDrop(10_000);
        expect(live.status()).toBe('down');

        // The 1s retry from the real drop would have fired here if it had survived.
        clock.advance(BACKOFF_MS[0] * 1.11);
        expect(socket.opens).toBe(1);

        clock.advance(10_000 - (BACKOFF_MS[0] * 1.11));
        expect(socket.opens).toBe(1);

        clock.advance(BACKOFF_MS[0] * 1.11);
        expect(socket.opens).toBe(2);
    });

    it('will not let an online event walk through a simulated drop', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();

        live.simulateDrop(10_000);
        window.dispatchEvent(new Event('online'));

        expect(socket.opens).toBe(1);
    });

    it('says nothing about a socket that was never up', () =>
    {
        const live = useRealtime();
        live.start();

        socket.drop();
        expect(live.status()).toBe('down');
        expect(live.interrupted()).toBe(false);

        clock.advance(BACKOFF_MS[0] * 1.11);
        socket.drop();
        expect(live.interrupted()).toBe(false);

        clock.advance(BACKOFF_MS[1] * 1.11);
        socket.accept();
        socket.drop();
        expect(live.interrupted()).toBe(true);
    });
});

describe('what arrives on the socket', () =>
{
    it('collapses a burst of deltas about one thing into a single refetch', () =>
    {
        const live = useRealtime();
        const heard = vi.fn();
        live.onNudge(heard);

        live.start();
        socket.accept();

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-1', at: 0 });
        socket.deliver({ v: 1, t: 'nudge', n: 2, scope: 'chat', id: 'c-1', at: 0 });
        socket.deliver({ v: 1, t: 'nudge', n: 3, scope: 'chat', id: 'c-1', at: 0 });

        clock.advance(NUDGE_WINDOW_MS - 1);
        expect(heard).not.toHaveBeenCalled();

        clock.advance(1);
        expect(heard).toHaveBeenCalledTimes(1);
        expect(heard).toHaveBeenCalledWith('chat', 'c-1');
    });

    it('keeps deltas about different things apart inside the same window', () =>
    {
        const live = useRealtime();
        const heard = vi.fn();
        live.onNudge(heard);

        live.start();
        socket.accept();

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-1', at: 0 });
        socket.deliver({ v: 1, t: 'nudge', n: 2, scope: 'chat', id: 'c-2', at: 0 });
        socket.deliver({ v: 1, t: 'nudge', n: 3, scope: 'social', at: 0 });

        clock.advance(NUDGE_WINDOW_MS);
        expect(heard).toHaveBeenCalledTimes(3);
        expect(heard).toHaveBeenCalledWith('social', undefined);
    });

    it('stops listening once the caller unsubscribes', () =>
    {
        const live = useRealtime();
        const heard = vi.fn();
        const stop = live.onNudge(heard);

        live.start();
        socket.accept();
        stop();

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        expect(heard).not.toHaveBeenCalled();
    });

    it('replaces presence on a snapshot and merges it on a delta', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();

        socket.deliver({
            v: 1,
            t: 'presence',
            n: 1,
            full: true,
            people: [
                { who: 'alex', state: 'online', since: 10 },
                { who: 'sara.k', state: 'away', since: 20 }
            ]
        });

        expect(live.presence()).toEqual([
            { who: 'alex', state: 'online', since: 10 },
            { who: 'sara.k', state: 'away', since: 20 }
        ]);

        socket.deliver({
            v: 1,
            t: 'presence',
            n: 2,
            full: false,
            people: [{ who: 'sara.k', state: 'online', since: 30 }]
        });

        expect(live.presence()).toEqual([
            { who: 'alex', state: 'online', since: 10 },
            { who: 'sara.k', state: 'online', since: 30 }
        ]);
    });

    it('forgets presence the instant the socket goes, rather than showing a stale room', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();

        socket.deliver({
            v: 1,
            t: 'presence',
            n: 1,
            full: true,
            people: [{ who: 'alex', state: 'online', since: 10 }]
        });

        socket.drop();
        expect(live.presence()).toBeNull();
    });

    it('stamps a typing notice with the clock, not with the sender', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();

        clock.advance(500);
        socket.deliver({ v: 1, t: 'typing', n: 1, who: 'sara.k', id: 'c-1' });

        expect(live.typing()).toEqual({ who: 'sara.k', id: 'c-1', at: 1_000_500 });
    });

    it('ignores a frame it has no use for rather than treating it as a fault', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();

        socket.deliver({ v: 1, t: 'hello', n: 1, rt: 'nura-rt/v1', self: 'alex', at: 0 });

        expect(live.presence()).toBeNull();
        expect(live.typing()).toBeNull();
        expect(live.status()).toBe('connected');
    });
});

describe('what the client sends', () =>
{
    it('writes each intent as one frame', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();

        live.sync();
        live.setState('away');
        live.startTyping('c-1');

        expect(socket.sent).toEqual([
            { t: 'sync' },
            { t: 'presence', state: 'away' },
            { t: 'typing', id: 'c-1' }
        ]);
    });

    it('drops a send on the floor while there is no socket to put it on', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();
        socket.drop();

        live.sync();
        expect(socket.sent).toEqual([]);
    });
});

describe('teardown', () =>
{
    it('says goodbye cleanly and leaves no timer behind', () =>
    {
        const live = useRealtime();
        const heard = vi.fn();
        live.onNudge(heard);

        live.start();
        socket.accept();
        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-1', at: 0 });

        live.stop();

        expect(socket.closed).toEqual([1000]);
        expect(clock.pending()).toBe(0);
        expect(live.status()).toBe('idle');
        expect(live.presence()).toBeNull();

        clock.advance(60_000);
        expect(heard).not.toHaveBeenCalled();
        expect(socket.opens).toBe(1);
    });

    it('returns a stop from start, so the shell can hold one function', () =>
    {
        const live = useRealtime();
        const stop = live.start();
        socket.accept();

        stop();

        expect(live.status()).toBe('idle');
        expect(socket.closed).toEqual([1000]);
    });

    it('stops reacting to the environment once it is stopped', () =>
    {
        const live = useRealtime();
        live.start();
        socket.accept();
        live.stop();

        window.dispatchEvent(new Event('online'));
        show();

        expect(socket.opens).toBe(1);
    });
});
