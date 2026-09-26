import { runtime } from './runtime.ts';

export type Haptic = 'tick' | 'select' | 'ready' | 'win' | 'warn' | 'capture' | 'hit' | 'deny' | 'hand' | 'kot';

const PATTERN: Record<Haptic, number | number[]> = {
    tick: 7,
    select: 12,
    ready: [16, 44, 16],
    win: [22, 48, 22, 48, 38],
    warn: [28, 56, 28],
    capture: [20, 30, 28],
    hit: [45, 60, 45],
    deny: [10, 50, 10],
    hand: [16, 40, 24],
    kot: [20, 40, 20, 40, 60]
};

export const HAPTIC_GAP_MS = 80;

let allowed = false;

let last = -Infinity;

export function setHaptics(on: boolean): void
{
    allowed = on;
}

export function hapticsAllowed(): boolean
{
    return allowed;
}

export function resetHaptics(): void
{
    allowed = false;
    last = -Infinity;
}

export function haptic(kind: Haptic): boolean
{
    if (!allowed || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function')
    {
        return false;
    }
    if (navigator.userActivation?.hasBeenActive === false)
    {
        return false;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible')
    {
        return false;
    }

    const now = runtime().clock.now();
    if (now - last < HAPTIC_GAP_MS)
    {
        return false;
    }
    last = now;

    return navigator.vibrate(PATTERN[kind]);
}
