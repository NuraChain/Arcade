import { describe, it, expect, beforeEach } from 'vitest';

import { buildDataset, dataset, resetDataset } from '../src/data/mock/index.ts';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { TIMING, initial } from '../src/lib/matchmaking.ts';
import { createRandom } from '../src/lib/random.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { planCandidates, planFinish, planInviteReply, planReadiness } from '../src/services/lobby.service.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { socket } from './fake-realtime.ts';

let clock: ManualClock;

/**
 * Who is in the building, as the server would say it.
 *
 * Matchmaking fills seats from the people the socket reports as online, so a lobby test has to
 * say who those are. There is no seeded roster any more: with no socket and no snapshot, nobody
 * is online and nobody is offline either - the app simply has not been told.
 */
const crowd = (ids: readonly string[]): void =>
{
    socket.deliver({
        v: 1,
        t: 'presence',
        n: 1,
        full: true,
        people: ids.map((who) => ({ who, state: 'online' as const, since: 0 }))
    });
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(100_000);
    setRuntime({ clock, seed: 5 });
    resetDataset();
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'demo',
        isMinor: false
    });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    crowd(dataset().people.map((person) => person.id));
    useLobby().reset();
});

describe('lobby service plans', () =>
{
    const people = buildDataset(5, 100_000).people;

    it('plans exactly the missing seats, favourites first, spread inside the promised wait', () =>
    {
        const intent = { game: 'hokm' as const, config: defaultTable('hokm'), seats: 4, mode: 'quick' as const, invitees: [] };
        const arrivals = planCandidates(intent, people, createRandom(1));
        expect(arrivals.length).toBe(3);
        expect(new Set(arrivals.map((arrival) => arrival.playerId)).size).toBe(3);
        for (const arrival of arrivals)
        {
            expect(people.find((person) => person.id === arrival.playerId)?.favourite).toBe('hokm');
            expect(arrival.after).toBeGreaterThan(0);
            expect(arrival.after).toBeLessThan(TIMING.eta.hokm * 2);
        }
        expect(planCandidates(intent, people, createRandom(1))).toEqual(arrivals);
    });

    it('plans fewer arrivals than seats when the pool is short, so the no-match path can show', () =>
    {
        const intent = { game: 'ludo' as const, config: defaultTable('ludo'), seats: 4, mode: 'quick' as const, invitees: [] };
        expect(planCandidates(intent, people.slice(0, 1), createRandom(2)).length).toBe(1);
    });

    it('readies only the humans who are not me and not already ready', () =>
    {
        const seats = [
            { index: 0, playerId: 'alex', invitedId: null, ready: false, host: true, bot: false },
            { index: 1, playerId: 'sara.k', invitedId: null, ready: false, host: false, bot: false },
            { index: 2, playerId: 'bot-1', invitedId: null, ready: true, host: false, bot: true },
            { index: 3, playerId: null, invitedId: null, ready: false, host: false, bot: false }
        ];
        const plan = planReadiness(seats, 'alex', createRandom(3));
        expect(plan.map((arrival) => arrival.playerId)).toEqual(['sara.k']);
    });

    it('replies to an invite within a few seconds and mostly says yes', () =>
    {
        let accepted = 0;
        for (let seed = 0; seed < 40; seed += 1)
        {
            const reply = planInviteReply(createRandom(seed));
            expect(reply.after).toBeGreaterThanOrEqual(2000);
            expect(reply.after).toBeLessThanOrEqual(6000);
            accepted += reply.accepted ? 1 : 0;
        }
        expect(accepted).toBeGreaterThan(20);
    });

    it('writes a roll log for dice games only, with every roll in range', () =>
    {
        const base = initial('alex');
        const dice = planFinish({ ...base, phase: 'playing', players: ['alex', 'sara.k'], intent: { game: 'backgammon', config: defaultTable('backgammon'), seats: 2, mode: 'quick', invitees: [] } }, createRandom(4));
        expect(dice.rolls.length).toBeGreaterThan(10);
        expect(dice.rolls.every((roll) => roll.dice.every((value) => value >= 1 && value <= 6))).toBe(true);
        expect(dice.result.winners.length).toBe(1);
        expect(Object.keys(dice.result.scores).sort()).toEqual(['alex', 'sara.k']);
        expect(dice.verification).toMatch(/^[0-9A-F]+-[0-9A-F]+$/);
        const cards = planFinish({ ...base, phase: 'playing', players: ['alex', 'sara.k', 'reza.t', 'mina'], intent: { game: 'hokm', config: defaultTable('hokm'), seats: 4, mode: 'quick', invitees: [] } }, createRandom(4));
        expect(cards.rolls).toEqual([]);
    });
});

describe('lobby store', () =>
{
    it('runs a quick match from search to the table on the clock alone', () =>
    {
        const lobby = useLobby();
        const tableId = lobby.quick('backgammon');
        expect(lobby.phase()).toBe('searching');
        expect(lobby.tableId()).toBe(tableId);
        expect(lobby.seats()[0].playerId).toBe('alex');

        for (let step = 0; step < 80 && lobby.phase() === 'searching'; step += 1)
        {
            clock.advance(250);
        }
        expect(lobby.phase()).toBe('found');
        expect(lobby.seats().every((seat) => seat.playerId !== null)).toBe(true);

        clock.advance(TIMING.foundHold);
        expect(lobby.phase()).toBe('lobby');

        clock.advance(5000);
        const other = lobby.seats().find((seat) => seat.playerId !== 'alex')!;
        expect(other.ready).toBe(true);

        lobby.ready(true);
        expect(lobby.phase()).toBe('starting');
        clock.advance(3000);
        expect(lobby.phase()).toBe('playing');

        clock.advance(40_000);
        expect(lobby.phase()).toBe('result');
        expect(lobby.state().result?.winners.length).toBe(1);
        expect(lobby.rolls().length).toBeGreaterThan(0);
        expect(lobby.verification()).not.toBeNull();
    });

    it('cancels a search and leaves nothing ticking', () =>
    {
        const lobby = useLobby();
        lobby.quick('hokm');
        clock.advance(1000);
        lobby.cancel();
        expect(lobby.phase()).toBe('idle');
        expect(clock.pending()).toBe(0);
    });

    it('raises the no-match fallback when nobody arrives, then fills with labelled partners', () =>
    {
        crowd([]);
        const lobby = useLobby();
        lobby.quick('hokm');
        clock.advance(TIMING.noMatchAfter);
        expect(lobby.state().noMatch).toBe(true);
        expect(lobby.phase()).toBe('searching');
        lobby.fillWithBots();
        expect(lobby.phase()).toBe('found');
        expect(lobby.seats().filter((seat) => seat.bot).length).toBe(3);
    });

    it('hosts a private table, hears back from the invitees, and lets the host start', () =>
    {
        const lobby = useLobby();
        lobby.host('ludo', { ...defaultTable('ludo'), seats: 4 }, ['sara.k', 'reza.t', 'mina']);
        expect(lobby.phase()).toBe('lobby');
        expect(lobby.seats().map((seat) => seat.invitedId)).toEqual([null, 'sara.k', 'reza.t', 'mina']);
        clock.advance(10_000);
        const seated = lobby.seats().filter((seat) => seat.playerId !== null && seat.playerId !== 'alex').length;
        expect(seated).toBeGreaterThan(0);
        expect(lobby.chatter().length).toBeGreaterThan(0);
    });

    it('rematches straight into a lobby with the same players and a fresh table', () =>
    {
        const lobby = useLobby();
        const first = lobby.quick('backgammon');
        clock.advance(TIMING.eta.backgammon * 2 + TIMING.foundHold + 6000);
        lobby.ready(true);
        clock.advance(3000);
        lobby.finishNow();
        expect(lobby.phase()).toBe('result');
        const players = [...lobby.state().players];
        const second = lobby.rematch();
        expect(second).not.toBe(first);
        expect(lobby.phase()).toBe('lobby');
        expect(lobby.state().players).toEqual(players);
        expect(lobby.rolls()).toEqual([]);
        clock.advance(6000);
        lobby.ready(true);
        expect(lobby.phase()).toBe('starting');
    });

    it('lets me say something at the table and keeps it in order', () =>
    {
        const lobby = useLobby();
        lobby.quick('backgammon');
        lobby.say('hi');
        lobby.say('   ');
        expect(lobby.chatter().map((message) => message.text)).toEqual(['hi']);
        expect(lobby.chatter()[0].from).toBe('alex');
    });
});
