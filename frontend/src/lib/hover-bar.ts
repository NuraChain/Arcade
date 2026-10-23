import type { Box, Size } from './anchor.ts';

/** How far the hover bar keeps from the bubble beside it. */
const GAP = 8;

/** How wide a line's hover bar may be to stand beside the bubble, on whichever side the row leaves more room. */
export function roomBeside(row: Box, bubble: Box)
{
    return Math.max(bubble.x - row.x, row.x + row.width - (bubble.x + bubble.width)) - GAP;
}

/**
 * Where a line's hover bar goes, in pixels from the top-left of the bubble's column: beside the
 * bubble on the side with more room, in the middle of its height, and kept inside the row. It never
 * stands over or under the line, where it lies on the lines round it; the bubble gives up what of the
 * bar the row has no room for instead. It is measured, so it is physical (`left` and `top`) whichever
 * way the page reads.
 */
export function fitBar(row: Box, bubble: Box, bar: Size)
{
    const before = bubble.x - row.x;
    const after = row.x + row.width - (bubble.x + bubble.width);
    const y = (bubble.height - bar.height) / 2;

    return after >= before
        ? { x: Math.min(bubble.width + GAP, row.x + row.width - bubble.x - bar.width), y }
        : { x: Math.max(-(bar.width + GAP), row.x - bubble.x), y };
}
