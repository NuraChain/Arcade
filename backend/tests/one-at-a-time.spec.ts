import { describe, expect, it } from 'vitest';

import { oneAtATime } from '../src/lib/one-at-a-time.ts';

const runner = (): { query: (sql: string) => Promise<string>; peak: () => number; order: string[] } =>
{
    let running = 0;
    let peak = 0;
    const order: string[] = [];

    return {
        order,
        peak: () => peak,
        query: async (sql: string): Promise<string> =>
        {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push(sql);
            running -= 1;

            if (sql === 'fail')
            {
                throw new Error('refused');
            }

            return `${ sql } done`;
        }
    };
};

describe('a query runner that asks one thing at a time', () =>
{
    it('never has two queries in flight on one client, and answers each in the order asked', async () =>
    {
        const held = oneAtATime(runner());

        const answers = await Promise.all([held.query('a'), held.query('b'), held.query('c')]);

        expect(answers).toEqual(['a done', 'b done', 'c done']);
        expect(held.order).toEqual(['a', 'b', 'c']);
        expect(held.peak()).toBe(1);
    });

    it('lets the next query run after one that failed', async () =>
    {
        const held = oneAtATime(runner());

        const [failed, after] = await Promise.allSettled([held.query('fail'), held.query('next')]);

        expect(failed.status).toBe('rejected');
        expect(after).toEqual({ status: 'fulfilled', value: 'next done' });
    });
});
