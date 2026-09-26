export interface ScrollMemory
{
    save(key: string, y: number): void;
    take(key: string): number | null;
    has(key: string): boolean;
    size(): number;
    clear(): void;
}

export function createScrollMemory(limit = 64): ScrollMemory
{
    const entries = new Map<string, number>();

    return {
        save(key, y)
        {
            entries.delete(key);
            entries.set(key, y);
            while (entries.size > limit)
            {
                const oldest = entries.keys().next().value;
                if (oldest === undefined)
                {
                    break;
                }
                entries.delete(oldest);
            }
        },

        take(key)
        {
            const value = entries.get(key);
            if (value === undefined)
            {
                return null;
            }
            entries.delete(key);
            return value;
        },

        has: (key) => entries.has(key),

        size: () => entries.size,

        clear()
        {
            entries.clear();
        }
    };
}

export const scrollMemory = createScrollMemory();
