/**
 * The one IndexedDB database this browser keeps keys in, and the one place its version lives.
 *
 * Two modules store things here - `device-keys.ts` holds the device's own keypairs, `epoch-keys.ts`
 * holds the sealed epoch keys - and they must not each open the database with their own idea of
 * what version it is. IndexedDB refuses an open at a LOWER version than the one on disk, so the
 * second module to add a store would break the first for anybody who had already run it: a
 * `VersionError` on load, with a keyring that looks empty and a device that appears to have never
 * enrolled.
 *
 * So the schema is declared once, here, and both callers ask for a store by name.
 */

const DATABASE = 'nura-keyring';
const VERSION = 2;

export const DEVICE_STORE = 'device';

/** The non-extractable AES key the epoch keys are sealed under. One per browser. */
export const VAULT_STORE = 'vault';

/** Epoch keys, as ciphertext. Never as bytes. */
export const EPOCH_STORE = 'epochs';

const STORES = [DEVICE_STORE, VAULT_STORE, EPOCH_STORE];

export function keyringAvailable(): boolean
{
    return typeof globalThis.indexedDB !== 'undefined';
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) =>
{
    const request = indexedDB.open(DATABASE, VERSION);

    request.onupgradeneeded = () =>
    {
        for (const store of STORES)
        {
            if (!request.result.objectStoreNames.contains(store))
            {
                request.result.createObjectStore(store);
            }
        }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('keyring'));
});

export async function transact<T>(
    store: string,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T>
{
    const database = await openDatabase();

    try
    {
        return await new Promise<T>((resolve, reject) =>
        {
            const request = work(database.transaction(store, mode).objectStore(store));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('keyring'));
        });
    }
    finally
    {
        database.close();
    }
}
