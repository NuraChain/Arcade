import { describe, expect, it } from 'vitest';

import {
    BREAK_DAYS,
    CONSENT_MS,
    ELIGIBILITIES,
    LADDER_NURA,
    STAKE_LADDER,
    WEI_PER_NURA,
    cutOf,
    eligibilityOf,
    maskOf,
    onLadder,
    potOf,
    seatsOfMask,
    shareOf,
    weiOf,
    type Standing
} from '../src/domains/stake/policy.ts';
import { TABLE_REFUSALS } from '../src/domains/table/refusals.ts';

const adult: Standing = { address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', minor: false, accepted: true, onBreak: false };

describe('who may play for NURA', () =>
{
    it('is a wallet account of an adult who accepted the terms and is not on a break', () =>
    {
        expect(eligibilityOf(adult)).toBe('yes');
    });

    it('asks the questions in order: a wallet, then age, then the terms, then a break', () =>
    {
        expect(eligibilityOf({ address: null, minor: true, accepted: false, onBreak: true })).toBe('paid-wallet');
        expect(eligibilityOf({ ...adult, minor: true, accepted: false, onBreak: true })).toBe('paid-minor');
        expect(eligibilityOf({ ...adult, accepted: false, onBreak: true })).toBe('paid-terms');
        expect(eligibilityOf({ ...adult, onBreak: true })).toBe('paid-break');
    });

    it('answers every no with a word the table refuses with', () =>
    {
        for (const word of ELIGIBILITIES.filter((may) => may !== 'yes'))
        {
            expect(Object.hasOwn(TABLE_REFUSALS, word), word).toBe(true);
        }
    });
});

describe('an amount of NURA', () =>
{
    it('is a whole number of wei, above nothing, in at most forty digits', () =>
    {
        expect(weiOf('1')).toBe(1n);
        expect(weiOf('1000000000000000000')).toBe(WEI_PER_NURA);
        expect(weiOf('9'.repeat(40))).toBe(10n ** 40n - 1n);
    });

    it('is nothing for anything else', () =>
    {
        for (const text of ['', '0', '00', '-1', '+1', '1.5', '1e18', '0x10', ' 1', '1 ', 'abc', '9'.repeat(41), '١'])
        {
            expect(weiOf(text), JSON.stringify(text)).toBeNull();
        }
    });
});

describe('the stakes a table may be played for', () =>
{
    it('are the ladder, in NURA, written in wei', () =>
    {
        expect(LADDER_NURA).toEqual([1, 5, 10, 25, 50, 100, 250]);
        expect(STAKE_LADDER).toEqual(LADDER_NURA.map((nura) => `${ nura }000000000000000000`));
    });

    it('are only the ladder, and only up to the vault\'s ceiling', () =>
    {
        const fifty = 50n * WEI_PER_NURA;

        expect(onLadder(STAKE_LADDER[0], fifty)).toBe(true);
        expect(onLadder(STAKE_LADDER[4], fifty)).toBe(true);
        expect(onLadder(STAKE_LADDER[5], fifty)).toBe(false);
        expect(onLadder('2000000000000000000', fifty)).toBe(false);
        expect(onLadder('1000000000000000001', fifty)).toBe(false);
        expect(onLadder('01000000000000000000', fifty)).toBe(false);
    });
});

describe('the pot and what a winner is paid', () =>
{
    it('is the stake times the chairs, the fee cut from it, the rest shared by the winners as the vault shares it', () =>
    {
        const stake = 10n * WEI_PER_NURA;
        const pot = potOf(stake, 4);

        expect(pot).toBe(40n * WEI_PER_NURA);
        expect(cutOf(pot, 500)).toBe(2n * WEI_PER_NURA);
        expect(shareOf(pot, 500, 1)).toBe(38n * WEI_PER_NURA);
        expect(shareOf(pot, 500, 2)).toBe(19n * WEI_PER_NURA);
    });

    it('rounds a share down, so the dust stays with the fee and nothing is paid that was not staked', () =>
    {
        const pot = potOf(1n, 3);

        expect(shareOf(pot, 0, 2)).toBe(1n);
        expect(shareOf(pot, 0, 2) * 2n).toBeLessThanOrEqual(pot);
        expect(shareOf(7n, 1000, 3)).toBe(2n);
        expect(shareOf(pot, 500, 0)).toBe(0n);
    });

    it('names its winners by seat in a mask the vault reads', () =>
    {
        expect(maskOf([0])).toBe(1);
        expect(maskOf([1, 3])).toBe(10);
        expect(maskOf([8])).toBe(256);
        expect(seatsOfMask(10)).toEqual([1, 3]);
        expect(seatsOfMask(maskOf([0, 2, 8]))).toEqual([0, 2, 8]);
        expect(seatsOfMask(0)).toEqual([]);
    });
});

describe('the rest of the rules', () =>
{
    it('offers a break of a day, a week or a month, and a signature lasts half an hour', () =>
    {
        expect(BREAK_DAYS).toEqual([1, 7, 30]);
        expect(CONSENT_MS).toBe(30 * 60 * 1000);
    });
});
