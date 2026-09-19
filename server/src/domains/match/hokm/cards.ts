/**
 * A card is a NUMBER, 0 to 51, and everything else here is arithmetic over it.
 *
 * `{ suit: 'hearts', rank: 'queen' }` is the obvious shape and the wrong one for this codebase. A
 * hokm state holds four hands of thirteen and is written into `matches.state` AND into
 * `match_actions.state` on every single action - so the object form stores about twenty times the
 * bytes of an integer array, on the hottest row in the domain, for information a division recovers.
 * Ludo made the same call for its pieces and for the same reason.
 *
 * Suit-major, so `suitOf` is one division and a whole suit is one contiguous run. Rank ascends with
 * the number, so comparing two cards of one suit is `>` rather than a lookup - which is the entire
 * body of `trickWinner` below.
 *
 * `cardOf` and `nameOf` exist for the TESTS. A rules suite written in raw integers is one nobody can
 * read and nobody can check against a rule book, and a failure that says `expected 38 to be 25` says
 * nothing at all; `cardOf('hearts', 'K')` and `KH` say what the rule is about.
 */

export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

export type Suit = typeof SUITS[number];

/** Ascending, because the index IS the rank: a two is 0 and an ace is 12. */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type Rank = typeof RANKS[number];

export const DECK: readonly number[] = Array.from({ length: SUITS.length * RANKS.length }, (_, card) => card);

export function suitOf(card: number): Suit
{
    return SUITS[Math.floor(card / RANKS.length)];
}

export function rankOf(card: number): number
{
    return card % RANKS.length;
}

export function cardOf(suit: Suit, rank: Rank): number
{
    return SUITS.indexOf(suit) * RANKS.length + RANKS.indexOf(rank);
}

export function nameOf(card: number): string
{
    return `${ RANKS[rankOf(card)] }${ suitOf(card)[0].toUpperCase() }`;
}

/**
 * What this hand may legally play against the suit that was led.
 *
 * Follow suit if you can, anything if you cannot - and that second half is why this returns the
 * WHOLE hand rather than an empty list: a player void in the led suit is not stuck, they are free,
 * including free to trump. Returning nothing there would have read as "no legal move" and passed
 * the turn, which is a different game.
 *
 * `led` is null for the opening card of a trick, where everything is legal.
 */
export function legalCards(hand: readonly number[], led: Suit | null): number[]
{
    if (led === null)
    {
        return [...hand];
    }

    const following = hand.filter((card) => suitOf(card) === led);

    return following.length > 0 ? following : [...hand];
}

/**
 * Which of the cards played to a trick took it, as an INDEX into what was played.
 *
 * An index rather than a seat, because who sat where is the engine's business and this file has
 * never heard of a seat. The caller knows the play order it built the array from.
 *
 * The rule is the ordinary one: the highest trump wins, and if nobody trumped, the highest card of
 * the suit that was LED wins. A card of any other suit cannot win however high it is - that is what
 * makes discarding a losing ace ordinary rather than a bug.
 */
export function trickWinner(played: readonly number[], trump: Suit): number
{
    const led = suitOf(played[0]);

    let best = 0;

    for (let index = 1; index < played.length; index += 1)
    {
        const card = played[index];
        const suit = suitOf(card);
        const winning = played[best];
        const winningSuit = suitOf(winning);

        if (suit !== winningSuit)
        {
            if (suit === trump)
            {
                best = index;
            }

            continue;
        }

        if (suit === led || suit === trump)
        {
            best = rankOf(card) > rankOf(winning) ? index : best;
        }
    }

    return best;
}

/**
 * The deck this many players are dealt from.
 *
 * Three players get 51 cards, because 52 does not divide by three and Pagat's answer is to remove
 * *"one of the 2's"* - it does not say which, so this picks one and stays picked. A deck that
 * dropped a different two each hand would be a rule nobody wrote, and the lowest club is the least
 * consequential card in the pack.
 */
export function deckFor(seats: number): number[]
{
    return seats === 3 ? DECK.filter((card) => card !== cardOf('clubs', '2')) : [...DECK];
}
