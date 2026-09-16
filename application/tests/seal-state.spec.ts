import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { privateKeyToAccount } from 'viem/accounts';

import type { ConversationDevices, PeerDevice } from '../src/api.ts';
import SealNotice from '../src/components/chat/seal-notice.component.azeroth';
import { deviceResource } from '../src/lib/attestation.ts';
import { deviceIdFrom, toBase64Url } from '../src/lib/device-id.ts';
import { sealabilityOf, sendBlockOf, type MemberSeal, type Sealability } from '../src/lib/seal-state.ts';
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
    ({ accountId: 'account-alex', handle: 'alex', kind: 'wallet', address: alice.address.toLowerCase(), devices: [await device(alice)] });

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
            { accountId: 'account-sara.k', handle: 'sara.k', kind: 'wallet', address: mallory.address.toLowerCase(), devices: [await device(mallory)] }
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
            { accountId: 'account-sara.k', handle: 'sara.k', kind: 'wallet', address: mallory.address.toLowerCase(), devices: [theirs] }
        ), 'alex');

        expect(answer.members.find((one) => one.handle === 'sara.k')?.devices).toEqual([theirs]);
    });

    it('is blocked by a guest, and names them', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { accountId: 'account-sara.k', handle: 'sara.k', kind: 'guest', devices: [] }
        ), 'alex');

        expect(answer.ready).toBe(false);
        expect(answer.blocked?.handle).toBe('sara.k');
        expect(answer.blocked?.state).toBe('no-wallet');
    });

    it('tells a wallet account with no device apart from a guest', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { accountId: 'account-sara.k', handle: 'sara.k', kind: 'wallet', devices: [] }
        ), 'alex');

        // Different sentences, because they are different situations: one of them is fixed by
        // enrolling a browser and the other is not fixed at all.
        expect(answer.blocked?.state).toBe('no-device');
    });

    it('refuses a contract wallet rather than taking the server word for it', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { accountId: 'account-sara.k', handle: 'sara.k', kind: 'wallet', address: mallory.address.toLowerCase(), devices: [await device(mallory, { attested: 'contract' })] }
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
                { accountId: 'account-sara.k', handle: 'sara.k', kind: 'wallet', address: mallory.address.toLowerCase(), devices: [good, swapped] }
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
                    accountId: 'account-sara.k',
                    handle: 'sara.k',
                    kind: 'wallet',
                    address: mallory.address.toLowerCase(),
                    devices: [theirs, { ...forged, address: alice.address.toLowerCase() }]
                }
            ), 'alex');

            expect(answer.blocked?.state).toBe('tampered');
        });

        it('reports a tampered member ahead of a merely absent one, whatever the order', async () =>
        {
            const swapped = { ...await device(mallory), signingKey: (await realKeys()).signingKey };

            const answer = await sealabilityOf(conversation(
                { accountId: 'account-guest.one', handle: 'guest.one', kind: 'guest', devices: [] },
                await me(),
                { accountId: 'account-sara.k', handle: 'sara.k', kind: 'wallet', address: mallory.address.toLowerCase(), devices: [swapped] }
            ), 'alex');

            // Absent proof is ordinary. A proof that was present and did not check out is not.
            expect(answer.blocked?.handle).toBe('sara.k');
            expect(answer.blocked?.state).toBe('tampered');
        });
    });
});

/**
 * Which of the two answers stands in the way of SENDING.
 *
 * Pure, so the rule is pinned here rather than inferred from a rendered page. The bug it exists to
 * make impossible: the composer was disabled on the room's answer alone while `post` refuses on this
 * browser's keyring, so a browser with no keys on an account enrolled elsewhere rendered a padlock,
 * enabled the box and threw on Send.
 */
describe('what stands in the way of sending', () =>
{
    const member = (state: MemberSeal['state'], isMe = false): MemberSeal =>
        ({ handle: 'sara.k', state, isMe, devices: [] });

    const room = (blocked: MemberSeal | null): Sealability =>
        ({ members: [], ready: blocked === null, blocked });

    it('is this browser, even when every account in the room is ready', () =>
    {
        const stop = sendBlockOf({ sealability: room(null), readiness: 'absent', known: true, isWallet: true });

        expect(stop).toEqual({ reason: 'browser', readiness: 'absent' });
    });

    /**
     * The anti-flash rule. `readiness()` answers `absent` until the keyring has been read, so acting
     * on it unguarded disables the composer on every cold load and enables it a moment later.
     */
    it('says nothing about this browser until somebody has looked', () =>
    {
        expect(sendBlockOf({ sealability: room(null), readiness: 'absent', known: false, isWallet: true })).toBeNull();
    });

    /**
     * The room's answer is a fetch, and the moments before it land read as "nothing is in the
     * way" - which is how an enabled composer took a message `post` was always going to refuse.
     * While the answer is in flight the composer stands down, quietly: no notice names anybody,
     * because there is nobody to name yet.
     */
    it('stands the composer down while the room has not answered', () =>
    {
        expect(sendBlockOf({ sealability: null, readiness: 'ready', known: true, isWallet: true, pending: true }))
            .toEqual({ reason: 'pending' });
    });

    it('lets a tampered device set outrank this browser, because that one is not a thing to work around', () =>
    {
        const stop = sendBlockOf({ sealability: room(member('tampered')), readiness: 'absent', known: true, isWallet: true });

        expect(stop?.reason).toBe('member');
    });

    /**
     * A guest's devices are attested by this server and are filtered out of every peer list, so
     * enrolling one changes nothing about sealing. Offering it would be a button that lies.
     */
    it('never blames a guest browser for keys that would not help', () =>
    {
        const stop = sendBlockOf({ sealability: room(member('no-wallet', true)), readiness: 'absent', known: true, isWallet: false });

        expect(stop).toEqual({ reason: 'member', member: member('no-wallet', true) });
    });

    it('still counts a browser waiting to be confirmed as in the way', () =>
    {
        expect(sendBlockOf({ sealability: room(null), readiness: 'waiting', known: true, isWallet: true }))
            .toEqual({ reason: 'browser', readiness: 'waiting' });
    });

    it('is nothing at all when the room and the browser both answer yes', () =>
    {
        expect(sendBlockOf({ sealability: room(null), readiness: 'ready', known: true, isWallet: true })).toBeNull();
    });
});

describe('what the thread says about it', () =>
{
    const render = (blocked: MemberSeal): string =>
        renderTest(() => SealNotice({ stop: { reason: 'member', member: blocked } }) as unknown as HTMLElement).container.textContent ?? '';

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
        const { container } = renderTest(() => SealNotice({ stop: { reason: 'member', member: seal('tampered') } }) as unknown as HTMLElement);

        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(container.textContent).toContain('did not match the proof');
    });

    it('is not an alarm for any of the ordinary reasons', () =>
    {
        for (const state of ['no-wallet', 'no-device', 'needs-chain'] as const)
        {
            cleanup();
            const { container } = renderTest(() => SealNotice({ stop: { reason: 'member', member: seal(state) } }) as unknown as HTMLElement);
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

    /**
     * The ACCOUNT sentence, which is not the browser sentence.
     *
     * This key used to say "This browser has no keys yet" while describing a state about the whole
     * account - nobody anywhere has enrolled. The browser's own case now has its own key, and
     * conflating them is what let a browser with no keys, on an account enrolled elsewhere, render
     * the positive line.
     */
    it('speaks about the account when it is the account that has nothing', () =>
    {
        expect(render(seal('no-device', true))).toContain('None of your browsers');
    });

    it('follows a language switch, like every other composed sentence', () =>
    {
        useLocale().setLocale('fa');
        expect(render(seal('no-wallet'))).toContain('مهروموم نشده‌اند');
    });

    it('tells a keyless browser which of the three it is, and offers only what would help', () =>
    {
        const said = (readiness: 'absent' | 'waiting' | 'unsupported'): string =>
        {
            cleanup();
            return renderTest(() => SealNotice({ stop: { reason: 'browser', readiness } }) as unknown as HTMLElement)
                .container.textContent ?? '';
        };

        expect(said('absent')).toContain('no keys of its own');
        expect(said('waiting')).toContain('waiting to be confirmed');
        expect(said('unsupported')).toContain('nowhere secure');
    });

    it('puts an action beside the sentence rather than inside it', () =>
    {
        const { container } = renderTest(() => SealNotice({
            stop: { reason: 'browser', readiness: 'absent' },
            action: (() =>
            {
                const button = document.createElement('button');
                button.textContent = 'Give this browser keys';
                return button;
            })()
        }) as unknown as HTMLElement);

        expect(container.querySelector('button')).not.toBeNull();
        expect(container.querySelector('p button')).toBeNull();
    });

    it('is never an alarm for anything about this browser', () =>
    {
        for (const readiness of ['absent', 'waiting', 'unsupported'] as const)
        {
            cleanup();
            const { container } = renderTest(() => SealNotice({ stop: { reason: 'browser', readiness } }) as unknown as HTMLElement);
            expect(container.querySelector('[role="alert"]')).toBeNull();
        }
    });
});
