import { describe, expect, it } from 'vitest';

import { DECK, RANKS, SUITS, cardOf, nameOf, rankOf, suitOf } from '../src/domains/match/cards/cards.ts';
import { autoCard, deckFor, legalCards, trickWinner } from '../src/domains/match/hokm/cards.ts';
import { dealerOf, duelResult, matchWinner, nextHakem, teamOf, trickCount, tripleResult, winningTricks } from '../src/domains/match/hokm/scoring.ts';

/**
 * Hokm's rule book, checked against the one this product says it implements.
 *
 * Every case here is either arithmetic somebody can get backwards or a sentence quoted from
 * pagat.com/whist/hokm.html - and the quoted ones are named after the rule rather than after the
 * function, because the thing that has to survive a refactor is the RULE. The three-player early
 * stop and the 7-7-3 tie are written out one example per Pagat's own, because those are the two
 * places a reasonable person would "fix" the code into a different game.
 *
 * No engine, no state, no database. These are functions of trick counts and seat numbers.
 */

describe('a card is a number', () =>
{
    it('round trips every one of the fifty-two', () =>
    {
        expect(DECK).toHaveLength(52);

        for (const suit of SUITS)
        {
            for (const rank of RANKS)
            {
                const card = cardOf(suit, rank);

                expect(suitOf(card), nameOf(card)).toBe(suit);
                expect(RANKS[rankOf(card)], nameOf(card)).toBe(rank);
            }
        }

        expect(new Set(DECK).size).toBe(52);
    });

    /**
     * The index IS the rank, so the whole of `trickWinner` can compare two cards with `>`. An ace
     * ranking below a two would be invisible in every other test and decide every trick.
     */
    it('ranks an ace above a king above a two', () =>
    {
        expect(rankOf(cardOf('spades', 'A'))).toBeGreaterThan(rankOf(cardOf('spades', 'K')));
        expect(rankOf(cardOf('spades', 'K'))).toBeGreaterThan(rankOf(cardOf('spades', '2')));
        expect(rankOf(cardOf('clubs', '10'))).toBeGreaterThan(rankOf(cardOf('clubs', '9')));
    });

    /**
     * Twos come off the bottom in a fixed order and only as many as the division needs - one for
     * three players, two for the two-handed house rule, none for four. Dropping a different two each
     * hand would be a rule nobody wrote, and a deck that did not divide would leave cards undealt.
     */
    it('strips only as many twos as the seat count needs', () =>
    {
        expect(deckFor(4)).toHaveLength(52);
        expect(deckFor(3)).toHaveLength(51);
        expect(deckFor(2)).toHaveLength(50);

        expect(deckFor(4).filter((card) => rankOf(card) === 0)).toHaveLength(4);
        expect(deckFor(3).filter((card) => rankOf(card) === 0)).toHaveLength(3);
        expect(deckFor(2).filter((card) => rankOf(card) === 0)).toHaveLength(2);

        expect(deckFor(2)).not.toContain(cardOf('clubs', '2'));
        expect(deckFor(2)).not.toContain(cardOf('diamonds', '2'));
        expect(deckFor(2)).toContain(cardOf('hearts', '2'));
    });

    /**
     * The deck is stripped until it divides, so every card is dealt and nothing is left over. That
     * is what lets `trickCount` be a division rather than a table, and it is the only thing the
     * two-handed house rule changes: drop two of the twos and deal all fifty.
     */
    it('deals every card out, at every player count', () =>
    {
        for (const seats of [2, 3, 4])
        {
            expect(deckFor(seats).length % seats, `${ seats } players`).toBe(0);
            expect(seats * trickCount(seats), `${ seats } players`).toBe(deckFor(seats).length);
        }

        expect(trickCount(4)).toBe(13);
        expect(trickCount(3)).toBe(17);
        expect(trickCount(2)).toBe(25);
        expect(deckFor(2)).toHaveLength(50);
    });

    /**
     * A hand is taken by MORE THAN HALF the tricks, not by a constant seven. Seven of thirteen is
     * where the number everybody knows comes from; at twenty-five cards each the same rule reads
     * thirteen, and a literal 7 would have ended a two-handed hand with eighteen tricks unplayed.
     */
    it('needs a majority of the tricks to take a hand', () =>
    {
        expect(winningTricks(4)).toBe(7);
        expect(winningTricks(2)).toBe(13);

        for (const seats of [2, 4])
        {
            const needed = winningTricks(seats);

            expect(needed * 2, `${ seats } players`).toBeGreaterThan(trickCount(seats));
            expect((needed - 1) * 2, `${ seats } players`).toBeLessThanOrEqual(trickCount(seats));
        }
    });
});

describe('following suit', () =>
{
    const hand = [cardOf('hearts', 'A'), cardOf('hearts', '3'), cardOf('spades', 'K'), cardOf('clubs', '7')];

    it('offers everything to whoever leads', () =>
    {
        expect(legalCards(hand, null).sort()).toEqual([...hand].sort());
    });

    it('offers only the led suit while you hold one', () =>
    {
        expect(legalCards(hand, 'hearts').sort())
            .toEqual([cardOf('hearts', 'A'), cardOf('hearts', '3')].sort());
    });

    /**
     * *"If a player holds no cards of the suit led, that player may play any card (including any
     * trump card)."* Returning nothing here would read as no legal move and pass the turn, which is
     * a different game - being void is freedom, not paralysis.
     */
    it('offers the whole hand when you are void, trumps included', () =>
    {
        expect(legalCards(hand, 'diamonds').sort()).toEqual([...hand].sort());
    });
});

describe('the card the sweep plays for an absent seat', () =>
{
    const cards = (...names: [Parameters<typeof cardOf>[0], Parameters<typeof cardOf>[1]][]) =>
        names.map(([suit, rank]) => cardOf(suit, rank));

    it('leads the lowest card of the longest suit that is not trump', () =>
    {
        const hand = cards(['clubs', '2'], ['clubs', '3'], ['diamonds', '4'], ['diamonds', '5'], ['diamonds', '9'], ['hearts', 'A']);

        expect(nameOf(autoCard(hand, [], 'hearts'))).toBe('4D');
    });

    it('leads from the plain suits even when trump is the longest', () =>
    {
        const hand = cards(['clubs', 'K'], ['clubs', '8'], ['spades', '2'], ['spades', '3'], ['spades', '4'], ['spades', '5']);

        expect(nameOf(autoCard(hand, [], 'spades'))).toBe('8C');
    });

    it('breaks a tie in length by the lower card', () =>
    {
        const hand = cards(['clubs', 'Q'], ['clubs', 'K'], ['diamonds', '3'], ['diamonds', '9']);

        expect(nameOf(autoCard(hand, [], 'spades'))).toBe('3D');
    });

    it('leads the lowest trump from a hand of nothing else', () =>
    {
        const hand = cards(['spades', '9'], ['spades', '3'], ['spades', 'A']);

        expect(nameOf(autoCard(hand, [], 'spades'))).toBe('3S');
    });

    it('follows with the lowest card of the suit led', () =>
    {
        const hand = cards(['clubs', '2'], ['diamonds', '7'], ['diamonds', '2'], ['diamonds', 'A']);

        expect(nameOf(autoCard(hand, [cardOf('diamonds', 'K')], 'clubs'))).toBe('2D');
    });

    it('follows a trump lead with the lowest trump', () =>
    {
        const hand = cards(['clubs', '2'], ['spades', 'J'], ['spades', '6']);

        expect(nameOf(autoCard(hand, [cardOf('spades', 'K')], 'spades'))).toBe('6S');
    });

    it('throws the lowest card that is not trump when void in the suit led', () =>
    {
        const hand = cards(['clubs', '2'], ['diamonds', '9'], ['spades', '4'], ['spades', 'A']);

        expect(nameOf(autoCard(hand, [cardOf('hearts', '5')], 'clubs'))).toBe('4S');
    });

    it('breaks a tie in rank by suit order', () =>
    {
        const hand = cards(['diamonds', '4'], ['spades', '4'], ['clubs', '2']);

        expect(nameOf(autoCard(hand, [cardOf('hearts', '5')], 'clubs'))).toBe('4D');
    });

    it('trumps low when void and holding nothing but trump', () =>
    {
        const hand = cards(['spades', '9'], ['spades', '3']);

        expect(nameOf(autoCard(hand, [cardOf('hearts', '5')], 'spades'))).toBe('3S');
    });

    it('only ever names a legal card', () =>
    {
        for (let seed = 0; seed < 400; seed += 1)
        {
            const hand = DECK.filter((card) => (card * 7 + seed * 13) % 9 === seed % 9).slice(0, 1 + (seed % 13));
            const lead = DECK[(seed * 31) % 52];
            const trick = seed % 3 === 0 ? [] : [lead];
            const trump = SUITS[seed % 4];
            const led = trick.length === 0 ? null : suitOf(trick[0]);

            expect(legalCards(hand, led), `seed ${ seed }`).toContain(autoCard(hand, trick, trump));
        }
    });
});

describe('who takes the trick', () =>
{
    it('gives it to the highest card of the suit led', () =>
    {
        const played = [cardOf('hearts', '9'), cardOf('hearts', 'K'), cardOf('hearts', '3')];

        expect(trickWinner(played, 'spades')).toBe(1);
    });

    /**
     * *"The highest card in the trump suit always wins the trick."* A two of trumps beats an ace of
     * the led suit, which is the single most important sentence in the game.
     */
    it('gives it to a trump over any card of the led suit', () =>
    {
        const played = [cardOf('hearts', 'A'), cardOf('spades', '2')];

        expect(trickWinner(played, 'spades')).toBe(1);
    });

    it('gives it to the highest trump when several are played', () =>
    {
        const played = [cardOf('hearts', 'A'), cardOf('spades', '2'), cardOf('spades', 'Q'), cardOf('spades', '5')];

        expect(trickWinner(played, 'spades')).toBe(2);
    });

    /**
     * A card of neither the led suit nor trumps cannot win however high it is. Discarding a losing
     * ace is an ordinary thing to do and must not quietly take the trick.
     */
    it('ignores a high card of a suit nobody led', () =>
    {
        const played = [cardOf('hearts', '4'), cardOf('diamonds', 'A'), cardOf('clubs', 'A')];

        expect(trickWinner(played, 'spades')).toBe(0);
    });
});

describe('scoring a hand between two sides', () =>
{
    it('is not over before somebody has seven tricks', () =>
    {
        expect(duelResult([6, 5], 0, 7)).toBeNull();
    });

    it('pays one point for reaching seven', () =>
    {
        expect(duelResult([7, 4], 0, 7)).toEqual({ side: 0, points: 1 });
        expect(duelResult([2, 7], 0, 7)).toEqual({ side: 1, points: 1 });
    });

    /** *"If the Hâkem's team wins the hand by taking the first 7 tricks... they win 2 points."* */
    it('pays the Hâkem two for a kot', () =>
    {
        expect(duelResult([7, 0], 0, 7)).toEqual({ side: 0, points: 2 });
    });

    /** *"If the Hâkem's opponents win by taking the first 7 tricks, they win 3 points."* */
    it('pays the other side three for a hâkem koti', () =>
    {
        expect(duelResult([0, 7], 0, 7)).toEqual({ side: 1, points: 3 });
    });

    /**
     * The same three rules at the two-handed threshold, because the number is the only thing that
     * differs. Seven tricks out of twenty-five is not a hand - it is a third of one.
     */
    it('counts to thirteen in the two-handed game and not to seven', () =>
    {
        const needed = winningTricks(2);

        expect(duelResult([7, 4], 0, needed)).toBeNull();
        expect(duelResult([13, 9], 0, needed)).toEqual({ side: 0, points: 1 });
        expect(duelResult([13, 0], 0, needed)).toEqual({ side: 0, points: 2 });
        expect(duelResult([0, 13], 0, needed)).toEqual({ side: 1, points: 3 });
    });
});

describe('scoring a hand between three players', () =>
{
    const ALL = trickCount(3);

    it('pays a sweep two to the Hâkem and three to anybody else', () =>
    {
        expect(tripleResult([7, 0, 0], 0, 7)).toEqual({ side: 0, points: 2 });
        expect(tripleResult([0, 7, 0], 0, 7)).toEqual({ side: 1, points: 3 });
    });

    /**
     * Pagat's own four examples, by name, because they are the whole of the early stop and each one
     * is a different answer: *"if the tricks are 7-4-3 the play must continue, because a second
     * player might also achieve 7 tricks, but at 7-4-4 the player with 7 tricks has won... In the
     * same way 8-3-1 is not yet a win, but 8-2-2 is a win."*
     */
    it('plays on at 7-4-3 and stops at 7-4-4', () =>
    {
        expect(tripleResult([7, 4, 3], 0, 14)).toBeNull();
        expect(tripleResult([7, 4, 4], 0, 15)).toEqual({ side: 0, points: 1 });
    });

    it('plays on at 8-3-1 and stops at 8-2-2', () =>
    {
        expect(tripleResult([8, 3, 1], 0, 12)).toBeNull();
        expect(tripleResult([8, 2, 2], 0, 12)).toEqual({ side: 0, points: 1 });
    });

    /**
     * *"If two of players take the same number of tricks then the third player wins the hand and
     * scores 1 point. So for example if the tricks are 7-7-3, the player with 3 tricks wins."*
     *
     * The most counter-intuitive rule in Hokm and the one most likely to be "corrected" later. It is
     * reachable only when all seventeen are played and nobody ever held an unbeatable lead.
     */
    it('gives the hand to the odd player out at 7-7-3', () =>
    {
        expect(tripleResult([7, 7, 3], 0, ALL)).toEqual({ side: 2, points: 1 });
        expect(tripleResult([3, 7, 7], 0, ALL)).toEqual({ side: 0, points: 1 });
    });

    /**
     * A tie BELOW the top is not that rule: 9-4-4 is a win for the nine, settled by the unbeatable
     * lead long before the last trick. Getting this backwards would hand the hand to a loser.
     */
    it('is not the odd-player rule when the tie is not at the top', () =>
    {
        expect(tripleResult([9, 4, 4], 0, ALL)).toEqual({ side: 0, points: 1 });
    });
});

describe('who rules the next hand', () =>
{
    /** *"The player to the left of Hâkem... becomes dealer"*, and left is the seat before in play order. */
    it('seats the dealer to the Hâkem left at every player count', () =>
    {
        expect(dealerOf(0, 4)).toBe(3);
        expect(dealerOf(2, 4)).toBe(1);
        expect(dealerOf(0, 3)).toBe(2);
        expect(dealerOf(0, 2)).toBe(1);
    });

    it('keeps the rank when the Hâkem side held the hand', () =>
    {
        expect(nextHakem(2, 4, true)).toBe(2);
        expect(nextHakem(0, 2, true)).toBe(0);
    });

    /**
     * *"the previous Hâkem deals and the player to his right becomes Hâkem"* - and the second half
     * is free, because the dealer is always the seat before the Hâkem. If those two ever disagreed
     * the deal would start in the wrong place.
     */
    it('passes it to the right on a loss, leaving the old Hâkem dealing', () =>
    {
        for (const seats of [2, 3, 4])
        {
            const moved = nextHakem(1, seats, false);

            expect(moved, `${ seats } players`).toBe((1 + 1) % seats);
            expect(dealerOf(moved, seats), `${ seats } players`).toBe(1);
        }
    });

    it('puts partners opposite each other', () =>
    {
        expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1]);
    });
});

describe('winning the match', () =>
{
    it('takes the first side to the target and nobody before', () =>
    {
        expect(matchWinner([6, 6], 7)).toBeNull();
        expect(matchWinner([7, 6], 7)).toBe(0);
        expect(matchWinner([5, 8], 7)).toBe(1);
        expect(matchWinner([12, 13], 13)).toBe(1);
    });
});
