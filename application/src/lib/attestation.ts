import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

import { deviceResource } from '../../../server/src/domains/device/resource.ts';
import type { PeerDevice } from '../api.ts';
import { deviceVerifies } from './device-id.ts';

/**
 * Checking, for ourselves, that somebody else's device is really theirs.
 *
 * This is the question the whole sealed-chat design turns on, and it is NOT the question the
 * self-certifying device id answers. An id is a hash of the keys published beside it, so a device
 * this server fabricates re-derives perfectly: the id proves the keys were not swapped in transit
 * and proves nothing whatever about whose device it is. PR 11's confirmation flow does not help
 * either - it only covers devices of your own account.
 *
 * So a peer device travels with the enrolment signature, and this file recovers the signing address
 * from it without asking anybody. Three things have to line up:
 *
 *   1. the id really is the hash of the two keys,
 *   2. the signed message names THAT device in its EIP-4361 `Resources` line,
 *   3. the signature recovers to the address published beside it.
 *
 * What this cannot do is tell you the address is the right PERSON's. That is not a gap in the
 * maths, it is where the trust has to come from: the address is shown so it can be compared out of
 * band, the way a safety number is. A server that swapped a peer's address would have to swap it
 * everywhere that person's address appears, and a human comparing it once would see it.
 *
 * `@noble/curves` rather than `viem` because this runs in the browser and viem is an order of
 * magnitude larger for the one thing needed here - recovering a public key from a signature.
 */

export { deviceResource };

export type PeerVerdict =
    | 'ok'

    /** The id is not the hash of those keys. The list has been edited. */
    | 'keys-swapped'

    /** A real signature over a message that authorises a DIFFERENT device. */
    | 'wrong-device'

    /** The signature does not recover to the address published beside it. */
    | 'bad-signature'

    /**
     * A contract wallet. ERC-1271 has no signature to recover - the answer lives in contract code,
     * which needs an `eth_call` this browser cannot make. Refused rather than accepted: an
     * unverifiable proof is not a verified one.
     */
    | 'needs-chain';

const ADDRESS = /^0x[0-9a-f]{40}$/;

const hexToBytes = (hex: string): Uint8Array =>
{
    const clean = hex.replace(/^0x/, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let index = 0; index < bytes.length; index += 1)
    {
        bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
{
    let hex = '';
    for (const byte of bytes)
    {
        hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
};

/**
 * The 0x19 byte EIP-191 puts in front of everything it signs.
 *
 * Built from its code point rather than written as an escape: it is an invisible control
 * character, and a source file that carries one literally is a file some editor, some lint
 * autofix or some copy-paste eventually eats - leaving code that recovers a perfectly valid
 * address that simply is not the signer.
 */
const EIP_191_PREFIX = String.fromCharCode(0x19);

/**
 * EIP-191's personal_sign digest.
 *
 * Two details, and both fail silently - a mistake in either recovers SOME address, just never the
 * signer. The prefix begins with the 0x19 byte, and the length is the BYTE length of the UTF-8
 * encoding rather than the character count, so a message with a Persian word in it is longer
 * than it looks.
 */
function personalDigest(message: string): Uint8Array
{
    const body = new TextEncoder().encode(message);
    const prefix = new TextEncoder().encode(`${ EIP_191_PREFIX }Ethereum Signed Message:\n${ body.length }`);

    const joined = new Uint8Array(prefix.length + body.length);
    joined.set(prefix, 0);
    joined.set(body, prefix.length);

    return keccak_256(joined);
}

/** The address that produced a `personal_sign`, or null if the signature is not recoverable. */
export function addressFromPersonalSign(message: string, signature: string): string | null
{
    try
    {
        const raw = hexToBytes(signature);
        if (raw.length !== 65)
        {
            return null;
        }

        // `v` is 27/28 from every wallet that follows the convention, and 0/1 from a few that do
        // not. Both are accepted; anything else is not a recovery bit.
        const v = raw[64] >= 27 ? raw[64] - 27 : raw[64];
        if (v !== 0 && v !== 1)
        {
            return null;
        }

        const point = new secp256k1.Signature(
            BigInt(`0x${ bytesToHex(raw.slice(0, 32)) }`),
            BigInt(`0x${ bytesToHex(raw.slice(32, 64)) }`)
        ).addRecoveryBit(v).recoverPublicKey(personalDigest(message));

        // An Ethereum address is the last 20 bytes of the keccak of the uncompressed public key
        // with its 0x04 prefix removed.
        return `0x${ bytesToHex(keccak_256(point.toRawBytes(false).slice(1)).slice(-20)) }`;
    }
    catch
    {
        // Malformed hex, a point off the curve, an s value out of range: unverifiable is not
        // verified, and there is nothing here worth telling apart.
        return null;
    }
}

/**
 * Whether this device is what it says it is.
 *
 * Ordered so the cheapest structural check runs first and the elliptic curve maths only runs on a
 * device that could still be genuine.
 */
export async function verifyPeerDevice(device: PeerDevice): Promise<PeerVerdict>
{
    if (!await deviceVerifies(device))
    {
        return 'keys-swapped';
    }

    if (!device.message.includes(deviceResource(device.id)))
    {
        return 'wrong-device';
    }

    if (device.attested === 'contract')
    {
        return 'needs-chain';
    }

    const address = device.address.trim().toLowerCase();
    if (!ADDRESS.test(address))
    {
        return 'bad-signature';
    }

    return addressFromPersonalSign(device.message, device.signature) === address
        ? 'ok'
        : 'bad-signature';
}
