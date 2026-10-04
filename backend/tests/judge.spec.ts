import { describe, expect, it } from 'vitest';

import { movesOf, planOf, type Plan, type SeatFacts } from '../src/domains/match/judge.ts';

const seat = (facts: Partial<SeatFacts> & { seat: number; place: number }): SeatFacts => ({
    side: facts.seat,
    quitter: null,
    own: 20,
    unsettled: false,
    ...facts
});

const walked = (rev: number) => ({ walked: true, rev });

const timedOut = (rev: number) => ({ walked: false, rev });

const verdictOf = (plan: Plan, at: number) => plan.verdicts.find((one) => one.seat === at)!;

const resultsOf = (plan: Plan) => plan.verdicts.map((one) => one.result);

const evenly = (count: number) => new Map(Array.from({ length: count }, (_, at) => [at, 1200]));

const swings = (plan: Plan, ratings: ReadonlyMap<number, number>) =>
    new Map(movesOf(plan, ratings).map((move) => [move.seat, move.after - move.before]));

describe('two players who played it out', () =>
{
    const plan = planOf({ seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2 })], after: 4, winners: [0] });

    it('rates the winner up and the loser down, and the match is won', () =>
    {
        expect(resultsOf(plan)).toEqual(['won', 'lost']);
        expect(plan.outcome).toBe('won');
        expect(plan.winnerSeat).toBe(0);
        expect(movesOf(plan, evenly(2))).toEqual([{ seat: 0, before: 1200, after: 1216 }, { seat: 1, before: 1200, after: 1184 }]);
    });

    it('carries the streak on for the winner and breaks it for the loser', () =>
    {
        expect(plan.verdicts.map((one) => one.streak)).toEqual(['add', 'reset']);
    });

    it('pays them both', () =>
    {
        expect(plan.verdicts.map((one) => one.paid)).toEqual([true, true]);
    });
});

describe('two players, one of whom stopped', () =>
{
    it('is a rated loss for a quitter who had hardly played, and no contest for the other', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 9 }), seat({ seat: 1, place: 2, own: 1, quitter: walked(3) })],
            after: 4,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['void', 'abandoned']);
        expect(verdictOf(plan, 0).counted).toEqual([]);
        expect(verdictOf(plan, 0).streak).toBe('keep');
        expect(plan.outcome).toBe('abandoned');
        expect(plan.winnerSeat).toBeNull();
        expect(movesOf(plan, evenly(2))).toEqual([{ seat: 1, before: 1200, after: 1184 }]);
    });

    it('is no contest for a survivor who had hardly played, however long the quitter stayed', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 2 }), seat({ seat: 1, place: 2, own: 30, quitter: walked(60) })],
            after: 4,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['void', 'abandoned']);
        expect([...swings(plan, evenly(2)).keys()]).toEqual([1]);
    });

    it('is a rated win once both had played their share', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 4 }), seat({ seat: 1, place: 2, own: 4, quitter: walked(20) })],
            after: 4,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['won', 'abandoned']);
        expect(plan.outcome).toBe('won');
        expect(plan.winnerSeat).toBe(0);
        expect(swings(plan, evenly(2))).toEqual(new Map([[0, 16], [1, -16]]));
    });

    it('charges a timeout the same rated loss as a walkout', () =>
    {
        const timeout = planOf({
            seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2, own: 0, quitter: timedOut(9) })],
            after: 4,
            winners: [0]
        });
        const resign = planOf({
            seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2, own: 0, quitter: walked(9) })],
            after: 4,
            winners: [0]
        });

        expect(verdictOf(timeout, 1).result).toBe('abandoned');
        expect(verdictOf(resign, 1).result).toBe('abandoned');
        expect(swings(timeout, evenly(2)).get(1)).toBe(-16);
        expect(swings(resign, evenly(2)).get(1)).toBe(-16);
    });

    it('pays a timeout that had played its share, and never a walkout or a seat that never played', () =>
    {
        const quitting = (quitter: { walked: boolean; rev: number }, own: number) => planOf({
            seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2, own, quitter })],
            after: 4,
            winners: [0]
        });

        expect(verdictOf(quitting(timedOut(9), 4), 1).paid).toBe(true);
        expect(verdictOf(quitting(timedOut(9), 3), 1).paid).toBe(false);
        expect(verdictOf(quitting(walked(9), 4), 1).paid).toBe(false);
        expect(verdictOf(quitting(walked(9), 30), 1).paid).toBe(false);
        expect(verdictOf(quitting(walked(9), 4), 0).paid).toBe(true);
    });

    it('pays nothing to a seat that did not count', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 1 }), seat({ seat: 1, place: 2, own: 0, quitter: timedOut(3) })],
            after: 4,
            winners: [0]
        });

        expect(verdictOf(plan, 0).result).toBe('void');
        expect(plan.verdicts.map((one) => one.paid)).toEqual([false, false]);
    });
});

describe('four-handed hokm', () =>
{
    const teams = (facts: Partial<SeatFacts> & { seat: number; place: number }) => seat({ side: facts.seat % 2, ...facts });

    it('moves partners as one side, by the same amount, never against each other', () =>
    {
        const plan = planOf({
            seats: [teams({ seat: 0, place: 1 }), teams({ seat: 1, place: 2 }), teams({ seat: 2, place: 1 }), teams({ seat: 3, place: 2 })],
            after: 7,
            winners: [0, 2]
        });
        const moved = swings(plan, new Map([[0, 1300], [1, 1250], [2, 1100], [3, 1150]]));

        expect(resultsOf(plan)).toEqual(['won', 'lost', 'won', 'lost']);
        expect(verdictOf(plan, 0).counted).toEqual([1]);
        expect(moved.get(0)).toBe(moved.get(2));
        expect(moved.get(1)).toBe(moved.get(3));
        expect(swings(plan, evenly(4))).toEqual(new Map([[0, 16], [1, -16], [2, 16], [3, -16]]));
    });

    it('leaves the partner of a quitter out of it, and the opponents too when the quitter had barely played', () =>
    {
        const plan = planOf({
            seats: [
                teams({ seat: 0, place: 1, own: 9, unsettled: true }),
                teams({ seat: 1, place: 2, own: 3, quitter: walked(14) }),
                teams({ seat: 2, place: 1, own: 9, unsettled: true }),
                teams({ seat: 3, place: 2, own: 9, unsettled: true })
            ],
            after: 7,
            winners: [0, 2]
        });

        expect(resultsOf(plan)).toEqual(['void', 'abandoned', 'void', 'void']);
        expect(verdictOf(plan, 3).streak).toBe('keep');
        expect(plan.outcome).toBe('abandoned');
        expect(plan.winnerSeat).toBeNull();
        expect([...swings(plan, evenly(4)).keys()]).toEqual([1]);
        expect(swings(plan, evenly(4)).get(1)).toBe(-16);
    });

    it('pays the opponents of a quitter who had played a hand, and still leaves the partner out', () =>
    {
        const plan = planOf({
            seats: [
                teams({ seat: 0, place: 1, own: 9, unsettled: true }),
                teams({ seat: 1, place: 2, own: 8, quitter: timedOut(40) }),
                teams({ seat: 2, place: 1, own: 7, unsettled: true }),
                teams({ seat: 3, place: 2, own: 9, unsettled: true })
            ],
            after: 7,
            winners: [0, 2]
        });

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'won', 'void']);
        expect(plan.outcome).toBe('won');
        expect(plan.winnerSeat).toBe(0);
        expect(swings(plan, evenly(4)).has(3)).toBe(false);
    });
});

describe('three-handed hokm', () =>
{
    it('never rates the two who were left against each other, and each beats the quitter', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 8, unsettled: true }),
                seat({ seat: 1, place: 2, own: 8, unsettled: true }),
                seat({ seat: 2, place: 3, own: 8, quitter: walked(30) })
            ],
            after: 7,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['won', 'won', 'abandoned']);
        expect(verdictOf(plan, 0).counted).toEqual([2]);
        expect(verdictOf(plan, 1).counted).toEqual([2]);
        expect(verdictOf(plan, 2).counted).toEqual([0, 1]);
        expect(swings(plan, evenly(3))).toEqual(new Map([[0, 16], [1, 16], [2, -16]]));
    });

    it('scores two seats level on points as a draw between them', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2 }), seat({ seat: 2, place: 2 })],
            after: 7,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['won', 'lost', 'lost']);
        expect(swings(plan, evenly(3))).toEqual(new Map([[0, 16], [1, -8], [2, -8]]));
    });

    it('names a winner seat that really won when the engine first named one that did not', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 2, unsettled: true }),
                seat({ seat: 1, place: 2, own: 8, unsettled: true }),
                seat({ seat: 2, place: 3, own: 8, quitter: walked(30) })
            ],
            after: 7,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['void', 'won', 'abandoned']);
        expect(plan.outcome).toBe('won');
        expect(plan.winnerSeat).toBe(1);
    });
});

describe('ludo', () =>
{
    it('rates a quitter who never rolled against everybody, and nobody against them', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1 }),
                seat({ seat: 1, place: 2 }),
                seat({ seat: 2, place: 3 }),
                seat({ seat: 3, place: 4, own: 0, quitter: walked(2) })
            ],
            after: 6,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['won', 'lost', 'lost', 'abandoned']);
        expect(verdictOf(plan, 3).counted).toEqual([0, 1, 2]);
        expect(verdictOf(plan, 0).counted).toEqual([1, 2]);
        expect(verdictOf(plan, 1).counted).toEqual([0, 2]);
    });

    it('ranks two quitters the engine placed level by who left later, and each takes a loss', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 8 }),
                seat({ seat: 1, place: 2, own: 8, quitter: walked(10) }),
                seat({ seat: 2, place: 2, own: 8, quitter: timedOut(20) })
            ],
            after: 6,
            winners: [0]
        });

        expect(plan.verdicts.map((one) => one.place)).toEqual([1, 3, 2]);
        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'abandoned']);

        const moved = swings(plan, evenly(3));

        expect(moved.get(2)).toBe(-16);
        expect(moved.get(1)).toBe(-16);
        expect(moved.get(0)).toBe(16);
    });

    it('rates an earlier quitter against a later one, and never the later one against the earlier', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 1 }),
                seat({ seat: 1, place: 2, own: 8, quitter: walked(10) }),
                seat({ seat: 2, place: 2, own: 8, quitter: walked(20) })
            ],
            after: 6,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['void', 'abandoned', 'abandoned']);
        expect(verdictOf(plan, 1).counted).toEqual([0, 2]);
        expect(verdictOf(plan, 2).counted).toEqual([0]);
        expect(plan.outcome).toBe('abandoned');
        expect(swings(plan, evenly(3))).toEqual(new Map([[1, -16], [2, -16]]));
    });

    it('gains nothing for the last of three to walk out, at a table left to one who never rolled', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 4, own: 0, quitter: walked(1) }),
                seat({ seat: 1, place: 4, own: 0, quitter: walked(2) }),
                seat({ seat: 2, place: 4, own: 0, quitter: walked(3) }),
                seat({ seat: 3, place: 1, own: 2 })
            ],
            after: 6,
            winners: [3]
        });
        const moved = swings(plan, evenly(4));

        expect(resultsOf(plan)).toEqual(['abandoned', 'abandoned', 'abandoned', 'void']);
        expect(verdictOf(plan, 2).counted).toEqual([3]);
        expect([...moved.keys()]).toEqual([0, 1, 2]);
        expect([...moved.values()].every((delta) => delta < 0)).toBe(true);
    });

    it('gains nothing for leaving after a stronger quitter', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1 }),
                seat({ seat: 1, place: 2, quitter: walked(10) }),
                seat({ seat: 2, place: 2, quitter: walked(20) })
            ],
            after: 6,
            winners: [0]
        });
        const moved = swings(plan, new Map([[0, 1200], [1, 1400], [2, 1200]]));

        expect(moved.get(1)).toBeLessThan(0);
        expect(moved.get(2)).toBeLessThan(0);
    });
});

describe('poker at three seats', () =>
{
    it('rates a bust by the order of elimination, and against a quitter only if both played', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 5 }),
                seat({ seat: 1, place: 2, own: 5, quitter: walked(80) }),
                seat({ seat: 2, place: 3, own: 5 })
            ],
            after: 3,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'lost']);
        expect(verdictOf(plan, 2).counted).toEqual([0, 1]);
        expect(verdictOf(plan, 1).counted).toEqual([0, 2]);
    });

    it('does not rate a bust against a quitter who never acted', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 5 }),
                seat({ seat: 1, place: 2, own: 0, quitter: timedOut(80) }),
                seat({ seat: 2, place: 3, own: 5 })
            ],
            after: 3,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'lost']);
        expect(verdictOf(plan, 2).counted).toEqual([0]);
        expect(verdictOf(plan, 0).counted).toEqual([2]);
    });
});

describe('poker at nine seats', () =>
{
    it('charges every one of eight quitters a loss, the last to leave included', () =>
    {
        const plan = planOf({
            seats: [
                ...Array.from({ length: 8 }, (_, at) => seat({ seat: at, place: 9 - at, own: 0, quitter: walked(at + 1) })),
                seat({ seat: 8, place: 1, own: 0 })
            ],
            after: 3,
            winners: [8]
        });
        const moved = swings(plan, evenly(9));

        expect(verdictOf(plan, 7).counted).toEqual([8]);
        expect(verdictOf(plan, 8).result).toBe('void');
        expect([...moved.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect([...moved.values()].every((delta) => delta < 0)).toBe(true);
    });
});

describe('a match nothing settled', () =>
{
    it('is no contest for everybody and moves nothing', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, unsettled: true }),
                seat({ seat: 1, place: 1, unsettled: true }),
                seat({ seat: 2, place: 1, unsettled: true })
            ],
            after: 7,
            winners: [0]
        });

        expect(resultsOf(plan)).toEqual(['void', 'void', 'void']);
        expect(plan.outcome).toBe('abandoned');
        expect(plan.winnerSeat).toBeNull();
        expect(movesOf(plan, evenly(3))).toEqual([]);
    });
});
