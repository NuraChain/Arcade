import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';
import { privateKeyToAccount } from 'viem/accounts';

import type { ConversationDevices, PeerDevice } from '../src/api.ts';
import SealNotice from '../src/components/chat/seal-notice.component.azeroth';
import { deviceLine } from '../src/lib/attestation.ts';
import { deviceIdFrom, toBase64Url } from '../src/lib/device-id.ts';
import { sealabilityOf, sendBlockOf, type BlockedMember, type Sealability, type SendBlock } from '../src/lib/seal-state.ts';
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
        'Let this browser read and send your messages on Nura Games (nura.games).',
        '',
        deviceLine(id),
        `Nonce: ${ 'a'.repeat(32) }`
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
    ({ accountId: 'account-alex', handle: 'alex', address: alice.address.toLowerCase(), devices: [await device(alice)] });

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
            { accountId: 'account-sara.k', handle: 'sara.k', address: mallory.address.toLowerCase(), devices: [await device(mallory)] }
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
            { accountId: 'account-sara.k', handle: 'sara.k', address: mallory.address.toLowerCase(), devices: [theirs] }
        ), 'alex');

        expect(answer.members.find((one) => one.handle === 'sara.k')?.devices).toEqual([theirs]);
    });

    it('is blocked by somebody with no device, and names them', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { accountId: 'account-sara.k', handle: 'sara.k', address: mallory.address.toLowerCase(), devices: [] }
        ), 'alex');

        expect(answer.ready).toBe(false);
        expect(answer.blocked?.handle).toBe('sara.k');
        expect(answer.blocked?.state).toBe('no-device');
    });

    it('names somebody else ahead of the reader when both have nothing to seal to', async () =>
    {
        const answer = await sealabilityOf(conversation(
            { accountId: 'account-sara.k', handle: 'sara.k', devices: [] },
            { accountId: 'account-alex', handle: 'alex', devices: [] }
        ), 'alex');

        expect(answer.blocked?.handle, 'the reader was named instead of the other person').toBe('sara.k');
        expect(answer.blocked?.isMe).toBe(false);
        expect(answer.blocked?.state).toBe('no-device');
    });

    it('refuses a contract wallet rather than taking the server word for it', async () =>
    {
        const answer = await sealabilityOf(conversation(
            await me(),
            { accountId: 'account-sara.k', handle: 'sara.k', address: mallory.address.toLowerCase(), devices: [await device(mallory, { attested: 'contract' })] }
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
                { accountId: 'account-sara.k', handle: 'sara.k', address: mallory.address.toLowerCase(), devices: [good, swapped] }
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
                { accountId: 'account-absent.one', handle: 'absent.one', devices: [] },
                await me(),
                { accountId: 'account-sara.k', handle: 'sara.k', address: mallory.address.toLowerCase(), devices: [swapped] }
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
    const member = (state: BlockedMember['state'], isMe = false): BlockedMember =>
        ({ handle: 'sara.k', state, isMe, devices: [] });

    const room = (blocked: BlockedMember | null): Sealability =>
        ({ members: [], ready: blocked === null, blocked });

    it('is this browser, even when every account in the room is ready', () =>
    {
        const stop = sendBlockOf({ sealability: room(null), readiness: 'absent', known: true });

        expect(stop).toEqual({ reason: 'browser', readiness: 'absent' });
    });

    /**
     * The anti-flash rule. `readiness()` answers `absent` until the keyring has been read, so acting
     * on it unguarded disables the composer on every cold load and enables it a moment later.
     */
    it('says nothing about this browser until somebody has looked', () =>
    {
        expect(sendBlockOf({ sealability: room(null), readiness: 'absent', known: false })).toBeNull();
    });

    /**
     * The room's answer is a fetch, and the moments before it land read as "nothing is in the
     * way" - which is how an enabled composer took a message `post` was always going to refuse.
     * While the answer is in flight the composer stands down, quietly: no notice names anybody,
     * because there is nobody to name yet.
     */
    it('stands the composer down while the room has not answered', () =>
    {
        expect(sendBlockOf({ sealability: null, readiness: 'ready', known: true, pending: true }))
            .toEqual({ reason: 'pending' });
    });

    it('lets a tampered device set outrank this browser, because that one is not a thing to work around', () =>
    {
        const stop = sendBlockOf({ sealability: room(member('tampered')), readiness: 'absent', known: true });

        expect(stop?.reason).toBe('member');
    });

    it('is nothing at all when the room and the browser both answer yes', () =>
    {
        expect(sendBlockOf({ sealability: room(null), readiness: 'ready', known: true })).toBeNull();
    });
});

describe('what the thread says about it', () =>
{
    const render = (blocked: BlockedMember): string =>
        renderTest(() => SealNotice({ stop: { reason: 'member', member: blocked } }) as unknown as HTMLElement).container.textContent ?? '';

    const seal = (state: BlockedMember['state'], isMe = false): BlockedMember => ({ handle: 'sara.k', state, isMe, devices: [] });

    it('names the person and says what would fix it', () =>
    {
        const said = render(seal('no-device'));

        expect(said).toContain('sara.k');
        expect(said).toContain('Nobody can write here yet');
        expect(said).toContain('has not given any of their browsers keys');
    });

    it('never calls what nobody can send unsealed, in either language', () =>
    {
        const states: BlockedMember['state'][] = ['no-device', 'needs-chain'];

        for (const language of ['en', 'fa'] as const)
        {
            useLocale().setLocale(language);

            for (const state of states)
            {
                for (const isMe of [false, true])
                {
                    const said = render(seal(state, isMe));

                    cleanup();

                    expect(said, `${ language } ${ state } ${ isMe ? 'mine' : 'theirs' }`).not.toMatch(/not sealed|مهروموم نشده/);
                    expect(said.length, `${ language } ${ state } ${ isMe ? 'mine' : 'theirs' } says nothing`).toBeGreaterThan(20);
                }
            }
        }

        useLocale().setLocale('en');
    });

    it('tells the reader it is they who cannot write when it is their own account', () =>
    {
        const said = render(seal('no-device', true));

        expect(said).toContain('You cannot write here yet');
        expect(said).not.toContain('sara.k');
    });

    it('reads as an alarm rather than a shrug when a proof did not check out', () =>
    {
        const { container } = renderTest(() => SealNotice({ stop: { reason: 'member', member: seal('tampered') } }) as unknown as HTMLElement);

        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(container.textContent).toContain('did not match the proof');
    });

    it('is not an alarm for any of the ordinary reasons', () =>
    {
        for (const state of ['no-device', 'needs-chain'] as const)
        {
            cleanup();
            const { container } = renderTest(() => SealNotice({ stop: { reason: 'member', member: seal(state) } }) as unknown as HTMLElement);
            expect(container.querySelector('[role="alert"]')).toBeNull();
        }
    });

    it('speaks about the account when it is the account that has nothing', () =>
    {
        expect(render(seal('no-device', true))).toContain('None of your browsers');
    });

    it('follows a language switch, like every other composed sentence', () =>
    {
        useLocale().setLocale('fa');
        expect(render(seal('no-device'))).toContain('هنوز کسی نمی‌تواند اینجا بنویسد');
    });

    it('tells a keyless browser which of the two it is, and offers only what would help', () =>
    {
        const said = (readiness: 'absent' | 'unsupported'): string =>
        {
            cleanup();
            return renderTest(() => SealNotice({ stop: { reason: 'browser', readiness } }) as unknown as HTMLElement)
                .container.textContent ?? '';
        };

        expect(said('absent')).toContain('no keys of its own');
        expect(said('unsupported')).toContain('nowhere secure');
    });

    it('offers this browser its keys beside the sentence, not inside it, and only when keys are what is missing', () =>
    {
        const drawn = (stop: SendBlock) =>
        {
            cleanup();
            return renderTest(() => SealNotice({ stop }) as unknown as HTMLElement).container;
        };

        const keyless = drawn({ reason: 'browser', readiness: 'absent' });

        expect(keyless.querySelector('button')?.textContent).toContain(useLocale().t('devices.enrol'));
        expect(keyless.querySelector('p button')).toBeNull();

        expect(drawn({ reason: 'browser', readiness: 'unsupported' }).querySelector('button')).toBeNull();
        expect(drawn({ reason: 'member', member: seal('no-device', true) }).querySelector('button')).toBeNull();
        expect(drawn({ reason: 'member', member: seal('no-device') }).querySelector('button')).toBeNull();
    });

    it('keeps that button when it is told the same thing again, and puts it away when keys stop being the answer', () =>
    {
        const [stop, setStop] = createSignal<SendBlock>({ reason: 'browser', readiness: 'absent' });
        const { container } = renderTest(() => SealNotice({
            get stop()
            {
                return stop();
            }
        }) as unknown as HTMLElement);
        const offered = container.querySelector('button');

        expect(offered).not.toBeNull();

        setStop({ reason: 'browser', readiness: 'absent' });

        expect(container.querySelector('button'), 'the button was drawn again').toBe(offered);

        setStop({ reason: 'browser', readiness: 'unsupported' });

        expect(container.querySelector('button')).toBeNull();
        expect(container.textContent).toContain('nowhere secure');
    });

    it('is never an alarm for anything about this browser', () =>
    {
        for (const readiness of ['absent', 'unsupported'] as const)
        {
            cleanup();
            const { container } = renderTest(() => SealNotice({ stop: { reason: 'browser', readiness } }) as unknown as HTMLElement);
            expect(container.querySelector('[role="alert"]')).toBeNull();
        }
    });
});
