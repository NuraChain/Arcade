import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { ACK_MS, useBoard, type MatchEvent } from '../src/stores/match.store.ts';
import { PROBE_GRACE_MS, PROBE_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { ClientFrame, MatchView } from '../src/api.ts';
import { client } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Ludo = Extract<MatchView['view'], { kind: 'ludo' }>;

const yard = (seat: number, colour: string): Ludo['seats'][number] => ({
    seat,
    colour,
    tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })),
    home: 0,
    out: false
});

const board = (rev: number, over: Partial<MatchView> = {}): MatchView => ({
    id: 'match-1',
    tableId: 'table-1',
    game: 'ludo',
    rev,
    seats: 2,
    players: [
        { seat: 0, who: 'alex', timeouts: 0 },
        { seat: 1, who: 'sara.k', timeouts: 0 }
    ] as MatchView['players'],
    turn: 0,
    mine: 0,
    startedAt: new Date(400_000).toISOString(),
    view: { kind: 'ludo', moves: [], seats: [yard(0, 'red'), yard(1, 'yellow')] },
    ...over
});

const rolled = (rev: number): MatchEvent => ({ rev, seat: 0, at: new Date(400_000).toISOString(), log: { kind: 'ludo', events: [] } } as unknown as MatchEvent);

const matches = client.matches as unknown as Record<string, unknown>;

const settle = async (): Promise<void> =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }
};

const plays = (): Extract<ClientFrame, { t: 'play' }>[] =>
    socket.sent.filter((frame): frame is Extract<ClientFrame, { t: 'play' }> => frame.t === 'play');

let clock: ManualClock;
let stops: (() => void)[] = [];
let http: ReturnType<typeof vi.fn>;

beforeEach(async () =>
{
    resetRuntime();
    clock = manualClock(400_000);
    setRuntime({ clock, seed: 5 });
    socket.reset();

    http = vi.fn(async ({ input }: { input: { key: string } }) => ({ match: board(2), applied: 'already', events: [], key: input.key }));
    matches.view = async () => board(1);
    matches.play = http;
    matches.since = async () => ({ match: board(1), events: [] });

    stops = [useRealtime().start(), useBoard().start()];
    socket.accept();
    useBoard().open('match-1');
    await settle();
});

afterEach(() =>
{
    for (const stop of stops.reverse())
    {
        stop();
    }
    useBoard().reset();
    useRealtime().reset();
    delete matches.view;
    delete matches.play;
    delete matches.since;
    vi.restoreAllMocks();
});

describe('playing over the socket', () =>
{
    it('sends the play as a frame bound to the board it was made against, and takes the ack', async () =>
    {
        const rolling = useBoard().roll();
        await settle();

        const [sent] = plays();
        expect(sent).toMatchObject({ t: 'play', match: 'match-1', rev: 1, play: { kind: 'ludo', verb: 'roll' } });

        socket.deliver({ v: 1, t: 'ack', n: 3, key: sent.key, match: board(2), applied: 'now', events: [rolled(2)] });
        await rolling;

        expect(useBoard().match()?.rev).toBe(2);
        expect(useBoard().events().events.map((event) => event.rev)).toEqual([2]);
        expect(http).not.toHaveBeenCalled();
    });

    it('sends the same play over HTTP, under the same key, when no ack arrives in time', async () =>
    {
        const rolling = useBoard().roll();
        await settle();
        const [sent] = plays();

        clock.advance(ACK_MS + 1);
        await rolling;

        expect(http).toHaveBeenCalledTimes(1);
        expect(http.mock.calls[0][0].input.key).toBe(sent.key);
        expect(useBoard().match()?.rev).toBe(2);
    });

    it('says so when the server refuses the play, and does not quietly send it again', async () =>
    {
        const toast = vi.spyOn(useToasts(), 'show');
        const rolling = useBoard().roll();
        await settle();
        const [sent] = plays();

        socket.deliver({ v: 1, t: 'refused', n: 3, key: sent.key, match: 'match-1', status: 409, message: 'It is not your turn.' });
        await rolling;

        expect(http).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    });

    it('takes a board somebody else moved from the push, and never plays the same events twice', async () =>
    {
        socket.deliver({ v: 1, t: 'game', n: 3, at: 400_000, match: board(2, { turn: 1 }), events: [rolled(2)] });
        expect(useBoard().match()?.rev).toBe(2);
        expect(useBoard().events().seq).toBe(1);

        socket.deliver({ v: 1, t: 'game', n: 4, at: 400_000, match: board(2, { turn: 1 }), events: [rolled(2)] });
        expect(useBoard().events().seq).toBe(1);

        socket.deliver({ v: 1, t: 'game', n: 5, at: 400_000, match: board(1), events: [rolled(1)] });
        expect(useBoard().match()?.rev).toBe(2);
    });

    it('ignores a push for a match nobody here has open', () =>
    {
        socket.deliver({ v: 1, t: 'game', n: 3, at: 400_000, match: { ...board(9), id: 'match-2' }, events: [] });

        expect(useBoard().match()?.rev).toBe(1);
    });
});

describe('a socket that stops answering', () =>
{
    it('is hung up and reopened while a table holds it, rather than trusted until TCP notices', () =>
    {
        const release = useRealtime().hold();
        socket.deaf = true;

        clock.advance(PROBE_MS + PROBE_GRACE_MS + 1);

        expect(socket.closed).toEqual([1000]);
        expect(socket.opens).toBe(2);
        release();
    });

    it('is left alone while it answers', () =>
    {
        const release = useRealtime().hold();

        clock.advance((PROBE_MS + PROBE_GRACE_MS) * 3);

        expect(socket.closed).toEqual([]);
        expect(socket.pings).toBeGreaterThan(1);
        release();
    });
});
