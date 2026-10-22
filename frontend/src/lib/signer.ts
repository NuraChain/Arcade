import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { bytesOf, hexOf } from '../../../backend/src/domains/match/fair.ts';

export function addressFrom(digest: Uint8Array, signature: string)
{
    try
    {
        const raw = bytesOf(signature);

        if (raw.length !== 65)
        {
            return null;
        }

        const v = raw[64] >= 27 ? raw[64] - 27 : raw[64];

        if (v !== 0 && v !== 1)
        {
            return null;
        }

        const point = new secp256k1.Signature(BigInt(hexOf(raw.slice(0, 32))), BigInt(hexOf(raw.slice(32, 64))))
            .addRecoveryBit(v)
            .recoverPublicKey(digest);

        return hexOf(keccak_256(point.toBytes(false).slice(1)).slice(-20));
    }
    catch
    {
        return null;
    }
}
