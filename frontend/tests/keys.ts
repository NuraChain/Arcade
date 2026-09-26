import { privateKeyToAccount } from 'viem/accounts';

import type { PeerDevice } from '../src/api.ts';
import { deviceResource } from '../src/lib/attestation.ts';
import type { DeviceSecrets } from '../src/lib/crypto.ts';
import { deviceIdFrom, toBase64Url } from '../src/lib/device-id.ts';
import type { DeviceKeys, KeyStore } from '../src/lib/device-keys.ts';

/**
 * A device with real keys, for specs that have to actually seal something.
 *
 * Every part of this is genuine - a real P-256 keypair for exchange, another for signing, a real
 * EIP-191 signature by a real account over a real EIP-4361 message naming the derived id. A fake
 * that stubbed any of it would prove only that the fake agrees with itself, and the whole point of
 * the sealing specs is that the browser's own verification accepts what the browser's own sealing
 * produces.
 *
 * The private halves are `extractable: false`, exactly as the product generates them, so a spec
 * cannot accidentally test a path that only works with exportable keys.
 */

export interface TestDevice extends DeviceKeys
{
    secrets: DeviceSecrets;

    /** The device as a peer is shown it: the two keys, the id they hash to, and the proof. */
    peer: PeerDevice;

    address: string;
}

/** The hardhat accounts, published and controlling nothing. Same ones the wallet fixtures use. */
export const TEST_ACCOUNTS = {
    alex: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    other: privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),
    third: privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
};

const enrolMessage = (address: string, id: string): string => [
    'nura.games wants you to sign in with your Ethereum account:',
    address,
    '',
    'Authorise a device.',
    '',
    'URI: https://nura.games',
    'Version: 1',
    'Chain ID: 1',
    `Nonce: ${ 'a'.repeat(32) }`,
    'Issued At: 2026-01-01T00:00:00.000Z',
    'Expiration Time: 2026-01-01T00:05:00.000Z',
    'Resources:',
    `- ${ deviceResource(id) }`
].join('\n');

export async function makeDevice(account: typeof TEST_ACCOUNTS.alex): Promise<TestDevice>
{
    const exchange = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as CryptoKeyPair;
    const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;

    const exchangeKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', exchange.publicKey)));
    const signingKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', signing.publicKey)));

    const id = await deviceIdFrom(exchangeKey, signingKey);
    const address = account.address.toLowerCase();
    const message = enrolMessage(address, id);

    return {
        id,
        exchangeKey,
        signingKey,
        address,
        secrets: { exchange, signing },
        peer: {
            id,
            exchangeKey,
            signingKey,
            attested: 'wallet',
            address,
            message,
            signature: await account.signMessage({ message })
        }
    };
}

/**
 * A key store holding one test device.
 *
 * The product's own store needs IndexedDB, which the test environment does not have - which is why
 * the store is behind a seam at all. This one answers from memory and holds the same non-extractable
 * handles the real one would.
 */
export function heldKeyStore(device: TestDevice | null): KeyStore
{
    return {
        available: () => true,
        async load()
        {
            return device === null
                ? null
                : { id: device.id, exchangeKey: device.exchangeKey, signingKey: device.signingKey };
        },
        async secrets()
        {
            return device?.secrets ?? null;
        },
        async mint()
        {
            throw new Error('This store holds one device and does not mint.');
        },
        async forget()
        {
            device = null;
        }
    };
}
