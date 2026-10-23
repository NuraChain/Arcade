/**
 * The time controls a table can be played under, written as players write them: the minutes each
 * side starts with, then the seconds a move adds. A closed set that imports nothing, so the browser
 * offers the same list the server stores, and `table-clocks.spec.ts` holds it to the CHECKs on
 * `tables.clock` and `game_rules.clocks`.
 */
export const CLOCKS = ['3+2', '5+0', '10+0', '15+10', '30+0'] as const;

export type ClockId = typeof CLOCKS[number];

/** What a table that offers controls opens with when nobody chose one. */
export const CLOCK_DEFAULT: ClockId = '10+0';

export const isClock = (value: unknown): value is ClockId => typeof value === 'string' && (CLOCKS as readonly string[]).includes(value);

/** A control as an engine plays it: what each side starts with and what a move adds, in milliseconds. */
export function clockOf(id: string | null)
{
    if (id === null || !isClock(id))
    {
        return null;
    }

    const [minutes, seconds] = id.split('+').map(Number);

    return { base: minutes * 60_000, increment: seconds * 1000 };
}

/**
 * The control a table is opened under. A turn-based table has none, because its limit is the day
 * a move every turn-based table gives, and neither has a game that offers none. Otherwise it is
 * the one asked for when the game offers it, and the game's default when what was asked is not
 * one it offers.
 */
export function clockFor(offered: readonly string[], mode: string, asked?: string | null): ClockId | null
{
    const controls = offered.filter(isClock);

    if (mode !== 'live' || controls.length === 0)
    {
        return null;
    }

    if (isClock(asked) && controls.includes(asked))
    {
        return asked;
    }

    return controls.includes(CLOCK_DEFAULT) ? CLOCK_DEFAULT : controls[0];
}
