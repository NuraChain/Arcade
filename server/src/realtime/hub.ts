import { maySeeOnline, type Party, type Relation } from '../domains/social/policy.ts';
import type { Principal } from '../http/auth.ts';
import type { MatchEvent, MatchView } from '../schemas.ts';
import { game, hello, nudge, presence, signal, typing, voice, type PresenceEntry, type PresenceState, type ServerFrame, type SignalKind, type VoicePeer } from './frames.ts';

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
    handle: string;
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

    voiceAllowed(userId: string, tableId: string): Promise<boolean>;

    mayTalk(a: string, b: string): Promise<boolean>;

    /** Sockets one account may hold at once. */
    accountMax: number;
}

export interface GamePush
{
    userId: string;
    match: MatchView;
    events: MatchEvent[];
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

export const VIEWED_MAX = 4;

export type SelfTopic = 'notifications' | 'devices' | 'profile';

export interface Hub
{
    bind(connection: Connection, principal: Principal): Promise<void>;
    release(connection: Connection): void;

    chatChanged(conversationId: string, ...also: string[]): void;
    socialChanged(...userIds: string[]): void;
    edgesChanged(...userIds: string[]): void;
    selfChanged(userId: string, what: SelfTopic): void;
    gamePushed(pushes: readonly GamePush[]): void;
    reply(connection: Connection, build: (n: number) => ServerFrame): void;
    tableChanged(tableId: string, people: readonly string[]): void;
    tableViewed(userId: string, tableId: string): void;
    sessionsRevoked(sessionIds: readonly string[]): void;

    typingIn(connection: Connection, conversationId: string): void;
    voice(connection: Connection, tableId: string, on: boolean, muted: boolean): void;
    signal(connection: Connection, tableId: string, to: string, kind: SignalKind, data: string): void;
    voiceOf(tableId: string): string[];
    setState(connection: Connection, state: PresenceState): void;
    resync(connection: Connection): void;

    sweep(): Promise<void>;
    flush(): Promise<void>;

    presenceOf(userId: string): PresenceEntry[];
    size(): number;
    /**
     * Sends a close frame with a code to every connection, and answers how many it sent.
     *
     * The count is not bookkeeping: the caller has to know whether there is anything to wait for
     * before it destroys the sockets underneath those frames. See `main.ts`.
     */
    closeAll(code: number, reason: string): number;
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

    const pendingChat = new Map<string, { at: number; also: Set<string> }>();
    const pendingEdges = new Set<string>();
    const pendingSelf = new Map<string, Set<SelfTopic>>();
    const pendingTable = new Map<string, { at: number; people: Set<string> }>();
    const viewed = new Map<string, string[]>();
    const watchers = new Map<string, Set<string>>();

    const pendingSocial = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const held = (connection: Connection): Held => connection as Held;

    const rooms = new Map<string, Map<string, { socket: Held; muted: boolean }>>();

    const talks = new Map<string, boolean>();

    const pairOf = (a: string, b: string): string => (a < b ? `${ a }|${ b }` : `${ b }|${ a }`);

    const roster = (tableId: string): void =>
    {
        const room = rooms.get(tableId);

        if (room === undefined)
        {
            return;
        }

        const members = [...room.values()];

        for (const member of members)
        {
            const peers: VoicePeer[] = members.map((other) => ({
                who: other.socket.handle,
                muted: other.muted,
                talk: other.socket.userId === member.socket.userId || talks.get(pairOf(member.socket.userId, other.socket.userId)) === true
            }));

            emit(member.socket, (n) => voice(n, tableId, true, peers));
        }
    };

    const forget = (userId: string): void =>
    {
        for (const room of rooms.values())
        {
            if (room.has(userId))
            {
                return;
            }
        }

        for (const key of [...talks.keys()])
        {
            if (key.split('|').includes(userId))
            {
                talks.delete(key);
            }
        }
    };

    const leave = (tableId: string, connectionId: string, tell: boolean): void =>
    {
        const room = rooms.get(tableId);

        if (room === undefined)
        {
            return;
        }

        for (const [userId, member] of room)
        {
            if (member.socket.id !== connectionId)
            {
                continue;
            }

            room.delete(userId);

            if (tell)
            {
                emit(member.socket, (n) => voice(n, tableId, false, []));
            }

            if (room.size === 0)
            {
                rooms.delete(tableId);
            }
            else
            {
                roster(tableId);
            }

            forget(userId);
            return;
        }
    };

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
            const handle = edges.get(userId)?.handle;
            out.push({ who: handle ?? userId, state: record.state, since: record.since });
        }
        return out;
    };

    const sendSnapshot = (connection: Held): void =>
    {
        emit(connection, (n) => presence(n, true, entriesFor(connection.userId)));
    };

    const handleOf = (userId: string): string => edges.get(userId)?.handle ?? userId;

    const retalk = async (moved: ReadonlySet<string>): Promise<void> =>
    {
        for (const [tableId, room] of [...rooms])
        {
            const members = [...room.keys()];

            if (!members.some((member) => moved.has(member)))
            {
                continue;
            }

            const pairs = members
                .flatMap((a, index) => members.slice(index + 1).map((b) => [a, b] as const))
                .filter(([a, b]) => moved.has(a) || moved.has(b));

            const verdicts = await Promise.all(pairs.map(([a, b]) => deps.mayTalk(a, b)));
            pairs.forEach(([a, b], index) => talks.set(pairOf(a, b), verdicts[index]));
            roster(tableId);
        }
    };

    const reload = async (userIds: readonly string[]): Promise<void> =>
    {
        const cached = userIds.filter((userId) => edges.has(userId));

        if (cached.length === 0)
        {
            return;
        }

        const viewers = new Set(byUser.keys());
        const before = new Map(cached.map((userId) => [userId, {
            handle: handleOf(userId),
            seen: online.has(userId) ? new Set([...byUser.keys()].filter((viewer) => visible(viewer, userId))) : new Set<string>()
        }]));

        const loaded = await Promise.all(cached.map((userId) => deps.edgesFor(userId)));
        const moved = new Set<string>();

        cached.forEach((userId, index) =>
        {
            const current = edges.get(userId);

            if (current !== undefined && current.loadedAt <= loaded[index].loadedAt)
            {
                edges.set(userId, loaded[index]);
                moved.add(userId);
            }
        });

        for (const userId of moved)
        {
            const was = before.get(userId)!;
            const handle = handleOf(userId);
            const record = online.get(userId);
            const people: PresenceEntry[] = record === undefined ? [] : [{ who: handle, state: record.state, since: record.since }];

            for (const socket of connectionsOf(userId))
            {
                socket.handle = handle;
            }

            for (const [viewer, sockets] of byUser)
            {
                if (moved.has(viewer) || !viewers.has(viewer))
                {
                    continue;
                }

                const saw = was.seen.has(viewer);
                const sees = people.length > 0 && visible(viewer, userId);
                const renamed = saw && handle !== was.handle;

                if (saw === sees && !renamed)
                {
                    continue;
                }

                const gone = saw && (!sees || renamed) ? [was.handle] : [];
                const shown = sees ? people : [];

                for (const connection of sockets)
                {
                    emit(connection, (n) => presence(n, false, shown, gone));
                }
            }
        }

        for (const viewer of byUser.keys())
        {
            if (moved.has(viewer) || !viewers.has(viewer))
            {
                for (const connection of connectionsOf(viewer))
                {
                    sendSnapshot(connection);
                }
            }
        }

        await retalk(moved);
    };

    const recheck = async (tableId: string): Promise<void> =>
    {
        const members = [...(rooms.get(tableId)?.values() ?? [])];
        const verdicts = await Promise.all(members.map((member) => deps.voiceAllowed(member.socket.userId, tableId)));

        members.forEach((member, index) =>
        {
            if (!verdicts[index])
            {
                leave(tableId, member.socket.id, true);
            }
        });
    };

    const unwatch = (userId: string, tableId: string): void =>
    {
        const set = watchers.get(tableId);
        set?.delete(userId);

        if (set?.size === 0)
        {
            watchers.delete(tableId);
        }
    };

    const forgetViews = (userId: string): void =>
    {
        for (const tableId of viewed.get(userId) ?? [])
        {
            unwatch(userId, tableId);
        }
        viewed.delete(userId);
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
            void flush();
        }, TICK_MS);
        timer.unref?.();
    };

    async function flush(): Promise<void>
    {
        const chat = [...pendingChat.entries()];
        const social = [...pendingSocial];
        const moved = [...pendingEdges];
        const self = [...pendingSelf.entries()];
        const tables = [...pendingTable.entries()];
        pendingChat.clear();
        pendingSocial.clear();
        pendingEdges.clear();
        pendingSelf.clear();
        pendingTable.clear();

        for (const [tableId, { at, people }] of tables)
        {
            publish(new Set([...people, ...(watchers.get(tableId) ?? [])]), (n) => nudge(n, 'table', at, tableId));
        }

        for (const [userId, topics] of self)
        {
            for (const topic of topics)
            {
                publish([userId], (n) => nudge(n, 'me', deps.now(), topic));
            }
        }

        await Promise.all([
            reload(moved)
                .catch((error) => deps.report(error, 'realtime.edges'))
                .then(() => publish(new Set([...moved, ...social]), (n) => nudge(n, 'social', deps.now()))),
            ...chat.map(([conversationId, { at, also }]) => deps.recipientsOf(conversationId)
                .then((recipients) => publish(new Set([...recipients, ...also]), (n) => nudge(n, 'chat', at, conversationId)))
                .catch((error) => deps.report(error, 'realtime.recipients'))),
            ...tables.map(([tableId]) => recheck(tableId).catch((error) => deps.report(error, 'realtime.voice')))
        ]);
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
        const handle = edges.get(userId)?.handle ?? userId;

        // A departure travels in `gone`, not as an empty `people`. There is no record left to build
        // an entry from - that is what having gone dark MEANS - so the only way to say it is to name
        // the handle separately. Sending `people: []` named nobody and changed nothing on the other
        // end, which is why a tab left open kept showing people who had left hours ago.
        const people: PresenceEntry[] = record === undefined
            ? []
            : [{ who: handle, state: record.state, since: record.since }];

        const gone = record === undefined ? [handle] : [];

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
                    emit(connection, (n) => presence(n, false, people, gone));
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

            for (const tableId of [...rooms.keys()])
            {
                leave(tableId, socket.id, false);
            }

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

        chatChanged(conversationId, ...also)
        {
            const current = pendingChat.get(conversationId);
            pendingChat.set(conversationId, { at: deps.now(), also: new Set([...(current?.also ?? []), ...also]) });
            schedule();
        },

        tableChanged(tableId, people)
        {
            const current = pendingTable.get(tableId);
            pendingTable.set(tableId, { at: deps.now(), people: new Set([...(current?.people ?? []), ...people]) });
            schedule();
        },

        tableViewed(userId, tableId)
        {
            const list = (viewed.get(userId) ?? []).filter((one) => one !== tableId);
            list.push(tableId);

            for (const dropped of list.splice(0, Math.max(0, list.length - VIEWED_MAX)))
            {
                unwatch(userId, dropped);
            }

            viewed.set(userId, list);
            watchers.set(tableId, (watchers.get(tableId) ?? new Set<string>()).add(userId));
        },

        edgesChanged(...userIds)
        {
            for (const userId of userIds)
            {
                pendingEdges.add(userId);
            }
            schedule();
        },

        selfChanged(userId, what)
        {
            pendingSelf.set(userId, (pendingSelf.get(userId) ?? new Set<SelfTopic>()).add(what));
            schedule();
        },

        gamePushed(pushes)
        {
            const at = deps.now();

            for (const push of pushes)
            {
                publish([push.userId], (n) => game(n, at, push.match, push.events));
            }
        },

        reply(connection, build)
        {
            emit(held(connection), build);
        },

        socialChanged(...userIds)
        {
            for (const userId of userIds)
            {
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

        /**
         * A typing notice is a write into somebody else's room, so it asks the same question every
         * other chat route asks: is the sender seated here.
         *
         * It did not. The gateway passes `frame.id` - any string a client cares to send - straight
         * through, and `recipientsOf` answers "who is in this room", never "is the asker in it". So
         * any signed-in account holding a conversation id could inject a typing notice into it, and
         * somebody removed from a group kept the id and kept typing into it. It was an amplifier
         * too: one forty-byte frame bought a query and a fan-out to every member.
         *
         * The membership test costs nothing extra - the recipient list already answers it. It fails
         * CLOSED: a sender absent from that list, for any reason, sends nothing.
         */
        typingIn(connection, conversationId)
        {
            const socket = held(connection);
            void deps.recipientsOf(conversationId)
                .then((recipients) =>
                {
                    if (!recipients.includes(socket.userId))
                    {
                        return;
                    }

                    publish(
                        recipients.filter((userId) => userId !== socket.userId),
                        (n) => typing(n, socket.handle, conversationId)
                    );
                })
                .catch((error) => deps.report(error, 'realtime.typing'));
        },

        voice(connection, tableId, on, muted)
        {
            const socket = held(connection);

            if (!on)
            {
                leave(tableId, socket.id, true);
                return;
            }

            const current = rooms.get(tableId)?.get(socket.userId);

            if (current !== undefined && current.socket.id === socket.id)
            {
                current.muted = muted;
                roster(tableId);
                return;
            }

            void deps.voiceAllowed(socket.userId, tableId)
                .then(async (allowed) =>
                {
                    if (!allowed || !socket.alive)
                    {
                        emit(socket, (n) => voice(n, tableId, false, []));
                        return;
                    }

                    const room = rooms.get(tableId) ?? new Map<string, { socket: Held; muted: boolean }>();
                    const others = [...room.values()].filter((member) => member.socket.userId !== socket.userId);

                    const verdicts = await Promise.all(others.map((other) => deps.mayTalk(socket.userId, other.socket.userId)));

                    others.forEach((other, index) => talks.set(pairOf(socket.userId, other.socket.userId), verdicts[index]));

                    if (!socket.alive)
                    {
                        return;
                    }

                    const previous = room.get(socket.userId);

                    if (previous !== undefined && previous.socket.id !== socket.id)
                    {
                        emit(previous.socket, (n) => voice(n, tableId, false, []));
                    }

                    room.set(socket.userId, { socket, muted });
                    rooms.set(tableId, room);
                    roster(tableId);
                })
                .catch((error) => deps.report(error, 'realtime.voice'));
        },

        signal(connection, tableId, to, kind, data)
        {
            const socket = held(connection);
            const room = rooms.get(tableId);
            const sender = room?.get(socket.userId);

            if (room === undefined || sender === undefined || sender.socket.id !== socket.id)
            {
                return;
            }

            const target = [...room.values()].find((member) => member.socket.handle === to);

            if (target === undefined || target.socket.userId === socket.userId || talks.get(pairOf(socket.userId, target.socket.userId)) !== true)
            {
                return;
            }

            emit(target.socket, (n) => signal(n, tableId, socket.handle, kind, data));
        },

        voiceOf(tableId)
        {
            return [...(rooms.get(tableId)?.values() ?? [])].map((member) => member.socket.handle);
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

                    // The cached social edges go with them, and this is the moment for it rather
                    // than the disconnect: a reload closes and reopens within a second, and paying
                    // a friends-and-blocks read for every navigation is what the linger avoids.
                    //
                    // Nothing released them at all before. `bind` was the only writer, a social
                    // change the only deleter, and shutdown the only clear - so every account that
                    // had ever opened a socket kept a Party and two full Sets for the life of the
                    // process. On a long-lived server with churn that is the whole social graph.
                    // ANNOUNCE FIRST. The announcement asks `partyOf` who may see this change, and
                    // that reads the very cache being dropped - so releasing it first leaves the
                    // going-dark frame unable to work out who to send itself to, and the watchers
                    // never hear that the account left.
                    announce(userId);
                    edges.delete(userId);
                    forgetViews(userId);
                }
            }

            for (const userId of [...viewed.keys()])
            {
                if (!online.has(userId) && !byUser.has(userId))
                {
                    forgetViews(userId);
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

            let sent = 0;
            for (const sockets of [...byUser.values()])
            {
                for (const connection of [...sockets])
                {
                    connection.alive = false;
                    connection.wire.close(code, reason);
                    sent += 1;
                }
            }
            byUser.clear();
            online.clear();
            edges.clear();
            rooms.clear();
            talks.clear();
            viewed.clear();
            watchers.clear();
            return sent;
        }
    };
}
