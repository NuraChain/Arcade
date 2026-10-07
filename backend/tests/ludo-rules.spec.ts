import { describe, expect, it } from 'vitest';

import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { FINISHED, RING_STEPS, YARD, ENTRY, SAFE, ringIndex, type LudoColour } from '../src/domains/match/ludo/board.ts';
import { apply, controlled, create, indexOfSeat, legalMoves } from '../src/domains/match/ludo/engine.ts';
import { placementsOf } from '../src/domains/match/ludo/standings.ts';
import type { GameEvent, LudoState, Outcome } from '../src/domains/match/ludo/state.ts';
import type { Variant } from '../src/domains/match/sides.ts';

/**
 * The rules, proved without a database and without a browser.
 *
 * Every refusal is asserted by its exact reason rather than by "it did not work", because the
 * service maps those reasons onto different HTTP statuses and a test that only checks failure would
 * let two of them swap places silently.
 */

const solo = (seats: readonly number[], first = 0) => create(seats, first, seats);

const table = (seats: number, first = 0) => solo(Array.from({ length: seats }, (_, seat) => seat), first);

const place = (state: LudoState, seat: number, pieces: number[]) =>
{
    const next: LudoState = { ...state, players: state.players.map((player) => ({ ...player, pieces: [...player.pieces] })) };
    next.players[indexOfSeat(next, seat)].pieces = [...pieces];

    return next;
};

const withDie = (state: LudoState, die: number): LudoState => ({ ...state, die });

const ok = (outcome: Outcome): { state: LudoState; events: GameEvent[] } =>
{
    if (!outcome.ok)
    {
        throw new Error(`expected an accepted action, got ${ outcome.reason }`);
    }

    return { state: outcome.state, events: outcome.events };
};

const kinds = (events: GameEvent[]): string[] => events.map((event) => event.e);

describe('setting up', () =>
{
    it('gives every player four tokens in the yard', () =>
    {
        for (const seats of [2, 3, 4])
        {
            const state = table(seats);

            expect(state.players, `${ seats } players`).toHaveLength(seats);

            for (const player of state.players)
            {
                expect(player.pieces).toEqual([YARD, YARD, YARD, YARD]);
                expect(player.out).toBe(false);
            }
        }
    });

    it('is one engine: the same colours and the same rotation whatever the seat count', () =>
    {
        expect(table(2).players.map((player) => player.colour)).toEqual(['red', 'yellow']);
        expect(table(3).players.map((player) => player.colour)).toEqual(['red', 'green', 'yellow']);
        expect(table(4).players.map((player) => player.colour)).toEqual(['red', 'green', 'yellow', 'blue']);
    });

    it('builds the same board however the seats arrive', () =>
    {
        expect(solo([2, 0, 1])).toEqual(solo([0, 1, 2]));
    });

    it('gives every player a side of its own when nobody is playing with anybody', () =>
    {
        for (const seats of [2, 3, 4])
        {
            expect(table(seats).players.map((player) => player.side), `${ seats } players`).toEqual(table(seats).players.map((player) => player.seat));
        }

        expect(solo([2, 5]).players.map((player) => player.side)).toEqual([2, 5]);
    });
});

describe('leaving the yard', () =>
{
    it('needs a six', () =>
    {
        const state = withDie(table(4), 3);

        expect(legalMoves(state)).toEqual([]);
    });

    it('opens on a six, and offers the move once rather than four times', () =>
    {
        const state = withDie(table(4), 6);

        expect(legalMoves(state)).toEqual([0]);
    });

    it('accepts any yard token on a six and brings out the first one in the yard', () =>
    {
        const start = withDie(place(table(2), 0, [YARD, 10, YARD, YARD]), 6);

        expect(legalMoves(start)).toEqual([0, 1]);

        for (const piece of [0, 2, 3])
        {
            const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece }));

            expect(state.players[0].pieces, `naming token ${ piece }`).toEqual([0, 10, YARD, YARD]);
            expect(events.find((event) => event.e === 'enter')).toEqual({ e: 'enter', seat: 0, owner: 0, piece: 0 });
        }
    });

    it('still refuses every yard token without a six', () =>
    {
        const start = withDie(place(table(2), 0, [10, YARD, YARD, YARD]), 4);

        for (const piece of [1, 2, 3])
        {
            const outcome = apply(start, { kind: 'move', seat: 0, piece });

            expect(outcome.ok ? null : outcome.reason, `naming token ${ piece }`).toBe('illegal-move');
        }
    });

    it('puts the token on its own entry square', () =>
    {
        const start = withDie(table(4), 6);
        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces[0]).toBe(0);
        expect(ringIndex('red', 0)).toBe(ENTRY.red);
        expect(kinds(events)).toContain('enter');
    });

    it('passes the turn on the first non-six, with no second try', () =>
    {
        const { state, events } = ok(apply(table(2), { kind: 'roll', seat: 0, die: 2 }));

        expect(state.turn, 'a full yard rolling low ends the turn at once').toBe(1);
        expect(kinds(events)).toContain('pass');
    });

    it('rolls again after a six that could not be used', () =>
    {
        const stuck = place(table(2), 0, [FINISHED, FINISHED, FINISHED, FINISHED - 1]);
        const { state, events } = ok(apply(stuck, { kind: 'roll', seat: 0, die: 6 }));

        expect(state.turn, 'a six always earns another roll').toBe(0);
        expect(state.die).toBeNull();
        expect(kinds(events)).not.toContain('pass');
    });
});

describe('moving', () =>
{
    it('walks the die', () =>
    {
        const start = withDie(place(table(2), 0, [10, YARD, YARD, YARD]), 4);
        const { state } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces[0]).toBe(14);
    });

    it('lets its own tokens share a square', () =>
    {
        const start = withDie(place(table(2), 0, [10, 14, YARD, YARD]), 4);

        expect(legalMoves(start)).toContain(0);

        const { state } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces[0]).toBe(14);
        expect(state.players[0].pieces[1]).toBe(14);
    });

    it('passes other tokens freely on the track', () =>
    {
        const state = withDie(place(table(2), 0, [10, 12, YARD, YARD]), 4);

        expect(legalMoves(state)).toContain(0);
    });

    it('refuses a token that is not legal to move', () =>
    {
        const state = withDie(place(table(2), 0, [FINISHED - 2, YARD, YARD, YARD]), 5);
        const outcome = apply(state, { kind: 'move', seat: 0, piece: 0 });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? null : outcome.reason).toBe('illegal-move');
    });

    it('refuses a token still in the yard without a six', () =>
    {
        const state = withDie(table(2), 4);
        const outcome = apply(state, { kind: 'move', seat: 0, piece: 0 });

        expect(outcome.ok ? null : outcome.reason).toBe('illegal-move');
    });

    it('refuses a move before a roll', () =>
    {
        const outcome = apply(table(2), { kind: 'move', seat: 0, piece: 0 });

        expect(outcome.ok ? null : outcome.reason).toBe('must-roll-first');
    });

    it('refuses a second roll in one turn', () =>
    {
        const state = withDie(place(table(2), 0, [10, YARD, YARD, YARD]), 3);
        const outcome = apply(state, { kind: 'roll', seat: 0, die: 5 });

        expect(outcome.ok ? null : outcome.reason).toBe('already-rolled');
    });

    it('refuses a player acting out of turn', () =>
    {
        const outcome = apply(table(2), { kind: 'roll', seat: 1, die: 6 });

        expect(outcome.ok ? null : outcome.reason).toBe('not-your-turn');
    });

    it('refuses somebody who is not at the table at all', () =>
    {
        const outcome = apply(table(2), { kind: 'roll', seat: 7, die: 6 });

        expect(outcome.ok ? null : outcome.reason).toBe('not-playing');
    });
});

describe('capturing', () =>
{
    it('sends a token home when it lands on one', () =>
    {
        const target = 12;
        const square = ringIndex('red', target);
        const victimAt = (square - ENTRY.yellow + 52) % 52;

        expect(SAFE).not.toContain(square);

        let state = place(table(2), 0, [target - 3, YARD, YARD, YARD]);
        state = place(state, 1, [victimAt, YARD, YARD, YARD]);

        const { state: after, events } = ok(apply(withDie(state, 3), { kind: 'move', seat: 0, piece: 0 }));

        expect(after.players[1].pieces[0]).toBe(YARD);
        expect(kinds(events)).toContain('capture');
    });

    /**
     * The whole sequence, as a player describes it: red is three squares behind yellow, rolls a
     * three, lands exactly on it - and yellow is back in its yard needing a six to come out again.
     *
     * Each half is pinned above and below, and the reason to walk it as one story is that the
     * halves meet in a place neither test looks: a captured token is only really sent home if what
     * it is sent back to is a yard the ordinary six rule applies to. A capture that set the piece
     * to something merely negative would pass the capture test and let the victim walk straight
     * back out on a two.
     */
    it('sends the captured token back to the yard, where it needs a six like any other', () =>
    {
        const target = 12;
        const square = ringIndex('red', target);
        const victimAt = (square - ENTRY.yellow + 52) % 52;

        expect(SAFE).not.toContain(square);

        let state = place(table(2), 0, [target - 3, YARD, YARD, YARD]);
        state = place(state, 1, [victimAt, YARD, YARD, YARD]);

        const { state: hit } = ok(apply(withDie(state, 3), { kind: 'move', seat: 0, piece: 0 }));

        expect(hit.players[1].pieces).toEqual([YARD, YARD, YARD, YARD]);

        const yellow = { ...hit, turn: 1 };

        for (const die of [1, 2, 3, 4, 5])
        {
            expect(legalMoves(withDie(yellow, die)), `a ${ die } must not free it`).toEqual([]);
        }

        const freed = ok(apply(withDie(yellow, 6), { kind: 'move', seat: 1, piece: 0 }));

        expect(freed.state.players[1].pieces[0]).toBe(0);
        expect(kinds(freed.events)).toContain('enter');
    });

    it('leaves a token alone on a starred square', () =>
    {
        const square = SAFE[1];
        const moverAt = (square - ENTRY.red + 52) % 52;
        const victimAt = (square - ENTRY.yellow + 52) % 52;

        let state = place(table(2), 0, [moverAt - 2, YARD, YARD, YARD]);
        state = place(state, 1, [victimAt, YARD, YARD, YARD]);

        const { state: after, events } = ok(apply(withDie(state, 2), { kind: 'move', seat: 0, piece: 0 }));

        expect(after.players[1].pieces[0]).toBe(victimAt);
        expect(kinds(events)).not.toContain('capture');
    });

    /**
     * Two players on ONE star, which is what a safe square is for.
     *
     * The player's own words for it: I am on an empty star, somebody is two squares behind me, and
     * they have to roll exactly a two to reach me - and even then I stay. Both halves matter and
     * only one of them was pinned. That a star refuses a capture is the test above; that the mover
     * still ARRIVES, and the two tokens share the square, is this one. A rule that refused the
     * landing instead would be a blockade, which this variant does not have, and nothing in
     * `legalMoves` distinguishes the two - so the difference lives here or nowhere.
     */
    it('lets an opponent land on the star and share it, rather than blocking the square', () =>
    {
        const square = SAFE[1];
        const moverAt = (square - ENTRY.red + 52) % 52 - 2;
        const victimAt = (square - ENTRY.yellow + 52) % 52;

        let state = place(table(2), 0, [moverAt, YARD, YARD, YARD]);
        state = place(state, 1, [victimAt, YARD, YARD, YARD]);

        expect(legalMoves(withDie(state, 2)), 'the exact roll must be offered').toContain(0);

        const { state: after, events } = ok(apply(withDie(state, 2), { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).not.toContain('capture');
        expect(after.players[1].pieces[0], 'the token on the star stays put').toBe(victimAt);
        expect(ringIndex('red', after.players[0].pieces[0]), 'the mover arrives').toBe(square);
        expect(ringIndex('yellow', after.players[1].pieces[0]), 'both are on one square').toBe(square);
    });

    /**
     * Every colour's own entry is one of the eight stars, so a token that has just come out of the
     * yard is standing on a safe square rather than on the most dangerous one on the board.
     */
    it('starts every colour on a star', () =>
    {
        for (const colour of ['red', 'green', 'yellow', 'blue'] as const)
        {
            expect(SAFE, `${ colour } enters on an unprotected square`).toContain(ENTRY[colour]);
        }
    });

    it('never captures its own, it stacks with them', () =>
    {
        const state = withDie(place(table(2), 0, [5, 8, YARD, YARD]), 3);
        const { state: after, events } = ok(apply(state, { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).not.toContain('capture');
        expect(after.players[0].pieces[0]).toBe(8);
        expect(after.players[0].pieces[1]).toBe(8);
    });

    it('does not capture by passing over somebody', () =>
    {
        const square = ringIndex('red', 12);
        const victimAt = (square - ENTRY.yellow + 52) % 52;

        let state = place(table(2), 0, [9, YARD, YARD, YARD]);
        state = place(state, 1, [victimAt, YARD, YARD, YARD]);

        const { state: after, events } = ok(apply(withDie(state, 5), { kind: 'move', seat: 0, piece: 0 }));

        expect(after.players[0].pieces[0]).toBe(14);
        expect(after.players[1].pieces[0], 'passed over, not landed on').toBe(victimAt);
        expect(kinds(events)).not.toContain('capture');
    });
});

describe('the capture event names the moving token, the captured token and its owner', () =>
{
    const captures = (events: GameEvent[]) => events.filter((event) => event.e === 'capture');

    const yellowOnTurn = (red: number[]) =>
    {
        let state = solo([2, 5], 1);
        state = place(state, 5, [YARD, YARD, 1, YARD]);
        state = place(state, 2, red);

        return withDie(state, 3);
    };

    it('names the mover by seat and token, and the victim by seat and token, for a single capture', () =>
    {
        expect(ringIndex('yellow', 4)).toBe(ringIndex('red', 30));
        expect(SAFE).not.toContain(ringIndex('red', 30));

        const { state, events } = ok(apply(yellowOnTurn([YARD, 10, YARD, 30]), { kind: 'move', seat: 5, piece: 2 }));

        expect(state.players[0].pieces).toEqual([YARD, 10, YARD, YARD]);
        expect(captures(events)).toEqual([
            { e: 'capture', seat: 5, owner: 5, piece: 2, victim: 2, victimPiece: 3 }
        ]);
    });

    it('writes one event per captured token when a token coming out sends a block home', () =>
    {
        let state = solo([2, 5], 1);
        state = place(state, 5, [YARD, YARD, 1, YARD]);
        state = withDie(place(state, 2, [YARD, 26, 10, 26]), 6);

        expect(ringIndex('red', 26)).toBe(ENTRY.yellow);

        const { state: after, events } = ok(apply(state, { kind: 'move', seat: 5, piece: 3 }));

        expect(after.players[0].pieces).toEqual([YARD, YARD, 10, YARD]);
        expect(captures(events)).toEqual([
            { e: 'capture', seat: 5, owner: 5, piece: 0, victim: 2, victimPiece: 1 },
            { e: 'capture', seat: 5, owner: 5, piece: 0, victim: 2, victimPiece: 3 }
        ]);
    });
});

describe('the home column', () =>
{
    it('takes an exact count and refuses an overshoot', () =>
    {
        const state = place(table(2), 0, [FINISHED - 2, YARD, YARD, YARD]);

        expect(legalMoves(withDie(state, 2))).toContain(0);
        expect(legalMoves(withDie(state, 3))).toEqual([]);
    });

    it('does not block on a token already in the column', () =>
    {
        const state = withDie(place(table(2), 0, [RING_STEPS - 1, RING_STEPS + 1, YARD, YARD]), 3);

        expect(legalMoves(state), 'stacking is legal in the home lane too').toContain(0);
    });

    it('is private: nobody else can be captured there', () =>
    {
        let state = place(table(2), 0, [RING_STEPS + 1, YARD, YARD, YARD]);
        state = place(state, 1, [RING_STEPS + 1, YARD, YARD, YARD]);

        const { events } = ok(apply(withDie(state, 1), { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).not.toContain('capture');
    });

    it('says so when a token gets home', () =>
    {
        const state = withDie(place(table(2), 0, [FINISHED - 1, YARD, YARD, YARD]), 1);
        const { events } = ok(apply(state, { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).toContain('home');
    });
});

describe('winning', () =>
{
    it('is all four tokens home, and ends the game there', () =>
    {
        const state = withDie(place(table(2), 0, [FINISHED, FINISHED, FINISHED, FINISHED - 1]), 1);
        const { state: after, events } = ok(apply(state, { kind: 'move', seat: 0, piece: 3 }));

        expect(after.winner).toBe(0);
        expect(kinds(events)).toContain('finish');
    });

    it('refuses every action once it is over', () =>
    {
        const state = withDie(place(table(2), 0, [FINISHED, FINISHED, FINISHED, FINISHED - 1]), 1);
        const { state: over } = ok(apply(state, { kind: 'move', seat: 0, piece: 3 }));

        expect(apply(over, { kind: 'roll', seat: 1, die: 6 }).ok).toBe(false);
        expect(apply(over, { kind: 'roll', seat: 1, die: 6 }).ok ? null : 'game-over').toBe('game-over');
    });

    it('names the winner as a side, which with nobody playing together is the seat and never its place in the list', () =>
    {
        const start = withDie(place(solo([2, 5], 1), 5, [FINISHED, FINISHED, FINISHED, FINISHED - 1]), 1);
        const { state, events } = ok(apply(start, { kind: 'move', seat: 5, piece: 3 }));

        expect(state.winner).toBe(5);
        expect(events.at(-1)).toEqual({ e: 'finish', side: 5, seats: [5] });
        expect(ludoEngine.finish(state)).toEqual({ winners: [5], unsettled: [], trailing: [] });
        expect(placementsOf(state).map((one) => [one.seat, one.place])).toEqual([[5, 1], [2, 2]]);
    });
});

describe('the turn', () =>
{
    it('passes when a roll leaves nothing to do', () =>
    {
        const state = place(table(2), 0, [FINISHED, FINISHED, FINISHED, FINISHED - 1]);
        const { state: after, events } = ok(apply(state, { kind: 'roll', seat: 0, die: 5 }));

        expect(after.turn).toBe(1);
        expect(kinds(events)).toContain('pass');
    });

    it('comes round again on a six', () =>
    {
        const state = place(table(2), 0, [10, YARD, YARD, YARD]);
        const rolled = ok(apply(state, { kind: 'roll', seat: 0, die: 6 }));
        const { state: after } = ok(apply(rolled.state, { kind: 'move', seat: 0, piece: 0 }));

        expect(after.turn).toBe(0);
        expect(after.die).toBeNull();
    });

    it('ends on the third six, without a move', () =>
    {
        let state = place(table(2), 0, [10, YARD, YARD, YARD]);

        state = ok(apply(state, { kind: 'roll', seat: 0, die: 6 })).state;
        state = ok(apply(state, { kind: 'move', seat: 0, piece: 0 })).state;
        state = ok(apply(state, { kind: 'roll', seat: 0, die: 6 })).state;
        state = ok(apply(state, { kind: 'move', seat: 0, piece: 0 })).state;

        const third = ok(apply(state, { kind: 'roll', seat: 0, die: 6 }));

        expect(kinds(third.events)).toContain('pass');
        expect(third.state.turn).toBe(1);
    });

    it('skips a seat that has forfeited', () =>
    {
        const state = table(3);
        const { state: after } = ok(apply(state, { kind: 'forfeit', seat: 1, reason: 'timeout' }));

        expect(after.players[1].out).toBe(true);
        expect(after.players[1].pieces).toEqual([YARD, YARD, YARD, YARD]);

        const turn = ok(apply(after, { kind: 'roll', seat: 0, die: 1 })).state;

        expect(turn.turn, 'the forfeited seat is skipped').toBe(2);
    });

    it('ends the game when forfeits leave one player standing', () =>
    {
        const state = table(2);
        const { state: after, events } = ok(apply(state, { kind: 'forfeit', seat: 1, reason: 'resign' }));

        expect(after.winner).toBe(0);
        expect(kinds(events)).toContain('finish');
    });
});

describe('a seat that stops playing', () =>
{
    const BOARD = [10, 20, YARD, FINISHED];

    it('has its tokens sent back to the yard while the game goes on', () =>
    {
        const start = place(place(table(3), 1, BOARD), 2, [5, YARD, YARD, YARD]);
        const { state, events } = ok(apply(start, { kind: 'forfeit', seat: 1, reason: 'timeout' }));

        expect(events).toEqual([{ e: 'forfeit', seat: 1, reason: 'timeout' }]);
        expect(state.players[1]).toMatchObject({ out: true, pieces: [YARD, YARD, YARD, YARD] });
        expect(state.players[2].pieces).toEqual([5, YARD, YARD, YARD]);
        expect(state.winner).toBeNull();
        expect(state.turn).toBe(0);
    });

    it('hands the turn on when it was the one on turn and the game goes on', () =>
    {
        const start = withDie(place(table(3), 0, BOARD), 4);
        const { state } = ok(apply(start, { kind: 'forfeit', seat: 0, reason: 'left' }));

        expect(state.turn).toBe(1);
        expect(state.die).toBeNull();
        expect(state.players[0].pieces).toEqual([YARD, YARD, YARD, YARD]);
    });

    it('keeps its tokens where they stood when its going ends the game', () =>
    {
        const start = withDie(place(place(table(2), 0, [3, YARD, YARD, YARD]), 1, BOARD), 4);
        const { state, events } = ok(apply(start, { kind: 'forfeit', seat: 1, reason: 'resign' }));

        expect(events).toEqual([{ e: 'forfeit', seat: 1, reason: 'resign' }, { e: 'finish', side: 0, seats: [0] }]);
        expect(state.players[1]).toMatchObject({ out: true, pieces: BOARD });
        expect(state.players[0].pieces).toEqual([3, YARD, YARD, YARD]);
        expect(state.winner).toBe(0);
        expect(state.die).toBeNull();
    });

    it('keeps the tokens of the last of three to go, after the first was sent to the yard', () =>
    {
        const start = place(place(table(3), 1, BOARD), 2, [5, 30, YARD, YARD]);
        const first = ok(apply(start, { kind: 'forfeit', seat: 2, reason: 'left' })).state;
        const { state, events } = ok(apply(first, { kind: 'forfeit', seat: 1, reason: 'timeout' }));

        expect(kinds(events)).toEqual(['forfeit', 'finish']);
        expect(state.winner).toBe(0);
        expect(state.players[2].pieces).toEqual([YARD, YARD, YARD, YARD]);
        expect(state.players[1].pieces).toEqual(BOARD);
        expect(ludoEngine.finish(state)).toEqual({ winners: [0], unsettled: [0], trailing: [] });
        expect(placementsOf(state).map((one) => [one.seat, one.place])).toEqual([[0, 1], [1, 2], [2, 2]]);
    });

    it('places everybody who left together, whatever the last of them left on the board', () =>
    {
        const start = place(place(place(table(4), 1, BOARD), 2, [5, 30, YARD, YARD]), 3, [FINISHED, FINISHED, 40, YARD]);
        const first = ok(apply(start, { kind: 'forfeit', seat: 2, reason: 'left' })).state;
        const second = ok(apply(first, { kind: 'forfeit', seat: 3, reason: 'resign' })).state;
        const { state } = ok(apply(second, { kind: 'forfeit', seat: 1, reason: 'timeout' }));

        expect(state.winner).toBe(0);
        expect(state.players[1].pieces).toEqual(BOARD);
        expect(state.players[3].pieces).toEqual([YARD, YARD, YARD, YARD]);
        expect(placementsOf(state).map((one) => [one.seat, one.place])).toEqual([[0, 1], [1, 2], [2, 2], [3, 2]]);
    });
});

describe('the ledger', () =>
{
    it('moves the revision on every accepted action and never otherwise', () =>
    {
        const state = table(2);
        const { state: after } = ok(apply(state, { kind: 'roll', seat: 0, die: 6 }));

        expect(after.rev).toBe(state.rev + 1);
        expect(apply(state, { kind: 'roll', seat: 1, die: 6 }).ok).toBe(false);
    });

    it('never mutates the state it was given', () =>
    {
        const state = withDie(place(table(2), 0, [10, YARD, YARD, YARD]), 4);
        const before = JSON.stringify(state);

        ok(apply(state, { kind: 'move', seat: 0, piece: 0 }));

        expect(JSON.stringify(state)).toBe(before);
    });
});

describe('two tokens of one colour form a block', () =>
{
    const square = ringIndex('red', 12);

    const yellowAt = (at: number) => (at - ENTRY.yellow + 52) % 52;

    const facing = (red: number[], yellow: number[], die: number) => withDie(place(place(table(2), 0, red), 1, yellow), die);

    it('lets no opponent land on a block', () =>
    {
        expect(SAFE).not.toContain(square);

        const start = facing([9, YARD, YARD, YARD], [yellowAt(square), yellowAt(square), YARD, YARD], 3);

        expect(legalMoves(start)).toEqual([]);

        const outcome = apply(start, { kind: 'move', seat: 0, piece: 0 });

        expect(outcome.ok ? null : outcome.reason).toBe('illegal-move');
    });

    it('lets no opponent pass a block', () =>
    {
        const start = facing([9, 30, YARD, YARD], [yellowAt(square), yellowAt(square), YARD, YARD], 5);

        expect(legalMoves(start)).toEqual([1]);
    });

    it('still lets an opponent stop short of a block', () =>
    {
        const start = facing([9, YARD, YARD, YARD], [yellowAt(square), yellowAt(square), YARD, YARD], 2);
        const { state } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces[0]).toBe(11);
        expect(state.players[1].pieces).toEqual([yellowAt(square), yellowAt(square), YARD, YARD]);
    });

    it('lets the owner pass its own block and break it up', () =>
    {
        const start = facing([9, 12, 12, YARD], [5, YARD, YARD, YARD], 5);

        expect(legalMoves(start)).toEqual([0, 1, 2]);

        const { state } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces).toEqual([14, 12, 12, YARD]);
    });

    it('forms when a token lands on one of its own', () =>
    {
        const start = facing([10, 12, YARD, YARD], [yellowAt(14), YARD, YARD, YARD], 2);
        const { state } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces).toEqual([12, 12, YARD, YARD]);

        const yellow = withDie({ ...state, turn: 1, die: null }, 2);

        expect(ringIndex('yellow', yellowAt(10) + 2)).toBe(square);
        expect(legalMoves(withDie(place(yellow, 1, [yellowAt(10), YARD, YARD, YARD]), 2))).toEqual([]);
    });

    it('takes no third token', () =>
    {
        const start = facing([10, 12, 12, YARD], [5, YARD, YARD, YARD], 2);

        expect(legalMoves(start)).toEqual([1, 2]);
        expect(apply(start, { kind: 'move', seat: 0, piece: 0 }).ok).toBe(false);
    });

    it('stands on a star and blocks there too', () =>
    {
        const star = 8;
        const onStar = [yellowAt(star), yellowAt(star), YARD, YARD];

        expect(SAFE).toContain(star);
        expect(legalMoves(facing([5, YARD, YARD, YARD], onStar, 3)), 'landing on it').toEqual([]);
        expect(legalMoves(facing([5, YARD, YARD, YARD], onStar, 5)), 'passing it').toEqual([]);
    });

    it('stands on the start square of another colour and blocks there too', () =>
    {
        const green = ENTRY.green;
        let start = place(table(4), 0, [green - 2, YARD, YARD, YARD]);
        start = withDie(place(start, 3, [(green - ENTRY.blue + 52) % 52, (green - ENTRY.blue + 52) % 52, YARD, YARD]), 2);

        expect(legalMoves(start)).toEqual([]);
    });

    it('turns a roll whose only moves it blocks into a pass on one to five', () =>
    {
        const start = place(place(table(2), 0, [9, YARD, YARD, YARD]), 1, [yellowAt(square), yellowAt(square), YARD, YARD]);
        const { state, events } = ok(apply(start, { kind: 'roll', seat: 0, die: 4 }));

        expect(events).toEqual([{ e: 'roll', seat: 0, die: 4 }, { e: 'pass', seat: 0, why: 'no-move' }]);
        expect(state.turn).toBe(1);
    });

    it('turns a six whose only moves it blocks into another roll', () =>
    {
        const start = place(place(table(2), 0, [9, FINISHED, FINISHED, FINISHED]), 1, [yellowAt(square), yellowAt(square), YARD, YARD]);
        const { state, events } = ok(apply(start, { kind: 'roll', seat: 0, die: 6 }));

        expect(events).toEqual([{ e: 'roll', seat: 0, die: 6 }]);
        expect(state.turn).toBe(0);
        expect(state.die).toBeNull();
    });

    it('does not block the home lane, where its owner may gather any number', () =>
    {
        const start = facing([RING_STEPS - 1, RING_STEPS + 1, RING_STEPS + 1, YARD], [5, YARD, YARD, YARD], 2);

        expect(legalMoves(start)).toContain(0);
    });
});

describe('a start square holds one token of its own colour', () =>
{
    it('lets no token come out while one of its own stands on the start square', () =>
    {
        const start = withDie(place(table(2), 0, [0, YARD, YARD, YARD]), 6);

        expect(legalMoves(start)).toEqual([0]);

        const outcome = apply(start, { kind: 'move', seat: 0, piece: 1 });

        expect(outcome.ok ? null : outcome.reason).toBe('illegal-move');
    });

    it('lets the next one come out once that token has moved on', () =>
    {
        const start = withDie(place(table(2), 0, [6, YARD, YARD, YARD]), 6);

        expect(legalMoves(start)).toEqual([0, 1]);
    });

    it('rolls again on a six when the token on the start square cannot move either', () =>
    {
        const blocked = (ENTRY.red + 3 - ENTRY.yellow + 52) % 52;
        const start = place(place(table(2), 0, [0, YARD, YARD, YARD]), 1, [blocked, blocked, YARD, YARD]);
        const { state, events } = ok(apply(start, { kind: 'roll', seat: 0, die: 6 }));

        expect(events).toEqual([{ e: 'roll', seat: 0, die: 6 }]);
        expect(state.turn).toBe(0);
        expect(state.die).toBeNull();
    });
});

describe('only a six earns another roll', () =>
{
    const capture = (die: number) => place(place(table(2), 0, [12 - die, YARD, YARD, YARD]), 1, [38, YARD, YARD, YARD]);

    it('keeps the turn after a move on a six, with the die cleared for the next roll', () =>
    {
        const rolled = ok(apply(place(table(2), 0, [10, YARD, YARD, YARD]), { kind: 'roll', seat: 0, die: 6 }));
        const { state } = ok(apply(rolled.state, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.turn).toBe(0);
        expect(state.die).toBeNull();
    });

    it('passes the turn after a move on one to five', () =>
    {
        for (const die of [1, 2, 3, 4, 5])
        {
            const { state } = ok(apply(withDie(place(table(2), 0, [10, YARD, YARD, YARD]), die), { kind: 'move', seat: 0, piece: 0 }));

            expect(state.turn, `a ${ die }`).toBe(1);
        }
    });

    it('gives no extra roll for a capture on one to five', () =>
    {
        const { state, events } = ok(apply(withDie(capture(3), 3), { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).toContain('capture');
        expect(state.turn).toBe(1);
        expect(state.die).toBeNull();
    });

    it('gives no extra roll for a token reaching home on one to five', () =>
    {
        const start = withDie(place(table(2), 0, [FINISHED - 2, 10, YARD, YARD]), 2);
        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).toContain('home');
        expect(state.turn).toBe(1);
    });

    it('still gives the roll for a capture on a six', () =>
    {
        const rolled = ok(apply(capture(6), { kind: 'roll', seat: 0, die: 6 }));
        const { state, events } = ok(apply(rolled.state, { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).toContain('capture');
        expect(state.turn).toBe(0);
        expect(state.die).toBeNull();
    });

    it('still gives the roll for a token reaching home on a six', () =>
    {
        const rolled = ok(apply(place(table(2), 0, [FINISHED - 6, 10, YARD, YARD]), { kind: 'roll', seat: 0, die: 6 }));
        const { state, events } = ok(apply(rolled.state, { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).toContain('home');
        expect(state.turn).toBe(0);
    });
});

describe('three sixes in a row end the turn', () =>
{
    const roll = (state: LudoState, die: number) => ok(apply(state, { kind: 'roll', seat: state.players[state.turn].seat, die }));

    const move = (state: LudoState, piece: number) => ok(apply(state, { kind: 'move', seat: state.players[state.turn].seat, piece })).state;

    it('passes the turn on the third six without a move, even when one is legal', () =>
    {
        let state = place(table(2), 0, [10, YARD, YARD, YARD]);

        state = move(roll(state, 6).state, 0);
        state = move(roll(state, 6).state, 0);

        const before = [...state.players[0].pieces];
        const third = roll(state, 6);

        expect(third.events).toEqual([{ e: 'roll', seat: 0, die: 6 }, { e: 'pass', seat: 0, why: 'three-sixes' }]);
        expect(third.state.turn).toBe(1);
        expect(third.state.die).toBeNull();
        expect(third.state.players[0].pieces).toEqual(before);
    });

    it('counts sixes that had nothing to move toward the three', () =>
    {
        let state = place(table(2), 0, [FINISHED, FINISHED, FINISHED, FINISHED - 1]);

        state = roll(state, 6).state;
        expect(state.turn).toBe(0);

        state = roll(state, 6).state;
        expect(state.turn).toBe(0);

        const third = roll(state, 6);

        expect(kinds(third.events)).toEqual(['roll', 'pass']);
        expect(third.state.turn).toBe(1);
    });

    it('starts the count again for the next player', () =>
    {
        let state = place(table(2), 0, [10, YARD, YARD, YARD]);

        state = move(roll(state, 6).state, 0);
        state = move(roll(state, 6).state, 0);
        state = roll(state, 6).state;

        expect(state.sixes).toBe(0);

        const next = roll(state, 6);

        expect(next.state.turn).toBe(1);
        expect(kinds(next.events)).not.toContain('pass');
    });

    it('ends the turn as usual on a non-six after two sixes', () =>
    {
        let state = place(table(2), 0, [10, YARD, YARD, YARD]);

        state = move(roll(state, 6).state, 0);
        state = move(roll(state, 6).state, 0);
        state = move(roll(state, 2).state, 0);

        expect(state.turn).toBe(1);
        expect(state.sixes).toBe(0);
    });
});

describe('a six with no legal move rolls again', () =>
{
    const stuck = () => place(table(2), 0, [FINISHED, FINISHED, FINISHED, FINISHED - 3]);

    it('keeps the turn and asks for another roll, with no pass', () =>
    {
        const { state, events } = ok(apply(stuck(), { kind: 'roll', seat: 0, die: 6 }));

        expect(events).toEqual([{ e: 'roll', seat: 0, die: 6 }]);
        expect(state.turn).toBe(0);
        expect(state.die).toBeNull();
        expect(apply(state, { kind: 'roll', seat: 0, die: 3 }).ok).toBe(true);
    });

    it('passes the turn on one to five with no legal move', () =>
    {
        for (const die of [4, 5])
        {
            const { state, events } = ok(apply(stuck(), { kind: 'roll', seat: 0, die }));

            expect(events, `a ${ die }`).toEqual([{ e: 'roll', seat: 0, die }, { e: 'pass', seat: 0, why: 'no-move' }]);
            expect(state.turn).toBe(1);
        }
    });

    it('passes a full yard on one to five at the first roll', () =>
    {
        for (const die of [1, 2, 3, 4, 5])
        {
            const { state } = ok(apply(table(2), { kind: 'roll', seat: 0, die }));

            expect(state.turn, `a ${ die }`).toBe(1);
        }
    });
});

describe('a starred square never captures', () =>
{
    const colours = table(4).players.map((player) => player.colour);

    const progressAt = (colour: (typeof colours)[number], square: number) => (square - ENTRY[colour] + 52) % 52;

    it('leaves an opponent on every one of the eight stars, whoever lands there', () =>
    {
        let landings = 0;

        for (const square of SAFE)
        {
            colours.forEach((mover, moverIndex) =>
            {
                const landing = progressAt(mover, square);

                if (landing < 2 || landing >= RING_STEPS)
                {
                    return;
                }

                colours.forEach((victim, victimIndex) =>
                {
                    const standing = progressAt(victim, square);

                    if (victimIndex === moverIndex || standing >= RING_STEPS)
                    {
                        return;
                    }

                    let state = place(table(4), moverIndex, [landing - 2, YARD, YARD, YARD]);
                    state = withDie({ ...place(state, victimIndex, [standing, YARD, YARD, YARD]), turn: moverIndex }, 2);

                    const { state: after, events } = ok(apply(state, { kind: 'move', seat: moverIndex, piece: 0 }));

                    expect(kinds(events), `${ mover } onto ${ victim } at ${ square }`).not.toContain('capture');
                    expect(after.players[victimIndex].pieces).toEqual([standing, YARD, YARD, YARD]);
                    expect(ringIndex(mover, after.players[moverIndex].pieces[0])).toBe(square);
                    landings += 1;
                });
            });
        }

        expect(landings).toBeGreaterThan(SAFE.length * 4);
    });
});

describe('a token coming out of the yard captures on its own start square', () =>
{
    const progressOnRedStart = (colour: 'green' | 'yellow' | 'blue') => (ENTRY.red - ENTRY[colour] + 52) % 52;

    const captures = (events: GameEvent[]) => events.filter((event) => event.e === 'capture');

    it('sends home an opponent standing on the start square', () =>
    {
        const start = withDie(place(table(2), 1, [progressOnRedStart('yellow'), 10, YARD, YARD]), 6);

        expect(ringIndex('yellow', progressOnRedStart('yellow'))).toBe(ENTRY.red);

        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces[0]).toBe(0);
        expect(state.players[1].pieces).toEqual([YARD, 10, YARD, YARD]);
        expect(kinds(events)).toEqual(['enter', 'capture']);
        expect(captures(events)).toEqual([{ e: 'capture', seat: 0, owner: 0, piece: 0, victim: 1, victimPiece: 0 }]);
        expect(state.turn, 'the six still earns its roll').toBe(0);
        expect(state.die).toBeNull();
    });

    it('sends home every opponent token there, whatever its colour', () =>
    {
        let start = place(table(4), 1, [progressOnRedStart('green'), progressOnRedStart('green'), YARD, YARD]);
        start = place(start, 3, [progressOnRedStart('blue'), YARD, YARD, YARD]);
        start = withDie(start, 6);

        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 2 }));

        expect(state.players[0].pieces).toEqual([0, YARD, YARD, YARD]);
        expect(state.players[1].pieces).toEqual([YARD, YARD, YARD, YARD]);
        expect(state.players[3].pieces).toEqual([YARD, YARD, YARD, YARD]);
        expect(captures(events).map((event) => event.e === 'capture' && [event.victim, event.victimPiece])).toEqual([[1, 0], [1, 1], [3, 0]]);
    });

    it('captures nobody when a token moves onto any start square instead of coming out on it', () =>
    {
        let start = place(table(4), 0, [ENTRY.yellow - 2, YARD, YARD, YARD]);
        start = withDie(place(start, 1, [ENTRY.yellow - ENTRY.green, YARD, YARD, YARD]), 2);

        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(ringIndex('red', state.players[0].pieces[0])).toBe(ENTRY.yellow);
        expect(state.players[1].pieces[0]).toBe(ENTRY.yellow - ENTRY.green);
        expect(captures(events)).toEqual([]);
    });

    it('sends home an opponent block standing on the start square when a token comes out onto it', () =>
    {
        const onStart = progressOnRedStart('yellow');
        const start = withDie(place(table(2), 1, [onStart, onStart, 10, YARD]), 6);

        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(state.players[0].pieces[0]).toBe(0);
        expect(state.players[1].pieces).toEqual([YARD, YARD, 10, YARD]);
        expect(captures(events)).toEqual([
            { e: 'capture', seat: 0, owner: 0, piece: 0, victim: 1, victimPiece: 0 },
            { e: 'capture', seat: 0, owner: 0, piece: 0, victim: 1, victimPiece: 1 }
        ]);
    });
});

describe('two against two', () =>
{
    const EMPTY = [YARD, YARD, YARD, YARD];

    const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

    const SHARED = 30;

    const pairs = (first = 0) => create([0, 1, 2, 3], first, [0, 1, 0, 1]);

    const on = (colour: LudoColour, square: number) => (square - ENTRY[colour] + 52) % 52;

    const position = (rows: number[][], turn: number, die: number | null): LudoState =>
        ({ ...rows.reduce((state, pieces, seat) => place(state, seat, pieces), pairs(turn)), die });

    const offered = (state: LudoState, turn: number, die: number) => legalMoves({ ...state, turn, die });

    const captures = (events: GameEvent[]) => events.filter((event) => event.e === 'capture');

    const quit = (state: LudoState, seat: number) => ok(apply(state, { kind: 'forfeit', seat, reason: 'left' }));

    it('seats partners opposite: red with yellow against green with blue, each twenty-six squares from the other', () =>
    {
        expect(pairs().players.map((player) => [player.colour, player.side])).toEqual([['red', 0], ['green', 1], ['yellow', 0], ['blue', 1]]);
        expect(ringIndex('yellow', 0) - ringIndex('red', 0)).toBe(26);
        expect(ringIndex('blue', 0) - ringIndex('green', 0)).toBe(26);
    });

    it('keeps every side with its seat however the seats arrive', () =>
    {
        expect(create([2, 0, 3, 1], 0, [0, 0, 1, 1])).toEqual(pairs());
    });

    it('is dealt its sides by the adapter from the variant of the table', () =>
    {
        const dealt = (variant: Variant) => ludoEngine
            .create([0, 1, 2, 3], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant })
            .state.players.map((player) => player.side);

        expect(ludoEngine.formats).toContainEqual({ seats: 4, variant: 'teams' });
        expect(dealt('teams')).toEqual([0, 1, 0, 1]);
        expect(dealt('standard')).toEqual([0, 1, 2, 3]);
    });

    it('never sends a partner home: landing on one captures nothing and makes a block', () =>
    {
        expect(SAFE).not.toContain(SHARED);

        const start = position([[on('red', SHARED) - 3, YARD, YARD, YARD], EMPTY, [on('yellow', SHARED), YARD, YARD, YARD], [on('blue', SHARED) - 2, YARD, YARD, YARD]], 0, 3);
        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(kinds(events)).toEqual(['step']);
        expect(state.players[0].pieces[0]).toBe(on('red', SHARED));
        expect(state.players[2].pieces).toEqual([on('yellow', SHARED), YARD, YARD, YARD]);
        expect(offered(state, 3, 2), 'blue landing on the pair').toEqual([]);
        expect(offered(state, 3, 5), 'blue passing the pair').toEqual([]);
        expect(offered(state, 3, 1), 'blue stopping short of it').toEqual([0]);
    });

    it('sends home the opponent on its start square when a token comes out, and leaves the partner standing there', () =>
    {
        const start = position([EMPTY, [on('green', ENTRY.red), YARD, YARD, YARD], [on('yellow', ENTRY.red), YARD, YARD, YARD], EMPTY], 0, 6);
        const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 0 }));

        expect(events).toEqual([
            { e: 'enter', seat: 0, owner: 0, piece: 0 },
            { e: 'capture', seat: 0, owner: 0, piece: 0, victim: 1, victimPiece: 0 }
        ]);
        expect(state.players[0].pieces).toEqual([0, YARD, YARD, YARD]);
        expect(state.players[1].pieces).toEqual(EMPTY);
        expect(state.players[2].pieces).toEqual([on('yellow', ENTRY.red), YARD, YARD, YARD]);
    });

    describe('a pair of partners on one square', () =>
    {
        const red = on('red', SHARED);
        const green = on('green', SHARED);
        const yellow = on('yellow', SHARED);
        const blue = on('blue', SHARED);

        it('lets no opponent land on it or pass it', () =>
        {
            const state = position([[red, YARD, YARD, YARD], [green - 2, YARD, YARD, YARD], [yellow, YARD, YARD, YARD], [blue - 2, blue - 5, YARD, YARD]], 0, null);

            expect(offered(state, 3, 2), 'blue: one would land on it, the other stops short').toEqual([1]);
            expect(offered(state, 3, 5), 'blue: one would pass it, the other would land on it').toEqual([]);
            expect(offered(state, 1, 2), 'green landing on it').toEqual([]);
            expect(offered(state, 1, 3), 'green passing it').toEqual([]);
            expect(offered(state, 1, 1), 'green stopping short of it').toEqual([0]);

            const outcome = apply({ ...state, turn: 1, die: 2 }, { kind: 'move', seat: 1, piece: 0 });

            expect(outcome.ok ? null : outcome.reason).toBe('illegal-move');
        });

        it('lets both partners pass it and break it up, after which what is left can be sent home', () =>
        {
            const state = position([[red, red - 3, YARD, YARD], EMPTY, [yellow, yellow - 1, YARD, YARD], [blue - 2, YARD, YARD, YARD]], 0, null);

            expect(offered(state, 0, 5), 'red: off the pair, and past it').toEqual([0, 1]);
            expect(offered(state, 2, 5), 'yellow: off the pair, and past it').toEqual([0, 1]);

            const broken = ok(apply({ ...state, die: 5 }, { kind: 'move', seat: 0, piece: 0 })).state;
            const { state: after, events } = ok(apply({ ...broken, turn: 3, die: 2 }, { kind: 'move', seat: 3, piece: 0 }));

            expect(captures(events)).toEqual([{ e: 'capture', seat: 3, owner: 3, piece: 0, victim: 2, victimPiece: 0 }]);
            expect(after.players[2].pieces).toEqual([YARD, yellow - 1, YARD, YARD]);
        });

        it('takes no third token of the side', () =>
        {
            const state = position([[red, red - 3, YARD, YARD], EMPTY, [yellow, yellow - 1, YARD, YARD], EMPTY], 0, null);

            expect(offered(state, 0, 3), 'red joining the pair').toEqual([0]);
            expect(offered(state, 2, 1), 'yellow joining the pair').toEqual([0]);
            expect(apply({ ...state, die: 3 }, { kind: 'move', seat: 0, piece: 1 }).ok).toBe(false);
        });

        it('leaves no room on a start square either: no token comes out onto two of its partner', () =>
        {
            const there = on('red', ENTRY.yellow);
            const full = position([[there, there, YARD, YARD], EMPTY, EMPTY, EMPTY], 2, 6);
            const room = position([[there, 10, YARD, YARD], EMPTY, EMPTY, EMPTY], 2, 6);

            expect(legalMoves(full)).toEqual([]);
            expect(apply(full, { kind: 'move', seat: 2, piece: 0 }).ok).toBe(false);
            expect(legalMoves(room)).toEqual([0]);

            const { state, events } = ok(apply(room, { kind: 'move', seat: 2, piece: 0 }));

            expect(events).toEqual([{ e: 'enter', seat: 2, owner: 2, piece: 0 }]);
            expect(state.players[0].pieces).toEqual([there, 10, YARD, YARD]);
            expect(state.players[2].pieces).toEqual([0, YARD, YARD, YARD]);
        });

        it('blocks on a star and on the start square of another colour too', () =>
        {
            const at = (square: number) =>
                position([[on('red', square), YARD, YARD, YARD], EMPTY, [on('yellow', square), YARD, YARD, YARD], [on('blue', square) - 2, YARD, YARD, YARD]], 3, null);

            for (const square of [SAFE[1], ENTRY.green])
            {
                expect(SAFE).toContain(square);
                expect(offered(at(square), 3, 2), `landing on ${ square }`).toEqual([]);
                expect(offered(at(square), 3, 5), `passing ${ square }`).toEqual([]);
                expect(offered(at(square), 3, 1), `stopping short of ${ square }`).toEqual([0]);
            }
        });

        it('goes home whole when it stands on the start square of an opponent whose token comes out', () =>
        {
            const start = position([[on('red', ENTRY.green), YARD, YARD, YARD], EMPTY, [on('yellow', ENTRY.green), YARD, YARD, YARD], EMPTY], 1, 6);
            const { state, events } = ok(apply(start, { kind: 'move', seat: 1, piece: 0 }));

            expect(captures(events)).toEqual([
                { e: 'capture', seat: 1, owner: 1, piece: 0, victim: 0, victimPiece: 0 },
                { e: 'capture', seat: 1, owner: 1, piece: 0, victim: 2, victimPiece: 0 }
            ]);
            expect(state.players[0].pieces).toEqual(EMPTY);
            expect(state.players[2].pieces).toEqual(EMPTY);
            expect(state.players[1].pieces).toEqual([0, YARD, YARD, YARD]);
        });
    });

    describe('a player whose four are home', () =>
    {
        it('has not ended the game', () =>
        {
            const start = position([[FINISHED, FINISHED, FINISHED, FINISHED - 2], EMPTY, [10, YARD, YARD, YARD], EMPTY], 0, 2);
            const { state, events } = ok(apply(start, { kind: 'move', seat: 0, piece: 3 }));

            expect(kinds(events)).toEqual(['step', 'home']);
            expect(state.winner).toBeNull();
            expect(state.turn).toBe(1);
            expect(ludoEngine.finish(state)).toBeNull();
        });

        it('moves its partner tokens at once, with the roll the six that brought the fourth home earned', () =>
        {
            const start = position([[FINISHED, FINISHED, FINISHED, FINISHED - 6], EMPTY, [10, YARD, YARD, YARD], EMPTY], 0, null);

            expect(controlled(start)).toBe(0);

            const rolled = ok(apply(start, { kind: 'roll', seat: 0, die: 6 })).state;
            const home = ok(apply(rolled, { kind: 'move', seat: 0, piece: 3 })).state;

            expect(home).toMatchObject({ turn: 0, die: null, winner: null });
            expect(controlled(home)).toBe(2);

            const again = ok(apply(home, { kind: 'roll', seat: 0, die: 3 })).state;

            expect(legalMoves(again)).toEqual([0]);

            const { state, events } = ok(apply(again, { kind: 'move', seat: 0, piece: 0 }));

            expect(events).toEqual([{ e: 'step', seat: 0, owner: 2, piece: 0, from: 10, to: 13 }]);
            expect(state.players[2].pieces).toEqual([13, YARD, YARD, YARD]);
            expect(state.players[0].pieces).toEqual(HOME);
            expect(state.turn).toBe(1);
        });

        it('passes the turn on one to five, and moves its partner tokens when the turn comes round again', () =>
        {
            const start = position([[FINISHED, FINISHED, FINISHED, FINISHED - 2], EMPTY, [10, YARD, YARD, YARD], EMPTY], 0, 2);
            let state = ok(apply(start, { kind: 'move', seat: 0, piece: 3 })).state;

            state = ok(apply(state, { kind: 'roll', seat: 1, die: 1 })).state;
            state = ok(apply(state, { kind: 'roll', seat: 2, die: 1 })).state;

            expect(controlled(state), 'the partner still moves its own').toBe(2);

            state = ok(apply(state, { kind: 'move', seat: 2, piece: 0 })).state;
            state = ok(apply(state, { kind: 'roll', seat: 3, die: 1 })).state;

            expect(state.turn).toBe(0);

            const rolled = ok(apply(state, { kind: 'roll', seat: 0, die: 4 })).state;
            const { events } = ok(apply(rolled, { kind: 'move', seat: 0, piece: 0 }));

            expect(events).toEqual([{ e: 'step', seat: 0, owner: 2, piece: 0, from: 11, to: 15 }]);
        });

        it('is still the only seat that may act on its turn', () =>
        {
            const state = position([HOME, EMPTY, [10, YARD, YARD, YARD], EMPTY], 0, 3);
            const outcome = apply(state, { kind: 'move', seat: 2, piece: 0 });

            expect(outcome.ok ? null : outcome.reason).toBe('not-your-turn');
        });

        it('rolls again on a six that moves nothing of its partner, and still ends its turn on the third', () =>
        {
            const start = position([HOME, EMPTY, [FINISHED, FINISHED, FINISHED, FINISHED - 3], EMPTY], 0, null);
            const first = ok(apply(start, { kind: 'roll', seat: 0, die: 6 }));

            expect(first.events).toEqual([{ e: 'roll', seat: 0, die: 6 }]);
            expect(first.state).toMatchObject({ turn: 0, die: null });

            const second = ok(apply(first.state, { kind: 'roll', seat: 0, die: 6 })).state;
            const third = ok(apply(second, { kind: 'roll', seat: 0, die: 6 }));

            expect(third.events).toEqual([{ e: 'roll', seat: 0, die: 6 }, { e: 'pass', seat: 0, why: 'three-sixes' }]);
            expect(third.state.turn).toBe(1);
        });

        it('passes on one to five when nothing of its partner can move', () =>
        {
            const start = position([HOME, EMPTY, EMPTY, EMPTY], 0, null);
            const { state, events } = ok(apply(start, { kind: 'roll', seat: 0, die: 3 }));

            expect(events).toEqual([{ e: 'roll', seat: 0, die: 3 }, { e: 'pass', seat: 0, why: 'no-move' }]);
            expect(state.turn).toBe(1);
        });

        it('brings a partner token out on a six, onto the partner start square, and sends home the opponent standing there', () =>
        {
            const start = position([HOME, [on('green', ENTRY.yellow), YARD, YARD, YARD], EMPTY, EMPTY], 0, null);
            const rolled = ok(apply(start, { kind: 'roll', seat: 0, die: 6 })).state;

            expect(legalMoves(rolled)).toEqual([0]);

            const { state, events } = ok(apply(rolled, { kind: 'move', seat: 0, piece: 2 }));

            expect(events).toEqual([
                { e: 'enter', seat: 0, owner: 2, piece: 0 },
                { e: 'capture', seat: 0, owner: 2, piece: 0, victim: 1, victimPiece: 0 }
            ]);
            expect(state.players[2].pieces).toEqual([0, YARD, YARD, YARD]);
            expect(state.players[1].pieces).toEqual(EMPTY);
            expect(state.turn).toBe(0);
        });

        it('cannot bring a partner token out while one of that colour stands on its start square', () =>
        {
            expect(legalMoves(position([HOME, EMPTY, [0, YARD, YARD, YARD], EMPTY], 0, 6))).toEqual([0]);
        });

        it('is credited with what it does with its partner tokens', () =>
        {
            const out = position([HOME, [on('green', ENTRY.yellow), YARD, YARD, YARD], EMPTY, EMPTY], 0, null);
            const rolled = ok(apply(out, { kind: 'roll', seat: 0, die: 6 }));
            const entered = ok(apply(rolled.state, { kind: 'move', seat: 0, piece: 0 }));
            const homed = ok(apply(position([HOME, EMPTY, [FINISHED - 2, 10, YARD, YARD], EMPTY], 0, 2), { kind: 'move', seat: 0, piece: 0 }));
            const tally = ludoEngine.tally([...rolled.events, ...entered.events, ...homed.events]);

            expect(kinds(homed.events)).toEqual(['step', 'home']);
            expect(tally.get(0)).toEqual({ rolls: 1, sixes: 1, enters: 1, captures: 1, home: 1 });
            expect([...tally.keys()]).toEqual([0]);
        });
    });

    describe('winning', () =>
    {
        it('is the side whose eighth token comes home, and the finish names both seats', () =>
        {
            const start = position([HOME, EMPTY, [FINISHED, FINISHED, FINISHED, FINISHED - 1], EMPTY], 2, 1);
            const { state, events } = ok(apply(start, { kind: 'move', seat: 2, piece: 3 }));

            expect(events.at(-1)).toEqual({ e: 'finish', side: 0, seats: [0, 2] });
            expect(state).toMatchObject({ winner: 0, die: null });
            expect(ludoEngine.finish(state)).toEqual({ winners: [0, 2], unsettled: [], trailing: [] });
            expect(ludoEngine.turnOf(state)).toBeNull();

            const late = apply(state, { kind: 'roll', seat: 3, die: 6 });

            expect(late.ok ? null : late.reason).toBe('game-over');
        });

        it('can be a helper bringing home the last of its partner tokens', () =>
        {
            const start = position([EMPTY, HOME, EMPTY, [FINISHED, FINISHED, FINISHED, FINISHED - 1]], 1, 1);
            const { state, events } = ok(apply(start, { kind: 'move', seat: 1, piece: 3 }));

            expect(events).toEqual([
                { e: 'step', seat: 1, owner: 3, piece: 3, from: FINISHED - 1, to: FINISHED },
                { e: 'home', seat: 1, owner: 3, piece: 3 },
                { e: 'finish', side: 1, seats: [1, 3] }
            ]);
            expect(state.winner).toBe(1);
            expect(ludoEngine.finish(state)).toEqual({ winners: [1, 3], unsettled: [], trailing: [] });
        });
    });

    describe('a forfeit', () =>
    {
        it('ends the match for the other side, and leaves the board as it stood', () =>
        {
            const start = position([[20, YARD, YARD, YARD], [FINISHED, 30, YARD, YARD], [5, YARD, YARD, YARD], [40, YARD, YARD, YARD]], 1, 4);
            const { state, events } = quit(start, 1);

            expect(events).toEqual([{ e: 'forfeit', seat: 1, reason: 'left' }, { e: 'finish', side: 0, seats: [0, 2] }]);
            expect(state).toMatchObject({ winner: 0, die: null });
            expect(state.players.map((player) => player.pieces)).toEqual(start.players.map((player) => player.pieces));
            expect(state.players.map((player) => player.out)).toEqual([false, true, false, false]);
        });

        it('leaves everybody still at the table unsettled, and the partner trailing only where their side was behind on the board', () =>
        {
            const ending = (rows: number[][]) => ludoEngine.finish(quit(position(rows, 0, null), 1).state);
            const settled = (trailing: number[]) => ({ winners: [0, 2], unsettled: [0, 2, 3], trailing });

            expect(ending([[FINISHED, 20, YARD, YARD], [30, YARD, YARD, YARD], [5, YARD, YARD, YARD], [40, YARD, YARD, YARD]]), 'fewer tokens home').toEqual(settled([3]));
            expect(ending([[20, YARD, YARD, YARD], [30, YARD, YARD, YARD], [50, YARD, YARD, YARD], [10, YARD, YARD, YARD]]), 'level on tokens home, less far round').toEqual(settled([3]));
            expect(ending([[20, YARD, YARD, YARD], [30, YARD, YARD, YARD], [20, YARD, YARD, YARD], [10, YARD, YARD, YARD]]), 'level').toEqual(settled([]));
            expect(ending([[20, YARD, YARD, YARD], [FINISHED, YARD, YARD, YARD], [50, YARD, YARD, YARD], EMPTY]), 'ahead').toEqual(settled([]));
        });

        it('counts the tokens the quitter left on the board for their side, so a partner is not behind for being left alone', () =>
        {
            const { state } = quit(position([[20, YARD, YARD, YARD], [FINISHED, FINISHED, 40, YARD], [5, YARD, YARD, YARD], EMPTY], 0, null), 1);

            expect(ludoEngine.finish(state)).toEqual({ winners: [0, 2], unsettled: [0, 2, 3], trailing: [] });
        });

        it('is still a forfeit for a seat whose own four are home, and no seat of the side left standing trails a side that has stopped', () =>
        {
            const { state } = quit(position([[1, YARD, YARD, YARD], [FINISHED, FINISHED, FINISHED, 50], EMPTY, HOME], 0, null), 3);

            expect(state.winner).toBe(0);
            expect(ludoEngine.finish(state)).toEqual({ winners: [0, 2], unsettled: [0, 1, 2], trailing: [] });
        });
    });

    describe('the standings', () =>
    {
        it('place a side as one: tokens home and then distance, added up over both partners, and both share the place', () =>
        {
            const state = position([[FINISHED, 10, YARD, YARD], [FINISHED, FINISHED, YARD, YARD], [FINISHED, FINISHED, 3, YARD], [20, YARD, YARD, YARD]], 0, null);

            expect(placementsOf(state)).toEqual([
                { seat: 0, home: 1, distance: FINISHED + 10, place: 1 },
                { seat: 2, home: 2, distance: FINISHED * 2 + 3, place: 1 },
                { seat: 1, home: 2, distance: FINISHED * 2, place: 2 },
                { seat: 3, home: 0, distance: 20, place: 2 }
            ]);
        });

        it('break a tie on tokens home by how far round the side is', () =>
        {
            const state = position([[10, YARD, YARD, YARD], [30, YARD, YARD, YARD], [10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 0, null);

            expect(placementsOf(state).map((one) => [one.seat, one.place])).toEqual([[1, 1], [3, 1], [0, 2], [2, 2]]);
        });

        it('let two sides that got exactly as far share a place', () =>
        {
            const state = position([[10, YARD, YARD, YARD], [15, YARD, YARD, YARD], [10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 0, null);

            expect(placementsOf(state).map((one) => one.place)).toEqual([1, 1, 1, 1]);
        });

        it('put a side with a seat out last, however far ahead its board is', () =>
        {
            const { state } = quit(position([[1, YARD, YARD, YARD], [FINISHED, FINISHED, FINISHED, 50], EMPTY, HOME], 0, null), 3);

            expect(placementsOf(state).map((one) => [one.seat, one.place])).toEqual([[0, 1], [2, 1], [1, 2], [3, 2]]);
        });
    });
});
