import { maySeeOnline, type Party, type Relation } from '../domains/social/policy.ts';
import type { Principal } from '../http/auth.ts';
import { hello, nudge, presence, typing, type PresenceEntry, type PresenceState, type ServerFrame } from './frames.ts';

/**
 * What the hub needs from a socket.
 *
 * The four members `ServerSocket` actually gives us, and nothing else - so a test stands in with
 * a plain object and no port is bound. `send` returning false means BACKPRESSURE, not closed; the
 * two are indistinguishable through that return value, which is why liveness is tracked
 * separately by a flag set in `onClose`.
 */
export interface Wire
{
    send(data: string): boolean;
    drain(): Promise<void>;
    close(code?: number, reason?: string): void;
}

export interface Edges
{
    party: Party;
    friends: ReadonlySet<string>;
    blocks: ReadonlySet<string>;
    loadedAt: number;
}

export interface HubDeps
{
    now(): number;

    /** Loads the relationship sets one connection reasons with. One query per bind. */
    edgesFor(userId: string): Promise<Edges>;

    /** Who should hear about a conversation. Member ids, blocks already excluded. */
    recipientsOf(conversationId: string): Promise<string[]>;

    /** Which of these sessions are still live. One query per sweep, not one per connection. */
    aliveSessions(sessionIds: readonly string[]): Promise<Set<string>>;

    /** Coalesced `last_seen_at` write. Called with ids, flushed by the domain at its own rate. */
    touchSeen(userIds: readonly string[]): void;

    report(error: unknown, where: string): void;

    /** Sockets one account may hold at once. */
    accountMax: number;
}

export interface Connection
{
    readonly id: string;
    readonly wire: Wire;
    userId: string;
    handle: string;
    sessionId: string;
    state: PresenceState;
}

interface Held extends Connection
{
    alive: boolean;
    outbox: string[];
    bytes: number;
    pumping: boolean;
    n: number;
}

const OUTBOX_FRAMES = 256;

const OUTBOX_BYTES = 256 * 1024;

/** How long a person stays online after their last socket goes. A reload must not flap. */
export const LINGER_MS = 15_000;

/** How long a connection's cached relationship sets may be trusted without a reload. */
export const EDGES_TTL_MS = 60_000;

/** Deltas inside one window collapse into one frame. */
export const TICK_MS = 500;

export interface Hub
{
    bind(connection: Connection, principal: Principal): Promise<void>;
    release(connection: Connection): void;

    chatChanged(conversationId: string): void;
    socialChanged(...userIds: string[]): void;
    sessionsRevoked(sessionIds: readonly string[]): void;

    typingIn(connection: Connection, conversationId: string): void;
    setState(connection: Connection, state: PresenceState): void;
    resync(connection: Connection): void;

    sweep(): Promise<void>;
    flush(): void;

    presenceOf(userId: string): PresenceEntry[];
    size(): number;
    closeAll(code: number, reason: string): void;
}

/**
 * The connection registry the WebSocket package deliberately does not provide.
 *
 * Its own `live` set holds raw `net.Socket`s, which cannot be sent a close frame - so anything
 * that wants to say goodbye with a code has to keep its own map. This is that map, plus the three
 * things a map alone is not: a per-connection outbox with ordering, a presence view computed PER
 * VIEWER, and a coalescing window so a burst of writes is one frame.
 *
 * Only two functions here would route through another process: `publish` and the inbound frame
 * handler. That is the whole multi-process seam. Everything else is local by construction except
 * `relationFor`, which reads both ends' cached sets - if this ever runs in more than one process,
 * that is the function that loads the subject's `Party` on demand instead.
 */
export function createHub(deps: HubDeps): Hub
{
    const byUser = new Map<string, Set<Held>>();
    const edges = new Map<string, Edges>();
    const online = new Map<string, { state: PresenceState; since: number; leftAt: number | null }>();

    const pendingChat = new Map<string, number>();
    const pendingSocial = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const held = (connection: Connection): Held => connection as Held;

    const partyOf = (userId: string): Party | null => edges.get(userId)?.party ?? null;

    /**
     * The relationship between two accounts, from what is already in memory.
     *
     * `incoming` and `outgoing` collapse into `none` because `maySeeOnline` treats them
     * identically - a pending request grants no visibility either way. Restating that here rather
     * than in the policy would be a second opinion; this only narrows what the policy is asked.
     */
    const relationFor = (viewer: string, subject: string): Relation =>
    {
        if (viewer === subject)
        {
            return 'me';
        }
        const mine = edges.get(viewer);
        const theirs = edges.get(subject);
        if (mine === undefined || theirs === undefined)
        {
            return 'none';
        }
        if (mine.blocks.has(subject) || theirs.blocks.has(viewer))
        {
            return 'blocked';
        }
        return mine.friends.has(subject) ? 'friend' : 'none';
    };

    const visible = (viewer: string, subject: string): boolean =>
    {
        const watching = partyOf(viewer);
        const watched = partyOf(subject);
        if (watching === null || watched === null)
        {
            return false;
        }

        // The real policy, per pair, never restated. It always says yes for a friend today -
        // calling it anyway is what makes a later change to the rule reach realtime without
        // anybody editing realtime code.
        return maySeeOnline(watching, watched, relationFor(viewer, subject));
    };

    const pump = (connection: Held): void =>
    {
        if (connection.pumping)
        {
            return;
        }
        connection.pumping = true;

        void (async () =>
        {
            try
            {
                while (connection.alive && connection.outbox.length > 0)
                {
                    const text = connection.outbox.shift()!;
                    connection.bytes -= text.length;
                    if (!connection.wire.send(text))
                    {
                        await connection.wire.drain();
                    }
                }
            }
            catch (error)
            {
                deps.report(error, 'realtime.pump');
            }
            finally
            {
                connection.pumping = false;
            }
        })();
    };

    /**
     * Queues one frame.
     *
     * `n` is stamped HERE, synchronously, so the ordinal matches the order frames were decided
     * on rather than the order their promises happened to settle. One pump drains the queue, and
     * nothing else writes to the socket.
     */
    const emit = (connection: Held, build: (n: number) => ServerFrame): void =>
    {
        if (!connection.alive)
        {
            return;
        }

        connection.n += 1;
        const text = JSON.stringify(build(connection.n));

        connection.outbox.push(text);
        connection.bytes += text.length;

        // Overflow CLOSES rather than dropping. A silently lossy stream defeats the only gap
        // detector there is, and a client that cannot tell it missed something is worse off than
        // one that reconnects.
        if (connection.outbox.length > OUTBOX_FRAMES || connection.bytes > OUTBOX_BYTES)
        {
            connection.alive = false;
            connection.outbox.length = 0;
            connection.bytes = 0;
            connection.wire.close(4413, 'Too far behind');
            return;
        }

        pump(connection);
    };

    const connectionsOf = (userId: string): Held[] => [...(byUser.get(userId) ?? [])];

    const publish = (userIds: Iterable<string>, build: (n: number) => ServerFrame): void =>
    {
        for (const userId of userIds)
        {
            for (const connection of connectionsOf(userId))
            {
                emit(connection, build);
            }
        }
    };

    const entriesFor = (viewer: string): PresenceEntry[] =>
    {
        const out: PresenceEntry[] = [];
        for (const [userId, record] of online)
        {
            if (!visible(viewer, userId))
            {
                continue;
            }
            const handle = edges.get(userId)?.party.id;
            out.push({ who: handle ?? userId, state: record.state, since: record.since });
        }
        return out;
    };

    const sendSnapshot = (connection: Held): void =>
    {
        emit(connection, (n) => presence(n, true, entriesFor(connection.userId)));
    };

    const schedule = (): void =>
    {
        if (timer !== null)
        {
            return;
        }
        timer = setTimeout(() =>
        {
            timer = null;
            flush();
        }, TICK_MS);
        timer.unref?.();
    };

    function flush(): void
    {
        const chat = [...pendingChat.entries()];
        const social = [...pendingSocial];
        pendingChat.clear();
        pendingSocial.clear();

        for (const userId of social)
        {
            // A social change moves who may see whom, so everybody who can see this person and
            // this person themselves get a fresh snapshot rather than a delta.
            for (const connection of connectionsOf(userId))
            {
                sendSnapshot(connection);
            }
            for (const [other, sockets] of byUser)
            {
                if (other === userId)
                {
                    continue;
                }
                for (const connection of sockets)
                {
                    sendSnapshot(connection);
                }
            }
            publish([userId], (n) => nudge(n, 'social', deps.now()));
        }

        for (const [conversationId, at] of chat)
        {
            void deps.recipientsOf(conversationId)
                .then((recipients) => publish(recipients, (n) => nudge(n, 'chat', at, conversationId)))
                .catch((error) => deps.report(error, 'realtime.recipients'));
        }
    }

    const markOnline = (userId: string, state: PresenceState): void =>
    {
        const current = online.get(userId);
        if (current === undefined)
        {
            online.set(userId, { state, since: deps.now(), leftAt: null });
        }
        else
        {
            current.state = state;
            current.leftAt = null;
        }
    };

    const announce = (userId: string, except?: Held): void =>
    {
        const record = online.get(userId);
        const people: PresenceEntry[] = record === undefined
            ? []
            : [{ who: edges.get(userId)?.party.id ?? userId, state: record.state, since: record.since }];

        for (const [viewer, sockets] of byUser)
        {
            if (!visible(viewer, userId))
            {
                continue;
            }
            for (const connection of sockets)
            {
                if (connection !== except)
                {
                    emit(connection, (n) => presence(n, false, people));
                }
            }
        }
    };

    return {
        async bind(connection, principal)
        {
            const socket = held(connection);
            socket.alive = true;
            socket.outbox = [];
            socket.bytes = 0;
            socket.pumping = false;
            socket.n = 0;
            socket.userId = principal.userId;
            socket.handle = principal.handle;
            socket.sessionId = principal.sessionId;
            socket.state = 'online';

            const sockets = byUser.get(principal.userId) ?? new Set<Held>();

            // The NEWEST is refused, never the oldest evicted. Evicting punishes somebody with
            // many tabs open, and under the QA matrix it would close a page mid-assertion.
            if (sockets.size >= deps.accountMax)
            {
                socket.alive = false;
                connection.wire.close(4429, 'Too many connections');
                return;
            }

            const cached = edges.get(principal.userId);
            if (cached === undefined || deps.now() - cached.loadedAt > EDGES_TTL_MS)
            {
                edges.set(principal.userId, await deps.edgesFor(principal.userId));
            }

            sockets.add(socket);
            byUser.set(principal.userId, sockets);

            const first = sockets.size === 1;
            markOnline(principal.userId, 'online');

            emit(socket, (n) => hello(n, principal.handle, deps.now()));
            sendSnapshot(socket);

            if (first)
            {
                // Everybody but the socket that just got the full snapshot, which would
                // otherwise receive a delta repeating what it was handed a frame ago.
                announce(principal.userId, socket);
                deps.touchSeen([principal.userId]);
            }
        },

        release(connection)
        {
            const socket = held(connection);
            socket.alive = false;

            const sockets = byUser.get(socket.userId);
            if (sockets === undefined)
            {
                return;
            }
            sockets.delete(socket);

            if (sockets.size > 0)
            {
                return;
            }

            byUser.delete(socket.userId);

            // Lingering, not gone. A reload or a navigation closes and reopens within a second,
            // and flapping every watching friend list for that is worse than being a few seconds
            // out of date.
            const record = online.get(socket.userId);
            if (record !== undefined)
            {
                record.leftAt = deps.now();
            }
        },

        chatChanged(conversationId)
        {
            pendingChat.set(conversationId, deps.now());
            schedule();
        },

        socialChanged(...userIds)
        {
            for (const userId of userIds)
            {
                // The cached sets are now wrong, so they are dropped rather than patched: the
                // next bind reloads them, and a stale edge means somebody who blocked you keeps
                // seeing you.
                edges.delete(userId);
                pendingSocial.add(userId);
            }
            schedule();
        },

        sessionsRevoked(sessionIds)
        {
            const dead = new Set(sessionIds);
            for (const sockets of [...byUser.values()])
            {
                for (const connection of [...sockets])
                {
                    if (dead.has(connection.sessionId))
                    {
                        connection.alive = false;
                        connection.wire.close(4401, 'Session ended');
                    }
                }
            }
        },

        typingIn(connection, conversationId)
        {
            const socket = held(connection);
            void deps.recipientsOf(conversationId)
                .then((recipients) =>
                {
                    publish(
                        recipients.filter((userId) => userId !== socket.userId),
                        (n) => typing(n, socket.handle, conversationId)
                    );
                })
                .catch((error) => deps.report(error, 'realtime.typing'));
        },

        setState(connection, state)
        {
            const socket = held(connection);
            socket.state = state;
            markOnline(socket.userId, state);
            announce(socket.userId);
        },

        resync(connection)
        {
            sendSnapshot(held(connection));
        },

        /**
         * The periodic sweep: expire lingering presence, and close anything whose session died.
         *
         * ONE query for every bound session rather than one per connection, which is what makes
         * this affordable at thirty seconds rather than something to be clever about.
         */
        async sweep()
        {
            const at = deps.now();
            for (const [userId, record] of [...online])
            {
                if (record.leftAt !== null && at - record.leftAt >= LINGER_MS)
                {
                    online.delete(userId);
                    announce(userId);
                }
            }

            const sessions = new Set<string>();
            for (const sockets of byUser.values())
            {
                for (const connection of sockets)
                {
                    sessions.add(connection.sessionId);
                }
            }
            if (sessions.size === 0)
            {
                return;
            }

            const alive = await deps.aliveSessions([...sessions]);
            for (const sockets of [...byUser.values()])
            {
                for (const connection of [...sockets])
                {
                    if (!alive.has(connection.sessionId))
                    {
                        connection.alive = false;
                        connection.wire.close(4401, 'Session ended');
                    }
                }
            }
        },

        flush,

        presenceOf: (userId) => entriesFor(userId),

        size()
        {
            let total = 0;
            for (const sockets of byUser.values())
            {
                total += sockets.size;
            }
            return total;
        },

        closeAll(code, reason)
        {
            if (timer !== null)
            {
                clearTimeout(timer);
                timer = null;
            }
            for (const sockets of [...byUser.values()])
            {
                for (const connection of [...sockets])
                {
                    connection.alive = false;
                    connection.wire.close(code, reason);
                }
            }
            byUser.clear();
            online.clear();
            edges.clear();
        }
    };
}
