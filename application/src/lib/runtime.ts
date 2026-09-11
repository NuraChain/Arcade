import { realClock, type Clock } from './clock.ts';

export interface Runtime
{
    clock: Clock;
    seed: number;
    latency: number;
}

function defaults(): Runtime
{
    return { clock: realClock(), seed: 1, latency: 1 };
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
