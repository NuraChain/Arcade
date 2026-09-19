/**
 * Who won a hand, what it was worth, and who rules the next one.
 *
 * Pure and import-free like `cards.ts` beside it. Everything here is a function of trick counts and
 * a seat number - no state, no clock, no deck - which is what lets the whole rule book be checked
 * against Pagat in a spec with no engine anywhere near it.
 *
 * **Seats are numbered in PLAY order, and play is anticlockwise.** That one sentence is what makes
 * the rest arithmetic rather than a diagram: the player to your right is the next to play, so "to
 * the right" is `+ 1` and "to the left" is `- 1`, at every player count. Pagat gives the dealer and
 * the rotation in those words and they come out as one line each.
 */

/** Hands are to seven tricks, and taking the first seven of them is a kot. */
export const KOT_TRICKS = 7;

/** Every hand is thirteen tricks except the three-handed game, which removes a two and deals 17. */
export function trickCount(seats: number): number
{
    return seats === 3 ? 17 : 13;
}

/**
 * Partners sit opposite, so the two teams are the two parities. At two and three players there are
 * no teams and a side IS a seat, which is why every scoring function below takes SIDES rather than
 * seats and the caller decides what a side is.
 */
export function teamOf(seat: number): number
{
    return seat % 2;
}

/** The dealer is the player to the Hâkem's left, which in an anticlockwise game is the seat before. */
export function dealerOf(hakem: number, seats: number): number
{
    return (hakem + seats - 1) % seats;
}

/**
 * The Hâkem keeps the rank if their side won, and otherwise it passes to the player on their right.
 *
 * Pagat states it three times, once per player count, and all three are this: *"If the Hâkem's team
 * won the hand, the Hâkem retains the rank... If the other team wins, the turn to deal passes to the
 * right: the previous Hâkem deals and the player to his right becomes Hâkem."* The second half is
 * free - `dealerOf(hakem + 1)` IS the old Hâkem - so there is nothing to store and nothing that can
 * disagree with itself.
 */
export function nextHakem(hakem: number, seats: number, hakemHeld: boolean): number
{
    return hakemHeld ? hakem : (hakem + 1) % seats;
}

export interface HandResult
{
    /** The winning SIDE: a team at four players, a seat at two and three. */
    side: number;

    points: number;
}

/**
 * Two sides racing to seven tricks, which is the two-player game and the four-player one alike.
 *
 * The bonus is asymmetric and that asymmetry is the whole flavour of the game: sweeping the first
 * seven is worth 2 to the Hâkem's side and 3 to the other, because beating the player who chose the
 * trump suit that badly is the harder thing. Pagat calls them kot and hâkem koti.
 *
 * Checked the moment a side reaches seven, so "the other side having taken none" and "took the
 * FIRST seven" are the same test - there is no later moment at which a zero could still be a zero.
 */
export function duelResult(tricks: readonly number[], hakemSide: number): HandResult | null
{
    for (let side = 0; side < tricks.length; side += 1)
    {
        if (tricks[side] < KOT_TRICKS)
        {
            continue;
        }

        const swept = tricks.every((count, other) => other === side || count === 0);

        return { side, points: swept ? (side === hakemSide ? 2 : 3) : 1 };
    }

    return null;
}

/**
 * Three players, where a hand can end long before its seventeen tricks are played.
 *
 * The rules are in this order because the order is what decides the awkward cases:
 *
 * **A sweep ends it immediately** - all of the first seven, 2 points to the Hâkem or 3 to anybody
 * else, exactly as the two-sided game.
 *
 * **Then an unbeatable lead ends it**, and unbeatable means nobody can EQUAL it either. Pagat's own
 * examples: 7-4-3 plays on because a second player could still reach seven, 7-4-4 is over because
 * nobody else can pass six; 8-3-1 plays on, 8-2-2 is over.
 *
 * **And only if seventeen tricks are gone without either, the ODD PLAYER OUT wins.** *"If two of
 * players take the same number of tricks then the third player wins the hand"* - so 7-7-3 is won by
 * the player holding three, which is the most counter-intuitive rule in the game and the one
 * somebody will eventually try to correct. It is reachable only as the last branch, and that is not
 * an accident: a shared count anywhere BELOW the top is already settled by the lead above (9-4-4 is
 * a win for the nine, not for the four), so by the time this line runs the tie can only be at the
 * top. Seventeen is not divisible by three, so all three cannot tie.
 */
export function tripleResult(tricks: readonly number[], hakem: number, played: number): HandResult | null
{
    const remaining = trickCount(3) - played;

    for (let seat = 0; seat < tricks.length; seat += 1)
    {
        if (tricks[seat] >= KOT_TRICKS && tricks.every((count, other) => other === seat || count === 0))
        {
            return { side: seat, points: seat === hakem ? 2 : 3 };
        }
    }

    for (let seat = 0; seat < tricks.length; seat += 1)
    {
        const unbeatable = tricks.every((count, other) => other === seat || count + remaining < tricks[seat]);

        if (unbeatable)
        {
            return { side: seat, points: 1 };
        }
    }

    if (remaining > 0)
    {
        return null;
    }

    const best = Math.max(...tricks);
    const odd = tricks.findIndex((count) => count !== best);

    return odd < 0 ? null : { side: odd, points: 1 };
}

/** The first side to the target - seven by default - takes the match. */
export function matchWinner(points: readonly number[], target: number): number | null
{
    const reached = points.findIndex((total) => total >= target);

    return reached < 0 ? null : reached;
}
