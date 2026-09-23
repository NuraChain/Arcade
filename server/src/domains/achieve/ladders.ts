export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export type Pace = 'live' | 'turns';

export type Metric =
    | { of: 'played' }
    | { of: 'won' }
    | { of: 'xp' }
    | { of: 'days' }
    | { of: 'peak' }
    | { of: 'streak' }
    | { of: 'tally'; name: string }
    | { of: 'wonAt'; seats: number }
    | { of: 'playedAt'; seats: number }
    | { of: 'wonIn'; pace: Pace }
    | { of: 'playedIn'; pace: Pace }
    | { of: 'global'; name: GlobalFact };

export type GlobalFact = 'played' | 'won' | 'xp' | 'level' | 'days' | 'hosted' | 'opponents' | 'peak' | 'streak' | 'wonFull' | 'wonTurns' | 'wonLive' | 'wonDuel';

export type GlobalFacts = Readonly<Record<GlobalFact, number>>;

export interface LadderFacts
{
    played: number;
    won: number;
    xp: number;
    days: number;
    peak: number;
    streak: number;
    tallies: Readonly<Record<string, number>>;
    seats: Readonly<Record<number, { played: number; won: number }>>;
    pace: Readonly<Record<Pace, { played: number; won: number }>>;
}

export interface Family
{
    id: string;
    metric: Metric;
    icon: string;
    title: { en: string; fa: string };
    blurb: { en: string; fa: string };
    one?: string;
    steps: readonly number[];
}

export interface Rung
{
    id: string;
    game: string | null;
    family: string;
    step: number;
    need: number;
    tier: Tier;
    icon: string;
    nameEn: string;
    nameFa: string;
    blurbEn: string;
    blurbFa: string;
}

const BANDS: readonly [number, number][] = [
    [20, 1],
    [100, 5],
    [300, 10],
    [500, 25],
    [1000, 50],
    [2000, 100],
    [5000, 250],
    [10_000, 500],
    [20_000, 1000],
    [50_000, 2500],
    [100_000, 5000]
];

export function dense(count: number, scale = 1): number[]
{
    const out: number[] = [];
    let at = 0;

    for (const [until, step] of BANDS)
    {
        while (at + step <= until && out.length < count)
        {
            at += step;
            out.push(at * scale);
        }
    }

    if (out.length < count)
    {
        throw new Error(`a ladder of ${ count } does not fit the bands`);
    }

    return out;
}

export function linear(from: number, by: number, count: number): number[]
{
    return Array.from({ length: count }, (_, index) => from + index * by);
}

export function tierAt(index: number, count: number): Tier
{
    const at = index / count;

    if (at < 0.3)
    {
        return 'bronze';
    }
    if (at < 0.55)
    {
        return 'silver';
    }
    if (at < 0.78)
    {
        return 'gold';
    }
    return at < 0.93 ? 'platinum' : 'diamond';
}

const EN = new Intl.NumberFormat('en-US');

const FA = new Intl.NumberFormat('fa-IR', { useGrouping: true });

export const scopeOf = (game: string | null): string => game ?? 'all';

export const rungId = (game: string | null, family: string, step: number): string => `${ scopeOf(game) }-${ family }-${ step }`;

export function reached(steps: readonly number[], value: number): number
{
    let count = 0;

    while (count < steps.length && steps[count] <= value)
    {
        count += 1;
    }

    return count;
}

export function rungsOf(game: string | null, families: readonly Family[]): Rung[]
{
    return families.flatMap((family) => family.steps.map((need, index): Rung => ({
        id: rungId(game, family.id, index + 1),
        game,
        family: family.id,
        step: index + 1,
        need,
        tier: tierAt(index, family.steps.length),
        icon: family.icon,
        nameEn: `${ family.title.en } ${ EN.format(index + 1) }`,
        nameFa: `${ family.title.fa } ${ FA.format(index + 1) }`,
        blurbEn: need === 1 && family.one !== undefined ? family.one : family.blurb.en.replace('{n}', EN.format(need)),
        blurbFa: family.blurb.fa.replace('{n}', FA.format(need))
    })));
}

export function measure(facts: LadderFacts, global: GlobalFacts, metric: Metric): number
{
    switch (metric.of)
    {
        case 'global':
            return global[metric.name];
        case 'played':
        case 'won':
        case 'xp':
        case 'days':
        case 'peak':
        case 'streak':
            return facts[metric.of];
        case 'tally':
            return facts.tallies[metric.name] ?? 0;
        case 'wonAt':
            return facts.seats[metric.seats]?.won ?? 0;
        case 'playedAt':
            return facts.seats[metric.seats]?.played ?? 0;
        case 'wonIn':
            return facts.pace[metric.pace].won;
        case 'playedIn':
            return facts.pace[metric.pace].played;
    }
}
