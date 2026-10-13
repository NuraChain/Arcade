import { describe, expect, it } from 'vitest';

import { discsFor } from '../src/game/stage/chips.ts';

describe('how many discs stand for an amount of chips', () =>
{
    it.each([
        [0, 0],
        [10, 1],
        [20, 1],
        [30, 2],
        [50, 2],
        [60, 3],
        [120, 3],
        [130, 4],
        [300, 4],
        [320, 5],
        [1500, 5],
        [1_000_000, 5]
    ])('%i chips against a big blind of 20 are %i', (amount, discs) =>
    {
        expect(discsFor(amount, 20)).toBe(discs);
    });

    it('never draws fewer discs for more chips, and never more than five', () =>
    {
        const drawn = Array.from({ length: 400 }, (_, step) => discsFor(step * 5, 20));

        expect(drawn.every((discs, at) => at === 0 || discs >= drawn[at - 1])).toBe(true);
        expect(Math.max(...drawn)).toBe(5);
        expect(drawn[0]).toBe(0);
        expect(drawn[1]).toBe(1);
    });

    it('measures against the blind and not the number: the same stack is smaller when the blinds have risen', () =>
    {
        expect(discsFor(600, 20)).toBe(5);
        expect(discsFor(600, 200)).toBe(3);
        expect(discsFor(600, 2000)).toBe(1);
    });

    it('still draws something where there is no blind to measure against', () =>
    {
        expect(discsFor(0, 0)).toBe(0);
        expect(discsFor(1, 0)).toBe(1);
        expect(discsFor(40, 0)).toBe(5);
    });
});
