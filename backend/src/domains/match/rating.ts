const K = 32;

const FLOOR = 100;

const CEILING = 4000;

export const START = 1200;

export interface Standing
{
    seat: number;

    side: number;

    rating: number;

    place: number;
}

export interface RatingMove
{
    seat: number;

    before: number;

    after: number;
}

const expected = (mine: number, theirs: number) => 1 / (1 + Math.pow(10, (theirs - mine) / 400));

const scored = (mine: number, theirs: number): number => (mine === theirs ? 0.5 : (mine < theirs ? 1 : 0));

const clamp = (rating: number) => Math.min(CEILING, Math.max(FLOOR, rating));

export function unitPlace(standings: readonly Pick<Standing, 'side' | 'place'>[], side: number)
{
    return Math.min(...standings.filter((one) => one.side === side).map((one) => one.place));
}

function unitRating(standings: readonly Standing[], side: number)
{
    const members = standings.filter((one) => one.side === side);

    return members.reduce((total, one) => total + one.rating, 0) / members.length;
}

export function rateField(standings: readonly Standing[], counts: (seat: number, side: number) => boolean = () => true): RatingMove[]
{
    const sides = [...new Set(standings.map((one) => one.side))];

    return standings.flatMap((mine) =>
    {
        const against = sides.filter((side) => side !== mine.side && counts(mine.seat, side));

        if (against.length === 0)
        {
            return [];
        }

        const place = unitPlace(standings, mine.side);
        const rating = unitRating(standings, mine.side);

        const delta = against.reduce(
            (total, side) => total + (scored(place, unitPlace(standings, side)) - expected(rating, unitRating(standings, side))),
            0
        );

        return [{
            seat: mine.seat,
            before: mine.rating,
            after: clamp(Math.round(mine.rating + (K / against.length) * delta))
        }];
    });
}
