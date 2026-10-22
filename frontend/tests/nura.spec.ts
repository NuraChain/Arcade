import { describe, expect, it } from 'vitest';

import { explorerTx, nuraOf, parseNura, typedNura } from '../src/lib/nura.ts';

const NURA = 10n ** 18n;

describe('an amount of NURA as somebody types it', () =>
{
    it('reads whole and fractional NURA into wei', () =>
    {
        expect(parseNura('10')).toBe(10n * NURA);
        expect(parseNura('2.5')).toBe(25n * NURA / 10n);
        expect(parseNura(' 0.000000000000000001 ')).toBe(1n);
        expect(parseNura('1000000')).toBe(1_000_000n * NURA);
    });

    it('reads the digits and the decimal mark of a Persian or Arabic keyboard', () =>
    {
        expect(parseNura('۱۰')).toBe(10n * NURA);
        expect(parseNura('۲٫۵')).toBe(25n * NURA / 10n);
        expect(parseNura('٣')).toBe(3n * NURA);
    });

    it('is nothing for nothing, a negative, a nought, too many places or anything else', () =>
    {
        for (const text of ['', '0', '0.0', '-1', '+1', '1.', '.5', '1e3', '0x10', 'ten', '1.0000000000000000001', '1 2', '1,000', '1,5', '1،5'])
        {
            expect(parseNura(text), JSON.stringify(text)).toBeNull();
        }
    });
});

describe('an amount of NURA as it is shown', () =>
{
    it('keeps four places and drops the rest, never rounding up', () =>
    {
        expect(nuraOf('19000000000000000000')).toBe(19);
        expect(nuraOf(25n * NURA / 10n)).toBe(2.5);
        expect(nuraOf('123456789000000000')).toBe(0.1234);
        expect(nuraOf('99999999999999999')).toBe(0.0999);
        expect(nuraOf('0')).toBe(0);
    });

    it('writes back exactly what a balance holds, for a field to be filled with', () =>
    {
        expect(typedNura(10n * NURA)).toBe('10');
        expect(typedNura(25n * NURA / 10n)).toBe('2.5');
        expect(typedNura(1n)).toBe('0.000000000000000001');
        expect(parseNura(typedNura(123_456_789_012_345_678_901n))).toBe(123_456_789_012_345_678_901n);
    });
});

describe('a transaction on the explorer', () =>
{
    it('is linked on NuraChain and nowhere else', () =>
    {
        const hash = `0x${ 'ab'.repeat(32) }`;

        expect(explorerTx(1020, hash)).toBe(`https://explorer.nurachain.net/tx/${ hash }`);
        expect(explorerTx(31337, hash)).toBeNull();
    });
});
