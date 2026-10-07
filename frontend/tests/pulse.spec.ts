import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const asked = () => server.calls.filter((call) => call === 'catalogue.live').length;

const pulse = (n: number, playing: number, tables: number, watching = 'nothing-on') =>
    socket.deliver({ v: 1, t: 'pulse', n, games: [{ game: 'ludo', playing, tables }], watching });

const connected = async () =>
{
    useRealtime().start();
    socket.accept();
    clock.advance(NUDGE_WINDOW_MS);
    await settle();
};

beforeEach(async () =>
{
    resetRuntime();
    clock = manualClock(700_000);
    setRuntime({ clock, seed: 5 });

    server.reset();
    server.live = [{ game: 'ludo', playing: 4, tables: 2 }, { game: 'hokm', playing: 8, tables: 1 }];
    socket.reset();
    useRealtime().reset();
    useCatalogue().reset();
    await settle();
});

afterEach(() =>
{
    useCatalogue().stop();
    useRealtime().reset();
    vi.restoreAllMocks();
});

describe('how busy the games are, in the browser', () =>
{
    it('reads the numbers once when it starts, and adds them up', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();

        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 2, playersOnline: 4 });
        expect(catalogue.stats('poker')).toEqual({ tablesOpen: 0, playersOnline: 0 });
        expect(catalogue.totals()).toEqual({ tablesOpen: 3, playersOnline: 12 });
    });

    it('takes the numbers the socket tells it, and asks nothing to get them', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        await connected();

        const before = asked();

        pulse(3, 6, 0);

        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 0, playersOnline: 6 });
        expect(catalogue.stats('hokm'), 'a game the frame does not name is quiet').toEqual({ tablesOpen: 0, playersOnline: 0 });
        expect(catalogue.totals()).toEqual({ tablesOpen: 0, playersOnline: 6 });
        expect(asked()).toBe(before);
    });

    it('does not ask on a timer any more, however long the page stays open', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        await connected();

        const before = asked();

        clock.advance(10 * 60_000);
        await settle();

        expect(asked()).toBe(before);
    });

    it('asks again when everything is rung and there is no socket to tell it', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        useRealtime().start();

        const before = asked();

        server.live = [{ game: 'ludo', playing: 9, tables: 3 }];
        useRealtime().ring();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(asked()).toBe(before + 1);
        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 3, playersOnline: 9 });
    });

    it('does not ask when a socket that has just come back rings everything: the socket tells it', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        await connected();

        const before = asked();

        socket.drop();
        clock.advance(2000);
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(useRealtime().status()).toBe('connected');
        expect(asked()).toBe(before);
    });

    it('asks once for a ring of everything, not once for each thing rung', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        useRealtime().start();

        const before = asked();

        useRealtime().ring();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();
        useRealtime().ring();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(asked()).toBe(before + 2);
    });

    it('keeps what the socket told it over an answer it had asked for before that', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        await connected();

        let answer: (value: { games: { game: string; playing: number; tables: number }[] }) => void = () => undefined;

        vi.spyOn(client.catalogue, 'live').mockImplementationOnce(() => new Promise((resolve) =>
        {
            answer = resolve;
        }));

        catalogue.refresh();
        await settle();
        pulse(3, 7, 1);
        answer({ games: [{ game: 'ludo', playing: 1, tables: 1 }] });
        await settle();

        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 1, playersOnline: 7 });
    });

    it('takes an answer it asked for after the socket last spoke', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        await connected();
        pulse(3, 7, 1);

        server.live = [{ game: 'ludo', playing: 2, tables: 2 }];
        catalogue.refresh();
        await settle();

        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 2, playersOnline: 2 });

        pulse(4, 5, 0);

        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 0, playersOnline: 5 });
    });

    it('says which list of games to watch the numbers belong to, and nothing before it is told', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        await connected();

        expect(catalogue.watching()).toBeNull();

        pulse(3, 2, 0, 'one-game-on');

        expect(catalogue.watching()).toBe('one-game-on');
    });

    it('hears nothing once it is stopped', async () =>
    {
        const catalogue = useCatalogue();
        const stop = catalogue.start();

        await connected();
        stop();
        pulse(3, 6, 0);

        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 2, playersOnline: 4 });
    });

    it('forgets what one session was told when it is reset for the next', async () =>
    {
        const catalogue = useCatalogue();

        catalogue.start();
        await connected();
        pulse(3, 6, 0, 'one-game-on');

        server.live = [{ game: 'ludo', playing: 1, tables: 1 }];
        catalogue.reset();
        await settle();

        expect(catalogue.watching()).toBeNull();
        expect(catalogue.stats('ludo')).toEqual({ tablesOpen: 1, playersOnline: 1 });
    });
});

describe('the realtime store and the pulse', () =>
{
    it('hands every pulse to whoever listens, and stops when they stop listening', async () =>
    {
        const realtime = useRealtime();
        const heard: number[] = [];

        const off = realtime.onPulse((frame) => heard.push(frame.games[0].playing));

        await connected();
        pulse(3, 1, 0);
        pulse(4, 2, 0);
        off();
        pulse(5, 3, 0);

        expect(heard).toEqual([1, 2]);
    });
});
