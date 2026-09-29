import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { deviceIdFrom, deviceIdMatches, isDeviceId } from '../src/domains/device/id.ts';
import { deviceLine, namesDevice } from '../src/domains/device/resource.ts';
import { deviceText, signInText } from '../src/domains/identity/signature.ts';

/**
 * The device id, and the one property it exists for.
 *
 * An id issued by the server is an id the server can mint for keys it made up. An id that is the
 * hash of the public keys can only be claimed by whoever published those exact keys, and the check
 * is one line at enrolment. Everything below is about that line holding.
 *
 * Real P-256 keys rather than made-up bytes, because the thing being hashed is a DER
 * SubjectPublicKeyInfo and its length and prefix are part of what makes two of them distinguishable.
 */

const b64url = (buffer: ArrayBuffer): string => Buffer.from(buffer).toString('base64url');

const exportPublic = async (algorithm: EcKeyGenParams, usages: KeyUsage[]): Promise<string> =>
{
    const pair = await webcrypto.subtle.generateKey(algorithm, true, usages) as CryptoKeyPair;
    return b64url(await webcrypto.subtle.exportKey('spki', pair.publicKey));
};

const exchangeKey = (): Promise<string> => exportPublic({ name: 'ECDH', namedCurve: 'P-256' }, ['deriveBits']);
const signingKey = (): Promise<string> => exportPublic({ name: 'ECDSA', namedCurve: 'P-256' }, ['sign', 'verify']);

describe('a device id', () =>
{
    it('is twenty-two url-safe characters, whatever the keys were', async () =>
    {
        for (let round = 0; round < 4; round += 1)
        {
            const id = deviceIdFrom(await exchangeKey(), await signingKey());
            expect(id).toHaveLength(22);
            expect(isDeviceId(id)).toBe(true);
        }
    });

    it('is the same id every time for the same two keys', async () =>
    {
        const [exchange, signing] = [await exchangeKey(), await signingKey()];
        expect(deviceIdFrom(exchange, signing)).toBe(deviceIdFrom(exchange, signing));
    });

    it('changes when either key changes', async () =>
    {
        const [exchange, signing] = [await exchangeKey(), await signingKey()];
        const id = deviceIdFrom(exchange, signing);

        expect(deviceIdFrom(await exchangeKey(), signing)).not.toBe(id);
        expect(deviceIdFrom(exchange, await signingKey())).not.toBe(id);
    });

    it('depends on the ORDER of the two keys, so a swapped pair is a different device', async () =>
    {
        const [exchange, signing] = [await exchangeKey(), await signingKey()];

        // Not a nicety. If the digest were order-free, a device could present its keys the other
        // way round and claim an id it was never given.
        expect(deviceIdFrom(signing, exchange)).not.toBe(deviceIdFrom(exchange, signing));
    });

    it('refuses an id that does not belong to the keys published beside it', async () =>
    {
        const [exchange, signing] = [await exchangeKey(), await signingKey()];
        const mine = deviceIdFrom(exchange, signing);

        expect(deviceIdMatches(mine, exchange, signing)).toBe(true);
        expect(deviceIdMatches(mine, await exchangeKey(), signing)).toBe(false);
        expect(deviceIdMatches('A'.repeat(22), exchange, signing)).toBe(false);
    });

    it('refuses anything that is not the right shape before it hashes anything', () =>
    {
        expect(isDeviceId('')).toBe(false);
        expect(isDeviceId('A'.repeat(21))).toBe(false);
        expect(isDeviceId('A'.repeat(23))).toBe(false);

        // base64, not base64url: + and / would arrive from an encoder that forgot which alphabet
        // this is, and they do not belong in a path segment.
        expect(isDeviceId(`${ 'A'.repeat(21) }+`)).toBe(false);
        expect(isDeviceId(`${ 'A'.repeat(21) }/`)).toBe(false);
        expect(isDeviceId(`${ 'A'.repeat(21) }-`)).toBe(true);
        expect(isDeviceId(`${ 'A'.repeat(21) }_`)).toBe(true);
    });
});

describe('the text a wallet signs to authorise a device', () =>
{
    const ID = 'abcdefghijklmnopqrstuv';

    it('names the device on a line of its own, so the signature cannot be moved to another one', () =>
    {
        expect(deviceText('nura.games', 'b'.repeat(32), ID).split('\n')).toEqual([
            'Let this browser read and send your messages on Nura Games (nura.games).',
            '',
            'Browser key: abcdefghijklmnopqrstuv',
            `Nonce: ${ 'b'.repeat(32) }`
        ]);
    });

    it('is recognised as naming that device, and only that device', () =>
    {
        const text = deviceText('nura.games', 'b'.repeat(32), ID);

        expect(namesDevice(text, ID)).toBe(true);
        expect(namesDevice(text, 'bcdefghijklmnopqrstuvw')).toBe(false);
    });

    it('does not name a device the text merely contains, which a substring check would accept', () =>
    {
        const longer = `${ deviceLine(ID) }x`;
        const buried = `Nonce: ${ deviceLine(ID) }`;

        expect(`a\n${ longer }\nb`.includes(deviceLine(ID))).toBe(true);
        expect(namesDevice(`a\n${ longer }\nb`, ID)).toBe(false);
        expect(namesDevice(`a\n${ buried }`, ID)).toBe(false);
    });

    it('never names a device in a sign-in that did not ask for one', () =>
    {
        expect(namesDevice(signInText('nura.games', 'b'.repeat(32)), ID)).toBe(false);
        expect(namesDevice(signInText('nura.games', 'b'.repeat(32), ID), ID)).toBe(true);
    });
});
