import { fromBase64Url, toBase64Url } from './device-id.ts';
import { EPOCH_STORE, keyringAvailable, transact, VAULT_STORE } from './keyring-db.ts';

/**
 * Where an epoch key rests, and the reason it does not rest as a key.
 *
 * `nura-e2ee/v1` says **no plaintext key bytes at rest**, and an epoch key is the one key in this
 * design that cannot be a non-extractable `CryptoKey`: WebCrypto will not derive HKDF material from
 * an AES-GCM key, and the per-sender message keys are HKDF from the epoch key. So the bytes have to
 * exist, and the question is only where.
 *
 * The answer is a VAULT: one AES-GCM key per browser, generated non-extractable, kept in IndexedDB
 * as a `CryptoKey` handle - `structuredClone` preserves non-extractable keys, which is the whole
 * reason this is possible - and every epoch key stored as ciphertext under it. Somebody with the
 * profile directory gets the ciphertext and a key handle they cannot export; somebody with the page
 * gets whatever the page can do anyway.
 *
 * The honest claim stays "no key bytes at rest". The bytes exist in memory while a message is being
 * sealed or opened, and `crypto.ts` zeroes them afterwards.
 *
 * A browser that cannot hold any of this - an insecure origin, a private mode that refuses
 * IndexedDB - gets null from every read here and the chat says it cannot seal. That is the same
 * `unsupported` readiness the device panel already renders, arrived at from the other end.
 */

const VAULT = 'self';
const IV_BYTES = 12;

interface Sealed
{
    iv: string;
    bytes: string;
}

const slotFor = (conversationId: string, epoch: number): string => `${ conversationId }:${ epoch }`;

/**
 * The vault key, made once and never replaced.
 *
 * `add` rather than `put`, so two tabs racing to create it cannot end with one of them holding a
 * key the other overwrote - which would make every epoch key the loser had already written
 * permanently unreadable. The loser's insert fails, it reads the winner's, and both agree.
 */
const vaultKey = async (): Promise<CryptoKey | null> =>
{
    if (!keyringAvailable() || typeof globalThis.crypto?.subtle === 'undefined')
    {
        return null;
    }

    const existing = await transact<CryptoKey | undefined>(VAULT_STORE, 'readonly', (store) => store.get(VAULT))
        .catch(() => undefined);

    if (existing !== undefined)
    {
        return existing;
    }

    const minted = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

    try
    {
        await transact(VAULT_STORE, 'readwrite', (store) => store.add(minted, VAULT));
        return minted;
    }
    catch
    {
        const winner = await transact<CryptoKey | undefined>(VAULT_STORE, 'readonly', (store) => store.get(VAULT))
            .catch(() => undefined);

        return winner ?? null;
    }
};

/** Seals an epoch key into the vault. The caller still owns its copy of the bytes, and zeroes it. */
export async function rememberEpochKey(conversationId: string, epoch: number, key: Uint8Array): Promise<boolean>
{
    const vault = await vaultKey();
    if (vault === null)
    {
        return false;
    }

    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, vault, key as BufferSource));

    const record: Sealed = { iv: toBase64Url(iv), bytes: toBase64Url(sealed) };

    try
    {
        await transact(EPOCH_STORE, 'readwrite', (store) => store.put(record, slotFor(conversationId, epoch)));
        return true;
    }
    catch
    {
        return false;
    }
}

/**
 * The epoch key this browser holds, as bytes the caller must zero.
 *
 * Null when there is none, which is the ordinary state before the epoch has been fetched and
 * unwrapped, and the permanent state for an epoch this device was never a recipient of.
 */
export async function recallEpochKey(conversationId: string, epoch: number): Promise<Uint8Array | null>
{
    const vault = await vaultKey();
    if (vault === null)
    {
        return null;
    }

    const record = await transact<Sealed | undefined>(EPOCH_STORE, 'readonly', (store) => store.get(slotFor(conversationId, epoch)))
        .catch(() => undefined);

    if (record === undefined)
    {
        return null;
    }

    try
    {
        const opened = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64Url(record.iv) as BufferSource },
            vault,
            fromBase64Url(record.bytes) as BufferSource
        );

        return new Uint8Array(opened);
    }
    catch
    {
        return null;
    }
}

/**
 * Throws away every epoch key this browser holds.
 *
 * Signing out has to do this. A session ends but IndexedDB does not, and leaving the keys behind
 * would mean the next person to use this browser inherits the ability to read every conversation
 * the last one had open - which is the one promise a sealed archive has to keep.
 */
export async function forgetEpochKeys(): Promise<void>
{
    if (!keyringAvailable())
    {
        return;
    }
    await transact(EPOCH_STORE, 'readwrite', (store) => store.clear()).catch(() => undefined);
}
