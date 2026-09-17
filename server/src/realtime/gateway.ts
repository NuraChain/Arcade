import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { attachWebSockets, type ServerSocket } from '@azerothjs/ws';
import type { Logger } from '@azerothjs/logger';

import type { ServerConfig } from '../env.ts';
import type { Ports } from '../ports.ts';
import { admit, toWebRequest } from './admit.ts';
import { createHandshakeLimit } from './handshake-limit.ts';
import { parseClientFrame } from './frames.ts';
import type { Connection, Hub } from './hub.ts';

export interface GatewayDeps
{
    ports: Ports;
    hub: Hub;
    config: ServerConfig;
    log: Logger;
}

/** How long a socket may stay unidentified before it is closed. */
const AUTH_DEADLINE_MS = 5000;

/** Frames a socket may send before it is identified. A fifth is a protocol fault. */
const PRE_AUTH_FRAMES = 4;

/** How often lingering presence expires and dead sessions are swept out. */
const SWEEP_MS = 30_000;

const THROTTLES: Record<string, number> = { sync: 5000, presence: 2000, typing: 3000 };

/**
 * The one place a WebSocket is accepted.
 *
 * Everything before the 101 is synchronous, because the framework's origin gate is - and
 * everything after it is careful about one thing: the buffered bytes that arrived in the same TCP
 * segment as the handshake are replayed by the package AFTER `onConnection` returns. A handler
 * assigned behind an `await` therefore misses an eager client's first frames, and they are
 * dropped against a null handler with no error at all. Nothing in this function awaits.
 *
 * The 101 is written before identity is known, which no API here can change. That window is
 * bounded by four things: the gate requires a session cookie to be present, a five-second
 * deadline closes anything still unidentified, only four frames may be buffered before then, and
 * the server says nothing at all until `hello`.
 */
export function attachRealtime(server: Server, deps: GatewayDeps): () => void
{
    const limit = createHandshakeLimit({ max: deps.config.wsHandshakeMax });

    const sweep = setInterval(() =>
    {
        void deps.hub.sweep().catch((error) => deps.log.error('realtime sweep failed', { error }));
    }, SWEEP_MS);
    sweep.unref();

    const detach = attachWebSockets(server, {
        path: '/ws',
        maxConnections: deps.config.wsMaxConnections,

        // Client frames are three small objects. Sixteen megabytes of untrusted input per socket
        // is the wrong ceiling for an endpoint that never receives a payload.
        maxPayload: 4096,

        verifyOrigin: admit({
            origin: deps.config.origin,
            secureCookies: deps.config.origin.startsWith('https://'),
            limit,
            trustProxy: deps.config.env === 'production'
        }),

        logger: deps.log,

        onConnection: (socket, request) =>
        {
            // An upgraded socket gets neither `requestId()` nor `logRequests` - both live in the
            // fetch pipeline, which an Upgrade request never reaches - so the gateway mints its
            // own correlation id and owns its log lines.
            const connection: Connection & { pending: boolean } = {
                id: randomUUID(),
                wire: socket,
                userId: '',
                handle: '',
                sessionId: '',
                state: 'online',
                pending: true
            };

            const buffered: string[] = [];
            const lastSeen: Record<string, number> = {};
            let faults = 0;

            const handle = (text: string): void =>
            {
                const frame = parseClientFrame(text);
                if (frame === null)
                {
                    socket.close(4400, 'Bad frame');
                    return;
                }

                const at = Date.now();
                const floor = THROTTLES[frame.t] ?? 1000;
                if (at - (lastSeen[frame.t] ?? 0) < floor)
                {
                    faults += 1;
                    if (faults > 10)
                    {
                        socket.close(4400, 'Too chatty');
                    }
                    return;
                }
                lastSeen[frame.t] = at;

                if (frame.t === 'sync')
                {
                    deps.hub.resync(connection);
                    return;
                }
                if (frame.t === 'presence')
                {
                    deps.hub.setState(connection, frame.state);
                    return;
                }
                deps.hub.typingIn(connection, frame.id);
            };

            // FIRST, and synchronously. See the note above about the replayed head buffer.
            socket.onMessage = (data) =>
            {
                const text = typeof data === 'string' ? data : new TextDecoder().decode(data);

                if (connection.pending)
                {
                    if (buffered.length >= PRE_AUTH_FRAMES)
                    {
                        socket.close(4400, 'Too eager');
                        return;
                    }
                    buffered.push(text);
                    return;
                }
                handle(text);
            };

            /**
             * Whether the socket went away, which is not the same question as whether it was bound.
             *
             * `bind` awaits a database read, and `pending` is cleared BEFORE it. So a socket that
             * died inside that window ran `release` against a hub that had not registered it yet -
             * an early return, no `leftAt` stamped - and then `bind` resumed and registered a dead
             * socket. Nothing could ever release it again: it sat in `byUser` forever, held a slot
             * against the per-account cap, and kept the person `online` with `leftAt: null` so the
             * sweep's linger check could never fire.
             */
            let closed = false;

            socket.onClose = () =>
            {
                closed = true;
                if (!connection.pending)
                {
                    deps.hub.release(connection);
                }
                connection.pending = false;
            };

            socket.onError = (error) => deps.log.debug('realtime socket error', { connection: connection.id, error });

            const deadline = setTimeout(() =>
            {
                if (connection.pending)
                {
                    socket.close(4401, 'Not signed in');
                }
            }, AUTH_DEADLINE_MS);
            deadline.unref();

            // Unobserved, so the `.catch` is mandatory: an `async onConnection` is not an option
            // because the package does not observe what it returns, and a rejection here would be
            // an unhandled one.
            void deps.ports.identity.principal(toWebRequest(request))
                .then(async (principal) =>
                {
                    clearTimeout(deadline);

                    if (principal === null || !connection.pending)
                    {
                        socket.close(4401, 'Not signed in');
                        return;
                    }

                    connection.pending = false;
                    await deps.hub.bind(connection, principal);

                    if (closed)
                    {
                        deps.hub.release(connection);
                        return;
                    }

                    for (const text of buffered.splice(0))
                    {
                        handle(text);
                    }
                })
                .catch((error) =>
                {
                    clearTimeout(deadline);
                    deps.log.error('realtime bind failed', { connection: connection.id, error });
                    socket.close(1011, 'Could not start');
                });
        }
    });

    return () =>
    {
        clearInterval(sweep);
        detach();
    };
}

export type { ServerSocket };
