import { START, rateField, unitPlace } from './rating.ts';

export type Result = 'won' | 'lost' | 'abandoned' | 'void';

export type Pay = 'full' | 'finish' | 'none';

export interface Quit
{
    walked: boolean;
    rev: number;
}

export interface SeatFacts
{
    seat: number;
    side: number;
    place: number;
    quitter: Quit | null;
    own: number;
    unsettled: boolean;
    trailing: boolean;
}

export interface Verdict
{
    seat: number;
    side: number;
    place: number;
    result: Result;
    counted: number[];
    paid: Pay;
    credit: boolean;
    streak: 'add' | 'reset' | 'keep';
}

export interface Plan
{
    verdicts: Verdict[];
    outcome: 'won' | 'abandoned';
    winnerSeat: number | null;
}

const leftLater = (one: SeatFacts, than: SeatFacts) =>
    one.quitter !== null && than.quitter !== null && one.quitter.rev > than.quitter.rev;

function placed(seats: readonly SeatFacts[]): SeatFacts[]
{
    const leftAfter = (mine: SeatFacts) =>
        seats.filter((other) => other.side !== mine.side && other.place === mine.place && leftLater(other, mine)).length;

    return seats.map((mine) => (mine.quitter === null ? mine : { ...mine, place: mine.place + leftAfter(mine) }));
}

function counts(mine: SeatFacts, own: readonly SeatFacts[], theirs: readonly SeatFacts[], after: number)
{
    if (mine.quitter !== null)
    {
        return !theirs.every((one) => leftLater(mine, one));
    }

    const quitters = theirs.filter((one) => one.quitter !== null);

    if (quitters.length > 0)
    {
        return !mine.trailing && mine.own >= after && quitters.every((one) => one.own >= after);
    }

    if (mine.unsettled && theirs.every((one) => one.unsettled))
    {
        return mine.trailing && mine.own >= after && own.some((one) => one.quitter?.walked === true && one.own >= after);
    }

    return true;
}

function resultOf(mine: SeatFacts, counted: readonly number[], beat: (side: number) => boolean): Result
{
    if (mine.quitter !== null)
    {
        return 'abandoned';
    }

    if (counted.length === 0)
    {
        return 'void';
    }

    return counted.every(beat) ? 'won' : 'lost';
}

const STREAK = { won: 'add', lost: 'reset', abandoned: 'reset', void: 'keep' } as const satisfies Record<Result, Verdict['streak']>;

function payOf(mine: SeatFacts, result: Result, after: number, forfeited: boolean): Pay
{
    if (result === 'void' || (mine.quitter !== null && (mine.quitter.walked || mine.own < after)))
    {
        return 'none';
    }

    return forfeited ? 'finish' : 'full';
}

export function planOf(input: { seats: readonly SeatFacts[]; after: number; winners: readonly number[]; forfeited: boolean }): Plan
{
    const seats = placed(input.seats);
    const sides = [...new Set(seats.map((one) => one.side))];
    const membersOf = (side: number) => seats.filter((one) => one.side === side);

    const verdicts = seats.map((mine): Verdict =>
    {
        const counted = sides.filter((side) => side !== mine.side && counts(mine, membersOf(mine.side), membersOf(side), input.after));
        const result = resultOf(mine, counted, (side) => unitPlace(seats, mine.side) < unitPlace(seats, side));
        const credit = result === 'won' && !input.forfeited;

        return {
            seat: mine.seat,
            side: mine.side,
            place: mine.place,
            result,
            counted,
            paid: payOf(mine, result, input.after, input.forfeited),
            credit,
            streak: result === 'won' && !credit ? 'keep' : STREAK[result]
        };
    });

    const won = verdicts.filter((one) => one.result === 'won').map((one) => one.seat);
    const named = input.winners[0];

    return {
        verdicts,
        outcome: won.length > 0 ? 'won' : 'abandoned',
        winnerSeat: named !== undefined && won.includes(named) ? named : (won.length > 0 ? Math.min(...won) : null)
    };
}

export function movesOf(plan: Plan, ratings: ReadonlyMap<number, number>)
{
    const counted = new Map(plan.verdicts.map((one) => [one.seat, one.counted]));

    return rateField(
        plan.verdicts.map((one) => ({ seat: one.seat, side: one.side, place: one.place, rating: ratings.get(one.seat) ?? START })),
        (seat, side) => counted.get(seat)?.includes(side) === true
    );
}
