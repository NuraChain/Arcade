import { cryptoAvailable, deviceIdFrom, toBase64Url } from './device-id.ts';
import { DEVICE_STORE, keyringAvailable, transact } from './keyring-db.ts';

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

const RECORD = 'self';

export interface DeviceKeys
{
    id: string;

    /** base64url of the DER SubjectPublicKeyInfo. What goes on the wire. */
    exchangeKey: string;
    signingKey: string;
}

/**
 * The non-extractable halves, as key HANDLES.
 *
 * Handing these out of the store is not handing out key material: `extractable` is false, so
 * neither this code nor anything that gets into the page can read bytes back out of them. What a
 * holder can do is USE them - unwrap an epoch key addressed to this device, and sign as this
 * device - which is exactly what the sealing needs and exactly what nothing else should have, so
 * they are fetched at the moment of use rather than kept anywhere.
 */
export interface DeviceSecrets
{
    exchange: CryptoKeyPair;
    signing: CryptoKeyPair;
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

    /** The private halves, for the two things only this device may do. Null when there are none. */
    secrets(): Promise<DeviceSecrets | null>;

    /** Generates a fresh pair of keypairs, replacing whatever was here. */
    mint(): Promise<DeviceKeys>;

    /** Throws the keys away. What they could read is unreadable from this browser afterwards. */
    forget(): Promise<void>;
}

const read = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    transact(DEVICE_STORE, mode, work);

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

const browserKeyStore: KeyStore & { record(): Promise<KeyRecord | null> } =
{
    available()
    {
        return cryptoAvailable() && keyringAvailable();
    },

    async load()
    {
        const record = await this.record();

        return record === null
            ? null
            : { id: record.id, exchangeKey: record.exchangeKey, signingKey: record.signingKey };
    },

    async secrets()
    {
        const record = await this.record();
        return record === null ? null : { exchange: record.exchange, signing: record.signing };
    },

    async record(): Promise<KeyRecord | null>
    {
        if (!this.available())
        {
            return null;
        }

        const record = await read<KeyRecord | undefined>('readonly', (store) => store.get(RECORD))
            .catch(() => undefined);

        return record ?? null;
    },

    async mint()
    {
        const record = await generate();
        await read('readwrite', (store) => store.put(record, RECORD));
        return { id: record.id, exchangeKey: record.exchangeKey, signingKey: record.signingKey };
    },

    async forget()
    {
        if (!this.available())
        {
            return;
        }
        await read('readwrite', (store) => store.delete(RECORD)).catch(() => undefined);
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
