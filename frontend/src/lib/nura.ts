import { NURA_CHAIN } from '../data/chain.ts';

const WEI = 10n ** 18n;

const PLACES = 4;

const latin = (text: string) => text
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.');

export function parseNura(text: string)
{
    const found = /^(\d{1,22})(?:\.(\d{1,18}))?$/.exec(latin(text.trim()));

    if (found === null)
    {
        return null;
    }

    const wei = BigInt(found[1]) * WEI + BigInt((found[2] ?? '').padEnd(18, '0'));

    return wei > 0n ? wei : null;
}

export function bpsOf(text: string)
{
    const found = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(latin(text.trim()));

    return found === null ? null : Number(found[1]) * 100 + Number((found[2] ?? '').padEnd(2, '0'));
}

export function nuraOf(wei: string | bigint)
{
    const value = typeof wei === 'bigint' ? wei : BigInt(wei);

    return Number(value / 10n ** BigInt(18 - PLACES)) / 10 ** PLACES;
}

export function typedNura(wei: bigint)
{
    const whole = wei / WEI;
    const part = (wei % WEI).toString().padStart(18, '0').replace(/0+$/, '');

    return part === '' ? whole.toString() : `${ whole }.${ part }`;
}

export function explorerTx(chainId: number, hash: string)
{
    return String(chainId) === NURA_CHAIN.chainId && NURA_CHAIN.explorerUrls.length > 0
        ? `${ NURA_CHAIN.explorerUrls[0] }/tx/${ hash }`
        : null;
}
