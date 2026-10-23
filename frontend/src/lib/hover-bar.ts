import type { Box, Size } from './anchor.ts';

/** How far the hover bar keeps from the bubble beside it. */
const GAP = 8;

/**
 * Where a line's hover bar goes, in pixels from the top-left of the bubble's column: beside the
 * bubble, on the side with more room, when the row has room for it there; otherwise over the
 * bubble's top edge from the side away from its sender, where the lines above it leave room (a run
 * of one sender's lines is drawn along that sender's side), kept inside the row, and under the
 * bubble when the thread's top would cut it off. It is measured, so it is physical (`left` and
 * `top`) whichever way the page reads.
 */
export function fitBar(row: Box, bubble: Box, bar: Size, options: { mine: boolean; rtl: boolean; top: number })
{
    const before = bubble.x - row.x;
    const after = row.x + row.width - (bubble.x + bubble.width);
    const middle = (bubble.height - bar.height) / 2;

    if (after >= before && after >= bar.width + GAP)
    {
        return { x: bubble.width + GAP, y: middle };
    }

    if (before > after && before >= bar.width + GAP)
    {
        return { x: -(bar.width + GAP), y: middle };
    }

    const fromLeft = options.mine !== options.rtl;
    const wanted = fromLeft ? 0 : bubble.width - bar.width;
    const x = Math.min(Math.max(wanted, row.x - bubble.x), row.x + row.width - bubble.x - bar.width);
    const above = bubble.y - bar.height - GAP / 2 >= options.top;

    return { x, y: above ? -(bar.height + GAP / 2) : bubble.height + GAP / 2 };
}
