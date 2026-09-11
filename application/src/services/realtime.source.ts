import type { ClientFrame, ServerFrame } from '../api.ts';

export interface RealtimeHandlers
{
    onOpen(): void;
    onFrame(frame: ServerFrame): void;

    /** `code` is the close code; 1006 means the socket died without one. */
    onClose(code: number): void;
}

export interface RealtimeSource
{
    /** Opens one connection. The returned function closes it from THIS side, cleanly. */
    open(handlers: RealtimeHandlers): () => void;

    send(frame: ClientFrame): void;
}

/**
 * The only module in the application that constructs a WebSocket.
 *
 * A RELATIVE path, resolved against `location`, never an absolute url: vite already proxies
 * `/ws` with `ws: true`, and an absolute url would hard-code a port that is wrong in three of the
 * four ways this app is served.
 *
 * Closing from this side uses `close(1000)` rather than dropping the socket, so the server sees a
 * clean goodbye and does not hold the connection open to its heartbeat timeout.
 */
export function createSocketSource(): RealtimeSource
{
    let socket: WebSocket | null = null;

    return {
        open(handlers)
        {
            if (typeof window === 'undefined')
            {
                return () => undefined;
            }

            const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const next = new WebSocket(`${ scheme }//${ window.location.host }/ws`);
            socket = next;

            next.onopen = () => handlers.onOpen();

            next.onmessage = (event) =>
            {
                if (typeof event.data !== 'string')
                {
                    return;
                }
                try
                {
                    handlers.onFrame(JSON.parse(event.data) as ServerFrame);
                }
                catch
                {
                    // A frame this client cannot read is not a reason to tear the socket down.
                    // The server is the only thing that writes them, and a newer one may say
                    // something this version has never heard of.
                }
            };

            next.onclose = (event) =>
            {
                if (socket === next)
                {
                    socket = null;
                }
                handlers.onClose(event.code);
            };

            // `onerror` is deliberately not wired to anything: a socket error is always followed
            // by a close, and reacting to both is how one drop becomes two reconnects.
            next.onerror = () => undefined;

            return () =>
            {
                next.onclose = null;
                next.close(1000, 'Leaving');
                if (socket === next)
                {
                    socket = null;
                }
            };
        },

        send(frame)
        {
            if (socket !== null && socket.readyState === WebSocket.OPEN)
            {
                socket.send(JSON.stringify({ v: 1, ...frame }));
            }
        }
    };
}
