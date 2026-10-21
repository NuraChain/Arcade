export const WEI_PER_NURA = 10n ** 18n;

export const LADDER_NURA = [1, 5, 10, 25, 50, 100, 250] as const;

export const STAKE_LADDER: readonly string[] = LADDER_NURA.map((nura) => (BigInt(nura) * WEI_PER_NURA).toString());

export const BREAK_DAYS = [1, 7, 30] as const;

export type BreakDays = typeof BREAK_DAYS[number];

export const CONSENT_MS = 30 * 60 * 1000;

export const BPS = 10_000n;

export const ELIGIBILITIES = ['yes', 'paid-wallet', 'paid-minor', 'paid-terms', 'paid-break'] as const;

export type Eligibility = typeof ELIGIBILITIES[number];

export interface Standing
{
    address: string | null;
    minor: boolean;
    accepted: boolean;
    onBreak: boolean;
}

export function eligibilityOf(standing: Standing): Eligibility
{
    if (standing.address === null)
    {
        return 'paid-wallet';
    }

    if (standing.minor)
    {
        return 'paid-minor';
    }

    if (!standing.accepted)
    {
        return 'paid-terms';
    }

    return standing.onBreak ? 'paid-break' : 'yes';
}

export function weiOf(text: string)
{
    if (!/^[0-9]{1,40}$/.test(text))
    {
        return null;
    }

    const wei = BigInt(text);
    return wei > 0n ? wei : null;
}

export function onLadder(amount: string, ceiling: bigint)
{
    return STAKE_LADDER.includes(amount) && BigInt(amount) <= ceiling;
}

export function potOf(amount: bigint, seats: number)
{
    return amount * BigInt(seats);
}

export function cutOf(pot: bigint, feeBps: number)
{
    return (pot * BigInt(feeBps)) / BPS;
}

export function shareOf(pot: bigint, feeBps: number, winners: number)
{
    return winners > 0 ? (pot - cutOf(pot, feeBps)) / BigInt(winners) : 0n;
}

export function maskOf(seats: readonly number[])
{
    return seats.reduce((mask, seat) => mask | (1 << seat), 0);
}

export function seatsOfMask(mask: number)
{
    const seats: number[] = [];

    for (let seat = 0; seat < 9; seat += 1)
    {
        if ((mask >> seat) & 1)
        {
            seats.push(seat);
        }
    }

    return seats;
}
