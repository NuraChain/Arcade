export const TURN_MS: Readonly<Record<string, number>> = {
    live: 30_000,
    turns: 24 * 60 * 60 * 1000
};

export const turnMs = (mode: string) => TURN_MS[mode] ?? TURN_MS.live;

export const MISSES_ALLOWED = 3;

export const nextMissForfeits = (timeouts: number) => timeouts + 1 >= MISSES_ALLOWED;
