import type { ClientFrame, PresenceEntry, ServerFrame } from '../../server/src/realtime/frames.ts';
import type { RealtimeHandlers, RealtimeSource } from '../src/services/realtime.source.ts';

/**
 * The socket, in memory, with the network taken out.
 *
 * `createSocketSource()` is the only module that constructs a real `WebSocket`, and in jsdom
 * `window` exists - so a store started without this installed would open an actual connection to
 * `ws://localhost/ws` and hang there. `tests/setup.ts` installs it globally for the same reason it
 * mocks `../src/api.ts`: no application test may reach the network.
 *
 * Nothing here happens on its own. A test says when the handshake completes (`accept`), what
 * arrives (`deliver`) and when it ends (`drop`), because every one of those is a moment the store
 * is supposed to react to and a fake that guesses them is a fake that hides the reaction.
 */
export const socket =
{
    /** How many times the store asked for a connection. The backoff is counted here. */
    opens: 0,

    /** Close codes the CLIENT used. A clean goodbye is 1000. */
    closed: [] as number[],

    sent: [] as ClientFrame[],

    /** The live connection's handlers, or null between connections. */
    live: null as RealtimeHandlers | null,

    reset(): void
    {
        socket.opens = 0;
        socket.closed = [];
        socket.sent = [];
        socket.live = null;
    },

    /** The handshake completes. */
    accept(): void
    {
        socket.live?.onOpen();
    },

    deliver(frame: ServerFrame): void
    {
        socket.live?.onFrame(frame);
    },

    /**
     * The far end hangs up. 1006 is what a browser reports for a socket that died without a close
     * frame, which is what an interrupted connection actually looks like.
     */
    drop(code = 1006): void
    {
        const handlers = socket.live;
        socket.live = null;
        handlers?.onClose(code);
    }
};

export function presenceFrame(n: number, full: boolean, people: PresenceEntry[]): ServerFrame
{
    return { v: 1, t: 'presence', n, full, people };
}

export function createFakeSource(): RealtimeSource
{
    return {
        open(handlers)
        {
            socket.opens += 1;
            socket.live = handlers;

            return () =>
            {
                // The real source nulls `onclose` before closing, so a close from THIS side never
                // reports back as a drop. A fake that fired onClose here would turn every clean
                // teardown into a reconnect.
                if (socket.live === handlers)
                {
                    socket.live = null;
                }
                socket.closed.push(1000);
            };
        },

        send(frame)
        {
            if (socket.live !== null)
            {
                socket.sent.push(frame);
            }
        }
    };
}
