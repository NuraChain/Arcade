import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
export function mintToken(): string
{
    return randomBytes(32).toString('base64url');
}

/** A nonce: 128 bits, hex, unpredictable. Same reasoning as above. */
export function mintNonce(): string
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
export function hashToken(token: string): string
{
    return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison for anything secret.
 *
 * `===` on a secret leaks its prefix through timing. Lengths are compared first because
 * `timingSafeEqual` throws on a mismatch - that leak is the length, which is not the secret.
 */
export function secretsMatch(left: string, right: string): boolean
{
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * An address in the one form this server stores and compares.
 *
 * Every address is lowercased at the boundary. EIP-55 checksum casing is a DISPLAY concern and a
 * transport accident - providers disagree about which they hand back - so comparing raw strings
 * is how one person ends up with two accounts. The `citext` columns and their CHECK constraints
 * enforce the same rule one layer down.
 */
export function normalizeAddress(address: string): string
{
    return address.trim().toLowerCase();
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

export function isAddress(address: string): boolean
{
    return ADDRESS.test(normalizeAddress(address));
}
