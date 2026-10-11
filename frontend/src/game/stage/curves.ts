export type Curve = (t: number) => number;

export const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

export const outQuad: Curve = (t) => 1 - (1 - t) * (1 - t);

export const inOutQuad: Curve = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export const outCubic: Curve = (t) => 1 - (1 - t) ** 3;

export const inOutCubic: Curve = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const parabola: Curve = (t) => 4 * t * (1 - t);

export function seeded(seed: number)
{
    let state = seed >>> 0;

    return () =>
    {
        state = (state + 0x6D2B79F5) >>> 0;

        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

export function hashOf(...parts: readonly (string | number)[])
{
    let hash = 2166136261;

    for (const part of parts)
    {
        const text = String(part);

        for (let index = 0; index < text.length; index += 1)
        {
            hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
        }

        hash = Math.imul(hash ^ 0x2F, 16777619) >>> 0;
    }

    return hash >>> 0;
}

export function steps(duration: number, every = 16)
{
    return Math.max(2, Math.ceil(duration / every));
}
