export const RARITY_IDS = ['normal', 'rare', 'legendary'] as const;

export type Rarity = typeof RARITY_IDS[number];

export const RARITY_SHARE: Record<Rarity, number> = {
    normal: 0.6,
    rare: 0.3,
    legendary: 0.1
};

export function rarityAt(index: number, count: number): Rarity
{
    const at = (index + 1) / count;
    let edge = 0;

    for (const id of RARITY_IDS)
    {
        edge += RARITY_SHARE[id];
        if (at <= edge + 1e-9)
        {
            return id;
        }
    }

    return RARITY_IDS[RARITY_IDS.length - 1]!;
}
