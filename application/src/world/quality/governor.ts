import { TIER_ORDER, type QualityTier } from './tiers.ts';

const WINDOW = 60;

const SLOW_MS = 22;

const PATIENCE_MS = 2000;

export interface GovernorOptions
{
    tier: QualityTier;
    onDowngrade(tier: QualityTier): void;

    now?(): number;
}

export interface Governor
{

    sample(deltaMs: number): void;
    tier(): QualityTier;
}

export function createGovernor(options: GovernorOptions): Governor
{
    const frames = new Float32Array(WINDOW);
    const scratch = new Float32Array(WINDOW);
    let written = 0;
    let cursor = 0;
    let slowSince = -1;
    let current = options.tier;
    const now = options.now ?? ((): number => performance.now());

    const median = (): number =>
    {
        const count = Math.min(written, WINDOW);
        scratch.set(frames.subarray(0, count));
        const view = scratch.subarray(0, count);
        view.sort();
        return view[Math.floor(count / 2)];
    };

    return {
        sample(deltaMs)
        {
            if (deltaMs > 200)
            {
                slowSince = -1;
                return;
            }

            frames[cursor] = deltaMs;
            cursor = (cursor + 1) % WINDOW;
            written += 1;

            if (written < WINDOW)
            {
                return;
            }

            if (median() <= SLOW_MS)
            {
                slowSince = -1;
                return;
            }

            if (slowSince < 0)
            {
                slowSince = now();
                return;
            }

            if (now() - slowSince < PATIENCE_MS)
            {
                return;
            }

            const index = TIER_ORDER.indexOf(current);
            if (index <= 0)
            {
                slowSince = now();
                return;
            }

            current = TIER_ORDER[index - 1];
            slowSince = -1;
            written = 0;
            cursor = 0;
            options.onDowngrade(current);
        },

        tier()
        {
            return current;
        }
    };
}
