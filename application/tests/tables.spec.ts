import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@azerothjs/testing';

import { defaultTable, TABLE_RULES } from '../src/data/tables.ts';
import { GAMES } from '../src/data/games.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

let clock: ReturnType<typeof manualClock>;

const settle = async (): Promise<void> =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(2_000_000);
    setRuntime({ clock, seed: 5 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'guest',
        isMinor: false
    });
    useLobby().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useLobby().reset();
    useRealtime().reset();
});

describe('what a table config may say', () =>
{
    it('no longer claims anything about fairness', () =>
    {
        // `fairness: 'dice' | 'deal'` became two sentences in the UI - every roll committed
        // before it is shown, every deal shuffled from a checkable seed - and nothing implemented
        // either one. The rule is gone from the column, the wire and the copy together.
        for (const game of GAMES)
        {
            expect(Object.keys(TABLE_RULES[game.id]), game.id).not.toContain('fairness');
        }
    });
});

describe('the lobby store', () =>
{
    it('opens a table and seats the host in the first chair', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('hokm', defaultTable('hokm'), []);

        lobby.open(id);
        await settle();

        const table = lobby.table()!;
        expect(table.host).toBe('alex');
        expect(table.mine).toBe(0);
        expect(table.taken).toBe(1);
        expect(table.status).toBe('open');
        expect(table.chairs.length).toBe(4);
        expect(server.calls).toContain('tables.create');
    });

    it('holds a chair for each person the host invited', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('hokm', defaultTable('hokm'), ['sara.k', 'reza.t']);

        lobby.open(id);
        await settle();

        const held = lobby.table()!.chairs.filter((chair) => chair.invited !== undefined);
        expect(held.map((chair) => chair.invited)).toEqual(['sara.k', 'reza.t']);
    });

    it('remembers where this account is sitting, across a reload', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('poker', defaultTable('poker'), []);

        expect(lobby.seated().map((table) => table.id)).toEqual([id]);

        await lobby.leave(id);
        expect(lobby.seated()).toEqual([]);
    });

    it('takes an open chair rather than opening a second table', async () =>
    {
        const lobby = useLobby();

        // Somebody else's table, with room in it. The point is that the client LOOKS before it
        // opens one of its own - matchmaking here is a query, not a simulation.
        const theirs = await lobby.host('ludo', { ...defaultTable('ludo'), privacy: 'public' }, []);
        server.tables[0].chairs[0].who = 'sara.k';
        server.tables[0].host = 'sara.k';
        server.calls = [];

        const found = await lobby.quick('ludo');

        expect(found).toBe(theirs);
        expect(server.calls).toContain('tables.open');
        expect(server.calls).toContain('tables.claim');
        expect(server.calls).not.toContain('tables.create');
    });

    it('opens one and waits when there is nothing to join', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.quick('backgammon');

        expect(server.calls).toContain('tables.create');
        expect(lobby.seated().map((table) => table.id)).toContain(id);
    });

    it('calls a full table an answer rather than a failure', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('backgammon', defaultTable('backgammon'), []);

        // Two seats, and the fake gives the second to whoever asks - so asking again finds none.
        server.tables[0].chairs[1].who = 'sara.k';
        server.tables[0].chairs[0].who = 'sara.k';

        const seat = await lobby.claim(id);
        expect(seat).toBeNull();
    });

    it('answers with the chair somebody already holds rather than a second one', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('hokm', defaultTable('hokm'), []);

        expect(await lobby.claim(id)).toBe(0);
        expect(await lobby.claim(id)).toBe(0);
    });

    it('flags only my own chair as ready', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('hokm', defaultTable('hokm'), []);
        lobby.open(id);
        await settle();

        await lobby.ready(id, true);
        await settle();

        const chairs = lobby.table()!.chairs;
        expect(chairs[0].ready).toBe(true);
        expect(chairs.slice(1).every((chair) => !chair.ready)).toBe(true);
    });

    it('closes a table behind the last person out', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('poker', defaultTable('poker'), []);
        lobby.open(id);
        await settle();

        await lobby.leave(id);
        await settle();

        expect(server.tables.find((table) => table.id === id)?.status).toBe('closed');
        expect(lobby.openId()).toBe('');
    });

    it('calls a table nobody opened an answer, not a failure', async () =>
    {
        const lobby = useLobby();
        lobby.open('table-nope');
        await settle();

        expect(lobby.table()).toBeNull();
        expect(lobby.failed() ?? null).toBeNull();
    });

    it('re-reads itself when the social doorbell rings', async () =>
    {
        const lobby = useLobby();
        const stop = lobby.start();

        useRealtime().start();
        socket.accept();
        await lobby.host('hokm', defaultTable('hokm'), []);
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('tables.mine');
        stop();
    });
});
