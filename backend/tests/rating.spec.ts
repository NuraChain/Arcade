import { describe, expect, it } from 'vitest';

import { placementsOf } from '../src/domains/match/ludo/standings.ts';
import { rateField, type Standing } from '../src/domains/match/rating.ts';
import { FINISHED, YARD } from '../src/domains/match/ludo/board.ts';
import type { LudoState } from '../src/domains/match/ludo/state.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';

/**
 * The numbers a profile shows, from the three angles each of them can be quietly wrong.
 *
 * Every one of these is arithmetic that reads correctly and can be off by a sign, an index or a
 * comparison - and the symptom is never a crash, it is a rating that drifts the wrong way or an
 * achievement nobody can earn. None of it touches a database, so it runs in the default `npm test`.
 */

const standing = (seat: number, rating: number, place: number): Standing => ({ seat, rating, place });

describe('rating a field', () =>
{
    it('is ordinary Elo for two', () =>
    {
        const [winner, loser] = rateField([standing(0, 1200, 1), standing(1, 1200, 2)]);

        expect(winner.after).toBe(1216);
        expect(loser.after).toBe(1184);
    });

    it('takes more from the favourite when the favourite loses', () =>
    {
        const evenly = rateField([standing(0, 1200, 1), standing(1, 1200, 2)]);
        const upset = rateField([standing(0, 1200, 1), standing(1, 1600, 2)]);

        expect(upset[0].after - upset[0].before).toBeGreaterThan(evenly[0].after - evenly[0].before);
        expect(upset[1].before - upset[1].after).toBeGreaterThan(evenly[1].before - evenly[1].after);
    });

    it('does not care which seat a player sat in', () =>
    {
        const asIs = rateField([standing(0, 1300, 2), standing(1, 1100, 1), standing(2, 1200, 3)]);
        const shuffled = rateField([standing(2, 1200, 3), standing(0, 1300, 2), standing(1, 1100, 1)]);

        for (const move of asIs)
        {
            expect(shuffled.find((one) => one.seat === move.seat)?.after).toBe(move.after);
        }
    });

    /**
     * The whole reason a field is rated pairwise rather than "winner takes a fixed number": beating
     * a strong field has to be worth more than beating a weak one, or a rating says nothing about
     * who somebody played.
     */
    it('pays more for beating a strong field than a weak one', () =>
    {
        const strong = rateField([standing(0, 1200, 1), standing(1, 1800, 2), standing(2, 1800, 3)]);
        const weak = rateField([standing(0, 1200, 1), standing(1, 800, 2), standing(2, 800, 3)]);

        expect(strong[0].after).toBeGreaterThan(weak[0].after);
    });

    it('moves nobody when two players share a place', () =>
    {
        const drawn = rateField([standing(0, 1200, 1), standing(1, 1200, 1)]);

        expect(drawn.map((one) => one.after)).toEqual([1200, 1200]);
    });

    it('moves nothing at all for a field of one', () =>
    {
        expect(rateField([standing(0, 1200, 1)])).toEqual([{ seat: 0, before: 1200, after: 1200 }]);
    });

    /** The column is `between 100 and 4000`, so a write outside it strands a finished match. */
    it('stays inside what the column will take', () =>
    {
        expect(rateField([standing(0, 4000, 1), standing(1, 100, 2)])[0].after).toBeLessThanOrEqual(4000);
        expect(rateField([standing(0, 100, 2), standing(1, 4000, 1)])[0].after).toBeGreaterThanOrEqual(100);
    });
});

const board = (pieces: number[][], winner: number | null, out: boolean[] = []): LudoState => ({
    v: 1,
    game: 'ludo',
    players: pieces.map((set, index) => ({
        seat: index,
        colour: (['red', 'green', 'yellow', 'blue'] as const)[index],
        pieces: set,
        out: out[index] === true
    })),
    turn: 0,
    die: null,
    sixes: 0,
    rev: 1,
    winner
});

describe('placing a field', () =>
{
    const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

    it('puts the winner first and orders the rest by how far they got', () =>
    {
        const places = placementsOf(board([HOME, [10, 10, YARD, YARD], [40, YARD, YARD, YARD]], 0));

        expect(places.map((one) => one.seat)).toEqual([0, 2, 1]);
        expect(places.map((one) => one.place)).toEqual([1, 2, 3]);
    });

    it('counts tokens home before distance', () =>
    {
        const places = placementsOf(board([HOME, [FINISHED, 1, YARD, YARD], [50, 50, YARD, YARD]], 0));

        expect(places[1].seat).toBe(1);
        expect(places[1].home).toBe(1);
    });

    /**
     * A forfeit is last whatever the board says, or walking out while ahead would be a placement
     * somebody earned by leaving.
     */
    it('places anybody who walked out last, however well they were doing', () =>
    {
        const places = placementsOf(board([HOME, [50, 50, 50, 50], [1, YARD, YARD, YARD]], 0, [false, true, false]));

        expect(places.map((one) => one.seat)).toEqual([0, 2, 1]);
    });

    it('lets two players who got exactly as far share a place', () =>
    {
        const places = placementsOf(board([HOME, [12, YARD, YARD, YARD], [12, YARD, YARD, YARD]], 0));

        expect(places[1].place).toBe(2);
        expect(places[2].place).toBe(2);
    });
});

/**
 * Asked of the ENGINE, because the engine is the only thing that can tell a played win from an
 * emptied room. `record.ts` carried its own `outcomeOf` beside `ludoEngine.finish`, which read the
 * same board and gave the same answer - two copies of one rule, and the second game would have had
 * to remember to add a third.
 */
describe('what a win is', () =>
{
    const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

    const outcomeOf = (state: LudoState): string => ludoEngine.finish(state)?.outcome ?? 'abandoned';

    it('is four tokens home', () =>
    {
        expect(outcomeOf(board([HOME, [1, YARD, YARD, YARD]], 0))).toBe('won');
    });

    /**
     * The rating farm this exists to close: three accounts sit down, two walk out, and the engine
     * declares the third the winner because it is the last one playing. Recording that as a win
     * would pay a rating for an empty room.
     */
    it('is NOT being the last one left in the room', () =>
    {
        expect(outcomeOf(board([[3, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, [false, true]))).toBe('abandoned');
    });

    it('is not a game that never ended', () =>
    {
        expect(outcomeOf(board([[3, YARD, YARD, YARD], [4, YARD, YARD, YARD]], null))).toBe('abandoned');
    });
});
