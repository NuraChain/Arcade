import { BAR, OFF, allHome, facing, type Hop, type Side } from '../../../../server/src/domains/match/backgammon/board.ts';
import { canStep, diceOf, landing, longest, stage } from '../../../../server/src/domains/match/backgammon/moves.ts';
import type { Tip } from './tip.ts';

export type Outcome = 'hit' | 'enter' | 'enterHit' | 'off';

export interface Moment
{
    phase: 'roll' | 'move' | 'double';
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

export function hits(outcome: Outcome | null): boolean
{
    return outcome === 'hit' || outcome === 'enterHit';
}

function stepsWith(side: Side, die: number): Hop[]
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
    const highs = stepsWith(side, high);
    const need = longest(side, diceOf(dice));

    if (need === 1 && lows.length > 0 && highs.length > 0)
    {
        return { key: 'helpers.backgammon.higher', params: { die: high } };
    }

    const keys = new Set(offered.map((hop) => `${ hop.from }/${ hop.to }`));

    if (need === 2 && [...lows, ...highs].some((hop) => !keys.has(`${ hop.from }/${ hop.to }`)))
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
