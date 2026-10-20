import { runtime } from './runtime.ts';

const KEY = 'nura-games.reloaded';

const PROBE_MS = 5000;

export const RELOAD_GAP_MS = 60_000;

let leaving = false;

let mending: Promise<boolean> | null = null;

async function answering()
{
    try
    {
        return (await fetch('/api/auth/me', { cache: 'no-store', signal: AbortSignal.timeout(PROBE_MS) })).status < 500;
    }
    catch
    {
        return false;
    }
}

function lately()
{
    try
    {
        return runtime().clock.now() - Number(sessionStorage.getItem(KEY) ?? 0) < RELOAD_GAP_MS;
    }
    catch
    {
        return true;
    }
}

function noted()
{
    try
    {
        sessionStorage.setItem(KEY, String(runtime().clock.now()));

        return true;
    }
    catch
    {
        return false;
    }
}

async function leave(asked: boolean)
{
    if (!leaving && (asked || !lately()) && await answering() && !leaving && (asked || noted()))
    {
        leaving = true;
        runtime().reload();
    }

    return leaving;
}

function recover()
{
    mending ??= leave(false).finally(() =>
    {
        mending = null;
    });

    return mending;
}

export function reloadPage()
{
    return leave(true);
}

export function chunk<T>(load: () => Promise<T>)
{
    return () => load().catch(async (error: unknown) =>
    {
        if (await recover())
        {
            return await new Promise<T>(() => undefined);
        }

        throw error;
    });
}

export function watchChunks()
{
    const lost = () => void recover();

    window.addEventListener('vite:preloadError', lost);

    return () => window.removeEventListener('vite:preloadError', lost);
}

export function resetChunks()
{
    leaving = false;
    mending = null;
}
