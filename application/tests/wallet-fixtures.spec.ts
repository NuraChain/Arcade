import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../server/src/db/wallet-fixtures.ts';
import { enrolMessage, ENROL_STATEMENT } from '../../server/src/domains/device/enrol-message.ts';
import { verifyPeerDevice } from '../src/lib/attestation.ts';
import { deviceIdFrom, toBase64Url } from '../src/lib/device-id.ts';

/**
 * The development wallet accounts, checked by the code that will judge them.
 *
 * `seed-wallets.ts` writes an attestation into every development database and the whole point of it
 * is that the BROWSER accepts it - otherwise the sealed half of the product has no reachable happy
 * path and `sealabilityOf` answers `no-wallet` everywhere, which is exactly the state this repo was
 * in before these fixtures existed.
 *
 * So this runs the seed's own `enrolMessage` and the browser's own `verifyPeerDevice` over the
 * fixtures' real private keys. Nothing here is a stand-in: a drift between the two would otherwise
 * show up as a development database where sealing silently never becomes available, with no test
 * failing anywhere.
 */

async function realKeys(): Promise<{ exchangeKey: string; signingKey: string }>
{
    const exchange = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);

    return {
        exchangeKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', exchange.publicKey))),
        signingKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', signing.publicKey)))
    };
}

/** Exactly what `seedWalletFixtures` writes, for one fixture. */
async function seededDevice(fixture: typeof WALLET_FIXTURES[number])
{
    const account = privateKeyToAccount(fixture.privateKey);
    const address = account.address.toLowerCase();
    const keys = await realKeys();
    const id = await deviceIdFrom(keys.exchangeKey, keys.signingKey);

    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const message = enrolMessage({
        domain: 'localhost:3100',
        uri: 'http://localhost:3100',
        address,
        chainId: '1',
        nonce: 'a'.repeat(22),
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 5 * 60 * 1000),
        deviceId: id
    });

    return {
        id,
        ...keys,
        attested: 'wallet' as const,
        address,
        message,
        signature: await account.signMessage({ message })
    };
}

describe('the development wallet fixtures', () =>
{
    it('names two accounts with distinct handles and distinct keys', () =>
    {
        expect(WALLET_FIXTURES.length).toBeGreaterThanOrEqual(2);

        const handles = WALLET_FIXTURES.map((one) => one.handle);
        const keys = WALLET_FIXTURES.map((one) => one.privateKey);

        expect(new Set(handles).size).toBe(handles.length);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('produces a device the browser accepts, for every fixture', async () =>
    {
        for (const fixture of WALLET_FIXTURES)
        {
            expect(await verifyPeerDevice(await seededDevice(fixture))).toBe('ok');
        }
    });

    it('signs a message that names the device it authorises', async () =>
    {
        const device = await seededDevice(WALLET_FIXTURES[0]);

        expect(device.message).toContain(`nura:device:${ device.id }`);
        expect(device.message).toContain(ENROL_STATEMENT);
    });

    it('signs the ENROLMENT sentence, not the sign-in one', async () =>
    {
        // A signature over the sign-in prompt would authorise a device with words that say nothing
        // about devices, which is exactly the substitution the Resources line exists to prevent.
        const device = await seededDevice(WALLET_FIXTURES[0]);
        expect(device.message).not.toContain('This proves the seat is yours');
    });

    it('refuses the same signature moved onto another device', async () =>
    {
        const device = await seededDevice(WALLET_FIXTURES[0]);
        const elsewhere = await seededDevice(WALLET_FIXTURES[1]);

        expect(await verifyPeerDevice({ ...device, message: elsewhere.message, signature: elsewhere.signature }))
            .toBe('wrong-device');
    });

    it('carries a decimal chain id, so the message is a real EIP-4361 one', async () =>
    {
        const device = await seededDevice(WALLET_FIXTURES[0]);
        expect(device.message).toContain('Chain ID: 1');
    });
});
