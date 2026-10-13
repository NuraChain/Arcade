const OVER = [1, 2.5, 6, 15];

export function discsFor(amount: number, unit: number)
{
    if (amount <= 0)
    {
        return 0;
    }

    const size = unit > 0 ? amount / unit : amount;

    return 1 + OVER.filter((least) => size > least).length;
}
