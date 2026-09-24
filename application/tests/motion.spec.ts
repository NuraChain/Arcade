import { describe, it, expect } from 'vitest';

import { flip, type MotionKit } from '../src/lib/motion.ts';

const list = (tops: Record<string, number>): HTMLElement =>
{
    const element = document.createElement('ul');

    for (const [id, top] of Object.entries(tops))
    {
        const row = document.createElement('li');
        row.dataset.flip = id;
        Object.defineProperty(row, 'offsetTop', { value: top });
        element.append(row);
    }

    return element;
};

const kit = (): { kit: MotionKit; glided: [string, number][] } =>
{
    const glided: [string, number][] = [];

    return {
        glided,
        kit: {
            glide: async (element: HTMLElement, by: number) =>
            {
                glided.push([element.dataset.flip ?? '', by]);
            },
            settle: async () => undefined
        } as unknown as MotionKit
    };
};

describe('rows that change places', () =>
{
    it('slides each row that moved from where it was, and leaves the rest alone', () =>
    {
        const tops = new Map<string, number>();
        const { kit: motion, glided } = kit();

        flip(list({ a: 0, b: 60, c: 120 }), tops, motion, false);
        expect(glided).toEqual([]);

        flip(list({ c: 0, a: 60, b: 120 }), tops, motion, false);
        expect(glided).toEqual([['c', 120], ['a', -60], ['b', -60]]);
    });

    it('moves nothing for somebody who asked for less motion, and still learns where rows are', () =>
    {
        const tops = new Map<string, number>();
        const { kit: motion, glided } = kit();

        flip(list({ a: 0, b: 60 }), tops, motion, true);
        flip(list({ b: 0, a: 60 }), tops, motion, true);

        expect(glided).toEqual([]);
        expect(Object.fromEntries(tops)).toEqual({ a: 60, b: 0 });
    });

    it('forgets rows that are gone, so one coming back later does not fly in from its old place', () =>
    {
        const tops = new Map<string, number>();
        const { kit: motion, glided } = kit();

        flip(list({ a: 0, b: 60 }), tops, motion, false);
        flip(list({ a: 0 }), tops, motion, false);
        flip(list({ b: 0, a: 60 }), tops, motion, false);

        expect(glided).toEqual([['a', -60]]);
    });
});
