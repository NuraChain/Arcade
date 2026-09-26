/**
 * Normalises what `DataSource.query()` hands back.
 *
 * TypeORM's raw `query()` does not return one shape. A SELECT gives the rows. An INSERT, UPDATE
 * or DELETE - even with `returning` - gives `[rows, affectedCount]`, a two-element tuple.
 *
 * That difference is silent and vicious. `result.length === 0` is never true for a mutation that
 * matched nothing, because the tuple always has two elements; and `result[0].message` is the ROWS
 * ARRAY rather than the first row, so it reads as `undefined`. A "did this UPDATE match?" check
 * written the obvious way therefore always says yes, and the value it reads is always missing.
 *
 * It cost an afternoon here: a sign-in that burned its nonce correctly, then handed `undefined`
 * to the signature verifier and reported "that signature did not match the address" for a
 * perfectly good signature. Every mutating query in this server goes through `rowsOf`.
 */
export function rowsOf<T>(result: unknown): T[]
{
    if (!Array.isArray(result))
    {
        return [];
    }

    // The mutation shape: exactly [rows, affectedCount].
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number')
    {
        return result[0] as T[];
    }

    return result as T[];
}

/** The first row, or null. What almost every caller actually wants. */
export function firstRow<T>(result: unknown): T | null
{
    return rowsOf<T>(result)[0] ?? null;
}

/** How many rows a mutation touched, whether or not it used `returning`. */
export function affectedBy(result: unknown): number
{
    if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number')
    {
        return result[1];
    }
    return Array.isArray(result) ? result.length : 0;
}
