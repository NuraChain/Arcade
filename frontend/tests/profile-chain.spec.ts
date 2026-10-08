import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route } from 'azerothjs';

import ProfileSheet from '../src/components/app/profile-sheet.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { Eip1193Provider } from '../src/lib/wallet.ts';
import '../src/locales/app-catalogue.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import type { Account } from '../../backend/src/schemas.ts';
import { client, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const settle = async () =>
{
    for (let i = 0; i < 12; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

let seed = 0;

const addressOf = (n: number) => `0x${ n.toString(16).padStart(40, '0') }`;

const walletWith = (address: string, send: () => Promise<unknown>, locked = false): { calls: string[]; provider: Eip1193Provider } =>
{
    const calls: string[] = [];
    return {
        calls,
        provider: {
            async request({ method })
            {
                calls.push(method);
                if (locked && method === 'eth_accounts')
                {
                    return [];
                }
                if (locked && method === 'eth_requestAccounts')
                {
                    throw { code: 4100, message: 'The wallet is locked' };
                }
                if (method === 'eth_accounts' || method === 'eth_requestAccounts')
                {
                    return [address];
                }
                if (method === 'eth_chainId')
                {
                    return '0x3fc';
                }
                if (method === 'eth_sendTransaction')
                {
                    return send();
                }
                if (method === 'eth_getTransactionReceipt')
                {
                    return { status: '0x1' };
                }
                return null;
            },
            on()
            {
                return;
            },
            removeListener()
            {
                return;
            }
        }
    };
};

let stopWallet: (() => void) | null = null;

const signInWith = async (signer: { provider: Eip1193Provider }, owner: string) =>
{
    const account: Account = { id: `u-${ owner }`, handle: 'dana.w', displayName: 'Dana', bio: '', hue: 12, isMinor: false, address: owner };
    server.account = account;
    useSession().establish(account);

    const wallet = useWallet();
    wallet.adopt(signer.provider);
    stopWallet = wallet.start();
    await settle();
};

let closedWith: boolean | null = null;

const sheet = async () =>
{
    closedWith = null;
    const close = (value?: unknown) =>
    {
        closedWith = value === true;
    };
    const component = (() => ProfileSheet({ overlayId: 'profile-test', close })) as unknown as () => HTMLElement;
    const table: Route[] = [{ path: '/app/me', component }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/me'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: component }) as HTMLElement);
    await settle();
    return container;
};

const fill = (container: HTMLElement, id: string, value: string) =>
{
    const field = container.querySelector(`#${ id }`) as HTMLInputElement | HTMLTextAreaElement;
    const proto = Object.getPrototypeOf(field) as object;
    (Object.getOwnPropertyDescriptor(proto, 'value')?.set as (this: unknown, v: string) => void).call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const save = async (container: HTMLElement) =>
{
    [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith('Save'))?.click();
    await settle();
};

const told = () => useToasts().items().map((toast) => toast.text).join(' | ');

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5000), seed: 2 });
    useLocale().setLocale('en');
    server.reset();
    useToasts().reset();
    seed += 1;
});

afterEach(() =>
{
    stopWallet?.();
    stopWallet = null;
    useWallet().reset();
    cleanup();
    resetRuntime();
});

describe('saving a profile writes the name, the picture and the bio to the Nura Profile', () =>
{
    it('asks the wallet to write it, and says so only once the chain has it', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(owner, async () => '0xfeed');
        await signInWith(signer, owner);
        server.chain = { configured: true, profile: null };

        const container = await sheet();
        fill(container, 'profile-name', 'Dana Whitfield');
        await settle();
        await save(container);

        expect(server.calls).toContain('auth.profile');
        expect(server.calls).toContain('chain.publish');
        expect(signer.calls).toContain('eth_sendTransaction');
        expect(signer.calls).toContain('eth_getTransactionReceipt');
        expect(told()).toContain('written to your Nura Profile');
        expect(closedWith).toBe(true);
    });

    it('refuses to write from a wallet holding a different account, rather than creating a profile for it', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(addressOf(seed + 1000), async () => '0xfeed');
        await signInWith(signer, owner);
        server.chain = { configured: true, profile: null };

        const container = await sheet();
        fill(container, 'profile-name', 'Dana Whitfield');
        await settle();
        await save(container);

        expect(server.calls).toContain('auth.profile');
        expect(signer.calls).not.toContain('eth_sendTransaction');
        expect(told()).toContain('different account');
    });

    it('says the wallet is locked, not that it was declined', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(owner, async () =>
        {
            throw { code: 4100, message: 'The wallet is locked' };
        });
        await signInWith(signer, owner);
        server.chain = { configured: true, profile: null };

        const container = await sheet();
        fill(container, 'profile-name', 'Dana Whitfield');
        await settle();
        await save(container);

        expect(told()).toContain('Saved on this server, but not on the chain');
        expect(told()).toContain('locked');
        expect(told()).not.toContain('declined');
    });

    it('says the profile stayed on this server when no registry is set up', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(owner, async () => '0xfeed');
        await signInWith(signer, owner);
        server.chain = { configured: false, profile: null };

        const container = await sheet();
        fill(container, 'profile-name', 'Dana Whitfield');
        await settle();
        await save(container);

        expect(server.calls).not.toContain('chain.publish');
        expect(told()).toContain('Saved on this server');
    });

    it('does not ask the wallet for anything when only the handle changed', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(owner, async () => '0xfeed');
        await signInWith(signer, owner);
        server.chain = {
            configured: true,
            profile: {
                id: '7', owner, username: '', displayName: 'Dana', bio: '', avatar: '', cover: '', location: '',
                jobTitle: '', company: '', record: '', updatedAt: new Date(0).toISOString()
            }
        };

        const container = await sheet();
        fill(container, 'profile-handle', 'dana.whitfield');
        await settle();
        await save(container);

        expect(server.calls).toContain('auth.handle');
        expect(server.calls).not.toContain('chain.publish');
        expect(signer.calls).not.toContain('eth_sendTransaction');
    });

    it('writes what this server holds when the chain still says something older, even with nothing edited', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(owner, async () => '0xfeed');
        await signInWith(signer, owner);
        server.chain = {
            configured: true,
            profile: {
                id: '7', owner, username: '', displayName: 'An older name', bio: '', avatar: '', cover: '', location: '',
                jobTitle: '', company: '', record: '', updatedAt: new Date(0).toISOString()
            }
        };

        const container = await sheet();
        await save(container);

        expect(server.calls).toContain('chain.publish');
        expect(signer.calls).toContain('eth_sendTransaction');
    });

    it('says a wallet that locked itself is locked, when it hides its account until unlocked', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(owner, async () => '0xfeed', true);
        await signInWith(signer, owner);
        server.chain = { configured: true, profile: null };

        const container = await sheet();
        fill(container, 'profile-name', 'Dana Whitfield');
        await settle();
        await save(container);

        expect(signer.calls).toContain('eth_requestAccounts');
        expect(signer.calls).not.toContain('eth_sendTransaction');
        expect(told()).toContain('locked');
        expect(told()).not.toContain('not connected');
    });

    it('points at the wallet, not the registry, when the wallet cannot send', async () =>
    {
        const owner = addressOf(seed);
        const signer = walletWith(owner, async () =>
        {
            throw { code: -32000, message: 'insufficient funds for gas' };
        });
        await signInWith(signer, owner);
        server.chain = { configured: true, profile: null };

        const container = await sheet();
        fill(container, 'profile-name', 'Dana Whitfield');
        await settle();
        await save(container);

        expect(told()).toContain('not enough for gas');
        expect(told()).not.toContain('could not be reached');
    });

    it('says it could not reach the registry, and does not hang, when the chain state will not load', async () =>
    {
        const owner = addressOf(seed);
        await signInWith(walletWith(owner, async () => '0xfeed'), owner);
        server.chain = { configured: true, profile: null };
        const profile = vi.spyOn(client.chain, 'profile').mockRejectedValue(new Error('rpc down'));

        const container = await sheet();
        fill(container, 'profile-name', 'Dana Whitfield');
        await settle();
        await save(container);

        expect(server.calls).toContain('auth.profile');
        expect(told()).toContain('could not be reached');
        expect(closedWith).toBe(true);
        profile.mockRestore();
    });

    it('carries the link of the uploaded picture on the account', async () =>
    {
        const owner = addressOf(seed);
        await signInWith(walletWith(owner, async () => '0xfeed'), owner);

        const { url } = await client.auth.avatar({ input: { data: 'AAAA' } });
        await useAccount().setProfile({ displayName: 'Dana', bio: '', avatar: url });

        expect(useAccount().user()?.avatar).toBe(`${ window.location.origin }/avatars/${ 'ab'.repeat(32) }.webp`);
    });
});
