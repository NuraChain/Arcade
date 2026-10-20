export interface WaitingSeat
{
    tableId: string;
    userId: string;
}

export function strikes(previous: ReadonlySet<string>, absentNow: readonly WaitingSeat[])
{
    const vacate: WaitingSeat[] = [];
    const next = new Set<string>();

    for (const seat of absentNow)
    {
        const key = `${ seat.tableId }:${ seat.userId }`;

        if (previous.has(key))
        {
            vacate.push(seat);
        }
        else
        {
            next.add(key);
        }
    }

    return { vacate, next };
}
