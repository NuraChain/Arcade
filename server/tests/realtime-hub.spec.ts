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
    edges: Map<string, { party: Party; handle?: string; friends: string[]; blocks: string[] }>;
    recipients: Map<string, string[]>;
    alive: Set<string>;
    touched: string[];
    errors: string[];
    seq: number;
    seated: Set<string>;
    apart: Set<string>;
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
        seq: 0,
        seated: new Set(),
        apart: new Set()
    };

    state.hub = createHub({
        now: () => state.at,
        accountMax: 3,
        edgesFor: async (userId) =>
        {
            const found = state.edges.get(userId) ?? { party: party(userId), friends: [], blocks: [] };
            return {
                party: found.party,
                handle: found.handle ?? found.party.id,
                friends: new Set(found.friends),
                blocks: new Set(found.blocks),
                loadedAt: state.at
            } satisfies Edges;
        },
        recipientsOf: async (conversationId) => state.recipients.get(conversationId) ?? [],
        aliveSessions: async (ids) => new Set(ids.filter((id) => state.alive.has(id))),
        touchSeen: (ids) => state.touched.push(...ids),
        report: (_error, where) => state.errors.push(where),
        voiceAllowed: async (userId, tableId) => state.seated.has(`${ userId }@${ tableId }`),
        mayTalk: async (a, b) => !state.apart.has([a, b].sort().join('|'))
    });

    return state;
}

async function connect(userId: string, sessionId = `s-${ userId }`): Promise<{ connection: Connection; wire: FakeWire; bound: boolean }>
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

    const bound = await world.hub.bind(connection, principal);
    return { connection, wire, bound };
}

const settle = async (): Promise<void> =>
{
    await world.hub.flush();
    await Promise.resolve();
};

const scopesOf = (wire: FakeWire): string[] =>
    wire.framesOf('nudge').map((frame) => (frame.t === 'nudge' ? `${ frame.scope }:${ frame.id ?? '' }` : ''));

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
        expect(fourth.bound, 'the gateway would go on dispatching a refused socket's buffered frames').toBe(false);
        expect(first.bound).toBe(true);
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

    it('names people by their handle, never by the account id underneath it', async () =>
    {
        world.edges.set('u-7', { party: party('u-7'), handle: 'nima', friends: [], blocks: [] });
        const alex = await connect('alex');
        await connect('u-7');

        expect(peopleSeenBy(alex.wire)).toContain('nima');
        expect(peopleSeenBy(alex.wire)).not.toContain('u-7');
    });

    it('always shows somebody their own presence', async () =>
    {
        const alex = await connect('alex');
        expect(world.hub.presenceOf('alex').map((entry) => entry.who)).toContain('alex');
        expect(alex.wire.sent[1]).toMatchObject({ t: 'presence', full: true });
    });
});

describe('a game push', () =>
{
    it('reaches every socket of the seat it was composed for, at once, and nobody else', async () =>
    {
        const alex = await connect('alex');
        const other = await connect('alex');
        const sara = await connect('sara.k');
        const reza = await connect('reza.t');
        const board = (mine: number) => ({ id: 'm-1', rev: 5, mine }) as unknown as Parameters<typeof world.hub.gamePushed>[0][number]['match'];

        world.hub.gamePushed([
            { userId: 'alex', match: board(0), events: [] },
            { userId: 'sara.k', match: board(1), events: [] }
        ]);

        expect(alex.wire.framesOf('game')).toMatchObject([{ match: { mine: 0 } }]);
        expect(other.wire.framesOf('game')).toMatchObject([{ match: { mine: 0 } }]);
        expect(sara.wire.framesOf('game')).toMatchObject([{ match: { mine: 1 } }]);
        expect(reza.wire.framesOf('game')).toEqual([]);
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
    it('tells the people named to go and re-read their graph, and touches nobody\'s presence', async () =>
    {
        const alex = await connect('alex');
        const sara = await connect('sara.k');
        const before = [alex.wire.sent.length, sara.wire.sent.length];

        world.hub.socialChanged('alex');
        await settle();

        expect(scopesOf(alex.wire)).toEqual(['social:']);
        expect(alex.wire.sent.slice(before[0]).filter((frame) => frame.t === 'presence')).toEqual([]);
        expect(sara.wire.sent.length).toBe(before[1]);
    });
});

describe('an edge change', () =>
{
    it('takes a block into account at once, without anybody reconnecting', async () =>
    {
        world.edges.set('alex', { party: party('alex'), friends: [], blocks: [] });
        const alex = await connect('alex');
        const reza = await connect('reza.t');

        world.edges.set('alex', { party: party('alex'), friends: [], blocks: ['reza.t'] });
        world.hub.edgesChanged('alex');
        await settle();

        expect(world.hub.presenceOf('reza.t').map((entry) => entry.who)).not.toContain('alex');
        expect(world.hub.presenceOf('alex').map((entry) => entry.who)).not.toContain('reza.t');
        expect(reza.wire.framesOf('presence').at(-1)).toMatchObject({ full: false, people: [], gone: ['alex'] });
        expect(alex.wire.framesOf('presence').at(-1)).toMatchObject({ full: true });
        expect(scopesOf(alex.wire)).toEqual(['social:']);
    });

    it('keeps everybody else on screen for the person whose graph moved', async () =>
    {
        world.edges.set('kian16', { party: party('kian16', { isMinor: true, allowStrangerMessages: false }), friends: [], blocks: [] });
        const alex = await connect('alex');
        await connect('sara.k');
        await connect('kian16');

        world.edges.set('alex', { party: party('alex'), friends: ['kian16'], blocks: [] });
        world.edges.set('kian16', { party: party('kian16', { isMinor: true, allowStrangerMessages: false }), friends: ['alex'], blocks: [] });
        world.hub.edgesChanged('alex', 'kian16');
        await settle();

        const last = alex.wire.framesOf('presence').at(-1);
        expect(last?.t === 'presence' ? last.people.map((entry) => entry.who).sort() : []).toEqual(['alex', 'kian16', 'sara.k']);
    });

    it('sends a fresh snapshot only to the two people and a delta only to those whose view moved', async () =>
    {
        const alex = await connect('alex');
        const sara = await connect('sara.k');
        const omid = await connect('omid.k');
        const counts = [alex, sara, omid].map((one) => one.wire.sent.length);

        world.edges.set('alex', { party: party('alex'), friends: ['sara.k'], blocks: [] });
        world.edges.set('sara.k', { party: party('sara.k'), friends: ['alex'], blocks: [] });
        world.hub.edgesChanged('alex', 'sara.k');
        await settle();

        expect(alex.wire.sent.slice(counts[0]).filter((frame) => frame.t === 'presence')).toHaveLength(1);
        expect(sara.wire.sent.slice(counts[1]).filter((frame) => frame.t === 'presence')).toHaveLength(1);
        expect(omid.wire.sent.length).toBe(counts[2]);
    });

    it('moves a renamed person under their new handle for everybody who can see them', async () =>
    {
        const alex = await connect('alex');
        const sara = await connect('sara.k');

        world.edges.set('alex', { party: party('alex.new'), friends: [], blocks: [] });
        world.hub.edgesChanged('alex');
        await settle();

        expect(sara.wire.framesOf('presence').at(-1)).toMatchObject({ full: false, people: [{ who: 'alex.new' }], gone: ['alex'] });
        expect(alex.connection.handle).toBe('alex.new');
    });

    it('stops two people talking once one of them blocks the other', async () =>
    {
        world.seated.add('alex@t-1').add('sara.k@t-1');
        const alex = await connect('alex');
        const sara = await connect('sara.k');

        world.hub.voice(alex.connection, 't-1', true, false);
        await settle();
        world.hub.voice(sara.connection, 't-1', true, false);
        await settle();

        world.apart.add(['alex', 'sara.k'].sort().join('|'));
        world.edges.set('alex', { party: party('alex'), friends: [], blocks: ['sara.k'] });
        world.hub.edgesChanged('alex');
        await settle();

        const last = alex.wire.framesOf('voice').at(-1);
        expect(last?.t === 'voice' ? last.peers.find((peer) => peer.who === 'sara.k')?.talk : null).toBe(false);
    });
});

describe('a table change', () =>
{
    it('reaches the people at the table and anybody looking at it, and nobody else', async () =>
    {
        const host = await connect('alex');
        const invited = await connect('sara.k');
        const watcher = await connect('omid.k');
        const stranger = await connect('mina');
        const presences = host.wire.framesOf('presence').length;

        world.hub.tableViewed('omid.k', 't-1');
        world.hub.tableChanged('t-1', ['alex', 'sara.k']);
        await settle();

        expect(scopesOf(host.wire)).toEqual(['table:t-1']);
        expect(scopesOf(invited.wire)).toEqual(['table:t-1']);
        expect(scopesOf(watcher.wire)).toEqual(['table:t-1']);
        expect(scopesOf(stranger.wire)).toEqual([]);
        expect(host.wire.framesOf('presence')).toHaveLength(presences);
    });

    it('keeps a look that arrived before the socket did, which is what a deep link does', async () =>
    {
        world.hub.tableViewed('omid.k', 't-1');
        const watcher = await connect('omid.k');

        world.hub.tableChanged('t-1', []);
        await settle();

        expect(scopesOf(watcher.wire)).toEqual(['table:t-1']);
    });

    it('lets go of a look from somebody who never connected once the sweep comes round', async () =>
    {
        world.hub.tableViewed('ghost', 't-1');
        await world.hub.sweep();
        const late = await connect('ghost');

        world.hub.tableChanged('t-1', []);
        await settle();

        expect(scopesOf(late.wire)).toEqual([]);
    });

    it('forgets the oldest table somebody looked at once they have looked at more', async () =>
    {
        const watcher = await connect('omid.k');

        for (const id of ['t-1', 't-2', 't-3', 't-4', 't-5'])
        {
            world.hub.tableViewed('omid.k', id);
        }
        world.hub.tableChanged('t-1', []);
        world.hub.tableChanged('t-5', []);
        await settle();

        expect(scopesOf(watcher.wire)).toEqual(['table:t-5']);
    });

    it('takes somebody out of the voice room once the table no longer lets them in', async () =>
    {
        world.seated.add('alex@t-1');
        const alex = await connect('alex');

        world.hub.voice(alex.connection, 't-1', true, false);
        await settle();

        world.seated.delete('alex@t-1');
        world.hub.tableChanged('t-1', ['alex']);
        await settle();

        expect(alex.wire.framesOf('voice').at(-1)).toMatchObject({ joined: false });
        expect(world.hub.voiceOf('t-1')).toEqual([]);
    });
});

describe('a change of one\'s own', () =>
{
    it('rings every tab of that account and no other', async () =>
    {
        const first = await connect('alex');
        const second = await connect('alex');
        const other = await connect('sara.k');

        world.hub.selfChanged('alex', 'notifications');
        await settle();

        expect(scopesOf(first.wire)).toEqual(['me:notifications']);
        expect(scopesOf(second.wire)).toEqual(['me:notifications']);
        expect(scopesOf(other.wire)).toEqual([]);
    });
});

describe('a chat change that reaches past the room', () =>
{
    it('reaches somebody who has just been taken out of it', async () =>
    {
        world.recipients.set('c-1', ['alex']);
        await connect('alex');
        const removed = await connect('sara.k');

        world.hub.chatChanged('c-1', 'sara.k');
        await settle();

        expect(scopesOf(removed.wire)).toEqual(['chat:c-1']);
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

        /**
         * The departure has to be SAYABLE, and for a long time it was not.
         *
         * This line used to assert `{ full: false, people: [] }` - the empty frame - which is the
         * bug written down as an expectation. `announce` builds its entry from the presence record,
         * and going dark is exactly the state where there is no record, so the frame named nobody.
         * A client merging it changed nothing, and a tab left open showed people who had left hours
         * earlier. `presenceOf` above is the SERVER's view and was always right; what the watcher
         * was actually told was empty.
         */
        expect(watcher.wire.framesOf('presence').at(-1)).toMatchObject({ full: false, people: [], gone: ['alex'] });
    });

    it('does not claim a departure when somebody is merely changing state', async () =>
    {
        await connect('alex');
        const watcher = await connect('sara.k');
        await world.hub.sweep();

        const before = watcher.wire.framesOf('presence').length;
        world.hub.setState((await connect('alex')).connection, 'away');

        const frames = watcher.wire.framesOf('presence').slice(before);
        expect(frames.length).toBeGreaterThan(0);

        // `gone` is omitted rather than sent empty, so a reader can tell "nobody left" from
        // "somebody left and I could not say who".
        for (const frame of frames)
        {
            expect(frame).not.toHaveProperty('gone');
        }
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

        const saidGoodbye = world.hub.closeAll(1001, 'Server restarting');

        expect(alex.wire.closed).toEqual({ code: 1001, reason: 'Server restarting' });
        expect(sara.wire.closed).toEqual({ code: 1001, reason: 'Server restarting' });
        expect(world.hub.size()).toBe(0);

        // The count is what `main.ts` waits on before `detach()` destroys these sockets. A close
        // frame is a write, and destroying the socket in the same synchronous block delivered 1006
        // to everybody - the exact outcome saying goodbye with a code exists to avoid. It has to
        // be a number rather than void, and it has to be zero on an empty server so a restart with
        // nobody connected does not pause for the drain.
        expect(saidGoodbye).toBe(2);
        expect(world.hub.closeAll(1001, 'Server restarting')).toBe(0);
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

describe('voice at a table', () =>
{
    const TABLE = 't-1';

    const seat = (...handles: string[]): void =>
    {
        for (const handle of handles)
        {
            world.seated.add(`${ handle }@${ TABLE }`);
        }
    };

    const rest = async (): Promise<void> =>
    {
        await new Promise((resolve) => setTimeout(resolve, 0));
        world.hub.flush();
    };

    const lastVoice = (wire: FakeWire): Extract<ServerFrame, { t: 'voice' }> | undefined =>
        wire.framesOf('voice').at(-1) as Extract<ServerFrame, { t: 'voice' }> | undefined;

    it('tells everybody in the room who else is in it, and who is muted', async () =>
    {
        seat('alex', 'sara.k');
        const alex = await connect('alex');
        const sara = await connect('sara.k');

        world.hub.voice(alex.connection, TABLE, true, false);
        await rest();
        world.hub.voice(sara.connection, TABLE, true, true);
        await rest();

        expect(lastVoice(alex.wire)).toMatchObject({ joined: true, peers: [{ who: 'alex', muted: false, talk: true }, { who: 'sara.k', muted: true, talk: true }] });
        expect(world.hub.voiceOf(TABLE)).toEqual(['alex', 'sara.k']);
    });

    it('refuses somebody who is not seated at a table with voice on', async () =>
    {
        const stranger = await connect('omid.k');

        world.hub.voice(stranger.connection, TABLE, true, false);
        await rest();

        expect(lastVoice(stranger.wire)).toMatchObject({ joined: false, peers: [] });
        expect(world.hub.voiceOf(TABLE)).toEqual([]);
    });

    it('relays a signal only to somebody in the same room who may talk with the sender', async () =>
    {
        seat('alex', 'sara.k', 'mina');
        world.apart.add(['alex', 'mina'].sort().join('|'));
        const alex = await connect('alex');
        const sara = await connect('sara.k');
        const mina = await connect('mina');
        const outside = await connect('omid.k');

        for (const one of [alex, sara, mina])
        {
            world.hub.voice(one.connection, TABLE, true, false);
            await rest();
        }

        world.hub.signal(alex.connection, TABLE, 'sara.k', 'offer', '{"sdp":"a"}');
        world.hub.signal(alex.connection, TABLE, 'mina', 'offer', '{"sdp":"b"}');
        world.hub.signal(outside.connection, TABLE, 'sara.k', 'offer', '{"sdp":"c"}');
        await rest();

        expect(sara.wire.framesOf('signal')).toEqual([expect.objectContaining({ from: 'alex', kind: 'offer', data: '{"sdp":"a"}' })]);
        expect(mina.wire.framesOf('signal')).toEqual([]);
        expect(lastVoice(mina.wire)?.peers.find((peer) => peer.who === 'alex')?.talk).toBe(false);
    });

    it('takes a closed socket out of the room and tells the others', async () =>
    {
        seat('alex', 'sara.k');
        const alex = await connect('alex');
        const sara = await connect('sara.k');

        world.hub.voice(alex.connection, TABLE, true, false);
        await rest();
        world.hub.voice(sara.connection, TABLE, true, false);
        await rest();

        world.hub.release(sara.connection);
        await rest();

        expect(lastVoice(alex.wire)?.peers.map((peer) => peer.who)).toEqual(['alex']);
        expect(world.hub.voiceOf(TABLE)).toEqual(['alex']);
    });

    it('moves a person to their newest tab rather than letting two tabs talk at once', async () =>
    {
        seat('alex');
        const first = await connect('alex');
        const second = await connect('alex');

        world.hub.voice(first.connection, TABLE, true, false);
        await rest();
        world.hub.voice(second.connection, TABLE, true, false);
        await rest();

        expect(lastVoice(first.wire)).toMatchObject({ joined: false });
        expect(lastVoice(second.wire)).toMatchObject({ joined: true });
    });
});
