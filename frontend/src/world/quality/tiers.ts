export type QualityTier = 'low' | 'medium' | 'high';

export type SceneSet = 'phone' | 'desktop';

export const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high'];

export const PIXEL_BUDGET: Record<QualityTier, number> = {
    low: 0.8e6,
    medium: 1.6e6,
    high: 3.7e6
};

export interface DeviceProfile
{
    cores: number;

    memory: number;

    width: number;

    height: number;
}

export interface Choice
{
    tier: QualityTier;

    set: SceneSet;
}

export function pickTier(profile: DeviceProfile): Choice
{
    if (Math.min(profile.width, profile.height) < 720)
    {
        return { tier: 'medium', set: 'phone' };
    }

    const weak = (profile.memory > 0 && profile.memory <= 4) || (profile.cores > 0 && profile.cores < 4);
    if (weak)
    {
        return { tier: 'low', set: 'desktop' };
    }

    return { tier: profile.cores >= 8 ? 'high' : 'medium', set: 'desktop' };
}

export function pixelRatioFor(tier: QualityTier, devicePixelRatio: number, width: number, height: number): number
{
    const area = Math.max(width * height, 1);
    return Math.min(devicePixelRatio, 2, Math.sqrt(PIXEL_BUDGET[tier] / area));
}
