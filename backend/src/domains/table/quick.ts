export type QuickMode = 'live' | 'turns';

export type QuickBlinds = 'low' | 'mid' | 'high';

export interface QuickRules
{
    seats: readonly number[];
    modes: readonly string[];
    targets: readonly number[];
    partners: 'none' | 'optional' | 'required';
    hasCube: boolean;
    hasBlinds: boolean;
}

export interface QuickAsk
{
    seats?: number;
    mode?: QuickMode;
    target?: number;
    blinds?: QuickBlinds;
    cube?: boolean;
    teams?: boolean;
}

export interface QuickFilter
{
    seats: number | null;
    mode: QuickMode;
    target: number | null;
    blinds: QuickBlinds | null;
    cube: boolean | null;
    teams: boolean | null;
}

export interface QuickMake
{
    seats: number;
    mode: QuickMode;
    target: number;
    blinds: QuickBlinds;
    cube: boolean;
    teams: boolean;
}

export type Quick = { ok: true; filter: QuickFilter; make: QuickMake } | { ok: false };

const SIDED = 4;

const CUBED_FROM = 2;

export const seatsByDefault = (rules: Pick<QuickRules, 'seats'>) =>
    rules.seats.find((count) => count >= 4) ?? rules.seats[rules.seats.length - 1];

export function quickOf(rules: QuickRules, ask: QuickAsk): Quick
{
    const mode = ask.mode ?? 'live';
    const forced = (count: number) => count === SIDED && rules.partners === 'required';

    const seated = rules.seats.filter((count) =>
        (ask.seats === undefined || count === ask.seats)
        && (ask.teams === undefined || (ask.teams ? count === SIDED && rules.partners !== 'none' : !forced(count))));

    const targets = rules.targets.filter((target) =>
        (ask.target === undefined || target === ask.target)
        && (ask.cube !== true || target >= CUBED_FROM));

    const playable = rules.modes.includes(mode)
        && seated.length > 0
        && (targets.length > 0 || (ask.target === undefined && ask.cube !== true))
        && (ask.blinds === undefined || rules.hasBlinds)
        && (ask.cube === undefined || rules.hasCube);

    if (!playable)
    {
        return { ok: false };
    }

    const seats = seatsByDefault({ seats: seated });
    const target = targets[0] ?? 0;

    return {
        ok: true,
        filter: {
            seats: ask.seats ?? null,
            mode,
            target: ask.target ?? null,
            blinds: ask.blinds ?? null,
            cube: ask.cube ?? null,
            teams: ask.teams ?? (ask.seats !== undefined && forced(ask.seats) ? true : null)
        },
        make: {
            seats,
            mode,
            target,
            blinds: ask.blinds ?? 'low',
            cube: (ask.cube ?? rules.hasCube) && target >= CUBED_FROM,
            teams: ask.teams ?? forced(seats)
        }
    };
}

export function chairFor(free: readonly number[], taken: readonly number[], teams: boolean)
{
    const beside = teams ? free.filter((seat) => taken.includes((seat + 2) % SIDED)) : [];
    const from = beside.length > 0 ? beside : free;

    return from.length === 0 ? null : Math.min(...from);
}
