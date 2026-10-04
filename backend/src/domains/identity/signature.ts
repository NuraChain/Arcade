import {
    encodeDeployData,
    erc6492SignatureValidatorAbi,
    erc6492SignatureValidatorByteCode,
    hashMessage,
    isErc6492Signature,
    parseAbi,
    verifyMessage,
    type Address,
    type Hex
} from 'viem';

import { boundedClient, refusedByContract } from '../../chain/rpc.ts';
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

const ERC1271_MAGIC = '0x1626ba7e';

const ERC1271 = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);

export async function verifySignature(input: VerifyInput): Promise<VerifyResult>
{
    const address = normalizeAddress(input.address) as Address;
    const signature = input.signature as Hex;

    if (await verifyMessage({ address, message: input.message, signature }).catch(() => false))
    {
        return { ok: true, attestation: 'wallet' };
    }
    if (input.rpcUrl === undefined || input.rpcUrl === '')
    {
        return { ok: false, reason: 'bad-signature' };
    }

    const client = boundedClient(input.rpcUrl);
    const hash = hashMessage(input.message);
    try
    {
        if (isErc6492Signature(signature))
        {
            const { data } = await client.call({
                data: encodeDeployData({
                    abi: erc6492SignatureValidatorAbi,
                    bytecode: erc6492SignatureValidatorByteCode,
                    args: [address, hash, signature]
                })
            });
            return data !== undefined && data !== '0x' && BigInt(data) === 1n
                ? { ok: true, attestation: 'contract' }
                : { ok: false, reason: 'bad-signature' };
        }

        const code = await client.getCode({ address });
        if (code === undefined || code === '0x')
        {
            return { ok: false, reason: 'bad-signature' };
        }

        const answer = await client.readContract({ address, abi: ERC1271, functionName: 'isValidSignature', args: [hash, signature] });
        return answer === ERC1271_MAGIC ? { ok: true, attestation: 'contract' } : { ok: false, reason: 'bad-signature' };
    }
    catch (error)
    {
        return { ok: false, reason: refusedByContract(error) ? 'bad-signature' : 'unreachable-chain' };
    }
}
