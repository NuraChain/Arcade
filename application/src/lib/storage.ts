export function remember(key: string, value: string): boolean
{
    try
    {
        localStorage.setItem(key, value);
        return true;
    }
    catch
    {
        return false;
    }
}

export function recall(key: string, allowed: readonly string[]): string | null
{
    try
    {
        const value = localStorage.getItem(key);
        return value !== null && allowed.includes(value) ? value : null;
    }
    catch
    {
        return null;
    }
}
