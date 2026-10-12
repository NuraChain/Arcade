import { describe, it, expect } from 'vitest';

import { ROUND, SHUFFLE, TURN, TURN_GAP, dealGap, dealLength, dealtIn, gatherLength, gatherOrder, holdBefore, openLength, openingPackets, restPackets, spanOf } from '../src/game/hokm-beats.ts';
import type { Told } from '../src/game/hokm-felt.ts';
import { TIMING } from '../src/game/motion.ts';

const card = (seat: number, at: number): Told => ({ e: 'card', seat, card: at });

const TRICK: Told[] = [card(1, 1), card(2, 2), card(3, 3), card(0, 4), { e: 'trick', seat: 2 }];

const TAKEN = 3 * TIMING.SEQ_GAP + TIMING.FLY + TIMING.SETTLE;

describe('how long a felt takes to show what happened', () =>
{
    it('is a card\'s flight, a little shorter for the reader\'s own', () =>
    {
        expect(spanOf([card(1, 12)], 4, 0)).toBe(TIMING.FLY_THEIRS);
        expect(spanOf([card(0, 12)], 4, 0)).toBe(TIMING.FLY);
        expect(spanOf([card(0, 12)], 4, null), 'somebody watching has no card of their own').toBe(TIMING.FLY_THEIRS);
        expect(TIMING.FLY).toBeLessThan(TIMING.FLY_THEIRS);
    });

    it('spaces the cards of one batch, and ends when the last of them is down', () =>
    {
        expect(spanOf([card(1, 1), card(2, 2), card(3, 3)], 4, 0)).toBe(2 * TIMING.SEQ_GAP + TIMING.FLY_THEIRS);
        expect(spanOf([card(3, 3), card(0, 4)], 4, 0), 'a slower card before a quicker one is still waited for').toBe(Math.max(TIMING.FLY_THEIRS, TIMING.SEQ_GAP + TIMING.FLY));
    });

    it('counts a trick to the moment it is taken, and not the time it lies there to be read, when nothing follows it', () =>
    {
        expect(spanOf(TRICK, 4, 0)).toBe(TAKEN);
    });

    it('counts the whole hold and the gather when the hand ends on that trick, and the short hold when a card follows', () =>
    {
        expect(spanOf([...TRICK, { e: 'hand', side: 0, points: 1, kot: false }], 4, 0)).toBe(TAKEN + TIMING.HOLD + gatherLength(4) + TIMING.BANNER);
        expect(spanOf([...TRICK, { e: 'finish', side: 0 }], 4, 0)).toBe(TAKEN + TIMING.HOLD + gatherLength(4));
        expect(spanOf([...TRICK, card(2, 30)], 4, 0)).toBe(TAKEN + TIMING.HOLD_MIN + gatherLength(4) + TIMING.FLY_THEIRS);
    });

    it('gathers as many cards as there are seats', () =>
    {
        const three: Told[] = [card(1, 1), card(2, 2), card(0, 4), { e: 'trick', seat: 2 }, card(2, 30)];

        expect(spanOf(three, 3, 0)).toBe(2 * TIMING.SEQ_GAP + TIMING.FLY + TIMING.SETTLE + TIMING.HOLD_MIN + gatherLength(3) + TIMING.FLY_THEIRS);
    });

    it('gives a deal its shuffle and one flight to the Hakem, and a flight each at a table for two', () =>
    {
        expect(spanOf([{ e: 'deal', hakem: 1 }], 4, 0)).toBe(SHUFFLE + TIMING.DEAL_FLY);
        expect(spanOf([{ e: 'deal', hakem: 1 }], 3, 0)).toBe(SHUFFLE + TIMING.DEAL_FLY);
        expect(spanOf([{ e: 'deal', hakem: 1 }], 2, null)).toBe(SHUFFLE + dealGap(2) + TIMING.DEAL_FLY);
    });

    it('gives a reader who is dealt five the time those five take to turn face up', () =>
    {
        expect(spanOf([{ e: 'deal', hakem: 0 }], 4, 0)).toBe(SHUFFLE + TIMING.DEAL_FLY + openLength(5));
        expect(spanOf([{ e: 'deal', hakem: 1 }], 2, 0), 'both seats are dealt five at a table for two').toBe(SHUFFLE + dealGap(2) + TIMING.DEAL_FLY + openLength(5));
        expect(spanOf([{ e: 'deal', hakem: 0 }], 4, null), 'somebody watching is dealt nothing').toBe(SHUFFLE + TIMING.DEAL_FLY);
    });

    it('gives trump the rest of the deal in its eleven packets, the reader\'s last four turning up, and nothing more at a table for two', () =>
    {
        expect(spanOf([{ e: 'trump', seat: 0, suit: 'spades' }], 4, 0)).toBe(TIMING.FADE + dealLength(11, false) + openLength(ROUND));
        expect(spanOf([{ e: 'trump', seat: 0, suit: 'spades' }], 3, 0)).toBe(TIMING.FADE + dealLength(11, false) + openLength(ROUND));
        expect(spanOf([{ e: 'trump', seat: 0, suit: 'spades' }], 4, null)).toBe(TIMING.FADE + dealLength(11, false));
        expect(spanOf([{ e: 'trump', seat: 0, suit: 'spades' }], 2, 0)).toBe(TIMING.FADE);
    });

    it('lets one draw finish before the next one flies, and gives a card put down no time of its own', () =>
    {
        expect(spanOf([{ e: 'draw', seat: 1 }], 2, 0)).toBe(TIMING.DEAL_FLY);
        expect(spanOf([{ e: 'draw', seat: 1 }, { e: 'draw', seat: 0 }], 2, 0)).toBe(2 * TIMING.DEAL_FLY);
        expect(spanOf([{ e: 'discard', seat: 0 }], 2, 0)).toBe(0);
        expect(spanOf([{ e: 'forfeit', seat: 1 }, { e: 'finish', side: 0 }], 2, 0)).toBe(0);
    });

    it('is the whole of a hand that ends and is dealt again, in order', () =>
    {
        const ending: Told[] = [...TRICK, { e: 'hand', side: 0, points: 1, kot: false }, { e: 'deal', hakem: 0 }];

        expect(spanOf(ending, 4, null)).toBe(3 * TIMING.SEQ_GAP + TIMING.FLY_THEIRS + TIMING.SETTLE + TIMING.HOLD + gatherLength(4) + TIMING.BANNER + SHUFFLE + TIMING.DEAL_FLY);
        expect(spanOf(ending, 4, 0), 'the new Hâkem\'s five turn up at the end of it').toBe(TAKEN + TIMING.HOLD + gatherLength(4) + TIMING.BANNER + SHUFFLE + TIMING.DEAL_FLY + openLength(5));
        expect(spanOf([], 4, 0)).toBe(0);
    });
});

describe('a trick on its way to whoever took it', () =>
{
    it('gathers the winning card last', () =>
    {
        const cards = [{ card: 1, seat: 1 }, { card: 2, seat: 2 }, { card: 3, seat: 3 }, { card: 4, seat: 0 }];

        expect(gatherOrder(cards, 2).map((one) => one.card)).toEqual([1, 3, 4, 2]);
        expect(gatherOrder(cards, 1).map((one) => one.card)).toEqual([2, 3, 4, 1]);
        expect(gatherOrder([], 1)).toEqual([]);
    });

    it('takes a beat longer for every card after the first', () =>
    {
        expect(gatherLength(1)).toBe(TIMING.GATHER);
        expect(gatherLength(4)).toBe(TIMING.GATHER + 3 * TIMING.GATHER_GAP);
        expect(gatherLength(0)).toBe(TIMING.GATHER);
    });

    it('lies there for the whole hold before a hand is called or the match ends, and briefly before anything else', () =>
    {
        expect(holdBefore({ e: 'hand', side: 0, points: 1, kot: false })).toBe(TIMING.HOLD);
        expect(holdBefore({ e: 'finish', side: 0 })).toBe(TIMING.HOLD);
        expect(holdBefore(card(2, 30))).toBe(TIMING.HOLD_MIN);
        expect(holdBefore({ e: 'deal', hakem: 0 })).toBe(TIMING.HOLD_MIN);
        expect(TIMING.HOLD_MIN).toBeLessThan(TIMING.HOLD);
    });
});

describe('a deal going round', () =>
{
    it('leaves the dealer one packet after another, and no gap before the only one', () =>
    {
        expect(dealGap(1)).toBe(0);
        expect(dealGap(0)).toBe(0);
        expect(dealGap(2)).toBe(TIMING.DEAL_GAP_MAX);
        expect(dealGap(4)).toBe(TIMING.DEAL_GAP_MAX);
    });

    it('never takes longer than the deal allows, however many packets there are', () =>
    {
        for (let packets = 1; packets <= 52; packets += 1)
        {
            expect(dealLength(packets, false), `${ packets } packets`).toBeLessThanOrEqual(TIMING.DEAL_TOTAL_MAX);
        }

        expect(dealLength(4, false)).toBe(3 * TIMING.DEAL_GAP_MAX + TIMING.DEAL_FLY);
        expect(dealLength(1, true)).toBe(SHUFFLE + TIMING.DEAL_FLY);
    });

    it('opens with five to the Hâkem alone, and with five to each at a table for two', () =>
    {
        expect(openingPackets(4, 2)).toEqual([{ seat: 2, count: 5 }]);
        expect(openingPackets(3, 0)).toEqual([{ seat: 0, count: 5 }]);
        expect(openingPackets(2, 1)).toEqual([{ seat: 1, count: 5 }, { seat: 0, count: 5 }]);
    });

    it('goes on, once trump is named, with five to every other seat and then fours all round from the Hâkem', () =>
    {
        const four = restPackets(4, 13, 2);
        const three = restPackets(3, 17, 1);
        const dealtTo = (packets: { seat: number; count: number }[], seat: number) => packets.filter((one) => one.seat === seat).reduce((sum, one) => sum + one.count, 0);

        expect(four.slice(0, 3)).toEqual([{ seat: 3, count: 5 }, { seat: 0, count: 5 }, { seat: 1, count: 5 }]);
        expect(four.slice(3).map((one) => one.seat)).toEqual([2, 3, 0, 1, 2, 3, 0, 1]);
        expect(four.slice(3).every((one) => one.count === ROUND)).toBe(true);
        expect([0, 1, 2, 3].map((seat) => dealtTo(four, seat)), 'the Hâkem already holds five').toEqual([13, 13, 8, 13]);

        expect(three.length).toBe(11);
        expect(three.slice(0, 2)).toEqual([{ seat: 2, count: 5 }, { seat: 0, count: 5 }]);
        expect([0, 1, 2].map((seat) => dealtTo(three, seat))).toEqual([17, 12, 17]);

        expect(restPackets(2, 13, 0), 'at a table for two the rest is drawn, not dealt').toEqual([]);
    });

    it('gives each card of a packet its turn to come face up, one a little after another', () =>
    {
        expect(openLength(0)).toBe(0);
        expect(openLength(1)).toBe(TURN);
        expect(openLength(5)).toBe(TURN + 4 * TURN_GAP);
        expect(TURN_GAP).toBeLessThan(TURN);
    });

    it('never takes the rest of the deal past what a deal is allowed', () =>
    {
        expect(dealLength(restPackets(4, 13, 0).length, false)).toBeLessThanOrEqual(TIMING.DEAL_TOTAL_MAX);
        expect(dealLength(restPackets(3, 17, 0).length, false)).toBeLessThanOrEqual(TIMING.DEAL_TOTAL_MAX);
    });
});

describe('the cards a reader is dealt, packet by packet', () =>
{
    const HAND = [0, 3, 9, 14, 17, 21, 26, 30, 33, 40, 44, 47, 51];

    it('puts every card in one packet and no card in two', () =>
    {
        const packets = dealtIn(HAND, [5, 4, 4], 7);

        expect(packets.map((one) => one.length)).toEqual([5, 4, 4]);
        expect(packets.flat().sort((a, b) => a - b)).toEqual(HAND);
    });

    it('deals the same hand the same way to the same seed, and another way to another', () =>
    {
        expect(dealtIn(HAND, [5, 4, 4], 7)).toEqual(dealtIn(HAND, [5, 4, 4], 7));
        expect(dealtIn(HAND, [5, 4, 4], 7)).not.toEqual(dealtIn(HAND, [5, 4, 4], 8));
    });

    it('does not deal a hand in the order it is held, which would say where every suit lies', () =>
    {
        expect(dealtIn(HAND, [5, 4, 4], 7).flat()).not.toEqual(HAND);
    });

    it('puts in a packet only as many cards as it holds, and deals what there is when the hand is shorter', () =>
    {
        expect(dealtIn(HAND, [4, 4], 3).map((one) => one.length), 'a packet of four took the cards that a later round will deal').toEqual([4, 4]);
        expect(dealtIn(HAND, [5], 3).map((one) => one.length), 'the Hâkem\'s first five took the whole hand with them').toEqual([5]);
        expect(dealtIn(HAND.slice(0, 6), [5, 4, 4], 3).map((one) => one.length)).toEqual([5, 1, 0]);
        expect(dealtIn([], [5], 3)).toEqual([[]]);
        expect(dealtIn(HAND, [], 3), 'with no packet to put them in the cards are nobody\'s').toEqual([]);
    });
});
