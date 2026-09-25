import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { HttpError } from '@azerothjs/http';
import { attachWebSockets } from '@azerothjs/ws';
import type { Logger } from '@azerothjs/logger';

import type { ServerConfig } from '../env.ts';
import type { Ports } from '../ports.ts';
import { admit, toWebRequest } from './admit.ts';
import { createHandshakeLimit } from './handshake-limit.ts';
import { matchPlayInput } from '../schemas.ts';
import { ack, game, parseClientFrame, pong, refused, SIGNAL_DATA_MAX, type ClientFrame } from './frames.ts';
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

const BUDGET_WINDOW_MS = 10_000;

const BUDGETS: Record<string, number> = { voice: 30, signal: 120, play: 40, resume: 20, ping: 10 };

const HEARTBEAT_MS = 15_000;

const FAULT_WINDOW_MS = 60_000;

const PONG_TIMEOUT_MS = 10_000;

interface Line
{
    tail: Promise<void>;
}

const whole = (raw: unknown, parsed: unknown): boolean =>
{
    if (typeof raw !== 'object' || raw === null)
    {
        return raw === parsed;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(raw) !== Array.isArray(parsed))
    {
        return false;
    }

    const kept = parsed as Record<string, unknown>;

    return Object.keys(raw).every((key) => Object.hasOwn(kept, key) && whole((raw as Record<string, unknown>)[key], kept[key]));
};

const refusalOf = (error: unknown): { status: number; message: string } =>
    error instanceof HttpError && error.expose
        ? { status: error.status, message: error.message }
        : { status: 500, message: 'Something went wrong.' };

const queue = (line: Line, work: () => Promise<void>): void =>
{
    line.tail = line.tail.then(work, work);
};

async function playOver(deps: GatewayDeps, connection: Connection, frame: Extract<ClientFrame, { t: 'play' }>): Promise<void>
{
    const raw = { key: frame.key, ...(frame.rev === undefined ? {} : { rev: frame.rev }), play: frame.play };
    const input = matchPlayInput.safeParse(raw);

    if (!input.ok || !whole(raw, input.value))
    {
        deps.hub.reply(connection, (n) => refused(n, frame.key, frame.match, 422, 'That is not a move in this game.'));
        return;
    }

    try
    {
        const answer = await deps.ports.match.play(connection.userId, frame.match, input.value);
        deps.hub.reply(connection, (n) => ack(n, frame.key, answer.match, answer.applied, answer.events));
    }
    catch (error)
    {
        const refusal = refusalOf(error);

        if (refusal.status === 500)
        {
            deps.log.error('realtime play failed', { connection: connection.id, error });
        }

        deps.hub.reply(connection, (n) => refused(n, frame.key, frame.match, refusal.status, refusal.message));
    }
}

async function resumeOver(deps: GatewayDeps, connection: Connection, frame: Extract<ClientFrame, { t: 'resume' }>): Promise<void>
{
    try
    {
        const found = await deps.ports.match.since(connection.userId, frame.match, frame.rev);

        if (found === null)
        {
            deps.hub.reply(connection, (n) => refused(n, '', frame.match, 404, 'No game there.'));
            return;
        }

        deps.hub.reply(connection, (n) => game(n, Date.now(), found.match, found.events));
    }
    catch (error)
    {
        const refusal = refusalOf(error);
        deps.hub.reply(connection, (n) => refused(n, '', frame.match, refusal.status, refusal.message));
    }
}

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
        //
        // BOTH ceilings, because they bound different things and only one of them was set.
        // `maxPayload` caps a single frame; the ASSEMBLED message is checked separately against
        // `maxMessage`, which defaults to sixteen megabytes. A fragmented text message of four
        // thousand frames therefore accumulated the whole sixteen megabytes in memory before the
        // parser ever saw it and refused it for being over four kilobytes - once per socket, against
        // a connection cap in the thousands.
        maxPayload: SIGNAL_DATA_MAX + 512,
        maxMessage: SIGNAL_DATA_MAX + 512,
        heartbeatMs: HEARTBEAT_MS,
        pongTimeoutMs: PONG_TIMEOUT_MS,

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
            const spent: Record<string, number[]> = {};
            const line: Line = { tail: Promise.resolve() };
            let faults = 0;
            let faultsSince = 0;

            const spend = (kind: string, at: number): boolean =>
            {
                const recent = (spent[kind] ?? []).filter((when) => at - when < BUDGET_WINDOW_MS);

                if (recent.length >= (BUDGETS[kind] ?? 0))
                {
                    refusing = true;
                    socket.close(4429, `Too many ${ kind } frames`);
                    return false;
                }

                recent.push(at);
                spent[kind] = recent;
                return true;
            };

            /**
             * Whether this socket has already been refused.
             *
             * `close()` sends a close FRAME and then waits up to five seconds for the peer to echo
             * it - and the framework only stops dispatching once that handshake completes. So a
             * client that simply ignores the close went on being parsed and served for those five
             * seconds: still JSON-parsed at line rate, and any frame clearing its per-type floor
             * still reached the hub, including the typing path that costs a database read.
             *
             * The verdict is taken here instead, where it can be immediate.
             */
            let refusing = false;

            const handle = (text: string): void =>
            {
                if (refusing)
                {
                    return;
                }

                const frame = parseClientFrame(text);
                if (frame === null)
                {
                    refusing = true;
                    socket.close(4400, 'Bad frame');
                    return;
                }

                const at = Date.now();

                if (frame.t in BUDGETS && !spend(frame.t, at))
                {
                    return;
                }

                if (frame.t === 'voice')
                {
                    deps.hub.voice(connection, frame.table, frame.on, frame.muted);
                    return;
                }

                if (frame.t === 'signal')
                {
                    deps.hub.signal(connection, frame.table, frame.to, frame.kind, frame.data);
                    return;
                }

                if (frame.t === 'ping')
                {
                    deps.hub.reply(connection, (n) => pong(n, Date.now()));
                    return;
                }

                if (frame.t === 'play')
                {
                    queue(line, () => playOver(deps, connection, frame));
                    return;
                }

                if (frame.t === 'resume')
                {
                    queue(line, () => resumeOver(deps, connection, frame));
                    return;
                }

                const floor = THROTTLES[frame.t] ?? 1000;
                if (at - (lastSeen[frame.t] ?? 0) < floor)
                {
                    if (at - faultsSince > FAULT_WINDOW_MS)
                    {
                        faults = 0;
                        faultsSince = at;
                    }

                    faults += 1;
                    if (faults > 10)
                    {
                        refusing = true;
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

                    if (!await deps.hub.bind(connection, principal))
                    {
                        refusing = true;
                        return;
                    }

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
