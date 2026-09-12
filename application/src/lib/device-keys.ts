import { cryptoAvailable, deviceIdFrom, toBase64Url } from './device-id.ts';

/**
 * The keys this browser holds, and the only place they are kept.
 *
 * **No plaintext key bytes at rest.** The private halves are generated non-extractable, so the
 * `CryptoKey` handles IndexedDB stores cannot be read back out as bytes by anything - not by this
 * code, not by a script that gets into the page, not by somebody with the profile directory. The
 * public halves are exported to base64url because they are published: the server stores them and
 * every other device wraps keys to them.
 *
 * The honest claim is "no key bytes at rest", not "key bytes never exist". A private key exists
 * inside the WebCrypto implementation the moment it is generated; what this file guarantees is
 * that nothing here can ever hold those bytes in a variable.
 *
 * Behind a seam because the test environment has no IndexedDB and because a browser in a private
 * mode may refuse it. `setKeyStore` is how the specs drive it and how a store that cannot open
 * reports `unsupported` rather than throwing halfway through an enrolment.
 */

const DATABASE = 'nura-keyring';
const STORE = 'device';
const RECORD = 'self';
const VERSION = 1;

export interface DeviceKeys
{
    id: string;

    /** base64url of the DER SubjectPublicKeyInfo. What goes on the wire. */
    exchangeKey: string;
    signingKey: string;
}

interface KeyRecord extends DeviceKeys
{
    exchange: CryptoKeyPair;
    signing: CryptoKeyPair;
}

export interface KeyStore
{
    /** Whether this browser can hold keys at all. */
    available(): boolean;

    load(): Promise<DeviceKeys | null>;

    /** Generates a fresh pair of keypairs, replacing whatever was here. */
    mint(): Promise<DeviceKeys>;

    /** Throws the keys away. What they could read is unreadable from this browser afterwards. */
    forget(): Promise<void>;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) =>
{
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () =>
    {
        if (!request.result.objectStoreNames.contains(STORE))
        {
            request.result.createObjectStore(STORE);
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('keyring'));
});

const transact = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
{
    const database = await openDatabase();
    try
    {
        return await new Promise<T>((resolve, reject) =>
        {
            const request = work(database.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('keyring'));
        });
    }
    finally
    {
        database.close();
    }
};

const exportPublic = async (key: CryptoKey): Promise<string> =>
    toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', key)));

/**
 * Generates the pair of keypairs a device is.
 *
 * Two separate keys rather than one, because they do different jobs and a key that does both is a
 * key whose compromise costs twice as much: the ECDH key receives wrapped epoch keys, the ECDSA
 * key signs this device's messages so no other member of a conversation can forge its lines.
 *
 * `extractable` is false, which in WebCrypto applies to the PRIVATE half - the public half is
 * always exportable, which is what lets them be published.
 */
const generate = async (): Promise<KeyRecord> =>
{
    const exchange = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']) as CryptoKeyPair;
    const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;

    const exchangeKey = await exportPublic(exchange.publicKey);
    const signingKey = await exportPublic(signing.publicKey);

    return {
        id: await deviceIdFrom(exchangeKey, signingKey),
        exchangeKey,
        signingKey,
        exchange,
        signing
    };
};

const browserKeyStore: KeyStore =
{
    available()
    {
        return cryptoAvailable() && typeof globalThis.indexedDB !== 'undefined';
    },

    async load()
    {
        if (!this.available())
        {
            return null;
        }

        const record = await transact<KeyRecord | undefined>('readonly', (store) => store.get(RECORD))
            .catch(() => undefined);

        return record === undefined
            ? null
            : { id: record.id, exchangeKey: record.exchangeKey, signingKey: record.signingKey };
    },

    async mint()
    {
        const record = await generate();
        await transact('readwrite', (store) => store.put(record, RECORD));
        return { id: record.id, exchangeKey: record.exchangeKey, signingKey: record.signingKey };
    },

    async forget()
    {
        if (!this.available())
        {
            return;
        }
        await transact('readwrite', (store) => store.delete(RECORD)).catch(() => undefined);
    }
};

let active: KeyStore = browserKeyStore;

export function keyStore(): KeyStore
{
    return active;
}

/** Swaps the store. The specs use it; nothing in the product does. */
export function setKeyStore(store: KeyStore): void
{
    active = store;
}

export function resetKeyStore(): void
{
    active = browserKeyStore;
}
