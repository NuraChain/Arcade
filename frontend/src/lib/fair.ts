import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

export function mac(key: Uint8Array, message: Uint8Array)
{
    return hmac(sha256, key, message);
}

export function keccak(data: Uint8Array)
{
    return keccak_256(data);
}
