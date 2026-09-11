import { createPublicClient, http, type Address, type Hex } from 'viem';

import { normalizeAddress } from '../../lib/crypto.ts';

/**
 * Sign-In With Ethereum, EIP-4361.
 *
 * The message is built HERE, on the server, and stored with the nonce. The client is handed the
 * finished text to sign and never composes it, because every field in it is a claim the server
 * later relies on: the domain the signature is valid for, the chain, the moment, the nonce. A
 * client that composes its own message is a client that can sign "for" a different site.
 */

export interface ChallengeInput
{
    /** The host the browser is really on, from configuration - never from a request header. */
    domain: string;
    uri: string;
    address: string;
    chainId: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
}

/**
 * EIP-4361's exact shape. The field order and the blank lines are part of the format, not
 * styling: wallets parse this to show a readable prompt, and a wallet that cannot parse it falls
 * back to showing raw bytes, which is what trains people to sign things they have not read.
 *
 * `Chain ID` must be the decimal EIP-155 number. The version this replaces passed the chain NAME
 * when no chain was configured - `Chain ID: NuraChain` - which no parser accepts.
 */
export function buildSiweMessage(input: ChallengeInput): string
{
    return [
        `${ input.domain } wants you to sign in with your Ethereum account:`,
        normalizeAddress(input.address),
        '',
        'Sign in to Nura Games. This proves the seat is yours. It costs nothing and moves nothing.',
        '',
        `URI: ${ input.uri }`,
        'Version: 1',
        `Chain ID: ${ input.chainId }`,
        `Nonce: ${ input.nonce }`,
        `Issued At: ${ input.issuedAt.toISOString() }`,
        `Expiration Time: ${ input.expiresAt.toISOString() }`
    ].join('\n');
}

export interface VerifyInput
{
    address: string;
    message: string;
    signature: string;

    /** An EIP-155 chain rpc, for the ERC-1271 call. Absent means EOAs only. */
    rpcUrl?: string;
    chainId?: number;
}

export type VerifyResult =
    | { ok: true; attestation: 'wallet' | 'contract' }
    | { ok: false; reason: 'bad-signature' | 'unreachable-chain' };

/**
 * Verifies that `address` produced `signature` over `message`.
 *
 * Two kinds of wallet, and both are real:
 *
 *  - An EOA signs with a key, and the address is recovered from the signature. No network.
 *  - A SMART-CONTRACT wallet (a Safe, most account-abstraction wallets) has no key to recover
 *    from. It answers ERC-1271's `isValidSignature` instead, which needs an `eth_call`. Skipping
 *    this branch does not fail safe, it fails EXCLUSIONARY: every contract-wallet holder is
 *    locked out with "bad signature" and nothing explains why.
 *
 * A chain that cannot be reached returns `unreachable-chain`, never `ok`. An unverifiable
 * signature is never treated as verified, and the caller is told the difference so it can say
 * "we could not reach the network" instead of "your signature was wrong".
 */
export async function verifySignature(input: VerifyInput): Promise<VerifyResult>
{
    const address = normalizeAddress(input.address) as Address;
    const signature = input.signature as Hex;

    // viem's verifyMessage does the EIP-191 prefixing and the secp256k1 recovery, then falls
    // through to ERC-1271 (and ERC-6492 for counterfactual wallets) when a client is given.
    if (input.rpcUrl === undefined || input.rpcUrl === '')
    {
        const { verifyMessage } = await import('viem');
        const ok = await verifyMessage({ address, message: input.message, signature })
            .catch(() => false);
        return ok ? { ok: true, attestation: 'wallet' } : { ok: false, reason: 'bad-signature' };
    }

    const client = createPublicClient({ transport: http(input.rpcUrl) });
    try
    {
        const ok = await client.verifyMessage({ address, message: input.message, signature });
        if (!ok)
        {
            return { ok: false, reason: 'bad-signature' };
        }

        // It verified. Which branch answered decides what we record: a contract wallet's
        // authority is its code, an EOA's is its key, and the devices panel says which.
        const code = await client.getCode({ address }).catch(() => undefined);
        const isContract = code !== undefined && code !== '0x';
        return { ok: true, attestation: isContract ? 'contract' : 'wallet' };
    }
    catch
    {
        // A local signature check that throws is a bad signature; a network call that throws is
        // an unreachable chain. Distinguish them by trying the offline path once more.
        const { verifyMessage } = await import('viem');
        const offline = await verifyMessage({ address, message: input.message, signature })
            .catch(() => false);
        return offline
            ? { ok: true, attestation: 'wallet' }
            : { ok: false, reason: 'unreachable-chain' };
    }
}
