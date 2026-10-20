import { realClock, type Clock } from './clock.ts';

export interface Runtime
{
    clock: Clock;
    seed: number;
    latency: number;
    reload: () => void;
}

function defaults(): Runtime
{
    const seed = typeof crypto === 'undefined' ? 1 : crypto.getRandomValues(new Uint32Array(1))[0];

    return { clock: realClock(), seed, latency: 1, reload: () => window.location.reload() };
}

let current: Runtime = defaults();

export function runtime()
{
    return current;
}

export function setRuntime(patch: Partial<Runtime>)
{
    current = { ...current, ...patch };
}

export function resetRuntime()
{
    current = defaults();
}
