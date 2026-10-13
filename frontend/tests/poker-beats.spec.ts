import { describe, expect, it } from 'vitest';

import {
    BOARD_GAP, BOARD_OUT, CARD_FLY, CARD_GAP, CARD_OUT, CHIP_FLY, COLLECT, COLLECT_GAP, COLLECT_MOST, DEAL_LEAD, DEAL_MOST, DISC_GAP, GATHER, GATHER_GAP, KNOCK, MUCK,
    MUCK_GAP, POT_FLY, POT_GAP, POT_SPAN, RACK, RUN_OUT, RUN_OUT_LEAST, SHOW_LEAST, SHOW_LINGER, TURN, WIN_AFTER, collectGap, dealGap, dealLength, heldBefore, slides, spanOf,
    streetLength, tabling
} from '../src/game/poker-beats.ts';

describe('how long a poker table takes to show what it is told', () =>
{
    it('takes no time to show nothing, or a move that is only a fact', () =>
    {
        expect(spanOf([], 6)).toBe(0);
        expect(spanOf([{ e: 'end' }], 6)).toBe(0);
    });

    it('allows a bet its flight and the gaps of five discs, whoever puts it in and however', () =>
    {
        const pouring = CHIP_FLY + 4 * DISC_GAP;

        expect(['blind', 'call', 'raise', 'allin', 'refund'].map((e) => spanOf([{ e }], 6))).toEqual([pouring, pouring, pouring, pouring, pouring]);
        expect(spanOf([{ e: 'check' }], 6)).toBe(KNOCK);
    });

    it('allows cards the time to be turned down and reach the dealer when somebody folds or goes out, and a stack the time to be racked off first when somebody walks out', () =>
    {
        const mucking = TURN + MUCK + MUCK_GAP;

        expect(['fold', 'bust'].map((e) => spanOf([{ e }], 6))).toEqual([mucking, mucking]);
        expect(spanOf([{ e: 'forfeit' }], 6), 'a stack that is racked off the felt was given no time to go').toBe(RACK + 4 * DISC_GAP + mucking);
    });

    it('allows a hand that is tabled the time of its two cards turning over, the second a beat after the first', () =>
    {
        expect(spanOf([{ e: 'show' }], 6)).toBe(CARD_GAP + TURN);
    });

    it('pays a pot in the beat a pot has, in which five discs reach their winner and rest there before the next hand', () =>
    {
        expect(spanOf([{ e: 'pot' }], 6)).toBe(POT_SPAN);
        expect(POT_FLY + 4 * POT_GAP, 'five discs are still in the air when the beat of the pot is over').toBeLessThan(POT_SPAN);
    });

    it('holds a table that has been shown down before each street of a run-out and before its first pot, and nowhere else', () =>
    {
        const shown = [{ e: 'show' }, { e: 'show' }];
        const street = { e: 'board', cards: [1] };

        expect([heldBefore(false, { e: 'pot' }), heldBefore(false, street), heldBefore(true, { e: 'show' }), heldBefore(true, { e: 'end' })]).toEqual([null, null, null, null]);
        expect(heldBefore(true, street)).toEqual({ ms: RUN_OUT, least: RUN_OUT_LEAST });
        expect(heldBefore(true, { e: 'pot' })).toEqual({ ms: SHOW_LINGER, least: SHOW_LEAST });
        expect([{ e: 'show' }, street, { e: 'pot' }, { e: 'end' }, { e: 'deal' }].map((move) => tabling(true, move))).toEqual([true, true, false, false, false]);
        expect([{ e: 'show' }, street, { e: 'pot' }].map((move) => tabling(false, move))).toEqual([true, false, false]);
        expect(spanOf([...shown, { e: 'pot' }, { e: 'pot' }], 2) - spanOf(shown, 2) - 2 * spanOf([{ e: 'pot' }], 2), 'the second pot of a hand was held as the first is').toBe(SHOW_LEAST);
        expect(spanOf([...shown, street, street, { e: 'pot' }], 2) - spanOf(shown, 2) - 2 * spanOf([street], 2) - spanOf([{ e: 'pot' }], 2)).toBe(2 * RUN_OUT_LEAST + SHOW_LEAST);
        expect([RUN_OUT_LEAST < RUN_OUT, SHOW_LEAST < SHOW_LINGER]).toEqual([true, true]);
    });

    it('deals two cards a seat one after another, and closes the gap so a full table is dealt in the time a deal is allowed', () =>
    {
        expect(dealGap(1)).toBe(0);
        expect([4, 12].map(dealGap)).toEqual([CARD_OUT, CARD_OUT]);
        expect(dealGap(18)).toBe((DEAL_MOST - CARD_FLY) / 17);
        expect(dealGap(18)).toBeLessThan(CARD_OUT);
        expect(dealLength(0)).toBe(0);
        expect(dealLength(4)).toBe(3 * CARD_OUT + CARD_FLY + TURN);
        expect(dealLength(18)).toBe(DEAL_MOST + TURN);
        expect(Math.max(...[2, 4, 8, 12, 14, 16, 18].map(dealLength))).toBe(DEAL_MOST + TURN);
    });

    it('lets a card be heard as it leaves, the first always and eight at the most however many are dealt', () =>
    {
        const heard = (cards: number) => Array.from({ length: cards }, (_, at) => slides(at, cards)).filter(Boolean).length;

        expect([4, 6, 8, 12, 18].map(heard)).toEqual([4, 6, 8, 8, 8]);
        expect([4, 12, 18].map((cards) => slides(0, cards))).toEqual([true, true, true]);
    });

    it('sweeps a hand to the dealer one lot after another, in a time that does not grow with the lots', () =>
    {
        expect(collectGap(1)).toBe(0);
        expect(collectGap(3)).toBe(COLLECT_GAP);
        expect(collectGap(14)).toBe(COLLECT_MOST / 13);
        expect(spanOf([{ e: 'deal' }], 2)).toBe(COLLECT + COLLECT_MOST + DEAL_LEAD + dealLength(4));
        expect(spanOf([{ e: 'deal' }], 9)).toBe(COLLECT + COLLECT_MOST + DEAL_LEAD + dealLength(18));
    });

    it('gathers the bets of every seat before a street, lays its cards face down one after another and turns them in the same order', () =>
    {
        expect(streetLength(0)).toBe(0);
        expect(streetLength(1)).toBe(CARD_FLY + TURN);
        expect(streetLength(3)).toBe(2 * (BOARD_OUT + BOARD_GAP) + CARD_FLY + TURN);
        expect(spanOf([{ e: 'board', cards: [1, 2, 3] }], 6)).toBe(GATHER + 5 * GATHER_GAP + streetLength(3));
        expect(spanOf([{ e: 'board', cards: [4] }], 2)).toBe(GATHER + GATHER_GAP + streetLength(1));
    });

    it('is the sum of its moves, so a hand that ends and the one dealt after it are counted whole', () =>
    {
        const hand = [{ e: 'call' }, { e: 'board', cards: [9] }, { e: 'show' }, { e: 'show' }, { e: 'pot' }, { e: 'end' }, { e: 'finish' }];

        expect(spanOf(hand, 2)).toBe((CHIP_FLY + 4 * DISC_GAP) + (GATHER + GATHER_GAP + streetLength(1)) + 2 * (CARD_GAP + TURN) + SHOW_LEAST + POT_SPAN + WIN_AFTER);
        expect(spanOf([...hand, { e: 'deal' }], 2)).toBe(spanOf(hand, 2) + spanOf([{ e: 'deal' }], 2));
    });
});
