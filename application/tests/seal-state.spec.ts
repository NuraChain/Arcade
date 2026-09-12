import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { privateKeyToAccount } from 'viem/accounts';

import type { ConversationDevices, PeerDevice } from '../src/api.ts';
import SealNotice from '../src/components/chat/seal-notice.component.azeroth';
import { deviceResource } from '../src/lib/attestation.ts';
import { deviceIdFrom, toBase64Url } from '../src/lib/device-id.ts';
import { sealabilityOf, type MemberSeal } from '../src/lib/seal-state.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';

/**
 * Whether a conversation can be sealed, and why not.
 *
 * The rules here are the ones that decide who a key would be wrapped to, so every "refuses" test
 * below is a hole somebody could otherwise read the conversation through.
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

async function device(signer: typeof alice, overrides: Partial<PeerDevice> = {}): Promise<PeerDevice>
{
    const keys = await realKeys();
    const id = await deviceIdFrom(keys.exchangeKey, keys.signingKey);

    const message = [
        'nura.games wants you to sign in with your Ethereum account:',
        signer.address.toLowerCase(),
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

const conversation = (...members: ConversationDevices['members']): ConversationDevices => ({ members });

const me = async (): Promise<ConversationDevices['members'][number]> =>
    ({ handle: 'alex', kind: 'wallet', devices: [await device(alice)] });

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() => cleanup());

describe('whether a conversation can be sealed', () =>
{
    it('is ready when everybody has a device that verifies', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { handle: 'sara.k', kind: 'wallet', devices: [await device(mallory)] }
        ), 'alex');

        expect(answer.ready).toBe(true);
        expect(answer.blocked).toBeNull();
        expect(answer.members.every((member) => member.state === 'ready')).toBe(true);
    });

    it('hands back the verified devices, because that is what a key gets wrapped to', async () =>
    {
        const theirs = await device(mallory);
        const answer = await sealabilityOf(conversation(
            await me(),
            { handle: 'sara.k', kind: 'wallet', devices: [theirs] }
        ), 'alex');

        expect(answer.members.find((one) => one.handle === 'sara.k')?.devices).toEqual([theirs]);
    });

    it('is blocked by a guest, and names them', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { handle: 'sara.k', kind: 'guest', devices: [] }
        ), 'alex');

        expect(answer.ready).toBe(false);
        expect(answer.blocked?.handle).toBe('sara.k');
        expect(answer.blocked?.state).toBe('no-wallet');
    });

    it('tells a wallet account with no device apart from a guest', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { handle: 'sara.k', kind: 'wallet', devices: [] }
        ), 'alex');

        // Different sentences, because they are different situations: one of them is fixed by
        // enrolling a browser and the other is not fixed at all.
        expect(answer.blocked?.state).toBe('no-device');
    });

    it('refuses a contract wallet rather than taking the server word for it', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { handle: 'sara.k', kind: 'wallet', devices: [await device(mallory, { attested: 'contract' })] }
        ), 'alex');

        expect(answer.blocked?.state).toBe('needs-chain');
    });

    describe('a device that does not verify condemns the whole list', () =>
    {
        it('refuses a list where one device had its keys swapped', async () =>
        {
            const good = await device(mallory);
            const swapped = { ...await device(mallory), exchangeKey: (await realKeys()).exchangeKey };

            const answer = await sealabilityOf(conversation(
                await me(),
                { handle: 'sara.k', kind: 'wallet', devices: [good, swapped] }
            ), 'alex');

            // Quietly using the good one is exactly how a fabricated device ends up wrapped in
            // beside the real ones - so a list with anything wrong in it yields NO devices.
            expect(answer.blocked?.state).toBe('tampered');
            expect(answer.members.find((one) => one.handle === 'sara.k')?.devices).toEqual([]);
        });

        it('refuses a device signed by the wrong wallet', async () =>
        {
            const theirs = await device(mallory);
            const forged = await device(mallory);

            const answer = await sealabilityOf(conversation(
                await me(),
                {
                    handle: 'sara.k',
                    kind: 'wallet',
                    devices: [theirs, { ...forged, address: alice.address.toLowerCase() }]
                }
            ), 'alex');

            expect(answer.blocked?.state).toBe('tampered');
        });

        it('reports a tampered member ahead of a merely absent one, whatever the order', async () =>
        {
            const swapped = { ...await device(mallory), signingKey: (await realKeys()).signingKey };

            const answer = await sealabilityOf(conversation(
                { handle: 'guest.one', kind: 'guest', devices: [] },
                await me(),
                { handle: 'sara.k', kind: 'wallet', devices: [swapped] }
            ), 'alex');

            // Absent proof is ordinary. A proof that was present and did not check out is not.
            expect(answer.blocked?.handle).toBe('sara.k');
            expect(answer.blocked?.state).toBe('tampered');
        });
    });
});

describe('what the thread says about it', () =>
{
    const render = (blocked: MemberSeal): string =>
        renderTest(() => SealNotice({ blocked }) as HTMLElement).container.textContent ?? '';

    const seal = (state: MemberSeal['state'], isMe = false): MemberSeal => ({ handle: 'sara.k', state, isMe, devices: [] });

    it('names the person and says what would fix it', () =>
    {
        const said = render(seal('no-wallet'));

        expect(said).toContain('sara.k');
        expect(said).toContain('not sealed');
        expect(said).toContain('wallet on both sides');
    });

    it('says something different for somebody who simply has not enrolled', () =>
    {
        expect(render(seal('no-device'))).toContain('has not given any of their browsers keys');
    });

    it('reads as an alarm rather than a shrug when a proof did not check out', () =>
    {
        const { container } = renderTest(() => SealNotice({ blocked: seal('tampered') }) as HTMLElement);

        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(container.textContent).toContain('did not match the proof');
    });

    it('is not an alarm for any of the ordinary reasons', () =>
    {
        for (const state of ['no-wallet', 'no-device', 'needs-chain'] as const)
        {
            cleanup();
            const { container } = renderTest(() => SealNotice({ blocked: seal(state) }) as HTMLElement);
            expect(container.querySelector('[role="alert"]')).toBeNull();
        }
    });

    it('speaks to the reader about their own account, not about them in the third person', () =>
    {
        // The signed-in demo tour hits exactly this: the only member standing in the way is you.
        const said = render(seal('no-wallet', true));

        expect(said).toContain('You are signed in without a wallet');
        expect(said).not.toContain('sara.k');
    });

    it('tells the reader what to do about their own browser', () =>
    {
        expect(render(seal('no-device', true))).toContain('This browser has no keys yet');
    });

    it('follows a language switch, like every other composed sentence', () =>
    {
        useLocale().setLocale('fa');
        expect(render(seal('no-wallet'))).toContain('مهروموم نشده‌اند');
    });
});
