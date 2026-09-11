import { describe, it, expect } from 'vitest';

import { defaultTable } from '../src/data/tables.ts';
import {
    TIMING,
    allReady,
    initial,
    nextDeadline,
    openSeats,
    reduce,
    tableIdFor,
    type MatchEvent,
    type MatchIntent,
    type MatchState
} from '../src/lib/matchmaking.ts';

const ME = 'you';

const intent = (game: 'hokm' | 'poker' | 'backgammon' | 'ludo', seats: number, invitees: string[] = []): MatchIntent => ({
    game,
    config: { ...defaultTable(game), seats },
    seats,
    mode: invitees.length > 0 ? 'private' : 'quick',
    invitees
});

const run = (state: MatchState, ...events: MatchEvent[]): MatchState => events.reduce(reduce, state);

const searching = (game: 'backgammon' | 'ludo' | 'hokm' = 'backgammon', seats = 2): MatchState =>
    reduce(initial(ME), { type: 'search', intent: intent(game, seats), tableId: 't-1', at: 1000 });

describe('matchmaking: searching', () =>
{
    it('seats me first, promises the game’s wait and arms the no-match deadline', () =>
    {
        const state = searching();
        expect(state.phase).toBe('searching');
        expect(state.seats[0].playerId).toBe(ME);
        expect(state.seats[0].host).toBe(true);
        expect(state.eta).toBe(TIMING.eta.backgammon);
        expect(nextDeadline(state)).toBe(1000 + TIMING.noMatchAfter);
    });

    it('moves to found the moment the last seat fills', () =>
    {
        const state = reduce(searching(), { type: 'candidate', playerId: 'sara', at: 3000 });
        expect(state.phase).toBe('found');
        expect(openSeats(state)).toEqual([]);
        expect(state.players).toEqual([ME, 'sara']);
        expect(nextDeadline(state)).toBe(3000 + TIMING.foundHold);
    });

    it('stays searching while seats remain open and ignores a duplicate candidate', () =>
    {
        const state = run(searching('hokm', 4),
            { type: 'candidate', playerId: 'sara', at: 2000 },
            { type: 'candidate', playerId: 'sara', at: 2100 });
        expect(state.phase).toBe('searching');
        expect(openSeats(state).length).toBe(2);
    });

    it('raises the no-match flag on the deadline tick and clears it on keep-waiting', () =>
    {
        const early = reduce(searching(), { type: 'tick', at: 1000 + TIMING.noMatchAfter - 1 });
        expect(early.noMatch).toBe(false);
        const late = reduce(early, { type: 'tick', at: 1000 + TIMING.noMatchAfter });
        expect(late.noMatch).toBe(true);
        expect(nextDeadline(late)).toBeNull();
        const again = reduce(late, { type: 'keep-waiting', at: 30000 });
        expect(again.noMatch).toBe(false);
        expect(nextDeadline(again)).toBe(30000 + TIMING.noMatchAfter);
    });

    it('fills the open seats with labelled bots on request and lands in found', () =>
    {
        const state = reduce(searching('hokm', 4), { type: 'fill-bots', at: 5000 });
        expect(state.phase).toBe('found');
        expect(state.seats.filter((seat) => seat.bot).length).toBe(3);
        expect(state.seats.filter((seat) => seat.bot).every((seat) => seat.ready)).toBe(true);
    });

    it('lets an invited friend take a seat while the search is still on', () =>
    {
        const state = run(searching('hokm', 4),
            { type: 'invite', playerId: 'sara', at: 2000 },
            { type: 'invite-replied', playerId: 'sara', accepted: true, at: 2500 });
        expect(state.seats.some((seat) => seat.playerId === 'sara')).toBe(true);
        expect(state.phase).toBe('searching');
    });
});

describe('matchmaking: found and lobby', () =>
{
    const found = (): MatchState => reduce(searching(), { type: 'candidate', playerId: 'sara', at: 3000 });

    it('sits down on accept or automatically after the hold', () =>
    {
        expect(reduce(found(), { type: 'accept', at: 3500 }).phase).toBe('lobby');
        expect(reduce(found(), { type: 'tick', at: 3000 + TIMING.foundHold }).phase).toBe('lobby');
        expect(reduce(found(), { type: 'tick', at: 3000 + TIMING.foundHold - 1 }).phase).toBe('found');
    });

    it('goes back to searching when the other player leaves before sitting down', () =>
    {
        const state = reduce(found(), { type: 'leave', playerId: 'sara', at: 3200 });
        expect(state.phase).toBe('searching');
        expect(openSeats(state).length).toBe(1);
    });

    it('starts the countdown only once every seat is filled and ready', () =>
    {
        const lobby = reduce(found(), { type: 'accept', at: 3500 });
        const half = reduce(lobby, { type: 'ready', playerId: 'sara', ready: true, at: 4000 });
        expect(half.phase).toBe('lobby');
        expect(allReady(half)).toBe(false);
        const all = reduce(half, { type: 'ready', playerId: ME, ready: true, at: 4200 });
        expect(all.phase).toBe('starting');
        expect(all.countdown).toBe(TIMING.countdown);
        expect(nextDeadline(all)).toBe(4200 + 1000);
    });

    it('hosts a private table with invited seats and no search', () =>
    {
        const state = reduce(initial(ME), { type: 'host', intent: intent('ludo', 4, ['sara', 'reza']), tableId: 't-2', at: 100 });
        expect(state.phase).toBe('lobby');
        expect(state.seats.map((seat) => seat.invitedId)).toEqual([null, 'sara', 'reza', null]);
        const joined = reduce(state, { type: 'join', playerId: 'reza', at: 200 });
        expect(joined.seats[2].playerId).toBe('reza');
        const declined = reduce(joined, { type: 'invite-replied', playerId: 'sara', accepted: false, at: 300 });
        expect(declined.seats[1].invitedId).toBeNull();
    });

    it('empties a seat when a guest leaves and ends the table when I leave', () =>
    {
        const lobby = reduce(found(), { type: 'accept', at: 3500 });
        const left = reduce(lobby, { type: 'leave', playerId: 'sara', at: 3600 });
        expect(openSeats(left).length).toBe(1);
        expect(reduce(lobby, { type: 'leave', playerId: ME, at: 3600 }).phase).toBe('idle');
    });
});

describe('matchmaking: starting, playing, result, rematch', () =>
{
    const starting = (): MatchState => run(searching(),
        { type: 'candidate', playerId: 'sara', at: 3000 },
        { type: 'accept', at: 3500 },
        { type: 'ready', playerId: 'sara', ready: true, at: 4000 },
        { type: 'ready', playerId: ME, ready: true, at: 4200 });

    it('counts down a second per tick and starts playing at zero', () =>
    {
        const two = reduce(starting(), { type: 'tick', at: 5200 });
        expect(two.countdown).toBe(2);
        expect(nextDeadline(two)).toBe(4200 + 2000);
        const one = reduce(two, { type: 'tick', at: 6200 });
        expect(one.countdown).toBe(1);
        const playing = reduce(one, { type: 'tick', at: 7200 });
        expect(playing.phase).toBe('playing');
        expect(nextDeadline(playing)).toBeNull();
    });

    it('aborts the countdown when someone un-readies or leaves', () =>
    {
        expect(reduce(starting(), { type: 'ready', playerId: 'sara', ready: false, at: 4500 }).phase).toBe('lobby');
        const gone = reduce(starting(), { type: 'leave', playerId: 'sara', at: 4500 });
        expect(gone.phase).toBe('lobby');
        expect(openSeats(gone).length).toBe(1);
    });

    it('rematches with the same players, un-readied, at a new table, skipping search', () =>
    {
        const result = run(starting(),
            { type: 'tick', at: 7200 },
            { type: 'finish', result: { winners: [ME], scores: { [ME]: 12, sara: 9 }, durationMs: 60000 }, at: 70000 });
        expect(result.phase).toBe('result');
        const again = reduce(result, { type: 'rematch', tableId: 't-9', at: 71000 });
        expect(again.phase).toBe('lobby');
        expect(again.tableId).toBe('t-9');
        expect(again.players).toEqual([ME, 'sara']);
        expect(again.seats.every((seat) => !seat.ready)).toBe(true);
        expect(again.intent?.mode).toBe('rematch');
        expect(again.result).toBeNull();
    });

    it('keeps bot seats ready through a rematch', () =>
    {
        const withBots = run(searching('hokm', 4),
            { type: 'fill-bots', at: 2000 },
            { type: 'accept', at: 2500 },
            { type: 'ready', playerId: ME, ready: true, at: 3000 },
            { type: 'tick', at: 6000 },
            { type: 'finish', result: { winners: ['bot-1'], scores: {}, durationMs: 1 }, at: 9000 },
            { type: 'rematch', tableId: 't-3', at: 9500 });
        expect(withBots.seats.filter((seat) => seat.bot).every((seat) => seat.ready)).toBe(true);
        expect(withBots.seats[0].ready).toBe(false);
    });
});

describe('matchmaking: cancel, reset and unknown events', () =>
{
    it('cancels from every waiting phase but never mid-game', () =>
    {
        const found = reduce(searching(), { type: 'candidate', playerId: 'sara', at: 3000 });
        expect(reduce(searching(), { type: 'cancel', at: 1 }).phase).toBe('idle');
        expect(reduce(found, { type: 'cancel', at: 1 }).phase).toBe('idle');
        const playing = run(found,
            { type: 'accept', at: 1 },
            { type: 'ready', playerId: 'sara', ready: true, at: 2 },
            { type: 'ready', playerId: ME, ready: true, at: 3 },
            { type: 'tick', at: 3003 });
        expect(playing.phase).toBe('playing');
        expect(reduce(playing, { type: 'cancel', at: 4 }).phase).toBe('playing');
        expect(reduce(playing, { type: 'leave', playerId: ME, at: 4 }).phase).toBe('idle');
    });

    it('leaves the state untouched for an event the phase does not know', () =>
    {
        const state = searching();
        expect(reduce(state, { type: 'finish', result: { winners: [], scores: {}, durationMs: 0 }, at: 5 })).toBe(state);
        expect(reduce(initial(ME), { type: 'ready', playerId: ME, ready: true, at: 5 })).toEqual(initial(ME));
    });

    it('resets from anywhere', () =>
    {
        expect(reduce(searching(), { type: 'reset' })).toEqual(initial(ME));
    });

    it('mints a table id that is stable for a seed and unique across moments', () =>
    {
        expect(tableIdFor(1, ME, 5)).toBe(tableIdFor(1, ME, 5));
        expect(tableIdFor(1, ME, 5)).not.toBe(tableIdFor(1, ME, 6));
        expect(tableIdFor(1, ME, 5)).toMatch(/^t-[0-9a-z]+$/);
    });
});
