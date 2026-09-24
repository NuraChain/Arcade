export const TURN_MS: Readonly<Record<string, number>> = {
    live: 30_000,
    turns: 24 * 60 * 60 * 1000
};

export const turnMs = (mode: string): number => TURN_MS[mode] ?? TURN_MS.live;
