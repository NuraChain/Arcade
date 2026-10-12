import { describe, it, expect } from 'vitest';

import { SHUFFLE, dealGap, dealLength, gatherLength, gatherOrder, holdBefore, spanOf } from '../src/game/hokm-beats.ts';
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
        expect(spanOf([{ e: 'deal', hakem: 1 }], 2, 0)).toBe(SHUFFLE + dealGap(2) + TIMING.DEAL_FLY);
    });

    it('gives trump the rest of the deal going round to every seat, and nothing more at a table for two', () =>
    {
        expect(spanOf([{ e: 'trump', seat: 0, suit: 'spades' }], 4, 0)).toBe(TIMING.FADE + dealLength(4, false));
        expect(spanOf([{ e: 'trump', seat: 0, suit: 'spades' }], 3, 0)).toBe(TIMING.FADE + dealLength(3, false));
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

        expect(spanOf(ending, 4, 0)).toBe(TAKEN + TIMING.HOLD + gatherLength(4) + TIMING.BANNER + SHUFFLE + TIMING.DEAL_FLY);
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
});
