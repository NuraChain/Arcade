import { describe, it, expect } from 'vitest';

import { fitBar } from '../src/lib/hover-bar.ts';

const row = { x: 0, y: 100, width: 800, height: 60 };

const bar = { width: 120, height: 36 };

describe('where a line’s hover bar goes', () =>
{
    it('stands beside a line of theirs, on the side with the room, in the middle of its height', () =>
    {
        const bubble = { x: 40, y: 110, width: 300, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0 })).toEqual({ x: 308, y: 2 });
    });

    it('stands before a line of the reader’s, which leaves its room at the start of the row', () =>
    {
        const bubble = { x: 460, y: 110, width: 300, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: true, rtl: false, top: 0 })).toEqual({ x: -128, y: 2 });
    });

    it('takes the side with more room when both sides have enough', () =>
    {
        const bubble = { x: 300, y: 110, width: 200, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0 }).x, 'after the line').toBe(208);
        expect(fitBar(row, { ...bubble, x: 340 }, bar, { mine: false, rtl: false, top: 0 }).x, 'before the line').toBe(-128);
    });

    it('wants its own width and a gap beside the line before it stands there', () =>
    {
        const bubble = { x: 40, y: 110, width: 633, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0 }).x, '127 pixels after it is not enough: over its far end').toBe(513);
        expect(fitBar(row, { ...bubble, width: 632 }, bar, { mine: false, rtl: false, top: 0 }).x, '128 pixels is').toBe(640);
    });

    it('stands over the top edge of a line too wide to stand beside, from the side away from its sender, where the lines above leave room', () =>
    {
        const bubble = { x: 40, y: 110, width: 700, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0 }), 'theirs, from the right').toEqual({ x: 580, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: true, rtl: false, top: 0 }), 'the reader’s, from the left').toEqual({ x: 0, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: false, rtl: true, top: 0 }), 'theirs in Persian, from the left').toEqual({ x: 0, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: true, rtl: true, top: 0 }), 'the reader’s in Persian, from the right').toEqual({ x: 580, y: -40 });
    });

    it('stands over the top edge on the side away from the line above it, whoever wrote that one', () =>
    {
        const bubble = { x: 40, y: 110, width: 700, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0, above: 'mine' }), 'theirs under the reader’s, from the left').toEqual({ x: 0, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0, above: 'theirs' }), 'theirs under theirs, from the right').toEqual({ x: 580, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: true, rtl: false, top: 0, above: 'theirs' }), 'the reader’s under theirs, from the right').toEqual({ x: 580, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: true, rtl: true, top: 0, above: 'theirs' }), 'the reader’s under theirs in Persian, from the left').toEqual({ x: 0, y: -40 });
    });

    it('stands over the top edge at the line’s own outer edge under a heading or a notice across the middle', () =>
    {
        const bubble = { x: 40, y: 110, width: 700, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0, above: 'middle' }), 'theirs, from the left').toEqual({ x: 0, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: true, rtl: false, top: 0, above: 'middle' }), 'the reader’s, from the right').toEqual({ x: 580, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: false, rtl: true, top: 0, above: 'middle' }), 'theirs in Persian, from the right').toEqual({ x: 580, y: -40 });
        expect(fitBar(row, bubble, bar, { mine: true, rtl: true, top: 0, above: 'middle' }), 'the reader’s in Persian, from the left').toEqual({ x: 0, y: -40 });
    });

    it('goes under the line when the top of the thread would cut it off over it', () =>
    {
        const bubble = { x: 40, y: 110, width: 700, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 80 }).y, 'room above down to 70, the thread starts at 80').toBe(44);
        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 70 }).y, 'exactly enough room above').toBe(-40);
    });

    it('is kept inside the row whatever the line does', () =>
    {
        const bubble = { x: -20, y: 110, width: 900, height: 40 };

        expect(fitBar(row, bubble, bar, { mine: false, rtl: false, top: 0 }).x, 'not past the row’s end').toBe(700);
        expect(fitBar(row, bubble, bar, { mine: true, rtl: false, top: 0 }).x, 'not before the row’s start').toBe(20);
    });
});
