export interface Box
{
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface Bet
{
    plate: Box;
    width: number;
    height: number;
}

interface Option
{
    spot: Box;
    clash: number;
    snug: number;
    reach: number;
}

const PLATE_WEIGHT = 1000;

const SEARCH_STEPS = 20000;

const BET_SPACE = 2;

const SNUG_GAP = 1;

const shared = (one: Box, two: Box) =>
    Math.max(0, Math.min(one.right, two.right) - Math.max(one.left, two.left))
    * Math.max(0, Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top));

const grown = (box: Box, by: number): Box => ({ left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by });

const beside = (bet: Bet, table: Box, gap: number) =>
{
    const { plate, width, height } = bet;
    const at = (left: number, top: number): Box => ({ left, top, right: left + width, bottom: top + height });
    const across = [(plate.left + plate.right - width) / 2, plate.left, plate.right - width];
    const down = [(plate.top + plate.bottom - height) / 2, plate.top, plate.bottom - height];
    const before = plate.left - gap - width;
    const after = plate.right + gap;
    const above = plate.top - gap - height;
    const below = plate.bottom + gap;

    return [
        ...down.map((top) => at(after, top)),
        ...down.map((top) => at(before, top)),
        ...across.map((left) => at(left, above)),
        ...across.map((left) => at(left, below)),
        at(after, above),
        at(before, above),
        at(after, below),
        at(before, below)
    ].filter((spot) => spot.left >= table.left - 0.5 && spot.top >= table.top - 0.5 && spot.right <= table.right + 0.5 && spot.bottom <= table.bottom + 0.5);
};

const ranked = (bet: Bet, table: Box, plates: readonly Box[], rest: readonly Box[], gap: number): Option[] =>
{
    const middle = { x: (table.left + table.right) / 2, y: (table.top + table.bottom) / 2 };
    const spots = [...beside(bet, table, gap).map((spot) => ({ spot, snug: 0 })), ...beside(bet, table, Math.min(gap, SNUG_GAP)).map((spot) => ({ spot, snug: 1 }))];

    return spots
        .map(({ spot, snug }) => ({
            spot,
            clash: plates.reduce((sum, box) => sum + PLATE_WEIGHT * shared(spot, box), 0) + rest.reduce((sum, box) => sum + shared(spot, box), 0),
            snug,
            reach: Math.round(Math.hypot((spot.left + spot.right) / 2 - middle.x, (spot.top + spot.bottom) / 2 - middle.y))
        }))
        .sort((one, two) => one.clash - two.clash || one.snug - two.snug || one.reach - two.reach);
};

const searched = (options: readonly Option[][]) =>
{
    const free = options.map((list) => list.filter((option) => option.clash === 0));
    const order = free.map((_, index) => index).sort((one, two) => free[one].length - free[two].length || one - two);
    const placed: (Box | null)[] = free.map(() => null);
    let steps = SEARCH_STEPS;

    const fill = (depth: number): boolean =>
    {
        if (depth === order.length)
        {
            return true;
        }

        const index = order[depth];

        for (const { spot } of free[index])
        {
            steps -= 1;

            if (steps < 0)
            {
                return false;
            }

            if (placed.some((other) => other !== null && shared(grown(other, BET_SPACE), spot) > 0))
            {
                continue;
            }

            placed[index] = spot;

            if (fill(depth + 1))
            {
                return true;
            }

            placed[index] = null;
        }

        return false;
    };

    return fill(0) ? placed : null;
};

const greedy = (bets: readonly Bet[], table: Box, plates: readonly Box[], rest: readonly Box[], gap: number) =>
{
    const placed: (Box | null)[] = bets.map(() => null);
    const busy = [...rest];
    const waiting = new Set(bets.map((_, index) => index));

    while (waiting.size > 0)
    {
        const next = [...waiting]
            .map((index) =>
            {
                const options = ranked(bets[index], table, plates, busy, gap);

                return { index, options, free: options.filter((option) => option.clash === 0).length };
            })
            .sort((one, two) => one.free - two.free || one.index - two.index)[0];
        const spot = next.options[0]?.spot ?? null;

        placed[next.index] = spot;
        waiting.delete(next.index);

        if (spot !== null)
        {
            busy.push(spot);
        }
    }

    return placed;
};

export function seatBets(bets: readonly Bet[], table: Box, plates: readonly Box[], rest: readonly Box[], gap: number)
{
    const options = bets.map((bet) => ranked(bet, table, plates, rest, gap));

    return searched(options) ?? greedy(bets, table, plates, rest, gap);
}
