export type Haptic = 'tick' | 'select' | 'ready' | 'win' | 'warn';

const PATTERN: Record<Haptic, number | number[]> = {
    tick: 7,
    select: 12,
    ready: [16, 44, 16],
    win: [22, 48, 22, 48, 38],
    warn: [28, 56, 28]
};

let allowed = false;

export function setHaptics(on: boolean): void
{
    allowed = on;
}

export function hapticsAllowed(): boolean
{
    return allowed;
}

export function haptic(kind: Haptic): boolean
{
    if (!allowed || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function')
    {
        return false;
    }
    return navigator.vibrate(PATTERN[kind]);
}
