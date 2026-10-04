import { describe, expect, it } from 'vitest';

import { placementsOf } from '../src/domains/match/ludo/standings.ts';
import { planOf } from '../src/domains/match/judge.ts';
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

const standing = (seat: number, rating: number, place: number, side = seat): Standing => ({ seat, side, rating, place });

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
        expect(rateField([standing(0, 1200, 1)])).toEqual([]);
    });

    /** The column is `between 100 and 4000`, so a write outside it strands a finished match. */
    it('stays inside what the column will take', () =>
    {
        expect(rateField([standing(0, 4000, 1), standing(1, 100, 2)])[0].after).toBeLessThanOrEqual(4000);
        expect(rateField([standing(0, 100, 2), standing(1, 4000, 1)])[0].after).toBeGreaterThanOrEqual(100);
    });
});

describe('rating sides', () =>
{
    const swingOf = (moves: ReturnType<typeof rateField>, seat: number) =>
    {
        const move = moves.find((one) => one.seat === seat)!;

        return move.after - move.before;
    };

    it('rates a side as one player at its members mean, so partners move by the same amount', () =>
    {
        const moves = rateField([standing(0, 1300, 1, 0), standing(1, 1250, 2, 1), standing(2, 1100, 1, 0), standing(3, 1150, 2, 1)]);

        expect([0, 1, 2, 3].map((seat) => swingOf(moves, seat))).toEqual([16, -16, 16, -16]);
    });

    it('never scores partners against each other', () =>
    {
        const lopsided = rateField([standing(0, 1800, 1, 0), standing(1, 1200, 2, 1), standing(2, 600, 1, 0), standing(3, 1200, 2, 1)]);

        expect(swingOf(lopsided, 0)).toBe(swingOf(lopsided, 2));
        expect(swingOf(lopsided, 1)).toBe(swingOf(lopsided, 3));
    });

    it('moves a seat nothing is counted against not at all', () =>
    {
        const moves = rateField(
            [standing(0, 1200, 1), standing(1, 1200, 2), standing(2, 1200, 3)],
            (seat) => seat !== 1
        );

        expect(moves.map((one) => one.seat)).toEqual([0, 2]);
    });

    it('rates a quitter against a field that is not rated against them', () =>
    {
        const moves = rateField(
            [standing(0, 1200, 1), standing(1, 1200, 2), standing(2, 1200, 3)],
            (seat, side) => seat === 2 || side !== 2
        );

        expect([0, 1, 2].map((seat) => swingOf(moves, seat))).toEqual([16, -16, -16]);
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

describe('what a ludo game reports', () =>
{
    const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

    it('names the seat with four tokens home and leaves nobody unsettled', () =>
    {
        expect(ludoEngine.finish(board([HOME, [1, YARD, YARD, YARD]], 0))).toEqual({ winners: [0], unsettled: [] });
    });

    it('names the last seat left in the room too, and the judge makes that no contest', () =>
    {
        const emptied = board([[3, YARD, YARD, YARD], [YARD, YARD, YARD, YARD]], 0, [false, true]);
        const ending = ludoEngine.finish(emptied)!;
        const places = ludoEngine.standings(emptied);
        const plan = planOf({
            seats: places.map((one) => ({
                seat: one.seat,
                side: ludoEngine.sideOf(one.seat, 2),
                place: one.place,
                quitter: one.seat === 1 ? { walked: true, rev: 2 } : null,
                own: 1,
                unsettled: ending.unsettled.includes(one.seat)
            })),
            after: ludoEngine.engagement(2).after,
            winners: ending.winners
        });

        expect(ending).toEqual({ winners: [0], unsettled: [] });
        expect(plan.verdicts.find((one) => one.seat === 0)?.result).toBe('void');
        expect(plan.outcome).toBe('abandoned');
    });

    it('reports nothing for a game that never ended', () =>
    {
        expect(ludoEngine.finish(board([[3, YARD, YARD, YARD], [4, YARD, YARD, YARD]], null))).toBeNull();
    });
});
