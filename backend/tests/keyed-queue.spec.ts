import { describe, expect, it } from 'vitest';

import { keyedQueue } from '../src/lib/keyed-queue.ts';

const gate = () =>
{
    let open: () => void = () => undefined;
    const closed = new Promise<void>((resolve) =>
    {
        open = resolve;
    });

    return { closed, open };
};

const settle = async () =>
{
    for (let turn = 0; turn < 8; turn += 1)
    {
        await Promise.resolve();
    }
};

describe('a queue with a key', () =>
{
    it('runs one task for a key at a time, in the order they were asked for', async () =>
    {
        const queue = keyedQueue();
        const first = gate();
        const seen: string[] = [];

        const one = queue.run('ludo', async () =>
        {
            seen.push('one starts');
            await first.closed;
            seen.push('one ends');

            return 1;
        });
        const two = queue.run('ludo', async () =>
        {
            seen.push('two starts');

            return 2;
        });

        await settle();

        expect(seen).toEqual(['one starts']);

        first.open();

        expect(await Promise.all([one, two])).toEqual([1, 2]);
        expect(seen).toEqual(['one starts', 'one ends', 'two starts']);
    });

    it('lets different keys run side by side', async () =>
    {
        const queue = keyedQueue();
        const held = gate();
        const seen: string[] = [];

        const slow = queue.run('ludo', async () =>
        {
            await held.closed;
            seen.push('ludo');
        });

        await queue.run('hokm', async () =>
        {
            seen.push('hokm');
        });

        expect(seen).toEqual(['hokm']);

        held.open();
        await slow;

        expect(seen).toEqual(['hokm', 'ludo']);
    });

    it('hands a refusal to whoever asked, and still runs the next task for that key', async () =>
    {
        const queue = keyedQueue();

        const refused = queue.run('ludo', async () =>
        {
            throw new Error('no room');
        });
        const after = queue.run('ludo', async () => 'seated');

        await expect(refused).rejects.toThrow('no room');
        expect(await after).toBe('seated');
    });
});
