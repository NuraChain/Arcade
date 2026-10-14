import { BAR, OFF, allHome, facing, keyOf, type Hop, type Side } from '../../../../backend/src/domains/match/backgammon/board.ts';
import { canStep, diceOf, forcedDie, landing, longest, stage } from '../../../../backend/src/domains/match/backgammon/moves.ts';
import type { Tip } from './tip.ts';

export type Outcome = 'hit' | 'enter' | 'enterHit' | 'off';

export interface Moment
{
    phase: 'opening' | 'roll' | 'move' | 'double';
    side: Side;
    dice: readonly number[];
    staged: readonly Hop[];
    doubling: boolean;
    cube: number;
}

export function outcomeOf(side: Side, hop: Hop): Outcome | null
{
    const hit = hop.to !== OFF && side.them[facing(hop.to)] === 1;

    if (hop.from === BAR)
    {
        return hit ? 'enterHit' : 'enter';
    }

    if (hop.to === OFF)
    {
        return 'off';
    }

    return hit ? 'hit' : null;
}

export function hits(outcome: Outcome | null)
{
    return outcome === 'hit' || outcome === 'enterHit';
}

interface Way
{
    hops: Hop[];
    left: string;
    plain: boolean;
}

export function reachOf(side: Side, dice: readonly number[], staged: readonly Hop[], from: number): Map<number, Hop[]>
{
    const ways = new Map<number, Way>();

    const walk = (hops: Hop[], spot: number) =>
    {
        const held = stage(side, dice, [...staged, ...hops]);

        if (held === null)
        {
            return;
        }

        if (hops.length > 0)
        {
            const known = ways.get(spot);
            const left = keyOf(held.at);

            if (known === undefined || hops.length < known.hops.length)
            {
                ways.set(spot, { hops, left, plain: true });
            }
            else if (hops.length === known.hops.length && left !== known.left)
            {
                known.plain = false;
            }
        }

        if (spot === OFF)
        {
            return;
        }

        for (const hop of held.next)
        {
            if (hop.from === spot)
            {
                walk([...hops, hop], hop.to);
            }
        }
    };

    walk([], from);

    return new Map([...ways].filter(([, way]) => way.plain).map(([to, way]) => [to, way.hops]));
}

function stepsWith(side: Side, die: number)
{
    const found: Hop[] = [];

    for (let from = BAR; from >= 1; from -= 1)
    {
        if (canStep(side, from, die))
        {
            found.push({ from, to: landing(from, die) });
        }
    }

    return found;
}

function binding(side: Side, dice: readonly number[], offered: readonly Hop[]): Tip | null
{
    const [low, high] = [Math.min(dice[0], dice[1]), Math.max(dice[0], dice[1])];
    const lows = stepsWith(side, low);
    const need = longest(side, diceOf(dice));
    const forced = forcedDie(side, dice, need);

    if (forced !== null && lows.length > 0)
    {
        return { key: 'helpers.backgammon.higher', params: { die: forced } };
    }

    const keys = new Set(offered.map((hop) => `${ hop.from }/${ hop.to }`));

    if (need === 2 && [...lows, ...stepsWith(side, high)].some((hop) => !keys.has(`${ hop.from }/${ hop.to }`)))
    {
        return { key: 'helpers.backgammon.both' };
    }

    return null;
}

export function coachOf(moment: Moment): Tip | null
{
    if (moment.phase === 'double')
    {
        return { key: 'helpers.backgammon.take', params: { cube: moment.cube * 2, now: moment.cube } };
    }

    if (moment.phase === 'roll')
    {
        return moment.doubling && moment.cube === 1 ? { key: 'helpers.backgammon.double', params: { cube: 2 } } : null;
    }

    if (moment.dice.length !== 2)
    {
        return null;
    }

    const plan = stage(moment.side, moment.dice, moment.staged);

    if (plan === null || plan.done)
    {
        return null;
    }

    if (plan.at.me[BAR] > 0)
    {
        return { key: 'helpers.backgammon.bar' };
    }

    const doubles = moment.dice[0] === moment.dice[1];

    if (doubles && longest(moment.side, diceOf(moment.dice)) === 4)
    {
        return { key: 'helpers.backgammon.doubles', params: { die: moment.dice[0] } };
    }

    const forced = !doubles && moment.staged.length === 0 ? binding(moment.side, moment.dice, plan.next) : null;

    if (forced !== null)
    {
        return forced;
    }

    if (moment.side.me[OFF] === 0 && allHome(plan.at.me) && plan.next.some((hop) => hop.to === OFF))
    {
        return { key: 'helpers.backgammon.bear' };
    }

    return null;
}
