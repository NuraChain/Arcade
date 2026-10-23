import type { Box, Size } from './anchor.ts';

/** How far the hover bar keeps from the bubble beside it. */
const GAP = 8;

/** Where what stands just above a line is drawn: along the reader's side, along everybody else's, or across the middle. */
export type Lane = 'mine' | 'theirs' | 'middle';

/**
 * Where a line's hover bar goes, in pixels from the top-left of the bubble's column: beside the
 * bubble, on the side with more room, when the row has room for it there; otherwise over the
 * bubble's top edge, kept inside the row, and under the bubble when the thread's top would cut it
 * off. Over the edge it keeps clear of what stands above the line (`above`): it stands away from a
 * line drawn along one side, and at the line's own outer edge under a heading or a notice drawn
 * across the middle; with nothing said, the line's own sender stands in for what is above. It is
 * measured, so it is physical (`left` and `top`) whichever way the page reads.
 */
export function fitBar(row: Box, bubble: Box, bar: Size, options: { mine: boolean; rtl: boolean; top: number; above?: Lane })
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

    const lane = options.above ?? (options.mine ? 'mine' : 'theirs');
    const awayFromMine = lane === 'middle' ? !options.mine : lane === 'mine';
    const fromLeft = awayFromMine !== options.rtl;
    const wanted = fromLeft ? 0 : bubble.width - bar.width;
    const x = Math.min(Math.max(wanted, row.x - bubble.x), row.x + row.width - bubble.x - bar.width);
    const room = bubble.y - bar.height - GAP / 2 >= options.top;

    return { x, y: room ? -(bar.height + GAP / 2) : bubble.height + GAP / 2 };
}
