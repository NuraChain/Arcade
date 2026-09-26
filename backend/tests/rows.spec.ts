import { describe, expect, it } from 'vitest';

import { affectedBy, firstRow, rowsOf } from '../src/lib/rows.ts';

/**
 * TypeORM's raw `query()` returns two different shapes, and the difference is silent.
 *
 * This cost a real afternoon: a sign-in burned its nonce correctly, then handed `undefined` to the
 * signature verifier and reported "that signature did not match the address" for a perfectly
 * valid signature. Both the success path and the replay path produced the same wrong answer,
 * because `result.length === 0` is never true for a tuple of length two.
 */

/** What a SELECT gives back. */
const SELECT = [{ id: 'a', message: 'hello' }, { id: 'b', message: 'world' }];

/** What an INSERT/UPDATE/DELETE gives back: [rows, affectedCount]. */
const MUTATION = [[{ id: 'a', message: 'hello' }], 1];

/** A mutation that matched nothing still returns a two-element tuple. */
const MUTATION_EMPTY = [[], 0];

describe('normalising what the driver returns', () =>
{
    it('passes a select result straight through', () =>
    {
        expect(rowsOf(SELECT)).toEqual(SELECT);
    });

    it('unwraps the rows out of a mutation tuple', () =>
    {
        expect(rowsOf(MUTATION)).toEqual([{ id: 'a', message: 'hello' }]);
    });

    it('reports a mutation that matched nothing as no rows', () =>
    {
        // THE bug. `MUTATION_EMPTY.length` is 2, so a bare `result.length === 0` check says the
        // update matched - and every caller downstream then works with garbage.
        expect(MUTATION_EMPTY.length).toBe(2);
        expect(rowsOf(MUTATION_EMPTY)).toEqual([]);
        expect(firstRow(MUTATION_EMPTY)).toBeNull();
    });

    it('reads the first row of either shape', () =>
    {
        expect(firstRow<{ message: string }>(SELECT)?.message).toBe('hello');
        expect(firstRow<{ message: string }>(MUTATION)?.message).toBe('hello');

        // And the shape that used to read as `undefined`: `MUTATION[0]` is the ROWS ARRAY, so
        // `MUTATION[0].message` was undefined rather than 'hello'.
        expect((MUTATION[0] as unknown as { message?: string }).message).toBeUndefined();
    });

    it('counts what a mutation touched, with or without returning', () =>
    {
        expect(affectedBy(MUTATION)).toBe(1);
        expect(affectedBy(MUTATION_EMPTY)).toBe(0);
        expect(affectedBy(SELECT)).toBe(2);
    });

    it('is not fooled by a select whose rows happen to look like a tuple', () =>
    {
        // Two columns where the second is a number is an ordinary select result, not a mutation.
        // The discriminator is that a mutation tuple's FIRST element is itself an array.
        const lookalike = [{ a: 1 }, 2] as unknown[];
        expect(rowsOf(lookalike)).toEqual(lookalike);
    });

    it('survives anything that is not an array', () =>
    {
        expect(rowsOf(undefined)).toEqual([]);
        expect(rowsOf(null)).toEqual([]);
        expect(firstRow({})).toBeNull();
    });
});
