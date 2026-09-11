const MARKS = /[\u0300-\u036F]/g;
const ARABIC_MARKS = /[\u064B-\u0652\u0670\u0640]/g;
const INVISIBLE = /[\u200B-\u200F]/g;

export function fold(value: string): string
{
    return value
        .normalize('NFD')
        .replace(MARKS, '')
        .replace(ARABIC_MARKS, '')
        .replace(INVISIBLE, '')
        .replace(/[يى]/g, 'ی')
        .replace(/ك/g, 'ک')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ۀ/g, 'ه')
        .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function rank(fields: readonly string[], needle: string): number
{
    if (needle === '')
    {
        return 0;
    }
    let best = 0;
    for (const field of fields)
    {
        const value = fold(field);
        if (value === needle)
        {
            best = Math.max(best, 100);
        }
        else if (value.startsWith(needle))
        {
            best = Math.max(best, 70);
        }
        else if (value.includes(` ${ needle }`))
        {
            best = Math.max(best, 50);
        }
        else if (value.includes(needle))
        {
            best = Math.max(best, 25);
        }
    }
    return best;
}

export function ranked<T>(items: readonly T[], needle: string, fields: (item: T) => readonly string[]): T[]
{
    const scored: Array<{ item: T; score: number }> = [];
    for (const item of items)
    {
        const score = rank(fields(item), needle);
        if (score > 0)
        {
            scored.push({ item, score });
        }
    }
    return scored.sort((a, b) => b.score - a.score).map((entry) => entry.item);
}
