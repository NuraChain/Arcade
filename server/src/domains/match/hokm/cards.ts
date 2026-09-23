import { DECK, SUITS, rankOf, suitOf, type Suit } from '../cards/cards.ts';

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
 * The deck this many players are dealt from, which is 52 minus however many twos it takes to divide.
 *
 * Fifty-two does not divide by three, so the three-handed game drops one two - Pagat says *"one of
 * the 2's"* without saying which, so this picks the lowest club and stays picked. The two-handed
 * game drops two of them for the same reason: fifty cards, twenty-five each, everything dealt.
 *
 * A deck that dropped a DIFFERENT two each hand would be a rule nobody wrote, so the choice is the
 * lowest suits in order and never anything else. Everything downstream is derived from the length
 * of what comes back, which is why adding a player count here is the whole change.
 */
export function deckFor(seats: number): number[]
{
    const dropped = seats === 3 ? 1 : (seats === 2 ? 2 : 0);

    return DECK.filter((card) => !(rankOf(card) === 0 && SUITS.indexOf(suitOf(card)) < dropped));
}
