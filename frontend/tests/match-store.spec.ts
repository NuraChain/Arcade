import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { en } from '../src/locales/en.ts';
import { fa } from '../src/locales/fa.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { ACK_MS, useBoard, type MatchEvent } from '../src/stores/match.store.ts';
import { NUDGE_WINDOW_MS, PROBE_GRACE_MS, PROBE_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { ClientFrame, MatchView, ServerFrame } from '../src/api.ts';
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
    view: { kind: 'ludo', moves: [], controls: 0, seats: [yard(0, 'red'), yard(1, 'yellow')] },
    ...over
});

const rolled = (rev: number) => ({ rev, seat: 0, at: new Date(400_000).toISOString(), log: { kind: 'ludo', events: [] } } as unknown as MatchEvent);

const matches = client.matches as unknown as Record<string, unknown>;

const settle = async () =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }
};

const plays = (): Extract<ClientFrame, { t: 'play' }>[] =>
    socket.sent.filter((frame): frame is Extract<ClientFrame, { t: 'play' }> => frame.t === 'play');

const refusedWith = (key: string, status: number, code: string): ServerFrame =>
    ({ v: 1, t: 'refused', n: 3, key, match: 'match-1', status, code, message: 'The server said no.' });

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
    useToasts().reset();
    useLocale().setLocale('en');
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

    it('says why the server refused the play, and does not quietly send it again', async () =>
    {
        const toast = vi.spyOn(useToasts(), 'show');
        const rolling = useBoard().roll();
        await settle();
        const [sent] = plays();

        socket.deliver(refusedWith(sent.key, 403, 'not-your-turn'));

        expect(await rolling).toBe('failed');
        expect(http).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning', text: en['match.refused.not-your-turn'] }));
    });

    it('says it in the language the reader is reading', async () =>
    {
        useLocale().setLocale('fa');

        const toast = vi.spyOn(useToasts(), 'show');
        const rolling = useBoard().roll();
        await settle();

        socket.deliver(refusedWith(plays()[0].key, 409, 'must-roll-first'));
        await rolling;

        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning', text: fa['match.refused.must-roll-first'] }));
    });

    it('says why when the refusal comes back over HTTP, because the socket was down', async () =>
    {
        const toast = vi.spyOn(useToasts(), 'show');

        socket.drop();
        http.mockRejectedValueOnce(new ApiError(409, 'raise-too-small', 'That raise is below the minimum.', undefined));

        expect(await useBoard().play({ kind: 'poker', verb: 'raise', amount: 40 })).toBe('failed');
        expect(plays()).toEqual([]);
        expect(http).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning', text: en['match.refused.raise-too-small'] }));
    });

    it('keeps the plain failure for a code that is not a word', async () =>
    {
        const toast = vi.spyOn(useToasts(), 'show');

        for (const code of ['conflict', 'validation-failed', 'not-found', 'internal', 'constructor'])
        {
            const rolling = useBoard().roll();
            await settle();

            socket.deliver(refusedWith(plays().at(-1)!.key, 409, code));

            expect(await rolling, code).toBe('failed');
            expect(toast, code).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'error', text: en['match.actionFailed'] }));
        }
    });

    it('keeps the plain failure when the request never arrived', async () =>
    {
        const toast = vi.spyOn(useToasts(), 'show');

        socket.drop();
        http.mockRejectedValueOnce(new TypeError('Failed to fetch'));

        expect(await useBoard().roll()).toBe('failed');
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', text: en['match.actionFailed'] }));
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

describe('a game that could not be fetched', () =>
{
    const failing = () =>
    {
        const fails = async (): Promise<MatchView> =>
        {
            throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
        };
        let asks = 0;
        let answer = fails;

        matches.view = async () =>
        {
            asks += 1;

            return await answer();
        };

        return {
            asks: () => asks,
            answers: (next: () => Promise<MatchView>) =>
            {
                answer = next;
            },
            fails: () =>
            {
                answer = fails;
            }
        };
    };

    const opened = async (id: string) =>
    {
        useBoard().open(id);
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 10));
        await settle();
    };

    beforeEach(async () =>
    {
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
    });

    it('is said to be lost, until it is fetched, and the board in hand meanwhile is still the last one that was', async () =>
    {
        const store = useBoard();
        const view = failing();

        expect(store.lost()).toBe(false);

        await opened('match-2');

        expect(view.asks()).toBe(1);
        expect(store.match()?.id).toBe('match-1');
        expect(store.lost()).toBe(true);

        view.answers(async () => board(4, { id: 'match-2' }));
        await store.refresh();
        await settle();

        expect(store.lost()).toBe(false);
        expect(store.match()?.rev).toBe(4);
    });

    it('goes on being said through a doorbell\'s own ask, is taken back for the length of an ask made by hand, and for good once the game arrives', async () =>
    {
        const store = useBoard();
        const view = failing();

        await opened('match-2');

        let fail = (): void => undefined;

        view.answers(async () =>
        {
            await new Promise<void>((resolve) => fail = resolve);

            throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
        });

        const since = vi.fn(async () => ({ match: board(1), events: [] }));

        matches.since = since;
        socket.deliver({ v: 1, t: 'nudge', n: 3, scope: 'game', id: 'match-2', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await vi.waitFor(() => expect(view.asks()).toBe(2), { timeout: 2000 });

        expect(since).not.toHaveBeenCalled();
        expect(store.lost()).toBe(true);

        fail();
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(store.lost()).toBe(true);

        const again = store.refresh().catch(() => undefined);

        await vi.waitFor(() => expect(view.asks()).toBe(3), { timeout: 2000 });

        expect(store.lost()).toBe(false);

        fail();
        await again;
        await settle();

        expect(store.lost()).toBe(true);

        view.answers(async () => board(4, { id: 'match-2' }));
        socket.deliver({ v: 1, t: 'nudge', n: 4, scope: 'game', id: 'match-2', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await vi.waitFor(() => expect(store.match()?.rev).toBe(4), { timeout: 2000 });

        expect(store.lost()).toBe(false);
    });

    it('is not said of a game that is not there, which is an answer', async () =>
    {
        const store = useBoard();

        matches.view = async () =>
        {
            throw new ApiError(404, 'not-found', 'No game there.', undefined);
        };

        await opened('match-2');

        expect(store.match()).toBeNull();
        expect(store.lost()).toBe(false);
    });

    it('is forgotten when another game is opened, when this one is closed and when the store is emptied', async () =>
    {
        const store = useBoard();
        const view = failing();

        await opened('match-2');

        expect(store.lost()).toBe(true);

        view.answers(async () => await new Promise<MatchView>(() => undefined));
        store.open('match-3');

        expect(store.lost()).toBe(false);

        view.fails();
        await opened('match-4');

        expect(store.lost()).toBe(true);

        store.close();

        expect(store.lost()).toBe(false);

        await opened('match-5');

        expect(store.lost()).toBe(true);

        store.reset();

        expect(store.lost()).toBe(false);
    });

    it('says nothing of the open game when an ask for one opened before it fails late', async () =>
    {
        const store = useBoard();
        const view = failing();
        let fail = (): void => undefined;

        view.answers(async () =>
        {
            await new Promise<void>((resolve) => fail = resolve);

            throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
        });
        store.open('match-2');
        await vi.waitFor(() => expect(view.asks()).toBe(1), { timeout: 2000 });

        view.answers(async () => board(7, { id: 'match-3' }));
        store.open('match-3');
        await vi.waitFor(() => expect(store.match()?.id).toBe('match-3'), { timeout: 2000 });

        fail();
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(store.lost()).toBe(false);
        expect(store.match()?.id).toBe('match-3');
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
