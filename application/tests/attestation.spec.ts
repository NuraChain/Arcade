import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { deviceIdFrom, toBase64Url } from '../src/lib/device-id.ts';
import { addressFromPersonalSign, deviceResource, verifyPeerDevice } from '../src/lib/attestation.ts';
import type { PeerDevice } from '../src/api.ts';

/**
 * The browser checking a peer's device for itself.
 *
 * `viem` is the SERVER's signature library and it is what really produced the signature on a real
 * enrolment, so signing here with viem and recovering with the browser's own `@noble` code is the
 * only test that means anything: it proves the two halves agree about EIP-191, and a disagreement
 * would mean every peer device on earth failing to verify with no error anywhere.
 */

const alice = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const mallory = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

async function realKeys(): Promise<{ exchangeKey: string; signingKey: string }>
{
    const exchange = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);

    return {
        exchangeKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', exchange.publicKey))),
        signingKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', signing.publicKey)))
    };
}

/** An enrolment the way the server really composes one: EIP-4361, with the device in Resources. */
const enrolMessage = (id: string, address: string): string => [
    'nura.games wants you to sign in with your Ethereum account:',
    address.toLowerCase(),
    '',
    'Authorise a device to read your messages on Nura Games. Only do this on a device you own. It costs nothing and moves nothing.',
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

async function peerDevice(
    signer: typeof alice,
    overrides: Partial<PeerDevice> = {}
): Promise<PeerDevice>
{
    const keys = await realKeys();
    const id = await deviceIdFrom(keys.exchangeKey, keys.signingKey);
    const message = overrides.message ?? enrolMessage(id, signer.address);

    return {
        id,
        ...keys,
        attested: 'wallet',
        address: signer.address.toLowerCase(),
        message,
        signature: await signer.signMessage({ message }),
        ...overrides
    };
}

describe('recovering the signer of a personal_sign', () =>
{
    it('agrees with the library that produced the signature', async () =>
    {
        const message = 'Authorise a device.';
        const signature = await alice.signMessage({ message });

        expect(addressFromPersonalSign(message, signature)).toBe(alice.address.toLowerCase());
    });

    it('counts the prefix length in BYTES, not characters', async () =>
    {
        // The trap. A Persian sentence has far more bytes than characters, and a recovery that
        // counts characters produces a perfectly valid address that is simply the wrong one - with
        // nothing anywhere reporting an error.
        const message = 'اجازهٔ دسترسی به این دستگاه را می‌دهم. سلام!';
        expect(new TextEncoder().encode(message).length).toBeGreaterThan(message.length);

        const signature = await alice.signMessage({ message });
        expect(addressFromPersonalSign(message, signature)).toBe(alice.address.toLowerCase());
    });

    it('recovers a different address when one character of the message changes', async () =>
    {
        const message = 'Authorise a device.';
        const signature = await alice.signMessage({ message });

        expect(addressFromPersonalSign(`${ message } `, signature)).not.toBe(alice.address.toLowerCase());
    });

    it('answers null rather than throwing for anything that is not a signature', () =>
    {
        expect(addressFromPersonalSign('x', '0x')).toBeNull();
        expect(addressFromPersonalSign('x', 'not hex at all')).toBeNull();
        expect(addressFromPersonalSign('x', `0x${ 'ff'.repeat(65) }`)).toBeNull();
    });
});

describe('verifying a peer device', () =>
{
    it('accepts a device its own wallet really authorised', async () =>
    {
        expect(await verifyPeerDevice(await peerDevice(alice))).toBe('ok');
    });

    it('refuses a device whose keys were swapped under its id', async () =>
    {
        const device = await peerDevice(alice);
        const other = await realKeys();

        // What a server that wanted to read the conversation would actually do: keep the id, swap
        // in an exchange key it holds the private half of.
        expect(await verifyPeerDevice({ ...device, exchangeKey: other.exchangeKey })).toBe('keys-swapped');
    });

    it('refuses a real signature that authorises a DIFFERENT device', async () =>
    {
        const device = await peerDevice(alice);
        const elsewhere = await peerDevice(alice);

        // Alice really signed this, and it is really hers - it just says nothing about this device.
        expect(await verifyPeerDevice({
            ...device,
            message: elsewhere.message,
            signature: elsewhere.signature
        })).toBe('wrong-device');
    });

    it('refuses a device signed by somebody else while claiming an address', async () =>
    {
        const device = await peerDevice(alice);
        const message = enrolMessage(device.id, alice.address);

        // Mallory signs a message naming Alice's address and Alice's device. The signature is
        // valid; it just does not recover to the address published beside it.
        expect(await verifyPeerDevice({
            ...device,
            message,
            signature: await mallory.signMessage({ message })
        })).toBe('bad-signature');
    });

    it('refuses a contract wallet rather than believing the server about it', async () =>
    {
        // ERC-1271 has no signature to recover; the answer is in contract code and needs a call
        // this browser cannot make. Unverifiable is not verified.
        expect(await verifyPeerDevice({ ...await peerDevice(alice), attested: 'contract' })).toBe('needs-chain');
    });

    it('refuses an address that is not an address', async () =>
    {
        expect(await verifyPeerDevice({ ...await peerDevice(alice), address: 'sara.k' })).toBe('bad-signature');
    });
});
