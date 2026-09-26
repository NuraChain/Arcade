import { describe, expect, it } from 'vitest';

import { FINISHED, RING_STEPS, YARD, ENTRY, SAFE, ringIndex } from '../src/domains/match/ludo/board.ts';
import { apply, create, indexOfSeat, legalMoves } from '../src/domains/match/ludo/engine.ts';
import type { GameEvent, LudoState, Outcome } from '../src/domains/match/ludo/state.ts';

/**
 * The rules, proved without a database and without a browser.
 *
 * Every refusal is asserted by its exact reason rather than by "it did not work", because the
 * service maps those reasons onto different HTTP statuses and a test that only checks failure would
 * let two of them swap places silently.
 */

const table = (seats: number, first = 0): LudoState => create(Array.from({ length: seats }, (_, seat) => seat), first);

const place = (state: LudoState, seat: number, pieces: number[]): LudoState =>
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
        expect(create([2, 0, 1], 0)).toEqual(create([0, 1, 2], 0));
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
