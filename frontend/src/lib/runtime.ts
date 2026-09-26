import { realClock, type Clock } from './clock.ts';

export interface Runtime
{
    clock: Clock;
    seed: number;
    latency: number;
}

function defaults(): Runtime
{
    const seed = typeof crypto === 'undefined' ? 1 : crypto.getRandomValues(new Uint32Array(1))[0];

    return { clock: realClock(), seed, latency: 1 };
}

let current: Runtime = defaults();

export function runtime(): Runtime
{
    return current;
}

export function setRuntime(patch: Partial<Runtime>): void
{
    current = { ...current, ...patch };
}

export function resetRuntime(): void
{
    current = defaults();
}
