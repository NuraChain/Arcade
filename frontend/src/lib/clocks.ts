import { clockOf, type ClockId } from '../../../backend/src/domains/table/clocks.ts';
import type { useLocale } from '../stores/locale.store.ts';

export type ClockPace = 'blitz' | 'rapid' | 'classical';

/**
 * How fast a control plays, by the length of a game of forty moves a side as online chess counts
 * it: the minutes each side starts with and forty times what a move adds. Under eight minutes is
 * blitz, under twenty-five rapid.
 */
export function paceOf(id: ClockId): ClockPace
{
    const { base, increment } = clockOf(id)!;
    const seconds = (base + 40 * increment) / 1000;

    return seconds < 480 ? 'blitz' : (seconds < 1500 ? 'rapid' : 'classical');
}

/** A control as players write it, in the reader's digits: "10+0", «۱۰+۰». */
export function faceOf(locale: ReturnType<typeof useLocale>, id: ClockId)
{
    const [minutes, seconds] = id.split('+').map(Number);

    return `${ locale.n(minutes) }+${ locale.n(seconds) }`;
}
