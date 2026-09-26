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

export function forget(key: string): void
{
    try
    {
        localStorage.removeItem(key);
    }
    catch
    {
        return;
    }
}

export function rememberJson(key: string, value: unknown): boolean
{
    return remember(key, JSON.stringify(value));
}

export function recallJson<T>(key: string, accept: (value: unknown) => value is T): T | null
{
    try
    {
        const raw = localStorage.getItem(key);
        if (raw === null)
        {
            return null;
        }
        const parsed: unknown = JSON.parse(raw);
        return accept(parsed) ? parsed : null;
    }
    catch
    {
        return null;
    }
}
