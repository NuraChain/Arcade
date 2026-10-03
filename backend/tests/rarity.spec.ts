import { describe, expect, it } from 'vitest';

import { RUNGS } from '../src/domains/achieve/families.ts';
import { RARITY_IDS, rarityAt } from '../src/domains/achieve/rarity.ts';

describe('how rare an achievement is', () =>
{
    it('climbs from normal to legendary along a ladder, and the top rung is always legendary', () =>
    {
        const ladder = Array.from({ length: 20 }, (_, index) => rarityAt(index, 20));

        expect(ladder.slice(0, 12).every((one) => one === 'normal')).toBe(true);
        expect(ladder.slice(12, 18).every((one) => one === 'rare')).toBe(true);
        expect(ladder.slice(18)).toEqual(['legendary', 'legendary']);
        expect(rarityAt(0, 1)).toBe('legendary');
        expect(rarityAt(2, 3)).toBe('legendary');
    });

    it('never goes back down a ladder', () =>
    {
        for (const count of [1, 2, 3, 7, 20, 64])
        {
            const order = Array.from({ length: count }, (_, index) => RARITY_IDS.indexOf(rarityAt(index, count)));
            expect(order).toEqual([...order].sort((a, b) => a - b));
        }
    });

    it('gives every generated achievement one of the known rarities', () =>
    {
        expect(RUNGS.every((rung) => (RARITY_IDS as readonly string[]).includes(rung.rarity))).toBe(true);
        expect(new Set(RUNGS.map((rung) => rung.rarity))).toEqual(new Set(RARITY_IDS));
    });
});
