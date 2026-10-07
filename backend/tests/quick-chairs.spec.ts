import { describe, expect, it } from 'vitest';

import { chairFor } from '../src/domains/table/quick.ts';

describe('the chair a quick search takes', () =>
{
    it('is the lowest free one at a table with no sides', () =>
    {
        expect(chairFor([1, 2, 3], [0], false)).toBe(1);
        expect(chairFor([3, 1], [0, 2], false)).toBe(1);
        expect(chairFor([5, 8, 2], [0, 1, 3, 4, 6, 7], false)).toBe(2);
        expect(chairFor([0], [], false)).toBe(0);
    });

    it('is none when no chair is free', () =>
    {
        expect(chairFor([], [0, 1], false)).toBeNull();
        expect(chairFor([], [0, 1, 2, 3], true)).toBeNull();
    });

    it('is the one opposite somebody already sitting at a table of two sides, so a side fills before the next one starts', () =>
    {
        expect(chairFor([1, 2, 3], [0], true)).toBe(2);
        expect(chairFor([0, 2, 3], [1], true)).toBe(3);
        expect(chairFor([0, 1, 3], [2], true)).toBe(0);
        expect(chairFor([0, 1, 2], [3], true)).toBe(1);
    });

    it('leaves the other side whole for two friends for as long as it can', () =>
    {
        const seated: number[] = [0];
        const order: number[] = [];

        for (let arrival = 0; arrival < 3; arrival += 1)
        {
            const free = [0, 1, 2, 3].filter((seat) => !seated.includes(seat));
            const seat = chairFor(free, seated, true)!;

            order.push(seat);
            seated.push(seat);
        }

        expect(order).toEqual([2, 1, 3]);
    });

    it('is the lowest free one when no free chair has a partner sitting, or when every one has', () =>
    {
        expect(chairFor([1, 3], [0, 2], true)).toBe(1);
        expect(chairFor([2, 3], [0, 1], true)).toBe(2);
        expect(chairFor([0, 1, 2, 3], [], true)).toBe(0);
        expect(chairFor([3], [0, 1, 2], true)).toBe(3);
    });

    it('takes sides into account only where the table has them', () =>
    {
        expect(chairFor([1, 2, 3], [0], false)).toBe(1);
        expect(chairFor([1, 2, 3], [0], true)).toBe(2);
    });
});
