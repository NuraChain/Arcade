import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

import { keccak256 } from 'viem';

/**
 * Server-side primitives. Small on purpose - everything here is either a one-liner over
 * `node:crypto` or a decision that deserves to be written down once.
 */

/**
 * A bearer token: 256 bits of randomness, url-safe.
 *
 * `randomBytes` and not `Math.random`, which is seeded, predictable and in this codebase
 * deliberately so - `lib/random.ts` exists to make the mock data reproducible. A token minted
 * from a reproducible generator is a token anyone can reproduce.
 */
export function mintToken()
{
    return randomBytes(32).toString('base64url');
}

/**
 * A die, 1 to 6, from the same generator the tokens come from.
 *
 * `randomInt` rather than `randomBytes(1) % 6`: Node rejects and redraws, so every face is equally
 * likely, where modulo over a byte quietly favours the low ones. `Math.random` is out for the
 * reason above - it is seeded here on purpose.
 *
 * This is the die of a free table, and nothing there can be checked: the server draws, the server
 * records, and a player cannot see that it did not draw twice and keep the one it liked. A table
 * played for NURA draws from a seed its players can work out again afterwards
 * (`domains/match/fair.ts`).
 */
export function rollDie()
{
    return randomInt(1, 7);
}

/** One of `count` things, drawn the same way a die is. Used for who moves first. */
export function pickBelow(count: number)
{
    return count <= 1 ? 0 : randomInt(0, count);
}

export function hmacSha256(key: Uint8Array, message: Uint8Array)
{
    return new Uint8Array(createHmac('sha256', key).update(message).digest());
}

export function keccak(data: Uint8Array)
{
    return keccak256(data, 'bytes');
}

/** A nonce: 128 bits, hex, unpredictable. Same reasoning as above. */
export function mintNonce()
{
    return randomBytes(16).toString('hex');
}

/**
 * The form a secret is stored in.
 *
 * Plain SHA-256 rather than a password hash, and the difference matters: a 256-bit random token
 * has no guessable structure, so the slow hashing that defends a human-chosen password buys
 * nothing here and costs a round trip's latency on every single request. What this does buy is
 * that a leaked database cannot be replayed as a set of live sessions.
 */
export function hashToken(token: string)
{
    return createHash('sha256').update(token).digest('hex');
}

/**
 * An address in the one form this server stores and compares.
 *
 * Every address is lowercased at the boundary. EIP-55 checksum casing is a DISPLAY concern and a
 * transport accident - providers disagree about which they hand back - so comparing raw strings
 * is how one person ends up with two accounts. The `citext` columns and their CHECK constraints
 * enforce the same rule one layer down.
 */
export function normalizeAddress(address: string)
{
    return address.trim().toLowerCase();
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

export function isAddress(address: string)
{
    return ADDRESS.test(normalizeAddress(address));
}
