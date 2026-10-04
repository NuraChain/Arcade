import { createPublicClient, http, type Address, type Hex } from 'viem';

import { normalizeAddress } from '../../lib/crypto.ts';
import { deviceLine } from '../device/resource.ts';

/**
 * The words a wallet is asked to sign, composed HERE and stored with the nonce.
 *
 * Plain text, not EIP-4361: the site's name, what the signature is for, the device it names and
 * the nonce. The nonce is what makes a signature single-use - without it one captured signature
 * would sign in forever - and the device line is what a peer checks, so both are in the signed
 * bytes. The address and the expiry are not: the signature recovers the address, and the server
 * holds the expiry beside the nonce.
 */
const body = (statement: string, nonce: string, deviceId?: string) =>
    [statement, '', ...(deviceId === undefined ? [] : [deviceLine(deviceId)]), `Nonce: ${ nonce }`].join('\n');

export function signInText(site: string, nonce: string, deviceId?: string)
{
    return body(
        deviceId === undefined
            ? `Sign in to Nura Games (${ site }).`
            : `Sign in to Nura Games (${ site }) and let this browser read and send your messages.`,
        nonce,
        deviceId
    );
}

export function deviceText(site: string, nonce: string, deviceId: string)
{
    return body(`Let this browser read and send your messages on Nura Games (${ site }).`, nonce, deviceId);
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
