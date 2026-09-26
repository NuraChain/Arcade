import { describe, expect, it } from 'vitest';

import type { Message } from '../src/data/chat.ts';
import { GROUP_GAP_MS, dayKindOf, threadRows } from '../src/lib/thread.ts';

const NOON = new Date(2026, 8, 23, 12, 0).getTime();

function line(id: string, from: string, at: number, kind: Message['kind'] = 'text'): Message
{
    return { id, conversationId: 'c', from, kind, text: id, at } as Message;
}

describe('a thread in groups', () =>
{
    it('stacks one person’s run under one head and one tail, and starts again when somebody else speaks', () =>
    {
        const rows = threadRows([
            line('a', 'omid', NOON),
            line('b', 'omid', NOON + 1000),
            line('c', 'omid', NOON + 2000),
            line('d', 'dana', NOON + 3000)
        ]);

        expect(rows.map((row) => [row.first, row.last])).toEqual([[true, false], [false, false], [false, true], [true, true]]);
    });

    it('breaks a run that went quiet for longer than the gap', () =>
    {
        const rows = threadRows([line('a', 'omid', NOON), line('b', 'omid', NOON + GROUP_GAP_MS + 1)]);

        expect(rows.map((row) => row.first)).toEqual([true, true]);
    });

    it('never folds a line the server wrote into somebody’s run', () =>
    {
        const rows = threadRows([line('a', 'omid', NOON), line('b', 'omid', NOON + 10, 'system'), line('c', 'omid', NOON + 20)]);

        expect(rows.map((row) => row.first)).toEqual([true, true, true]);
    });

    it('puts a day divider before the first line of every day, and nowhere else', () =>
    {
        const rows = threadRows([
            line('a', 'omid', NOON - 24 * 3600 * 1000),
            line('b', 'omid', NOON),
            line('c', 'omid', NOON + 60_000)
        ]);

        expect(rows.map((row) => row.day)).toEqual([true, true, false]);
        expect(rows[1].first).toBe(true);
    });

    it('names today and yesterday, and leaves anything older to the calendar', () =>
    {
        expect(dayKindOf(NOON - 3600 * 1000, NOON)).toBe('today');
        expect(dayKindOf(NOON - 24 * 3600 * 1000, NOON)).toBe('yesterday');
        expect(dayKindOf(NOON - 3 * 24 * 3600 * 1000, NOON)).toBe('older');
    });
});
