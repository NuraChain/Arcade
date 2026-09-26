/**
 * Elo over a field, and nothing else in this file knows what game was played.
 *
 * Two players is ordinary Elo. Three and four are the same arithmetic applied to every PAIR in the
 * field - each player is scored against each other player as though they had played them one to one,
 * and the deltas are averaged over the opponents faced. That is the standard generalisation and it
 * has the property that matters here: beating three strong players moves a rating more than beating
 * three weak ones, and the result does not depend on how the seats happened to be numbered.
 *
 * Pure, and imported by nothing that touches a database. `rating.spec.ts` is what holds the
 * properties - symmetry, the draw case, the clamp - because every one of them is arithmetic that
 * looks right and can be wrong by a sign.
 */

/** The usual competition K. Big enough that a first win is visible, small enough to settle. */
const K = 32;

/**
 * The rating a table CHECK will accept, and the reason the clamp is here rather than at the edge:
 * a rating is a number people compare, so it must not run away, and a write refused by Postgres
 * after a match has already finished would strand the match rather than the rating.
 */
const FLOOR = 100;

const CEILING = 4000;

export interface Standing
{
    seat: number;

    rating: number;

    /** 1 is best. Equal places are a draw between those players and score half against each other. */
    place: number;
}

export interface RatingMove
{
    seat: number;

    before: number;

    after: number;
}

const expected = (mine: number, theirs: number): number => 1 / (1 + Math.pow(10, (theirs - mine) / 400));

const scored = (mine: number, theirs: number): number => (mine === theirs ? 0.5 : (mine < theirs ? 1 : 0));

const clamp = (rating: number): number => Math.min(CEILING, Math.max(FLOOR, rating));

/**
 * What each seat's rating becomes.
 *
 * A field of one moves nothing: there was nobody to be better than, and a match that ends with one
 * player left standing because everybody else walked out is exactly that case. It is recorded as a
 * result and it is not a rating event.
 */
export function rateField(standings: readonly Standing[]): RatingMove[]
{
    if (standings.length < 2)
    {
        return standings.map((one) => ({ seat: one.seat, before: one.rating, after: one.rating }));
    }

    return standings.map((mine) =>
    {
        const others = standings.filter((one) => one.seat !== mine.seat);

        const delta = others.reduce(
            (total, theirs) => total + (scored(mine.place, theirs.place) - expected(mine.rating, theirs.rating)),
            0
        );

        return {
            seat: mine.seat,
            before: mine.rating,
            after: clamp(Math.round(mine.rating + (K / others.length) * delta))
        };
    });
}
