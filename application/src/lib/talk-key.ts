export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Escape', 'Tab', 'Enter', 'Slash', 'BracketLeft']);

export function keyName(code: string): string
{
    if (/^Key[A-Z]$/.test(code))
    {
        return code.slice(3);
    }

    if (/^Digit\d$/.test(code))
    {
        return code.slice(5);
    }

    if (/^Numpad\d$/.test(code))
    {
        return `Num ${ code.slice(6) }`;
    }

    return code.replace(/(Left|Right)$/, ' $1');
}
