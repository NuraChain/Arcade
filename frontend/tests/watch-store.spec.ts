import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEffect, createRoot } from 'azerothjs';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { OPENING_MS, useBoard, type MatchEvent } from '../src/stores/match.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { WATCH_POLL_MS, useWatch } from '../src/stores/watch.store.ts';
import { WATCH_TAIL } from '../../backend/src/domains/match/turns.ts';
import type { MatchView, MatchWatch } from '../src/api.ts';
import { ApiError, client } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Ludo = Extract<MatchView['view'], { kind: 'ludo' }>;

const yard = (seat: number, colour: string): Ludo['seats'][number] => ({
    seat,
    colour,
    tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })),
    home: 0,
    out: false,
    side: seat
});

const board = (id: string, rev: number): MatchView => ({
    id,
    tableId: 'table-1',
    game: 'ludo',
    rev,
    seats: 2,
    players: [{ seat: 0, who: 'alex' }, { seat: 1, who: 'sara.k' }] as MatchView['players'],
    turn: 0,
    startedAt: new Date(400_000).toISOString(),
    view: { kind: 'ludo', moves: [], controls: 0, seats: [yard(0, 'red'), yard(1, 'yellow')] }
});

const told = (rev: number, seat = 0) => ({ rev, seat, at: new Date(400_000).toISOString(), log: { kind: 'ludo', moves: [] } } as unknown as MatchEvent);

const matches = client.matches as unknown as Record<string, unknown>;

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }
};

interface Game
{
    rev: number;
    live: boolean;
    ledger: MatchEvent[];
}

let clock: ManualClock;
let stops: (() => void)[] = [];
let games: Record<string, Game>;
let asked: { id: string; rev: string }[];

const answerOf = (id: string, rev: string): MatchWatch =>
{
    const game = games[id];
    const from = /^\d{1,15}$/.test(rev) ? Math.min(Number(rev), game.rev) : game.rev;

    return {
        match: board(id, game.rev),
        behind: game.live ? 30 : 0,
        delay: 30,
        live: game.live,
        events: game.rev - from > WATCH_TAIL ? [] : game.ledger.filter((event) => event.rev > from && event.rev <= game.rev)
    };
};

const played = (id: string, upTo: number) =>
{
    games[id].ledger = [told(1, -1), ...Array.from({ length: Math.max(0, upTo - 1) }, (_, index) => told(index + 2, index % 2))];
};

const ring = (id?: string) =>
{
    clock.advance(NUDGE_WINDOW_MS);
    socket.deliver({ v: 1, t: 'nudge', n: 3, scope: 'game', ...(id === undefined ? {} : { id }), at: 0 });
    clock.advance(NUDGE_WINDOW_MS);
};

const revs = () => useWatch().events().events.map((event) => event.rev);

beforeEach(async () =>
{
    resetRuntime();
    clock = manualClock(400_000);
    setRuntime({ clock, seed: 5 });
    socket.reset();
    games = { 'match-1': { rev: 1, live: true, ledger: [told(1, -1)] } };
    asked = [];
    matches.watch = vi.fn(async ({ params, query }: { params: { id: string }; query: { rev: string } }) =>
    {
        asked.push({ id: params.id, rev: query.rev });

        if (games[params.id] === undefined)
        {
            throw new ApiError(404, 'not-found', 'Nothing to watch there.', undefined);
        }

        return answerOf(params.id, query.rev);
    });

    stops = [useRealtime().start(), useWatch().start()];
    socket.accept();
    await settle();
    clock.advance(NUDGE_WINDOW_MS * 2);
    await settle();
});

afterEach(() =>
{
    for (const stop of stops.reverse())
    {
        stop();
    }

    useWatch().reset();
    useRealtime().reset();
    delete matches.watch;
    vi.restoreAllMocks();
});

describe('watching a game', () =>
{
    it('asks from the beginning the first time and from the revision it holds after that', async () =>
    {
        useWatch().open('match-1');
        await settle();

        games['match-1'].rev = 3;
        played('match-1', 3);
        useWatch().retry();
        await settle();
        useWatch().retry();
        await settle();

        expect(asked.map((one) => one.rev)).toEqual(['0', '1', '3']);
        expect(useWatch().view()?.match.rev).toBe(3);
    });

    it('hands on the board with nothing the board does not need, and the events apart from it', async () =>
    {
        useWatch().open('match-1');
        await settle();

        expect(Object.keys(useWatch().view()!).sort()).toEqual(['behind', 'delay', 'live', 'match']);
        expect(useWatch().events()).toMatchObject({ id: 'match-1', live: true, jump: false });
    });

    it('plays the opening for somebody who arrived while the board was still the opening, once', async () =>
    {
        useWatch().open('match-1');
        await settle();

        const batch = useWatch().events();

        expect(revs()).toEqual([1]);
        expect(batch.events[0].seat).toBe(-1);
        expect(batch.opens?.()).toBe(true);
        expect(batch.opens?.(), 'an opening is played once').toBe(false);
    });

    it('does not offer an opening that has waited longer than a board waits for one', async () =>
    {
        useWatch().open('match-1');
        await settle();
        clock.advance(OPENING_MS + 1);

        expect(useWatch().events().opens?.()).toBe(false);
    });

    it('shows a game opened in its middle as it stands, and plays nothing that came before', async () =>
    {
        games['match-1'].rev = 5;
        played('match-1', 5);

        const before = useWatch().events().seq;

        useWatch().open('match-1');
        await settle();

        expect(useWatch().view()?.match.rev).toBe(5);
        expect(useWatch().events().seq, 'moves made before the watcher came were handed to the board').toBe(before);
    });

    it('hands the board and the events that explain it to a reader in one go, the board never after its events', async () =>
    {
        useWatch().open('match-1');
        await settle();

        const seen: string[] = [];
        const dispose = createRoot((drop) =>
        {
            createEffect(() =>
            {
                seen.push(`${ useWatch().view()?.match.rev }/${ useWatch().events().events.map((event) => event.rev).join() }`);
            });

            return drop;
        });

        games['match-1'].rev = 3;
        played('match-1', 3);
        useWatch().retry();
        await settle();
        dispose();

        expect(seen).toEqual(['1/1', '3/2,3']);
    });

    it('publishes each event once when two reads overlap', async () =>
    {
        useWatch().open('match-1');
        await settle();

        const batches: number[][] = [];
        const dispose = createRoot((drop) =>
        {
            createEffect(() =>
            {
                batches.push(useWatch().events().events.map((event) => event.rev));
            });

            return drop;
        });

        games['match-1'].rev = 4;
        played('match-1', 4);
        useWatch().retry();
        useWatch().retry();
        useWatch().retry();
        await settle();
        dispose();

        expect(batches).toEqual([[1], [2, 3, 4]]);
        expect(asked.map((one) => one.rev), 'three presses while one read is out are that read and one more').toEqual(['0', '1', '4']);
    });

    it('drops an answer older than the board it already shows', async () =>
    {
        games['match-1'].rev = 4;
        played('match-1', 4);
        useWatch().open('match-1');
        await settle();

        const before = useWatch().events().seq;

        games['match-1'].rev = 2;
        useWatch().retry();
        await settle();

        expect(useWatch().view()?.match.rev).toBe(4);
        expect(useWatch().events().seq).toBe(before);
    });

    it('shows the board alone when the events do not reach it from the revision held', async () =>
    {
        useWatch().open('match-1');
        await settle();

        const before = useWatch().events().seq;

        games['match-1'].rev = 4;
        games['match-1'].ledger = [told(1, -1), told(3), told(4)];
        useWatch().retry();
        await settle();

        expect(useWatch().view()?.match.rev).toBe(4);
        expect(useWatch().events().seq, 'a run with a hole in it was handed to a board').toBe(before);

        games['match-1'].rev = 6;
        games['match-1'].ledger = [told(1, -1), told(2), told(3), told(4), told(5), told(6)];
        useWatch().retry();
        await settle();

        expect(revs(), 'the next whole run is played from the board that was shown').toEqual([5, 6]);
    });

    it('shows the board alone when it is further behind than the server will explain', async () =>
    {
        useWatch().open('match-1');
        await settle();

        const before = useWatch().events().seq;

        games['match-1'].rev = WATCH_TAIL + 5;
        played('match-1', WATCH_TAIL + 5);
        useWatch().retry();
        await settle();

        expect(useWatch().view()?.match.rev).toBe(WATCH_TAIL + 5);
        expect(useWatch().events().seq).toBe(before);
    });

    it('keeps counting its batches across games, and asks about the next game from its beginning', async () =>
    {
        games['match-1'].rev = 3;
        played('match-1', 3);
        useWatch().open('match-1');
        await settle();
        games['match-1'].rev = 4;
        played('match-1', 4);
        useWatch().retry();
        await settle();

        const last = useWatch().events().seq;

        games['match-2'] = { rev: 1, live: true, ledger: [told(1, -1)] };
        useWatch().close();
        useWatch().open('match-2');
        await settle();

        expect(asked.at(-1)).toEqual({ id: 'match-2', rev: '0' });
        expect(useWatch().events()).toMatchObject({ id: 'match-2' });
        expect(useWatch().events().seq).toBeGreaterThan(last);
        expect(useWatch().events().opens?.(), 'the next game has an opening of its own').toBe(true);
    });

    it('publishes nothing from an answer for a game it has stopped watching', async () =>
    {
        let answer: (value: MatchWatch) => void = () => undefined;

        matches.watch = vi.fn(() => new Promise<MatchWatch>((resolve) =>
        {
            answer = resolve;
        }));
        useWatch().open('match-1');
        await settle();
        useWatch().close();
        answer(answerOf('match-1', '0'));
        await settle();

        expect(useWatch().view()).toBeNull();
        expect(useWatch().events().id).not.toBe('match-1');
    });

    it('opening the game it already holds asks nothing and keeps its place', async () =>
    {
        useWatch().open('match-1');
        await settle();
        useWatch().open('match-1');
        await settle();

        expect(asked).toHaveLength(1);
        expect(useWatch().view()?.match.rev).toBe(1);
    });
});

describe('a watcher and a player', () =>
{
    it('are handed the same runs of events for the same moves', async () =>
    {
        matches.view = async () => ({ ...board('match-1', 1), mine: 0 });
        matches.since = async () => ({ match: { ...board('match-1', 1), mine: 0 }, events: [] });

        const stop = useBoard().start();

        useBoard().open('match-1');
        useWatch().open('match-1');
        await settle();

        const player: number[][] = [];
        const watcher: number[][] = [];
        let shown = 1;

        for (const upTo of [2, 4, 5])
        {
            games['match-1'].rev = upTo;
            played('match-1', upTo);
            socket.deliver({
                v: 1,
                t: 'game',
                n: upTo,
                at: 400_000,
                match: { ...board('match-1', upTo), mine: 0 },
                events: games['match-1'].ledger.filter((event) => event.rev > shown && event.rev <= upTo)
            });
            useWatch().retry();
            await settle();
            player.push(useBoard().events().events.map((event) => event.rev));
            watcher.push(revs());
            shown = upTo;
        }

        stop();
        useBoard().reset();
        delete matches.view;
        delete matches.since;

        expect(watcher).toEqual([[2], [3, 4], [5]]);
        expect(watcher).toEqual(player);
    });
});

describe('what makes a watcher look again', () =>
{
    it('is a ring that names its game, or one that names none, and not one for another game', async () =>
    {
        useWatch().open('match-1');
        await settle();

        const before = asked.length;

        ring('match-2');
        await settle();

        expect(asked.length, 'a ring for somebody else\'s game').toBe(before);

        ring('match-1');
        await settle();

        expect(asked.length).toBe(before + 1);

        ring();
        await settle();

        expect(asked.length, 'a ring of everything, which is all a browser with no socket ever hears').toBe(before + 2);
    });

    it('is the half minute going by, while the tab is on show', async () =>
    {
        useWatch().open('match-1');
        await settle();

        const before = asked.length;

        clock.advance(WATCH_POLL_MS);
        await settle();

        expect(asked.length).toBe(before + 1);

        const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        clock.advance(WATCH_POLL_MS);
        await settle();

        expect(asked.length, 'a hidden tab went on asking').toBe(before + 1);

        state.mockRestore();
    });

    it('stops once the game is over: the end is read, played, and nothing is asked again', async () =>
    {
        games['match-1'].rev = 3;
        played('match-1', 3);
        useWatch().open('match-1');
        await settle();

        games['match-1'] = { rev: 5, live: false, ledger: [told(1, -1), told(2), told(3), told(4), told(5)] };
        useWatch().settle();
        await settle();

        expect(useWatch().view()).toMatchObject({ live: false, behind: 0 });
        expect(revs(), 'the last moves were not handed to the board').toEqual([4, 5]);

        const before = asked.length;

        useWatch().settle();
        clock.advance(WATCH_POLL_MS * 2);
        ring('match-1');
        ring();
        await settle();

        expect(asked.length, 'a finished game was asked about again').toBe(before);

        useWatch().retry();
        await settle();

        expect(asked.length, 'somebody who presses Try again is still answered').toBe(before + 1);
    });
});

describe('a game that cannot be shown', () =>
{
    it('is refused when the server has nothing there, and is not called a failure', async () =>
    {
        useWatch().open('match-9');
        await settle();

        expect(useWatch().refused()).toBe(true);
        expect(useWatch().failed()).toBe(false);
        expect(useWatch().view()).toBeNull();
    });

    it('is a failure when the read never came back and there is nothing to show, and is not one while a board is in hand', async () =>
    {
        matches.watch = vi.fn(async () =>
        {
            throw new Error('no connection');
        });
        useWatch().open('match-1');
        await settle();

        expect(useWatch().failed()).toBe(true);
        expect(useWatch().refused()).toBe(false);

        matches.watch = vi.fn(async ({ params, query }: { params: { id: string }; query: { rev: string } }) => answerOf(params.id, query.rev));
        useWatch().retry();
        await settle();

        expect(useWatch().failed()).toBe(false);
        expect(useWatch().view()?.match.rev).toBe(1);

        matches.watch = vi.fn(async () =>
        {
            throw new Error('no connection');
        });
        useWatch().retry();
        await settle();

        expect(useWatch().failed(), 'a board on screen was replaced by a complaint').toBe(false);
        expect(useWatch().view()?.match.rev).toBe(1);
    });

    it('takes the board away when a game that was shown is no longer there to watch', async () =>
    {
        useWatch().open('match-1');
        await settle();
        delete games['match-1'];
        useWatch().retry();
        await settle();

        expect(useWatch().view()).toBeNull();
        expect(useWatch().refused()).toBe(true);
    });
});
