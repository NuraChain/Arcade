import { label, messageAad, epochCommitment, epochConfirmationText, PROTOCOL, type MessageAad } from '../../../server/src/domains/chat/envelope.ts';
import { fromBase64Url, toBase64Url } from './device-id.ts';

/**
 * `nura-e2ee/v1`, as pure functions over published parameters.
 *
 * Nothing here reaches the network, the store or IndexedDB. Everything it needs arrives as an
 * argument and everything it produces is a return value, which is what lets the known-answer tests
 * in `tests/crypto.spec.ts` be real tests rather than an assertion that the code did something.
 *
 * **The epoch key is BYTES, not a `CryptoKey`, and that is forced rather than chosen.** WebCrypto
 * refuses both halves of what this design needs from a key object: a non-extractable AES key
 * cannot be wrapped, and HKDF cannot derive from an AES-GCM key at all. So the epoch key lives as
 * 32 raw bytes for exactly as long as it is being used, is imported fresh for each operation, and
 * is zeroed by its caller afterwards. `keyring.ts` is where it rests, and it rests encrypted.
 *
 * That is the honest version of "no plaintext key bytes at rest": the bytes exist in memory at
 * three moments - minting, wrapping and opening - and nowhere else, ever.
 *
 * **Every derived key is domain-separated.** The wrap key, the per-sender message key and the key
 * check value each come from a different `label()`, so a key minted for one job cannot be the key
 * used for another, and a key for one epoch cannot be the key for the next. Correct primitives
 * assembled without domain separation is the classic way a protocol is broken anyway.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;

/** The franking key, carried in front of the plaintext inside the ciphertext. */
const FRANK_BYTES = 32;

const utf8 = new TextEncoder();

/** The DER SubjectPublicKeyInfo of a published key, as it travels. */
export type PublicKey = string;

export interface DeviceSecrets
{
    exchange: CryptoKeyPair;
    signing: CryptoKeyPair;
}

export interface WrappedEpochKey
{
    deviceId: string;
    ephemeralKey: PublicKey;
    wrapped: string;
}

export interface SealedBody
{
    iv: string;
    body: string;
    signature: string;
}

/** What a recipient gets back, and what a REPORT would disclose if they chose to file one. */
export interface OpenedText
{
    text: string;

    /**
     * The franking key this message was committed under.
     *
     * Held by whoever can read the message and by nobody else - it is inside the ciphertext. A
     * report discloses it alongside the words, and that pair is what lets a server it was never
     * shown to confirm the message is real.
     */
    frankingKey: string;
}

const join = (...parts: Uint8Array[]): Uint8Array =>
{
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);

    let offset = 0;
    for (const part of parts)
    {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

const importExchange = (key: PublicKey): Promise<CryptoKey> =>
    crypto.subtle.importKey('spki', fromBase64Url(key) as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

const importVerifier = (key: PublicKey): Promise<CryptoKey> =>
    crypto.subtle.importKey('spki', fromBase64Url(key) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);

/**
 * HKDF-SHA256 from raw secret bytes to one AES-GCM key.
 *
 * The secret is imported as HKDF material every time rather than kept around as a key object,
 * because a `CryptoKey` for HKDF cannot be stored usefully and because the caller owns the bytes
 * and is going to zero them.
 */
const deriveAes = async (secret: Uint8Array, salt: string, info: string): Promise<CryptoKey> =>
{
    const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey']);

    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(salt) as BufferSource, info: utf8.encode(info) as BufferSource },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
};

/**
 * Overwrites key bytes once they have been used.
 *
 * Best-effort and stated as such: a JavaScript engine may have copied the buffer during a garbage
 * collection and nothing here can reach that copy. What it does guarantee is that the variable the
 * caller was holding stops being a key, which closes the window where a later bug or a heap dump
 * reads one out of a value nobody remembered was still live.
 */
export function forget(bytes: Uint8Array): void
{
    bytes.fill(0);
}

/** A fresh epoch key: 32 bytes from the platform CSPRNG, belonging to nobody until it is wrapped. */
export function mintEpochKey(): Uint8Array
{
    return randomBytes(KEY_BYTES);
}

/**
 * One copy of the epoch key, readable by one device and by nothing else.
 *
 * Ephemeral ECDH against the recipient's published exchange key, so the wrap is unlinkable to any
 * other wrap and there is no long-term shared secret to compromise. The derivation is bound to the
 * conversation, the epoch AND the recipient, so a wrap cannot be lifted from one epoch and replayed
 * into another - which would otherwise let a server roll a conversation back to a key an
 * already-revoked device still holds.
 */
export async function wrapEpochKey(
    epochKey: Uint8Array,
    conversationId: string,
    epoch: number,
    recipient: { id: string; exchangeKey: PublicKey }
): Promise<WrappedEpochKey>
{
    const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;

    const shared = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'ECDH', public: await importExchange(recipient.exchangeKey) },
        ephemeral.privateKey,
        256
    ));

    const key = await deriveAes(
        shared,
        conversationId,
        label(PROTOCOL, 'wrap', conversationId, String(epoch), recipient.id)
    );

    forget(shared);

    const iv = randomBytes(IV_BYTES);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, epochKey as BufferSource));

    return {
        deviceId: recipient.id,
        ephemeralKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey))),
        wrapped: toBase64Url(join(iv, sealed))
    };
}

/**
 * This device's copy of an epoch key, or null when it is not this device's copy.
 *
 * Null rather than a throw, because "I cannot open this" is an ordinary state under rotation: a
 * device that was not a recipient of an epoch holds a wrap that does not belong to it, and the
 * thread has to say so rather than break.
 */
export async function unwrapEpochKey(
    secrets: DeviceSecrets,
    deviceId: string,
    conversationId: string,
    epoch: number,
    wrap: { ephemeralKey: PublicKey; wrapped: string }
): Promise<Uint8Array | null>
{
    try
    {
        const shared = new Uint8Array(await crypto.subtle.deriveBits(
            { name: 'ECDH', public: await importExchange(wrap.ephemeralKey) },
            secrets.exchange.privateKey,
            256
        ));

        const key = await deriveAes(
            shared,
            conversationId,
            label(PROTOCOL, 'wrap', conversationId, String(epoch), deviceId)
        );

        forget(shared);

        const bytes = fromBase64Url(wrap.wrapped);
        const opened = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) as BufferSource },
            key,
            bytes.slice(IV_BYTES) as BufferSource
        );

        return new Uint8Array(opened);
    }
    catch
    {
        return null;
    }
}

/** The epoch key encrypting a fixed sentence about itself, so a wrong unwrap says so immediately. */
export async function confirmationOf(epochKey: Uint8Array, conversationId: string, epoch: number): Promise<string>
{
    const key = await deriveAes(epochKey, conversationId, label(PROTOCOL, 'kcv', String(epoch)));
    const iv = randomBytes(IV_BYTES);

    const sealed = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        utf8.encode(epochConfirmationText(conversationId, epoch)) as BufferSource
    ));

    return toBase64Url(join(iv, sealed));
}

/**
 * Whether the key this device unwrapped is the key everybody else is using.
 *
 * Without this, a device holding the wrong key finds out at the first message it cannot open -
 * where a failed AES-GCM tag means "wrong key" and "corrupt ciphertext" and "wrong AAD" all at
 * once, and the product has no way to say which.
 */
export async function checkConfirmation(
    epochKey: Uint8Array,
    conversationId: string,
    epoch: number,
    confirmation: string
): Promise<boolean>
{
    try
    {
        const key = await deriveAes(epochKey, conversationId, label(PROTOCOL, 'kcv', String(epoch)));
        const bytes = fromBase64Url(confirmation);

        const opened = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) as BufferSource },
            key,
            bytes.slice(IV_BYTES) as BufferSource
        );

        return new TextDecoder().decode(opened) === epochConfirmationText(conversationId, epoch);
    }
    catch
    {
        return false;
    }
}

/**
 * The commitment a message is franked under: `HMAC-SHA256(frankingKey, plaintext)`.
 *
 * HMAC rather than a plain hash because the key is what makes it HIDING: a bare hash of a short
 * message - "ok", "yes", an address - is a value anybody could confirm by guessing, and this value
 * travels in the clear past a server that is not supposed to learn anything from it.
 */
export async function commitmentOf(frankingKey: string, text: string): Promise<string>
{
    const key = await crypto.subtle.importKey(
        'raw',
        fromBase64Url(frankingKey) as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(text) as BufferSource)));
}

/**
 * The per-sender key a message is sealed under.
 *
 * Every member of a conversation holds the epoch key, so sealing directly under it would let any
 * member forge any other member's line and no recipient could tell. Deriving per sender does not
 * fix that by itself - the signature does - but it keeps each sender's ciphertexts under their own
 * key, so a nonce reuse by one device cannot cross-contaminate another's.
 */
const senderKey = (epochKey: Uint8Array, conversationId: string, epoch: number, senderDeviceId: string): Promise<CryptoKey> =>
    deriveAes(epochKey, conversationId, label(PROTOCOL, 'send', String(epoch), senderDeviceId));

/** The exact bytes a message signature covers: the AAD, then the nonce, then the ciphertext. */
const signedBytes = (aad: string, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array =>
    join(utf8.encode(aad), iv, ciphertext);

/**
 * Seals what somebody typed, and signs it as this device.
 *
 * The signature is the part that makes a conversation with more than two people mean anything:
 * members share the epoch key, so authentication by encryption alone would say "somebody in this
 * room wrote this" and nothing more.
 */
export async function sealText(
    epochKey: Uint8Array,
    secrets: DeviceSecrets,
    aad: MessageAad,
    text: string,
    frankingKey: string
): Promise<SealedBody>
{
    const key = await senderKey(epochKey, aad.conversationId, aad.epoch, aad.senderDeviceId);
    const iv = randomBytes(IV_BYTES);
    const authenticated = messageAad(aad);

    // The franking key goes in FRONT of the words, inside the sealing. Everybody who can read the
    // message can report it; the server, which can do neither, holds only the commitment.
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: utf8.encode(authenticated) as BufferSource },
        key,
        join(fromBase64Url(frankingKey), utf8.encode(text)) as BufferSource
    ));

    const signature = new Uint8Array(await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        secrets.signing.privateKey,
        signedBytes(authenticated, iv, ciphertext) as BufferSource
    ));

    return { iv: toBase64Url(iv), body: toBase64Url(ciphertext), signature: toBase64Url(signature) };
}

/** A fresh franking key. One per message, never reused, never derived. */
export function mintFrankingKey(): string
{
    return toBase64Url(randomBytes(FRANK_BYTES));
}

/** Why a sealed message could not be turned back into words. */
export type OpenFailure =
    /** The signing device is not one this conversation knows, or is not the account the message claims. */
    | 'unknown-sender'

    /** A real ciphertext with a signature that is not the named device's. */
    | 'bad-signature'

    /** The key this device holds does not open it - usually an epoch it was not a recipient of. */
    | 'no-key'

    /** It decrypted under a different AAD than the row states. The row has been edited. */
    | 'tampered';

export type Opened = OpenedText | { failure: OpenFailure };

/**
 * Turns a sealed message back into words, or says exactly why it could not.
 *
 * The signature is checked BEFORE the decryption and against the AAD the row states, so a row the
 * server edited fails as `bad-signature` rather than as a decryption error - the difference matters
 * because one of those means "somebody changed this" and the other means "this is corrupt".
 */
export async function openText(
    epochKey: Uint8Array,
    signerKey: PublicKey,
    aad: MessageAad,
    sealed: SealedBody
): Promise<Opened>
{
    const authenticated = messageAad(aad);
    const iv = fromBase64Url(sealed.iv);
    const ciphertext = fromBase64Url(sealed.body);

    const honest = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        await importVerifier(signerKey),
        fromBase64Url(sealed.signature) as BufferSource,
        signedBytes(authenticated, iv, ciphertext) as BufferSource
    ).catch(() => false);

    if (!honest)
    {
        return { failure: 'bad-signature' };
    }

    try
    {
        const key = await senderKey(epochKey, aad.conversationId, aad.epoch, aad.senderDeviceId);

        const opened = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as BufferSource, additionalData: utf8.encode(authenticated) as BufferSource },
            key,
            ciphertext as BufferSource
        );

        const bytes = new Uint8Array(opened);

        if (bytes.length < FRANK_BYTES)
        {
            return { failure: 'tampered' };
        }

        const frankingKey = toBase64Url(bytes.slice(0, FRANK_BYTES));
        const text = new TextDecoder().decode(bytes.slice(FRANK_BYTES));

        // The sender chose both the key and the commitment, so a mismatch means they published a
        // commitment that does not cover what they wrote - which would make the message impossible
        // to report. Refusing it here is what stops somebody opting out of moderation by hand.
        if (await commitmentOf(frankingKey, text) !== aad.commitment)
        {
            return { failure: 'tampered' };
        }

        return { text, frankingKey };
    }
    catch
    {
        return { failure: 'no-key' };
    }
}

/** The minting device's signature over who its epoch key went to. */
export async function signRecipients(
    secrets: DeviceSecrets,
    conversationId: string,
    epoch: number,
    minterDeviceId: string,
    recipients: readonly string[]
): Promise<string>
{
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        secrets.signing.privateKey,
        utf8.encode(epochCommitment({ conversationId, epoch, minterDeviceId, recipients })) as BufferSource
    );

    return toBase64Url(new Uint8Array(signature));
}

/**
 * Whether the recipient set really was signed for by the device that claims to have minted it.
 *
 * This is the check that turns "the server says the key went to these devices" into a fact. The
 * caller passes the set it EXPECTS - computed from devices it verified itself - so a server that
 * withheld a device or added one of its own produces a commitment that does not verify.
 */
export async function verifyRecipients(
    minter: { id: string; signingKey: PublicKey },
    conversationId: string,
    epoch: number,
    recipients: readonly string[],
    signature: string
): Promise<boolean>
{
    try
    {
        return await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            await importVerifier(minter.signingKey),
            fromBase64Url(signature) as BufferSource,
            utf8.encode(epochCommitment({ conversationId, epoch, minterDeviceId: minter.id, recipients })) as BufferSource
        );
    }
    catch
    {
        return false;
    }
}
