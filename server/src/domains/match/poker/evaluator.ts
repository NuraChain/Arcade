import { rankOf, suitOf } from '../cards/cards.ts';

export const CATEGORIES = [
    'high-card',
    'pair',
    'two-pair',
    'trips',
    'straight',
    'flush',
    'full-house',
    'quads',
    'straight-flush'
] as const;

export type Category = typeof CATEGORIES[number];

export interface Strength
{
    category: Category;
    score: number;
}

const BASE = 13;

const ACE = 12;

const FIVE = 3;

function scored(category: number, ranks: readonly number[]): Strength
{
    let score = category;

    for (let index = 0; index < 5; index += 1)
    {
        score = score * BASE + (ranks[index] ?? 0);
    }

    return { category: CATEGORIES[category], score };
}

function straightHigh(ranks: readonly number[]): number | null
{
    const distinct = [...new Set(ranks)];

    if (distinct.length !== 5)
    {
        return null;
    }

    if (distinct[0] - distinct[4] === 4)
    {
        return distinct[0];
    }

    return distinct[0] === ACE && distinct[1] === FIVE ? FIVE : null;
}

export function evaluateFive(cards: readonly number[]): Strength
{
    const ranks = cards.map(rankOf).sort((a, b) => b - a);
    const flush = cards.every((card) => suitOf(card) === suitOf(cards[0]));
    const high = straightHigh(ranks);

    if (flush && high !== null)
    {
        return scored(8, [high]);
    }

    const counts = new Map<number, number>();

    for (const rank of ranks)
    {
        counts.set(rank, (counts.get(rank) ?? 0) + 1);
    }

    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const order = groups.map(([rank]) => rank);
    const shape = groups.map(([, count]) => count).join('');

    if (shape === '41')
    {
        return scored(7, order);
    }

    if (shape === '32')
    {
        return scored(6, order);
    }

    if (flush)
    {
        return scored(5, ranks);
    }

    if (high !== null)
    {
        return scored(4, [high]);
    }

    if (shape === '311')
    {
        return scored(3, order);
    }

    if (shape === '221')
    {
        return scored(2, order);
    }

    return scored(shape === '2111' ? 1 : 0, order);
}

export function evaluate(cards: readonly number[]): Strength
{
    let best: Strength | null = null;
    const count = cards.length;

    for (let a = 0; a < count; a += 1)
    {
        for (let b = a + 1; b < count; b += 1)
        {
            for (let c = b + 1; c < count; c += 1)
            {
                for (let d = c + 1; d < count; d += 1)
                {
                    for (let e = d + 1; e < count; e += 1)
                    {
                        const strength = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);

                        if (best === null || strength.score > best.score)
                        {
                            best = strength;
                        }
                    }
                }
            }
        }
    }

    return best ?? scored(0, []);
}
