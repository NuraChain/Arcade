import { describe, expect, it } from 'vitest';

import type { ForfeitReason } from '../src/domains/match/engine.ts';
import { ludoEngine } from '../src/domains/match/engines/ludo.ts';
import { movesOf, planOf, type Plan, type Quit, type SeatFacts } from '../src/domains/match/judge.ts';
import { FINISHED, YARD } from '../src/domains/match/ludo/board.ts';
import type { EngineAction, LudoState } from '../src/domains/match/ludo/state.ts';
import type { Format } from '../src/domains/match/sides.ts';

const seat = (facts: Partial<SeatFacts> & { seat: number; place: number }): SeatFacts => ({
    side: facts.seat,
    quitter: null,
    own: 20,
    unsettled: false,
    trailing: false,
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
    const plan = planOf({ seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2 })], after: 4, winners: [0], forfeited: false });

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
        expect(plan.verdicts.map((one) => one.paid)).toEqual(['full', 'full']);
    });
});

describe('two players, one of whom stopped', () =>
{
    it('is a rated loss for a quitter who had hardly played, and no contest for the other', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 9 }), seat({ seat: 1, place: 2, own: 1, quitter: walked(3) })],
            after: 4,
            winners: [0],
            forfeited: true
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
            winners: [0],
            forfeited: true
        });

        expect(resultsOf(plan)).toEqual(['void', 'abandoned']);
        expect([...swings(plan, evenly(2)).keys()]).toEqual([1]);
    });

    it('is a rated win once both had played their share', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 4 }), seat({ seat: 1, place: 2, own: 4, quitter: walked(20) })],
            after: 4,
            winners: [0],
            forfeited: true
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
            winners: [0],
            forfeited: true
        });
        const resign = planOf({
            seats: [seat({ seat: 0, place: 1 }), seat({ seat: 1, place: 2, own: 0, quitter: walked(9) })],
            after: 4,
            winners: [0],
            forfeited: true
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
            winners: [0],
            forfeited: true
        });

        expect(verdictOf(quitting(timedOut(9), 4), 1).paid).toBe('finish');
        expect(verdictOf(quitting(timedOut(9), 3), 1).paid).toBe('none');
        expect(verdictOf(quitting(walked(9), 4), 1).paid).toBe('none');
        expect(verdictOf(quitting(walked(9), 30), 1).paid).toBe('none');
        expect(verdictOf(quitting(walked(9), 4), 0).paid).toBe('finish');
    });

    it('pays nothing to a seat that did not count', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 1 }), seat({ seat: 1, place: 2, own: 0, quitter: timedOut(3) })],
            after: 4,
            winners: [0],
            forfeited: true
        });

        expect(verdictOf(plan, 0).result).toBe('void');
        expect(plan.verdicts.map((one) => one.paid)).toEqual(['none', 'none']);
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
            winners: [0, 2],
            forfeited: false
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
            winners: [0, 2],
            forfeited: true
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
            winners: [0, 2],
            forfeited: true
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
                seat({ seat: 1, place: 1, own: 8, unsettled: true }),
                seat({ seat: 2, place: 3, own: 8, quitter: walked(30) })
            ],
            after: 7,
            winners: [0],
            forfeited: true
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
            winners: [0],
            forfeited: false
        });

        expect(resultsOf(plan)).toEqual(['won', 'lost', 'lost']);
        expect(swings(plan, evenly(3))).toEqual(new Map([[0, 16], [1, -8], [2, -8]]));
    });

    it('names a winner seat that really won when the engine first named one that did not', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 2, unsettled: true }),
                seat({ seat: 1, place: 1, own: 8, unsettled: true }),
                seat({ seat: 2, place: 3, own: 8, quitter: walked(30) })
            ],
            after: 7,
            winners: [0],
            forfeited: true
        });

        expect(resultsOf(plan)).toEqual(['void', 'won', 'abandoned']);
        expect(plan.outcome).toBe('won');
        expect(plan.winnerSeat).toBe(1);
    });
});

describe('a hokm forfeit while the score was against somebody', () =>
{
    const teams = (facts: Partial<SeatFacts> & { seat: number; place: number }) => seat({ side: facts.seat % 2, ...facts });

    const threeHanded = planOf({
        seats: [
            seat({ seat: 0, place: 1, own: 8, unsettled: true }),
            seat({ seat: 1, place: 2, own: 8, unsettled: true, trailing: true }),
            seat({ seat: 2, place: 3, own: 8, quitter: walked(30) })
        ],
        after: 7,
        winners: [0],
        forfeited: true
    });

    const partnered = (quitter: Quit, trailing: boolean, own = { quitter: 9, partner: 9 }) => planOf({
        seats: [
            teams({ seat: 0, place: 1, own: 9, unsettled: true }),
            teams({ seat: 1, place: 2, own: own.quitter, quitter }),
            teams({ seat: 2, place: 1, own: 9, unsettled: true }),
            teams({ seat: 3, place: 2, own: own.partner, unsettled: true, trailing })
        ],
        after: 7,
        winners: [0, 2],
        forfeited: true
    });

    it('is no contest against the quitter for a survivor who trailed the other one', () =>
    {
        expect(verdictOf(threeHanded, 1)).toMatchObject({ result: 'void', counted: [], streak: 'keep', paid: 'none' });
        expect(swings(threeHanded, evenly(3)).has(1)).toBe(false);
    });

    it('is still a win over the quitter for the survivor who led', () =>
    {
        expect(resultsOf(threeHanded)).toEqual(['won', 'void', 'abandoned']);
        expect(verdictOf(threeHanded, 0).counted).toEqual([2]);
        expect(swings(threeHanded, evenly(3))).toEqual(new Map([[0, 16], [2, -16]]));
    });

    it('shares the rated loss of a walkout with the partner when their team was behind', () =>
    {
        const plan = partnered(walked(40), true);

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'won', 'lost']);
        expect(verdictOf(plan, 3)).toMatchObject({ counted: [0], streak: 'reset', paid: 'finish' });
        expect(swings(plan, evenly(4))).toEqual(new Map([[0, 16], [1, -16], [2, 16], [3, -16]]));
    });

    it('leaves that partner out of it when the walkout came before either of them had played their share', () =>
    {
        expect(resultsOf(partnered(walked(40), true, { quitter: 2, partner: 9 }))).toEqual(['void', 'abandoned', 'void', 'void']);
        expect(resultsOf(partnered(walked(40), true, { quitter: 9, partner: 2 }))[3]).toBe('void');
    });

    it('leaves that partner out of it when the team was level or ahead', () =>
    {
        const plan = partnered(walked(40), false);

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'won', 'void']);
        expect(swings(plan, evenly(4)).has(3)).toBe(false);
    });

    it('leaves that partner out of it when the clock took the quitter, however far behind', () =>
    {
        const plan = partnered(timedOut(40), true);

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'won', 'void']);
        expect(swings(plan, evenly(4)).has(3)).toBe(false);
    });
});

describe('what a win is worth when the last opponent quit', () =>
{
    it('moves the rating and pays the finish, and credits no win and no streak', () =>
    {
        const plan = planOf({
            seats: [seat({ seat: 0, place: 1, own: 9 }), seat({ seat: 1, place: 2, own: 9, quitter: walked(20) })],
            after: 4,
            winners: [0],
            forfeited: true
        });

        expect(verdictOf(plan, 0)).toMatchObject({ result: 'won', paid: 'finish', credit: false, streak: 'keep' });
        expect(verdictOf(plan, 1)).toMatchObject({ result: 'abandoned', paid: 'none', credit: false, streak: 'reset' });
        expect(swings(plan, evenly(2))).toEqual(new Map([[0, 16], [1, -16]]));
    });

    it('pays a game played out after a quitter in full', () =>
    {
        const plan = planOf({
            seats: [
                seat({ seat: 0, place: 1, own: 9 }),
                seat({ seat: 1, place: 3, own: 9, quitter: walked(20) }),
                seat({ seat: 2, place: 2, own: 9 })
            ],
            after: 3,
            winners: [0],
            forfeited: false
        });

        expect(verdictOf(plan, 0)).toMatchObject({ result: 'won', paid: 'full', credit: true, streak: 'add' });
        expect(verdictOf(plan, 2)).toMatchObject({ result: 'lost', paid: 'full', credit: false, streak: 'reset' });
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
            winners: [0],
            forfeited: false
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
            winners: [0],
            forfeited: true
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
            winners: [0],
            forfeited: true
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
            winners: [3],
            forfeited: true
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
            winners: [0],
            forfeited: true
        });
        const moved = swings(plan, new Map([[0, 1200], [1, 1400], [2, 1200]]));

        expect(moved.get(1)).toBeLessThan(0);
        expect(moved.get(2)).toBeLessThan(0);
    });
});

describe('ludo two against two, judged from what the engine reports', () =>
{
    const PAIRED: Format = { seats: 4, variant: 'teams' };

    const SEATS = [0, 1, 2, 3];

    const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

    const EMPTY = [YARD, YARD, YARD, YARD];

    const AFTER = ludoEngine.engagement(PAIRED).after;

    const BEHIND = [[FINISHED, 20, YARD, YARD], [30, YARD, YARD, YARD], [5, YARD, YARD, YARD], [40, YARD, YARD, YARD]];

    const AHEAD = [[20, YARD, YARD, YARD], [FINISHED, 30, YARD, YARD], [5, YARD, YARD, YARD], EMPTY];

    const dealt = (rows: number[][], turn = 0, die: number | null = null): LudoState =>
    {
        const { state } = ludoEngine.create(SEATS, { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'teams' });

        return { ...state, turn, die, players: state.players.map((player, seat) => ({ ...player, pieces: rows[seat] })) };
    };

    const played = (state: LudoState, action: EngineAction) =>
    {
        const applied = ludoEngine.apply(state, action, { die: () => 1 });

        if (!applied.ok)
        {
            throw new Error(applied.reason);
        }

        return applied.state;
    };

    const judged = (state: LudoState, quit: { seat: number; quitter: Quit } | null, own = [AFTER, AFTER, AFTER, AFTER]) =>
    {
        const ending = ludoEngine.finish(state)!;
        const places = ludoEngine.standings(state);

        return planOf({
            seats: SEATS.map((at) => seat({
                seat: at,
                side: ludoEngine.sideOf(at, PAIRED),
                place: places.find((one) => one.seat === at)!.place,
                quitter: quit?.seat === at ? quit.quitter : null,
                own: own[at],
                unsettled: ending.unsettled.includes(at),
                trailing: ending.trailing.includes(at)
            })),
            after: AFTER,
            winners: ending.winners,
            forfeited: quit !== null
        });
    };

    const gone = (rows: number[][], quitter: Quit, reason: ForfeitReason, own?: number[]) =>
        judged(played(dealt(rows), ludoEngine.forfeit(1, reason)), { seat: 1, quitter }, own);

    it('moves both partners by the same amount when their side brings all eight home, never against each other', () =>
    {
        const won = played(dealt([HOME, [30, YARD, YARD, YARD], [FINISHED, FINISHED, FINISHED, FINISHED - 1], [10, YARD, YARD, YARD]], 2, 1), { kind: 'move', seat: 2, piece: 3 });
        const plan = judged(won, null);
        const moved = swings(plan, new Map([[0, 1300], [1, 1250], [2, 1100], [3, 1150]]));

        expect(resultsOf(plan)).toEqual(['won', 'lost', 'won', 'lost']);
        expect(plan.verdicts.map((one) => one.place)).toEqual([1, 2, 1, 2]);
        expect(verdictOf(plan, 0)).toMatchObject({ counted: [1], paid: 'full', credit: true });
        expect(plan.winnerSeat).toBe(0);
        expect(moved.get(0)).toBe(moved.get(2));
        expect(moved.get(1)).toBe(moved.get(3));
        expect(swings(plan, evenly(4))).toEqual(new Map([[0, 16], [1, -16], [2, 16], [3, -16]]));
    });

    it('shares the rated loss of a walkout with the partner when their side was behind on the board', () =>
    {
        const plan = gone(BEHIND, walked(40), 'left');

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'won', 'lost']);
        expect(verdictOf(plan, 3)).toMatchObject({ counted: [0], streak: 'reset', paid: 'finish' });
        expect(verdictOf(plan, 0)).toMatchObject({ counted: [1], credit: false, paid: 'finish' });
        expect(swings(plan, evenly(4))).toEqual(new Map([[0, 16], [1, -16], [2, 16], [3, -16]]));
    });

    it('leaves that partner out of it when their side was ahead on the board, the tokens the quitter left counted', () =>
    {
        const plan = gone(AHEAD, walked(40), 'resign');

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'won', 'void']);
        expect(swings(plan, evenly(4)).has(3)).toBe(false);
    });

    it('leaves that partner out of it when the clock took the quitter, however far behind', () =>
    {
        const plan = gone(BEHIND, timedOut(40), 'timeout');

        expect(resultsOf(plan)).toEqual(['won', 'abandoned', 'won', 'void']);
        expect(swings(plan, evenly(4)).has(3)).toBe(false);
    });

    it('leaves everybody but the quitter out of it when the quitter had hardly rolled', () =>
    {
        const plan = gone(BEHIND, walked(4), 'left', [AFTER, AFTER - 1, AFTER, AFTER]);

        expect(resultsOf(plan)).toEqual(['void', 'abandoned', 'void', 'void']);
        expect(plan.outcome).toBe('abandoned');
        expect([...swings(plan, evenly(4)).keys()]).toEqual([1]);
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
            winners: [0],
            forfeited: false
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
            winners: [0],
            forfeited: false
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
            winners: [8],
            forfeited: true
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
            winners: [0],
            forfeited: true
        });

        expect(resultsOf(plan)).toEqual(['void', 'void', 'void']);
        expect(plan.outcome).toBe('abandoned');
        expect(plan.winnerSeat).toBeNull();
        expect(movesOf(plan, evenly(3))).toEqual([]);
    });
});
