import { describe, it, expect } from 'vitest';

import { fitBar, roomBeside } from '../src/lib/hover-bar.ts';

const row = { x: 0, y: 100, width: 800, height: 60 };

const bar = { width: 120, height: 36 };

describe('where a line’s hover bar goes', () =>
{
    it('stands beside a line of theirs, on the side with the room, in the middle of its height', () =>
    {
        const bubble = { x: 40, y: 110, width: 300, height: 40 };

        expect(fitBar(row, bubble, bar)).toEqual({ x: 308, y: 2 });
    });

    it('stands before a line of the reader’s, which leaves its room at the start of the row', () =>
    {
        const bubble = { x: 460, y: 110, width: 300, height: 40 };

        expect(fitBar(row, bubble, bar)).toEqual({ x: -128, y: 2 });
    });

    it('takes the side with more room when both sides have enough', () =>
    {
        const bubble = { x: 300, y: 110, width: 200, height: 40 };

        expect(fitBar(row, bubble, bar).x, 'after the line').toBe(208);
        expect(fitBar(row, { ...bubble, x: 340 }, bar).x, 'before the line').toBe(-128);
    });

    it('stands in the middle of a line taller or shorter than itself, never over or under it', () =>
    {
        const bubble = { x: 40, y: 110, width: 300, height: 120 };

        expect(fitBar(row, bubble, bar).y, 'a line of several rows').toBe(42);
        expect(fitBar(row, { ...bubble, height: 32 }, bar).y, 'a line of one row, shorter than the bar').toBe(-2);
    });

    it('is kept inside the row when the line leaves it too little room on either side', () =>
    {
        expect(fitBar(row, { x: 40, y: 110, width: 700, height: 40 }, bar).x, 'not past the row’s end').toBe(640);
        expect(fitBar(row, { x: 120, y: 110, width: 700, height: 40 }, bar).x, 'not before the row’s start').toBe(-120);
    });
});

describe('how wide a line’s hover bar may be', () =>
{
    it('is the room on the side with more of it, less the gap', () =>
    {
        expect(roomBeside(row, { x: 40, y: 110, width: 633, height: 40 }), 'theirs, 127 pixels after it').toBe(119);
        expect(roomBeside(row, { x: 40, y: 110, width: 632, height: 40 }), 'a pixel narrower, room for the bar').toBe(bar.width);
        expect(roomBeside(row, { x: 460, y: 110, width: 300, height: 40 }), 'the reader’s, 460 before it').toBe(452);
    });
});
