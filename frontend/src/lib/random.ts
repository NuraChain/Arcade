export interface Random
{
    next(): number;
    int(min: number, max: number): number;
    pick<T>(items: readonly T[]): T;
    shuffle<T>(items: readonly T[]): T[];
    chance(probability: number): boolean;
}

export function hashSeed(...parts: Array<string | number>): number
{
    let hash = 0x811C9DC5;
    /**
     * The separator is BUILT, never typed.
     *
     * It was a literal 0x1F byte sitting inside a string here, invisible in every editor - which is
     * the thing `chat/envelope.ts` and `lib/attestation.ts` both write this way and say why: an
     * invisible control character in a source file is one an editor, a lint autofix or a careless
     * copy eventually eats, and here that would silently change every seed this function derives.
     */
    const text = parts.map((part) => String(part)).join(String.fromCharCode(0x1f));
    for (let index = 0; index < text.length; index += 1)
    {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export function createRandom(seed: number): Random
{
    let state = seed >>> 0;

    const next = (): number =>
    {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    return {
        next,

        int(min, max)
        {
            const low = Math.ceil(min);
            const high = Math.floor(max);
            return low + Math.floor(next() * (high - low + 1));
        },

        pick(items)
        {
            return items[Math.floor(next() * items.length)];
        },

        shuffle(items)
        {
            const copy = [...items];
            for (let index = copy.length - 1; index > 0; index -= 1)
            {
                const swap = Math.floor(next() * (index + 1));
                const held = copy[index];
                copy[index] = copy[swap];
                copy[swap] = held;
            }
            return copy;
        },

        chance(probability)
        {
            return next() < probability;
        }
    };
}
