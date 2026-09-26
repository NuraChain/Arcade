export interface Pot
{
    amount: number;
    eligible: number[];
}

export interface Refund
{
    seat: number;
    amount: number;
}

export function uncalled(put: readonly number[], folded: readonly boolean[]): Refund | null
{
    let top = -1;

    for (let seat = 0; seat < put.length; seat += 1)
    {
        if (!folded[seat] && (top < 0 || put[seat] > put[top]))
        {
            top = seat;
        }
    }

    if (top < 0)
    {
        return null;
    }

    const rest = Math.max(0, ...put.filter((_, seat) => seat !== top));
    const amount = put[top] - rest;

    return amount > 0 ? { seat: top, amount } : null;
}

export function layers(put: readonly number[], folded: readonly boolean[]): Pot[]
{
    const contenders = put.map((_, seat) => seat).filter((seat) => !folded[seat]);
    const levels = [...new Set(contenders.map((seat) => put[seat]))].filter((level) => level > 0).sort((a, b) => a - b);
    const pots: Pot[] = [];
    let previous = 0;

    for (const level of levels)
    {
        const amount = put.reduce((sum, chips) => sum + Math.max(0, Math.min(chips, level) - previous), 0);

        pots.push({ amount, eligible: contenders.filter((seat) => put[seat] >= level) });
        previous = level;
    }

    const dead = put.reduce((sum, chips) => sum + Math.max(0, chips - previous), 0);

    if (dead > 0)
    {
        if (pots.length === 0)
        {
            pots.push({ amount: dead, eligible: contenders });
        }
        else
        {
            pots[pots.length - 1].amount += dead;
        }
    }

    return pots;
}

export function leftOf(button: number, seats: number): (seat: number) => number
{
    return (seat) => (seat - button - 1 + seats * 2) % seats;
}

export function split(amount: number, winners: readonly number[], order: (seat: number) => number): Map<number, number>
{
    const ordered = [...winners].sort((a, b) => order(a) - order(b));
    const share = Math.floor(amount / ordered.length);
    const odd = amount - share * ordered.length;

    return new Map(ordered.map((seat, index) => [seat, share + (index < odd ? 1 : 0)]));
}

export function standing(put: readonly number[], folded: readonly boolean[], allIn: readonly boolean[]): Pot[]
{
    const contenders = put.map((_, seat) => seat).filter((seat) => !folded[seat]);
    const caps = [...new Set(contenders.filter((seat) => allIn[seat]).map((seat) => put[seat]))].filter((cap) => cap > 0).sort((a, b) => a - b);
    const pots: Pot[] = [];
    let previous = 0;

    for (const cap of caps)
    {
        const amount = put.reduce((sum, chips) => sum + Math.max(0, Math.min(chips, cap) - previous), 0);

        pots.push({ amount, eligible: contenders.filter((seat) => !allIn[seat] || put[seat] >= cap) });
        previous = cap;
    }

    const rest = put.reduce((sum, chips) => sum + Math.max(0, chips - previous), 0);
    const live = contenders.filter((seat) => !allIn[seat]);

    if (rest > 0)
    {
        if (live.length > 0 || pots.length === 0)
        {
            pots.push({ amount: rest, eligible: live.length > 0 ? live : contenders });
        }
        else
        {
            pots[pots.length - 1].amount += rest;
        }
    }

    return pots;
}
