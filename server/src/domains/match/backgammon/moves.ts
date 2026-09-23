import { BAR, HOME, OFF, allHome, facing, keyOf, type Hop, type Played, type Side } from './board.ts';

export interface Settled
{
    side: Side;
    played: Played[];
}

export function diceOf(roll: readonly number[]): number[]
{
    return roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : [roll[0], roll[1]];
}

export function landing(from: number, die: number): number
{
    return Math.max(OFF, from - die);
}

export function canStep(side: Side, from: number, die: number): boolean
{
    if (from < 1 || from > BAR || side.me[from] === 0 || (side.me[BAR] > 0 && from !== BAR))
    {
        return false;
    }

    const to = from - die;

    if (to > OFF)
    {
        return side.them[facing(to)] < 2;
    }

    if (!allHome(side.me))
    {
        return false;
    }

    if (to === OFF)
    {
        return true;
    }

    for (let point = from + 1; point <= HOME; point += 1)
    {
        if (side.me[point] > 0)
        {
            return false;
        }
    }

    return true;
}

export function step(side: Side, from: number, die: number): { side: Side; played: Played }
{
    const me = [...side.me];
    const them = [...side.them];
    const to = landing(from, die);
    const hit = to !== OFF && them[facing(to)] === 1;

    me[from] -= 1;
    me[to] += 1;

    if (hit)
    {
        them[facing(to)] = 0;
        them[BAR] += 1;
    }

    return { side: { me, them }, played: { from, to, die, hit } };
}

function faces(dice: readonly number[]): number[]
{
    return [...new Set(dice)];
}

function without(dice: readonly number[], die: number): number[]
{
    const at = dice.indexOf(die);

    return [...dice.slice(0, at), ...dice.slice(at + 1)];
}

function playable(side: Side, die: number): boolean
{
    for (let from = BAR; from >= 1; from -= 1)
    {
        if (canStep(side, from, die))
        {
            return true;
        }
    }

    return false;
}

function deepest(side: Side, dice: readonly number[], memo: Map<string, number>): number
{
    if (dice.length === 0)
    {
        return 0;
    }

    const key = `${ keyOf(side) }/${ dice.join(',') }`;
    const known = memo.get(key);

    if (known !== undefined)
    {
        return known;
    }

    let best = 0;

    for (const die of faces(dice))
    {
        for (let from = BAR; from >= 1 && best < dice.length; from -= 1)
        {
            if (canStep(side, from, die))
            {
                best = Math.max(best, 1 + deepest(step(side, from, die).side, without(dice, die), memo));
            }
        }
    }

    memo.set(key, best);

    return best;
}

export function longest(side: Side, dice: readonly number[]): number
{
    return deepest(side, dice, new Map());
}

function forcedDie(side: Side, roll: readonly number[], need: number): number | null
{
    if (need !== 1 || roll[0] === roll[1])
    {
        return null;
    }

    const high = Math.max(roll[0], roll[1]);

    return playable(side, high) ? high : null;
}

export function turns(side: Side, roll: readonly number[]): Hop[][]
{
    const memo = new Map<string, number>();
    const dice = diceOf(roll);
    const need = deepest(side, dice, memo);
    const only = forcedDie(side, roll, need);
    const found = new Map<string, Hop[]>();
    const seen = new Set<string>();

    const walk = (at: Side, left: number[], path: Hop[]): void =>
    {
        if (path.length === need)
        {
            const key = keyOf(at);

            if (!found.has(key))
            {
                found.set(key, path);
            }

            return;
        }

        const key = `${ keyOf(at) }/${ left.join(',') }`;

        if (seen.has(key))
        {
            return;
        }

        seen.add(key);

        for (const die of faces(left))
        {
            if (only !== null && die !== only)
            {
                continue;
            }

            for (let from = BAR; from >= 1; from -= 1)
            {
                if (!canStep(at, from, die))
                {
                    continue;
                }

                const next = step(at, from, die).side;
                const rest = without(left, die);

                if (path.length + 1 + deepest(next, rest, memo) === need)
                {
                    walk(next, rest, [...path, { from, to: landing(from, die) }]);
                }
            }
        }
    };

    if (need > 0)
    {
        walk(side, dice, []);
    }

    return [...found.values()];
}

export function settle(side: Side, roll: readonly number[], hops: readonly Hop[]): Settled | null
{
    const dice = diceOf(roll);
    const need = longest(side, dice);

    if (need === 0 || hops.length !== need)
    {
        return null;
    }

    const only = forcedDie(side, roll, need);

    const walk = (at: Side, left: number[], played: Played[]): Settled | null =>
    {
        if (played.length === hops.length)
        {
            return { side: at, played };
        }

        const hop = hops[played.length];

        for (const die of faces(left))
        {
            if ((only !== null && die !== only) || landing(hop.from, die) !== hop.to || !canStep(at, hop.from, die))
            {
                continue;
            }

            const next = step(at, hop.from, die);
            const done = walk(next.side, without(left, die), [...played, next.played]);

            if (done !== null)
            {
                return done;
            }
        }

        return null;
    };

    return walk(side, dice, []);
}

export interface Staged
{
    at: Side;
    next: Hop[];
    done: boolean;
}

export function stage(side: Side, roll: readonly number[], staged: readonly Hop[]): Staged | null
{
    const memo = new Map<string, number>();
    const dice = diceOf(roll);
    const need = deepest(side, dice, memo);
    const only = forcedDie(side, roll, need);
    const next = new Map<string, Hop>();
    const reached: { at: Side | null } = { at: null };

    if (staged.length > need)
    {
        return null;
    }

    const walk = (at: Side, left: number[], index: number): void =>
    {
        if (index === staged.length)
        {
            reached.at ??= at;

            for (const die of faces(left))
            {
                if (only !== null && die !== only)
                {
                    continue;
                }

                for (let from = BAR; from >= 1; from -= 1)
                {
                    if (canStep(at, from, die) && index + 1 + deepest(step(at, from, die).side, without(left, die), memo) === need)
                    {
                        const to = landing(from, die);

                        next.set(`${ from }/${ to }`, { from, to });
                    }
                }
            }

            return;
        }

        const hop = staged[index];

        for (const die of faces(left))
        {
            if ((only !== null && die !== only) || landing(hop.from, die) !== hop.to || !canStep(at, hop.from, die))
            {
                continue;
            }

            const moved = step(at, hop.from, die).side;
            const rest = without(left, die);

            if (index + 1 + deepest(moved, rest, memo) === need)
            {
                walk(moved, rest, index + 1);
            }
        }
    };

    walk(side, dice, 0);

    return reached.at === null ? null : { at: reached.at, next: [...next.values()], done: staged.length === need };
}
