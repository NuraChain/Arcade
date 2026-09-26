/**
 * Where each seat sits around a round table, from the reader's chair.
 *
 * Every card game this product will hold is played on one surface with people around it, so this is
 * arithmetic the hokm board, the poker table and the backgammon rail all want and none of them
 * should own. It answers in PLATE fractions - 0 to 1 across the felt - the way `game/layout.ts`
 * answers in fractions of the ludo plate, so the caller multiplies by whatever size the table
 * happens to be and nothing measures anything.
 *
 * **The reader is always at the bottom**, which is the one thing that makes a table readable: your
 * own card is nearest you and your partner's is across from you, whoever you are and whatever seat
 * the server gave you. A watcher has no seat, so the table is drawn from seat zero - somebody has to
 * be at the bottom and an arbitrary choice beats an empty edge.
 *
 * **Play passes to the RIGHT**, which is counter-clockwise at a real table and clockwise on a screen
 * looking down at one. So the next seat is drawn to the reader's right and the angle decreases. Get
 * that backwards and a four-handed game still works perfectly - partners are opposite either way -
 * while everybody watches the turn travel the wrong way round the table all evening.
 */

export interface Chair
{
    seat: number;

    /** The reader's own chair is 0, the next player 1, and so on around the table. */
    place: number;

    /** Where the card this seat played lies on the felt, as fractions of the plate. */
    x: number;

    /**
     * How far off square the card lies, in degrees.
     *
     * A card thrown onto a table does not land aligned to anything, and four cards at exactly the
     * same angle read as a diagram rather than as a trick. It is derived from the seat rather than
     * drawn, because a rotation that changed on every render would make the table twitch every time
     * anybody played.
     */
    y: number;

    tilt: number;
}

const RADIUS = 0.23;

export function aroundTable(seats: number, mine: number | null): Chair[]
{
    const reader = mine === null || mine < 0 ? 0 : mine;

    return Array.from({ length: seats }, (_, seat) =>
    {
        const place = (seat - reader + seats) % seats;
        const angle = Math.PI / 2 - (place / seats) * Math.PI * 2;

        return {
            seat,
            place,
            x: 0.5 + Math.cos(angle) * RADIUS,
            y: 0.5 + Math.sin(angle) * RADIUS,
            tilt: ((seat * 37) % 13) - 6
        };
    });
}
