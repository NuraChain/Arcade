import { describe, expect, it } from 'vitest';

import { BOARD_GAP, CARD_GAP, CHIP_FLY, DEAL_LEAD, DEAL_SLIDE, DISC_GAP, GATHER, GATHER_GAP, KNOCK, POT_SPAN, WIN_AFTER, slidesFor, spanOf } from '../src/game/poker-beats.ts';

describe('how long a poker table takes to show what it is told', () =>
{
    it('takes no time to show nothing, or a move that is only a fact', () =>
    {
        expect(spanOf([], 6)).toBe(0);
        expect(spanOf([{ e: 'end' }, { e: 'bust' }, { e: 'forfeit' }], 6)).toBe(0);
    });

    it('allows a bet its flight and the gaps of five discs, whoever puts it in and however', () =>
    {
        const pouring = CHIP_FLY + 4 * DISC_GAP;

        expect(['blind', 'call', 'raise', 'allin', 'refund'].map((e) => spanOf([{ e }], 6))).toEqual([pouring, pouring, pouring, pouring, pouring]);
        expect(spanOf([{ e: 'check' }], 6)).toBe(KNOCK);
        expect(spanOf([{ e: 'fold' }, { e: 'show' }], 6)).toBe(2 * CARD_GAP);
    });

    it('slides two cards to each seat when it deals, and never more than eight', () =>
    {
        expect([2, 3, 6, 9].map(slidesFor)).toEqual([4, 6, 8, 8]);
        expect(spanOf([{ e: 'deal' }], 2)).toBe(DEAL_LEAD + 4 * DEAL_SLIDE);
        expect(spanOf([{ e: 'deal' }], 9)).toBe(DEAL_LEAD + 8 * DEAL_SLIDE);
    });

    it('gathers the bets of every seat before a street, then lays its cards one after another', () =>
    {
        expect(spanOf([{ e: 'board', cards: [1, 2, 3] }], 6)).toBe(GATHER + 5 * GATHER_GAP + 3 * BOARD_GAP);
        expect(spanOf([{ e: 'board', cards: [4] }], 2)).toBe(GATHER + GATHER_GAP + BOARD_GAP);
    });

    it('is the sum of its moves, so a hand that ends and the one dealt after it are counted whole', () =>
    {
        const hand = [{ e: 'call' }, { e: 'board', cards: [9] }, { e: 'show' }, { e: 'show' }, { e: 'pot' }, { e: 'end' }, { e: 'finish' }];

        expect(spanOf(hand, 2)).toBe((CHIP_FLY + 4 * DISC_GAP) + (GATHER + GATHER_GAP + BOARD_GAP) + 2 * CARD_GAP + POT_SPAN + WIN_AFTER);
        expect(spanOf([...hand, { e: 'deal' }], 2)).toBe(spanOf(hand, 2) + spanOf([{ e: 'deal' }], 2));
    });
});
