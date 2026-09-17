import { beforeEach, describe, expect, it } from 'vitest';

import { createHub, EDGES_TTL_MS, LINGER_MS, type Connection, type Edges, type Hub, type Wire } from '../src/realtime/hub.ts';
import type { Party } from '../src/domains/social/policy.ts';
import type { Principal } from '../src/http/auth.ts';
import type { ServerFrame } from '../src/realtime/frames.ts';

/**
 * The hub, against a structural fake.
 *
 * A socket is three methods here, so nothing binds a port and the whole fan-out is exercised in
 * milliseconds. What is being tested is the part that is easy to get quietly wrong: who is told
 * what, and who is NOT - which is a question about `maySeeOnline`, the real one, called per pair.
 */

class FakeWire implements Wire
{
    public sent: ServerFrame[] = [];

    public closed: { code: number; reason: string } | null = null;

    public backpressure = false;

    /** A peer that has stopped reading: `drain` never settles, so the outbox is what grows. */
    public stalled = false;

    send(data: string): boolean
    {
        if (this.stalled)
        {
            return false;
        }
        this.sent.push(JSON.parse(data) as ServerFrame);
        return !this.backpressure;
    }

    async drain(): Promise<void>
    {
        if (this.stalled)
        {
            await new Promise<void>(() => undefined);
        }
        this.backpressure = false;
    }

    close(code = 1000, reason = ''): void
    {
        this.closed ??= { code, reason };
    }

    framesOf(kind: ServerFrame['t']): ServerFrame[]
    {
        return this.sent.filter((frame) => frame.t === kind);
    }
}

const party = (handle: string, overrides: Partial<Party> = {}): Party => ({
    id: handle,
    isMinor: false,
    allowStrangerMessages: true,
    showOnline: true,
    ...overrides
});

interface World
{
    hub: Hub;
    at: number;
    edges: Map<string, { party: Party; friends: string[]; blocks: string[] }>;
    recipients: Map<string, string[]>;
    alive: Set<string>;
    touched: string[];
    errors: string[];
    seq: number;
}

let world: World;

function build(): World
{
    const state: World = {
        hub: null as unknown as Hub,
        at: 1_700_000_000_000,
        edges: new Map(),
        recipients: new Map(),
        alive: new Set(),
        touched: [],
        errors: [],
        seq: 0
    };

    state.hub = createHub({
        now: () => state.at,
        accountMax: 3,
        edgesFor: async (userId) =>
        {
            const found = state.edges.get(userId) ?? { party: party(userId), friends: [], blocks: [] };
            return {
                party: found.party,
                friends: new Set(found.friends),
                blocks: new Set(found.blocks),
                loadedAt: state.at
            } satisfies Edges;
        },
        recipientsOf: async (conversationId) => state.recipients.get(conversationId) ?? [],
        aliveSessions: async (ids) => new Set(ids.filter((id) => state.alive.has(id))),
        touchSeen: (ids) => state.touched.push(...ids),
        report: (_error, where) => state.errors.push(where)
    });

    return state;
}

async function connect(userId: string, sessionId = `s-${ userId }`): Promise<{ connection: Connection; wire: FakeWire }>
{
    world.seq += 1;
    const wire = new FakeWire();
    const connection: Connection = {
        id: `conn-${ world.seq }`,
        wire,
        userId,
        handle: userId,
        sessionId,
        state: 'online'
    };
    world.alive.add(sessionId);

    const principal: Principal = {
        userId,
        handle: userId,
        kind: 'guest',
        isMinor: world.edges.get(userId)?.party.isMinor ?? false,
        sessionId
    };

    await world.hub.bind(connection, principal);
    return { connection, wire };
}

const settle = async (): Promise<void> =>
{
    world.hub.flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const peopleSeenBy = (wire: FakeWire): string[] =>
    wire.framesOf('presence').flatMap((frame) => (frame.t === 'presence' ? frame.people.map((entry) => entry.who) : []));

beforeEach(() =>
{
    world = build();
});

describe('binding', () =>
{
    it('greets a socket and hands it the snapshot before anything else', async () =>
    {
        const { wire } = await connect('alex');

        expect(wire.sent[0]).toMatchObject({ t: 'hello', self: 'alex', n: 1 });
        expect(wire.sent[1]).toMatchObject({ t: 'presence', full: true, n: 2 });
    });

    it('numbers frames in the order they were decided, from one', async () =>
    {
        const { wire } = await connect('alex');
        expect(wire.sent.map((frame) => frame.n)).toEqual([1, 2]);
    });

    it('refuses the newest connection past the account cap, leaving the others alone', async () =>
    {
        const first = await connect('alex');
        await connect('alex');
        await connect('alex');

        const fourth = await connect('alex');

        expect(fourth.wire.closed).toEqual({ code: 4429, reason: 'Too many connections' });
        expect(first.wire.closed).toBeNull();
        expect(world.hub.size()).toBe(3);
    });

    it('touches last-seen once for the first socket, not once per tab', async () =>
    {
        await connect('alex');
        await connect('alex');
        expect(world.touched).toEqual(['alex']);
    });
});

describe('who may see whom online', () =>
{
    it('shows two ordinary strangers to each other', async () =>
    {
        const alex = await connect('alex');
        await connect('sara.k');

        expect(peopleSeenBy(alex.wire)).toContain('sara.k');
    });

    it('hides a minor from a stranger and shows them to a friend', async () =>
    {
        world.edges.set('kian16', { party: party('kian16', { isMinor: true, allowStrangerMessages: false }), friends: ['sara.k'], blocks: [] });
        world.edges.set('sara.k', { party: party('sara.k'), friends: ['kian16'], blocks: [] });
        world.edges.set('alex', { party: party('alex'), friends: [], blocks: [] });

        const stranger = await connect('alex');
        const friend = await connect('sara.k');
        await connect('kian16');

        expect(peopleSeenBy(stranger.wire)).not.toContain('kian16');
        expect(peopleSeenBy(friend.wire)).toContain('kian16');
    });

    it('hides somebody who turned themselves invisible, except from a friend', async () =>
    {
        world.edges.set('hidden', { party: party('hidden', { showOnline: false }), friends: ['sara.k'], blocks: [] });
        world.edges.set('sara.k', { party: party('sara.k'), friends: ['hidden'], blocks: [] });

        const stranger = await connect('alex');
        const friend = await connect('sara.k');
        await connect('hidden');

        expect(peopleSeenBy(stranger.wire)).not.toContain('hidden');
        expect(peopleSeenBy(friend.wire)).toContain('hidden');
    });

    it('hides a blocked pair from each other, whichever of them wrote the block', async () =>
    {
        world.edges.set('alex', { party: party('alex'), friends: [], blocks: ['reza.t'] });
        world.edges.set('reza.t', { party: party('reza.t'), friends: [], blocks: [] });

        const blocker = await connect('alex');
        const blocked = await connect('reza.t');

        expect(peopleSeenBy(blocker.wire)).not.toContain('reza.t');
        expect(peopleSeenBy(blocked.wire)).not.toContain('alex');
    });

    it('always shows somebody their own presence', async () =>
    {
        const alex = await connect('alex');
        expect(world.hub.presenceOf('alex').map((entry) => entry.who)).toContain('alex');
        expect(alex.wire.sent[1]).toMatchObject({ t: 'presence', full: true });
    });
});

describe('nudges', () =>
{
    it('reaches exactly the recipients the chat domain named', async () =>
    {
        world.recipients.set('c-1', ['alex', 'sara.k']);
        const alex = await connect('alex');
        const sara = await connect('sara.k');
        const other = await connect('reza.t');

        world.hub.chatChanged('c-1');
        await settle();

        expect(alex.wire.framesOf('nudge')).toHaveLength(1);
        expect(sara.wire.framesOf('nudge')).toHaveLength(1);
        expect(other.wire.framesOf('nudge')).toHaveLength(0);
    });

    it('includes the sender, because their other tabs are listening too', async () =>
    {
        world.recipients.set('c-1', ['alex']);
        const first = await connect('alex');
        const second = await connect('alex');

        world.hub.chatChanged('c-1');
        await settle();

        expect(first.wire.framesOf('nudge')).toHaveLength(1);
        expect(second.wire.framesOf('nudge')).toHaveLength(1);
    });

    it('collapses a burst about one conversation into a single frame', async () =>
    {
        world.recipients.set('c-1', ['alex']);
        const alex = await connect('alex');

        world.hub.chatChanged('c-1');
        world.hub.chatChanged('c-1');
        world.hub.chatChanged('c-1');
        await settle();

        expect(alex.wire.framesOf('nudge')).toHaveLength(1);
    });

    it('carries no word of what was said', async () =>
    {
        world.recipients.set('c-1', ['alex']);
        const alex = await connect('alex');

        world.hub.chatChanged('c-1');
        await settle();

        expect(Object.keys(alex.wire.framesOf('nudge')[0]).sort()).toEqual(['at', 'id', 'n', 'scope', 't', 'v']);
    });
});

describe('a social change', () =>
{
    it('drops the cached edges so the next bind reloads them', async () =>
    {
        world.edges.set('alex', { party: party('alex'), friends: [], blocks: [] });
        await connect('alex');

        world.edges.set('alex', { party: party('alex'), friends: [], blocks: ['reza.t'] });
        world.hub.socialChanged('alex');
        await settle();

        const reza = await connect('reza.t');
        const alexAgain = await connect('alex');

        expect(peopleSeenBy(reza.wire)).not.toContain('alex');
        expect(peopleSeenBy(alexAgain.wire)).not.toContain('reza.t');
    });

    it('tells the person whose graph moved to go and re-read it', async () =>
    {
        const alex = await connect('alex');
        world.hub.socialChanged('alex');
        await settle();

        const scopes = alex.wire.framesOf('nudge').map((frame) => (frame.t === 'nudge' ? frame.scope : ''));
        expect(scopes).toContain('social');
    });
});

describe('leaving', () =>
{
    it('stays online through the linger, then goes dark', async () =>
    {
        const alex = await connect('alex');
        const watcher = await connect('sara.k');
        await world.hub.sweep();

        world.hub.release(alex.connection);
        expect(world.hub.presenceOf('sara.k').map((entry) => entry.who)).toContain('alex');

        world.at += LINGER_MS - 1;
        await world.hub.sweep();
        expect(world.hub.presenceOf('sara.k').map((entry) => entry.who)).toContain('alex');

        world.at += 2;
        await world.hub.sweep();
        expect(world.hub.presenceOf('sara.k').map((entry) => entry.who)).not.toContain('alex');

        expect(watcher.wire.framesOf('presence').at(-1)).toMatchObject({ full: false, people: [] });
    });

    it('keeps somebody online while another tab of theirs is open', async () =>
    {
        const first = await connect('alex');
        await connect('alex');
        await connect('sara.k');

        world.hub.release(first.connection);
        world.at += LINGER_MS * 2;
        await world.hub.sweep();

        expect(world.hub.presenceOf('sara.k').map((entry) => entry.who)).toContain('alex');
    });
});

describe('sessions', () =>
{
    it('closes a socket whose session was revoked, with a code rather than a destroy', async () =>
    {
        const alex = await connect('alex');
        world.hub.sessionsRevoked(['s-alex']);

        expect(alex.wire.closed).toEqual({ code: 4401, reason: 'Session ended' });
    });

    it('sweeps out a session that died without anybody saying so, in one query', async () =>
    {
        const alex = await connect('alex');
        const sara = await connect('sara.k');

        world.alive.delete('s-alex');
        await world.hub.sweep();

        expect(alex.wire.closed).toEqual({ code: 4401, reason: 'Session ended' });
        expect(sara.wire.closed).toBeNull();
    });
});

describe('backpressure', () =>
{
    it('closes a connection that falls too far behind rather than dropping a frame', async () =>
    {
        const alex = await connect('alex');
        alex.wire.stalled = true;

        for (let index = 0; index < 400; index += 1)
        {
            world.recipients.set(`c-${ index }`, ['alex']);
            world.hub.chatChanged(`c-${ index }`);
            await settle();
        }

        expect(alex.wire.closed?.code).toBe(4413);
    });
});

describe('shutting down', () =>
{
    it('says goodbye with a code to everybody', async () =>
    {
        const alex = await connect('alex');
        const sara = await connect('sara.k');

        world.hub.closeAll(1001, 'Server restarting');

        expect(alex.wire.closed).toEqual({ code: 1001, reason: 'Server restarting' });
        expect(sara.wire.closed).toEqual({ code: 1001, reason: 'Server restarting' });
        expect(world.hub.size()).toBe(0);
    });
});

describe('cached edges', () =>
{
    /**
     * Nothing ever released them. `bind` was the only writer, a social change the only deleter and
     * shutdown the only clear - so every account that had ever opened a socket kept a Party and two
     * full Sets, friends and blocks, for the life of the process.
     *
     * Observed the way the TTL test below observes a reload: change the source, reconnect INSIDE the
     * TTL, and see whether the new value took. If the sweep dropped the cache the reconnect reloads
     * and `showOnline: false` applies; if it did not, the stale cache is still answering.
     */
    it('releases them once the account is finally gone, not merely lingering', async () =>
    {
        world.edges.set('alex', { party: party('alex'), friends: [], blocks: [] });
        const first = await connect('alex');
        world.hub.release(first.connection);

        world.at += LINGER_MS + 1;
        await world.hub.sweep();

        world.edges.set('alex', { party: party('alex', { showOnline: false }), friends: [], blocks: [] });
        world.at += 1;

        await connect('sara.k');
        await connect('alex');

        expect(
            world.hub.presenceOf('sara.k').map((entry) => entry.who),
            'the reconnect answered from a cache the sweep should have dropped'
        ).not.toContain('alex');
    });

    it('reloads them once they are older than the ceiling', async () =>
    {
        world.edges.set('alex', { party: party('alex'), friends: [], blocks: [] });
        const first = await connect('alex');
        world.hub.release(first.connection);

        world.edges.set('alex', { party: party('alex', { showOnline: false }), friends: [], blocks: [] });
        world.at += EDGES_TTL_MS + 1;

        await connect('sara.k');
        await connect('alex');

        // The authoritative view, not the frames already sent: sara.k legitimately saw a
        // lingering alex through the stale cache before the reconnect reloaded it.
        expect(world.hub.presenceOf('sara.k').map((entry) => entry.who)).not.toContain('alex');
        expect(world.hub.presenceOf('alex').map((entry) => entry.who)).toContain('alex');
    });
});

describe('releasing twice', () =>
{
    /**
     * The gateway clears `pending` BEFORE awaiting `bind`, so a socket that dies inside that window
     * releases against a hub that has not registered it yet - an early return that stamps nothing.
     * The gateway now releases again once the bind finishes, which is the only moment the hub can
     * actually do it.
     *
     * That recovery only works if a second release is harmless, so this pins it: the first is a
     * no-op, the second does the work, and the account is left neither registered nor online.
     */
    it('tolerates a release that arrives before the bind, and one after', async () =>
    {
        const alex = await connect('alex');

        world.hub.release(alex.connection);
        world.hub.release(alex.connection);

        expect(world.hub.size(), 'a released socket was still counted').toBe(0);

        world.at += LINGER_MS + 1;
        await world.hub.sweep();

        expect(world.hub.presenceOf('alex').map((entry) => entry.who)).not.toContain('alex');
    });
});

describe('typing', () =>
{
    /**
     * A typing notice is a write into somebody else's room, and it was the one chat path with no
     * membership check on it. The gateway hands `frame.id` through verbatim - any string a client
     * cares to send - and `recipientsOf` answers "who is in this room", never "is the asker in it".
     *
     * So any signed-in account holding a conversation id could inject a notice into it, and anybody
     * removed from a group kept the id and kept typing into it. One forty-byte frame bought a query
     * and a fan-out to every member.
     */
    it('fans a notice out to the rest of the room when the sender is seated in it', async () =>
    {
        world.recipients.set('c-1', ['alex', 'sara.k']);

        const alex = await connect('alex');
        const sara = await connect('sara.k');

        world.hub.typingIn(alex.connection, 'c-1');
        await settle();

        expect(sara.wire.framesOf('typing')).toHaveLength(1);
        expect(alex.wire.framesOf('typing'), 'the sender was told about their own typing').toHaveLength(0);
    });

    it('sends nothing at all when the sender is not seated in the room they named', async () =>
    {
        world.recipients.set('c-1', ['sara.k']);

        const sara = await connect('sara.k');
        const stranger = await connect('alex');

        world.hub.typingIn(stranger.connection, 'c-1');
        await settle();

        expect(
            sara.wire.framesOf('typing'),
            'a stranger injected a typing notice into a room they are not in'
        ).toHaveLength(0);
    });
});
