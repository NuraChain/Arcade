import { describe, expect, it } from 'vitest';

import { EMPTY, beatsOf, feltOf, overflows, scaled, type Beat, type HokmMove } from '../src/game/hokm-beats.ts';
import { TIMING, easings, flightFrames, POP_LINEAR, SNAP_LINEAR } from '../src/game/motion.ts';

const FOUR = { seat: 0, seats: 4, sideOf: (seat: number) => seat % 2 };

const kinds = (beats: readonly Beat[]): string[] => beats.map((beat) => beat.kind);

const at = (beats: readonly Beat[], kind: Beat['kind']): number => beats.find((beat) => beat.kind === kind)?.at ?? -1;

describe('a card on the felt', () =>
{
    it('flies from its seat and lands after the flight', () =>
    {
        const { beats, felt } = beatsOf([{ e: 'card', seat: 1, card: 12 }], EMPTY, FOUR);

        expect(kinds(beats)).toEqual(['card', 'land']);
        expect(at(beats, 'land')).toBe(TIMING.FLY_THEIRS);
        expect(felt.cards).toEqual([{ card: 12, seat: 1 }]);
    });

    it('flies the reader\'s own card a little faster', () =>
    {
        const { beats } = beatsOf([{ e: 'card', seat: 0, card: 5 }], EMPTY, FOUR);

        expect(at(beats, 'land')).toBe(TIMING.FLY);
    });

    it('spaces several cards in one batch', () =>
    {
        const moves: HokmMove[] = [{ e: 'card', seat: 1, card: 1 }, { e: 'card', seat: 2, card: 2 }];
        const starts = beatsOf(moves, EMPTY, FOUR).beats.filter((beat) => beat.kind === 'card').map((beat) => beat.at);

        expect(starts).toEqual([0, TIMING.SEQ_GAP]);
    });
});

describe('a trick', () =>
{
    const four: HokmMove[] = [
        { e: 'card', seat: 1, card: 1 },
        { e: 'card', seat: 2, card: 2 },
        { e: 'card', seat: 3, card: 3 },
        { e: 'card', seat: 0, card: 4 },
        { e: 'trick', seat: 2 }
    ];

    it('is taken after the last card lands and left held when nothing follows it in the batch', () =>
    {
        const { beats, felt, held } = beatsOf(four, EMPTY, FOUR);
        const lastLanding = Math.max(...beats.filter((beat) => beat.kind === 'land').map((beat) => beat.at));

        expect(at(beats, 'took')).toBe(lastLanding + TIMING.SETTLE);
        expect(at(beats, 'gather')).toBe(-1);
        expect(held).toBe(at(beats, 'took'));
        expect(felt.took).toBe(2);
        expect(felt.cards).toHaveLength(4);
    });

    it('is gathered after the whole hold when the hand ends in the same batch', () =>
    {
        const { beats, held } = beatsOf([...four, { e: 'hand', side: 0, points: 1, kot: false }], EMPTY, FOUR);

        expect(at(beats, 'gather')).toBe(at(beats, 'took') + TIMING.HOLD);
        expect(held).toBeNull();
    });

    it('is gathered after only the short hold, counted from when it was taken, when the next lead arrives later', () =>
    {
        const table = { cards: [{ card: 1, seat: 1 }, { card: 2, seat: 2 }], took: 2 };

        expect(at(beatsOf([{ e: 'card', seat: 2, card: 30 }], table, FOUR, 100).beats, 'gather')).toBe(TIMING.HOLD_MIN - 100);
        expect(at(beatsOf([{ e: 'card', seat: 2, card: 30 }], table, FOUR, 2000).beats, 'gather')).toBe(0);
    });

    it('is the reader\'s when their partner took it', () =>
    {
        const took = beatsOf(four, EMPTY, FOUR).beats.find((beat) => beat.kind === 'took');

        expect(took).toMatchObject({ seat: 2, ours: true });
    });

    it('gathers the winning card last', () =>
    {
        const gather = beatsOf([...four, { e: 'hand', side: 0, points: 1, kot: false }], EMPTY, FOUR).beats.find((beat) => beat.kind === 'gather');

        expect(gather?.kind === 'gather' ? gather.cards.at(-1) : null).toEqual({ card: 2, seat: 2 });
    });

    it('holds only briefly when the next lead is already in the batch', () =>
    {
        const { beats } = beatsOf([...four, { e: 'card', seat: 2, card: 30 }], EMPTY, FOUR);

        expect(at(beats, 'gather')).toBe(at(beats, 'took') + TIMING.HOLD_MIN);
        expect(beats.filter((beat) => beat.kind === 'card').at(-1)!.at).toBeGreaterThanOrEqual(at(beats, 'clear'));
    });

    it('gathers a trick left on the felt before the next lead lands', () =>
    {
        const { beats } = beatsOf([{ e: 'card', seat: 2, card: 30 }], { cards: [{ card: 1, seat: 1 }, { card: 2, seat: 2 }], took: 2 }, FOUR);

        expect(kinds(beats).slice(0, 3)).toEqual(['gather', 'clear', 'card']);
    });
});

describe('a hand', () =>
{
    it('ends with a banner after the last trick is gathered', () =>
    {
        const { beats } = beatsOf([
            { e: 'card', seat: 3, card: 9 },
            { e: 'trick', seat: 1 },
            { e: 'hand', side: 1, points: 1, kot: false },
            { e: 'deal', hakem: 1 }
        ], { cards: [{ card: 6, seat: 0 }, { card: 7, seat: 1 }, { card: 8, seat: 2 }], took: null }, FOUR);

        expect(kinds(beats)).toEqual(['card', 'land', 'took', 'gather', 'clear', 'hand', 'deal']);
        expect(at(beats, 'hand')).toBe(at(beats, 'clear'));
        expect(beats.find((beat) => beat.kind === 'hand')).toMatchObject({ ours: false, kot: false });
        expect(at(beats, 'deal')).toBe(at(beats, 'hand') + TIMING.BANNER);
    });

    it('deals the first five from the dealer, to the new Hakem', () =>
    {
        const deal = beatsOf([{ e: 'deal', hakem: 2 }], EMPTY, FOUR).beats[0];

        expect(deal).toMatchObject({ kind: 'deal', from: 1, to: [2], shuffle: true });
    });

    it('calls a kot a kot', () =>
    {
        const hand = beatsOf([{ e: 'hand', side: 0, points: 2, kot: true }], EMPTY, FOUR).beats[0];

        expect(hand).toMatchObject({ kind: 'hand', kot: true, ours: true, points: 2 });
    });
});

describe('trump', () =>
{
    it('is announced, then the rest of the deal goes round from the dealer\'s left', () =>
    {
        const { beats } = beatsOf([{ e: 'trump', seat: 0, suit: 'hearts' }], EMPTY, FOUR);

        expect(kinds(beats)).toEqual(['trump', 'deal']);
        expect(beats[1]).toMatchObject({ from: 3, to: [0, 1, 2, 3], shuffle: false });
    });

    it('never takes longer than the deal allows', () =>
    {
        const { ends } = beatsOf([{ e: 'trump', seat: 0, suit: 'hearts' }], EMPTY, FOUR);

        expect(ends).toBeLessThanOrEqual(TIMING.FADE + TIMING.DEAL_TOTAL_MAX);
    });
});

describe('the end of a match', () =>
{
    it('is a win for the reader only when their side won', () =>
    {
        expect(beatsOf([{ e: 'finish', side: 0 } as HokmMove], EMPTY, FOUR).beats[0]).toMatchObject({ kind: 'finish', won: true });
        expect(beatsOf([{ e: 'finish', side: 1 } as HokmMove], EMPTY, FOUR).beats[0]).toMatchObject({ kind: 'finish', won: false });
    });

    it('is nobody\'s win for a spectator', () =>
    {
        expect(beatsOf([{ e: 'finish', side: 0 } as HokmMove], EMPTY, { ...FOUR, seat: null }).beats[0]).toMatchObject({ won: false });
    });
});

describe('the felt a view describes', () =>
{
    it('places the trick by seat from the lead', () =>
    {
        expect(feltOf([10, 11], 3, 4).cards).toEqual([{ card: 10, seat: 3 }, { card: 11, seat: 0 }]);
    });

    it('plays a timeline at double speed when the table has fallen behind, flights included', () =>
    {
        const plan = beatsOf([{ e: 'card', seat: 1, card: 1 }], EMPTY, FOUR);
        const fast = scaled(plan, 0.5);
        const flight = fast.beats.find((beat) => beat.kind === 'card');

        expect(fast.ends).toBe(plan.ends / 2);
        expect(fast.beats.map((beat) => beat.at)).toEqual(plan.beats.map((beat) => beat.at / 2));
        expect(flight?.kind === 'card' ? flight.at + flight.duration : -1).toBe(at(fast.beats, 'land'));
    });

    it('jumps rather than replays a catch-up of more than twelve actions or more than one hand', () =>
    {
        const hand = { e: 'hand' as const, side: 0, points: 1, kot: false };

        expect(overflows(12, [])).toBe(false);
        expect(overflows(13, [])).toBe(true);
        expect(overflows(4, [hand])).toBe(false);
        expect(overflows(4, [hand, { e: 'deal', hakem: 1 }, hand])).toBe(true);
    });
});

describe('motion', () =>
{
    it('flies from the source centre to the destination, scaled by width', () =>
    {
        const [first, last] = flightFrames({ x: 0, y: 0, width: 20, height: 28 }, { x: 100, y: 50, width: 40, height: 56 }, { toRotate: 4 });

        expect(first).toMatchObject({ translate: '-110px -64px', scale: '0.5', rotate: '0deg', opacity: 1 });
        expect(last).toMatchObject({ translate: '0px 0px', scale: '1', rotate: '4deg' });
    });

    it('fades out only over the tail when asked', () =>
    {
        const frames = flightFrames({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }, { toOpacity: 0, fadeFrom: 0.6 });

        expect(frames).toHaveLength(3);
        expect(frames[1]).toMatchObject({ offset: 0.6, opacity: 1 });
        expect(frames[2]).toMatchObject({ opacity: 0 });
    });

    it('uses the spring curves only where linear() is understood', () =>
    {
        expect(easings(true).snap).toBe(SNAP_LINEAR);
        expect(easings(true).pop).toBe(POP_LINEAR);
        expect(easings(false).snap).toBe('cubic-bezier(0.2, 0, 0, 1)');
        expect(easings(false).pop).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
        expect(SNAP_LINEAR.startsWith('linear(0,') && SNAP_LINEAR.endsWith(' 1)')).toBe(true);
    });
});
