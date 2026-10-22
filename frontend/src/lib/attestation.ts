import { keccak_256 } from '@noble/hashes/sha3.js';

import { deviceLine, namesDevice } from '../../../backend/src/domains/device/resource.ts';
import type { PeerDevice } from '../api.ts';
import { deviceVerifies } from './device-id.ts';
import { addressFrom } from './signer.ts';

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
 *   2. the signed message names THAT device on a `Browser key:` line of its own,
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

export { deviceLine };

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
    | 'needs-chain'

    /**
     * A real signature, by an address that is not the account's.
     *
     * Decided by the caller rather than here, because this file only ever sees one device and the
     * account's own wallet is a fact about the MEMBER. It is an alarm, not an absence: somebody
     * vouched for this device, and it was not the person whose device it claims to be.
     */
    | 'wrong-address';

const ADDRESS = /^0x[0-9a-f]{40}$/;

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
export function addressFromPersonalSign(message: string, signature: string)
{
    return addressFrom(personalDigest(message), signature);
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

    if (!namesDevice(device.message, device.id))
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
