import { hashSeed } from '../lib/random.ts';

export interface SignInRequest
{
    domain: string;
    address: string;
    chainId: string;
    nonce: string;
    issuedAt: number;
    statement: string;
    uri: string;
}

export function nonceFor(seed: number, address: string, at: number): string
{
    return hashSeed(seed, address.toLowerCase(), Math.floor(at / 1000)).toString(36).padStart(8, '0').slice(0, 12);
}

export function buildSignInMessage(request: SignInRequest): string
{
    return [
        `${ request.domain } wants you to sign in with your wallet:`,
        request.address,
        '',
        request.statement,
        '',
        `URI: ${ request.uri }`,
        'Version: 1',
        `Chain ID: ${ request.chainId }`,
        `Nonce: ${ request.nonce }`,
        `Issued At: ${ new Date(request.issuedAt).toISOString() }`
    ].join('\n');
}

export function handleFor(address: string): string
{
    return address.slice(2, 8).toLowerCase();
}
