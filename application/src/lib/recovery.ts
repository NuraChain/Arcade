import { label } from '../../../server/src/domains/chat/envelope.ts';
import { recoveryChallenge, RECOVERY_PROTOCOL } from '../../../server/src/domains/device/recovery.ts';
import { fromBase64Url, toBase64Url } from './device-id.ts';

/**
 * The recovery phrase, and everything derived from it.
 *
 * A device that loses its keys loses the conversations it could read, and the only honest way back
 * is a secret the person holds outside this product. That secret is GENERATED here and never
 * chosen: PBKDF2 is the only KDF `SubtleCrypto` offers, and against a GPU it is weak enough that a
 * human-chosen passphrase would be a real break rather than a theoretical one. 120 bits from the
 * platform CSPRNG is not guessable at any iteration count, which is the point - the iterations are
 * belt, the entropy is braces.
 *
 * **It is not derived from a wallet signature.** A deterministic `personal_sign` over a fixed
 * string would be an unrevocable, phishable, remote skeleton key to the entire archive: anybody who
 * could get that one signature out of somebody - and getting signatures out of people is the single
 * most practised attack in this industry - would hold every message they had ever received, with no
 * way to take it back.
 *
 * **What it protects, and what it does not.** It seals an ARCHIVE KEY, and the archive key seals
 * every epoch key. It does not restore a device's identity: those keypairs are non-extractable and
 * stay that way, so a replacement browser enrols as itself, with its own wallet attestation, and
 * then restores what it can read. That also means the phrase is exactly as powerful as it sounds -
 * whoever holds it can read everything, forever - and the copy says so rather than implying a
 * backup is free.
 *
 * **Crockford base32 rather than a wordlist.** A BIP-39 list is 13 KB of dictionary shipped to
 * every browser for a string most people write on paper once. Crockford excludes the four
 * characters people confuse (I, L, O, U) and folds the confusable ones on the way back in, so
 * `KM7O` and `KM70` are the same phrase and a hand-copied I becomes a 1 without anybody noticing
 * there was a problem.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const PHRASE_BYTES = 15;
const PHRASE_SYMBOLS = 24;

const SALT_BYTES = 16;
const IV_BYTES = 12;

/**
 * 600,000, which is OWASP's figure for a human-chosen password.
 *
 * It is here for the case this design refuses to allow rather than the case it has: against 120
 * generated bits the iteration count is irrelevant, and the day somebody argues for letting people
 * type their own phrase, this number is what will be quoted as though it made that safe. It does
 * not. The entropy is what makes it safe.
 */
const ITERATIONS = 600_000;

const utf8 = new TextEncoder();

export interface RecoveryKeys
{
    /** Seals the archive key. Never leaves this browser. */
    wrap: CryptoKey;

    /** Proves the phrase to the server without handing it over. */
    signer: { scalar: Uint8Array; publicKey: string };
}

/**
 * A fresh phrase: 120 bits, in CANONICAL form.
 *
 * Canonical means the twenty-four symbols and nothing else - no grouping, no case variation, no
 * separators. Everything that derives a key derives it from this form, and `normalisePhrase` turns
 * whatever somebody types back into it. A minted phrase that came out pre-grouped would be derived
 * from a string that no typed phrase can ever equal, and recovery would fail for everybody with
 * nothing anywhere explaining why. `groupPhrase` is for the screen and only for the screen.
 */
export function mintPhrase(): string
{
    const bytes = crypto.getRandomValues(new Uint8Array(PHRASE_BYTES));

    let bits = 0;
    let carry = 0;
    let out = '';

    for (const byte of bytes)
    {
        carry = (carry << 8) | byte;
        bits += 8;

        while (bits >= 5)
        {
            bits -= 5;
            out += ALPHABET[(carry >> bits) & 31];
        }
    }

    return out;
}

/**
 * What somebody typed, as the phrase it was meant to be, or null.
 *
 * Separators, spacing and case are all thrown away, and the three characters Crockford excludes
 * because people confuse them are folded to what they were confused with. Somebody copying a phrase
 * off paper should not be told they got it wrong for writing a capital O.
 */
export function normalisePhrase(typed: string): string | null
{
    const folded = typed
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1');

    if (folded.length !== PHRASE_SYMBOLS)
    {
        return null;
    }

    return [...folded].every((symbol) => ALPHABET.includes(symbol)) ? folded : null;
}

/** The phrase as it is shown and written down: groups of four, joined by a hyphen. */
export function groupPhrase(phrase: string): string
{
    return phrase.match(/.{1,4}/g)?.join('-') ?? phrase;
}

/** A fresh salt for a new vault. Published beside the ciphertext; secret of nothing. */
export function mintSalt(): string
{
    return toBase64Url(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const scalarFrom = (bytes: Uint8Array): Uint8Array =>
{
    let value = 0n;
    for (const byte of bytes)
    {
        value = (value << 8n) | BigInt(byte);
    }

    // Reduced into [1, n-1]. The bias this introduces is around 2^-128 for a 256-bit input, which
    // is smaller than every other margin in this design by a wide margin.
    const scalar = (value % (P256_ORDER - 1n)) + 1n;

    const out = new Uint8Array(32);
    let rest = scalar;

    for (let index = 31; index >= 0; index -= 1)
    {
        out[index] = Number(rest & 0xffn);
        rest >>= 8n;
    }
    return out;
};

/**
 * The curve, loaded only when a phrase is actually being used.
 *
 * `@noble/curves` is already here for `attestation.ts` and is behind a dynamic import there for the
 * same reason: it is elliptic-curve code most sessions never execute, and recovery is the rarest
 * path in the product.
 *
 * WebCrypto cannot do this part. Turning a private scalar into a public point is a scalar multiply,
 * and `SubtleCrypto` exposes no way to import a raw ECDSA private key without already knowing the
 * public one - which is precisely what has to be computed.
 */
const curve = async (): Promise<typeof import('@noble/curves/nist.js').p256> =>
    (await import('@noble/curves/nist.js')).p256;

/**
 * Turns a phrase and a salt into the two things derived from them.
 *
 * One PBKDF2 pass produces 64 bytes and they are split: the first half wraps, the second half is a
 * private scalar. Deriving both from one pass rather than running PBKDF2 twice is not an
 * optimisation, it is the difference between one expensive operation and two - and a caller that
 * ran it twice with different info strings would be doing 1.2 million iterations for no gain.
 */
export async function deriveRecovery(phrase: string, salt: string): Promise<RecoveryKeys>
{
    const base = await crypto.subtle.importKey('raw', utf8.encode(phrase) as BufferSource, 'PBKDF2', false, ['deriveBits']);

    const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt) as BufferSource, iterations: ITERATIONS },
        base,
        512
    ));

    const wrap = await crypto.subtle.importKey(
        'raw',
        bits.slice(0, 32) as BufferSource,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );

    const scalar = scalarFrom(bits.slice(32, 64));
    const p256 = await curve();

    bits.fill(0);

    return {
        wrap,
        signer: { scalar, publicKey: toBase64Url(p256.getPublicKey(scalar, false)) }
    };
}

/** A fresh archive key: what every epoch key is sealed to, so one secret restores all of them. */
export function mintArchiveKey(): Uint8Array
{
    return crypto.getRandomValues(new Uint8Array(32));
}

const seal = async (key: CryptoKey, bytes: Uint8Array, aad?: Uint8Array): Promise<string> =>
{
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, ...(aad === undefined ? {} : { additionalData: aad as BufferSource }) },
        key,
        bytes as BufferSource
    ));

    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv, 0);
    out.set(sealed, iv.length);
    return toBase64Url(out);
};

const open = async (key: CryptoKey, packed: string, aad?: Uint8Array): Promise<Uint8Array | null> =>
{
    try
    {
        const bytes = fromBase64Url(packed);
        const opened = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: bytes.slice(0, IV_BYTES) as BufferSource,
                ...(aad === undefined ? {} : { additionalData: aad as BufferSource })
            },
            key,
            bytes.slice(IV_BYTES) as BufferSource
        );
        return new Uint8Array(opened);
    }
    catch
    {
        return null;
    }
};

/** The archive key, sealed under the phrase. The only copy anywhere. */
export const sealArchiveKey = (keys: RecoveryKeys, archiveKey: Uint8Array): Promise<string> =>
    seal(keys.wrap, archiveKey);

export const openArchiveKey = (keys: RecoveryKeys, wrapped: string): Promise<Uint8Array | null> =>
    open(keys.wrap, wrapped);

const archiveAes = (archiveKey: Uint8Array): Promise<CryptoKey> =>
    crypto.subtle.importKey('raw', archiveKey as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

/**
 * The slot an archived key belongs to, authenticated alongside it.
 *
 * Without this the archive is a bag of interchangeable blobs: the server hands back rows keyed by
 * (conversation, epoch) and a recovering browser believes the labels. Relabelling one key onto
 * another conversation makes that conversation permanently unreadable on the recovered device -
 * and the entry is preferred over the server's own wrap and never evicted, so it does not heal.
 */
const archiveAad = (conversationId: string, epoch: number): Uint8Array =>
    utf8.encode(label(RECOVERY_PROTOCOL, 'archive', conversationId, String(epoch)));

/** One epoch key, sealed to the archive so a replacement browser can be given it back. */
export async function sealForArchive(
    archiveKey: Uint8Array,
    conversationId: string,
    epoch: number,
    epochKey: Uint8Array
): Promise<string>
{
    return seal(await archiveAes(archiveKey), epochKey, archiveAad(conversationId, epoch));
}

export async function openFromArchive(
    archiveKey: Uint8Array,
    conversationId: string,
    epoch: number,
    wrapped: string
): Promise<Uint8Array | null>
{
    return open(await archiveAes(archiveKey), wrapped, archiveAad(conversationId, epoch));
}

/**
 * Whether a phrase really is the phrase this vault was made with.
 *
 * A wrong phrase produces a wrong wrapping key, and AES-GCM would already refuse - but only at the
 * first thing it tried to open, and "your phrase is wrong" and "your archive is corrupt" must not
 * be the same message. This is the epoch confirmation tag from `crypto.ts`, doing the same job one
 * level up.
 */
export const checkValueOf = (keys: RecoveryKeys): Promise<string> =>
    seal(keys.wrap, utf8.encode(RECOVERY_PROTOCOL));

export async function phraseMatches(keys: RecoveryKeys, checkValue: string): Promise<boolean>
{
    const opened = await open(keys.wrap, checkValue);
    return opened !== null && new TextDecoder().decode(opened) === RECOVERY_PROTOCOL;
}

/**
 * Proves the phrase to the server, for one device, once.
 *
 * The signature names the account and the device, so it confirms the browser that asked and nothing
 * else. What the server checks it against is a public key, so holding the whole database gets an
 * attacker no closer to the archive than holding none of it.
 */
export async function signRecovery(
    keys: RecoveryKeys,
    accountId: string,
    deviceId: string,
    nonce: string
): Promise<string>
{
    const p256 = await curve();

    const digest = new Uint8Array(await crypto.subtle.digest(
        'SHA-256',
        utf8.encode(recoveryChallenge(accountId, deviceId, nonce)) as BufferSource
    ));

    // `prehash: false` says the input IS the digest. `@noble/curves` 2.x flipped this default:
    // 1.x signed the 32 bytes it was given, 2.x hashes them first, so handing it a SHA-256 digest
    // signs SHA-256(SHA-256(challenge)) and the server - which verifies through WebCrypto ECDSA
    // with `hash: 'SHA-256'` over the raw challenge - rejects a perfectly well-formed 64-byte
    // signature. Nothing about the value says so; `recovery.spec.ts` is what said so.
    return toBase64Url(p256.sign(digest, keys.signer.scalar, { prehash: false }));
}
