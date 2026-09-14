import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { NURA_CHAIN, chainHost, chainIsConfigured } from '../src/data/chain.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import {
    addressHue,
    announcedWallets,
    detect,
    discoverWallets,
    failureOf,
    forgetWallets,
    isAddress,
    rdnsOf,
    shortAddress,
    walletName,
    type Eip1193Provider
} from '../src/lib/wallet.ts';
import { personFor, useAccount } from '../src/stores/account.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';
import { fixtureAccount, guestAccount, server, walletAccount } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

let clock: ManualClock;

interface FakeOptions
{
    accounts?: string[];
    chainId?: string;
    rejectAccounts?: boolean;
    rejectSign?: boolean;
    isMetaMask?: boolean;
}

function fakeProvider(options: FakeOptions = {}): Eip1193Provider & { calls: string[]; signed: string[] }
{
    const calls: string[] = [];
    const signed: string[] = [];
    return {
        calls,
        signed,
        isMetaMask: options.isMetaMask ?? true,
        async request({ method, params })
        {
            calls.push(method);
            if (method === 'eth_requestAccounts')
            {
                if (options.rejectAccounts === true)
                {
                    throw { code: 4001, message: 'User rejected the request.' };
                }
                return options.accounts ?? [ADDRESS];
            }
            if (method === 'eth_accounts')
            {
                return options.accounts ?? [ADDRESS];
            }
            if (method === 'eth_chainId')
            {
                return options.chainId ?? '0x1';
            }
            if (method === 'personal_sign')
            {
                if (options.rejectSign === true)
                {
                    throw { code: 4001, message: 'User denied message signature.' };
                }
                signed.push(String((params as unknown[] | undefined)?.[0] ?? ''));
                return '0xsignature';
            }
            if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain')
            {
                return null;
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
    };
}

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_700_000_000_000);
    setRuntime({ clock, seed: 4 });
    server.reset();
    forgetWallets();
    useSession().reset();
    useWallet().reset();
});

afterEach(() =>
{
    useWallet().reset();
    useSession().reset();
    forgetWallets();
    delete (window as unknown as { ethereum?: unknown }).ethereum;
});

describe('addresses', () =>
{
    it('recognises an address and refuses anything else', () =>
    {
        expect(isAddress(ADDRESS)).toBe(true);
        expect(isAddress('0x71C7')).toBe(false);
        expect(isAddress('alex')).toBe(false);
    });

    it('shortens for display without losing either end', () =>
    {
        const short = shortAddress(ADDRESS);
        expect(short.startsWith('0x71C7')).toBe(true);
        expect(short.endsWith('976F')).toBe(true);
        expect(short.length).toBeLessThan(ADDRESS.length);
        expect(shortAddress('not-an-address')).toBe('not-an-address');
    });

    it('gives every address a stable hue', () =>
    {
        expect(addressHue(ADDRESS)).toBe(addressHue(ADDRESS));
        expect(addressHue(ADDRESS)).toBeGreaterThanOrEqual(0);
        expect(addressHue(ADDRESS)).toBeLessThan(360);
        expect(addressHue('0x0000000000000000000000000000000000000001')).not.toBe(addressHue(ADDRESS));
    });
});

describe('provider detection', () =>
{
    it('finds nothing when the browser has no wallet', () =>
    {
        expect(detect()).toBeNull();
    });

    it('takes the first injected provider instead of believing a self-declared flag', () =>
    {
        const rabby = { ...fakeProvider({ isMetaMask: false }), isRabby: true };
        const metamask = fakeProvider();
        (window as unknown as { ethereum: Eip1193Provider }).ethereum = { ...metamask, providers: [rabby, metamask] };
        expect(detect()).toBe(rabby);
    });

    it('prefers a wallet that announced itself over whatever was injected', () =>
    {
        (window as unknown as { ethereum: Eip1193Provider }).ethereum = fakeProvider();
        const nura = fakeProvider({ isMetaMask: false });
        const stop = discoverWallets();

        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: { info: { rdns: 'net.nurachain.wallet', name: 'Nura Wallet', icon: '' }, provider: nura }
        }));

        expect(detect()).toBe(nura);
        expect(walletName(nura)).toBe('Nura Wallet');
        expect(rdnsOf(nura)).toBe('net.nurachain.wallet');
        expect(announcedWallets().map((one) => one.rdns)).toEqual(['net.nurachain.wallet']);
        stop();
    });

    it('names the wallet it found, and does not invent one it did not', () =>
    {
        expect(walletName(fakeProvider())).toBe('MetaMask');
        expect(walletName({ ...fakeProvider({ isMetaMask: false }), isRabby: true })).toBe('Rabby');
        expect(walletName(fakeProvider({ isMetaMask: false }))).toBe('Browser wallet');
        expect(walletName(null)).toBe('Browser wallet');
    });

    it('reads the standard provider error codes', () =>
    {
        expect(failureOf({ code: 4001 })).toBe('rejected');
        expect(failureOf({ code: -32002 })).toBe('pending');
        expect(failureOf({ code: 4902 })).toBe('chain');
        expect(failureOf(new Error('boom'))).toBe('unknown');
    });
});

describe('chain', () =>
{
    it('takes the domain from the configured chain site', () =>
    {
        expect(chainHost()).toBe('nurachain.net');
    });
});

describe('wallet store', () =>
{
    it('refuses to connect when no wallet is installed', async () =>
    {
        const wallet = useWallet();
        wallet.adopt(null);
        expect(wallet.available()).toBe(false);
        expect(await wallet.connect()).toBeNull();
        expect(wallet.status()).toBe('error');
        expect(wallet.failure()).toBe('no-wallet');
    });

    it('connects, signs the message the server issued, and returns the account it minted', async () =>
    {
        const wallet = useWallet();
        const provider = fakeProvider();
        wallet.adopt(provider);

        const account = await wallet.connect();
        expect(account).toEqual(walletAccount(ADDRESS));
        expect(wallet.status()).toBe('connected');
        expect(wallet.address()).toBe(ADDRESS);
        expect(wallet.chainId()).toBe('0x1');
        expect(provider.calls).toContain('eth_requestAccounts');
        expect(provider.calls.filter((method) => method === 'personal_sign').length).toBe(1);
        expect(provider.signed[0]).toBe(server.issued?.message);
    });

    it('sends the signature back with the nonce it was issued against', async () =>
    {
        const wallet = useWallet();
        wallet.adopt(fakeProvider());
        await wallet.connect();
        expect(server.received).toMatchObject({ address: ADDRESS, nonce: server.issued?.nonce, signature: '0xsignature' });
    });

    it('only asks the wallet to switch network once the chain is configured', async () =>
    {
        const wallet = useWallet();
        const provider = fakeProvider();
        wallet.adopt(provider);
        await wallet.connect();
        expect(provider.calls.includes('wallet_switchEthereumChain')).toBe(chainIsConfigured(NURA_CHAIN));
    });

    it('stops cleanly when the account request is turned down', async () =>
    {
        const wallet = useWallet();
        wallet.adopt(fakeProvider({ rejectAccounts: true }));
        expect(await wallet.connect()).toBeNull();
        expect(wallet.status()).toBe('error');
        expect(wallet.failure()).toBe('rejected');
        expect(wallet.address()).toBeNull();
    });

    it('stops cleanly when the signature is turned down, and never reaches the server', async () =>
    {
        const wallet = useWallet();
        wallet.adopt(fakeProvider({ rejectSign: true }));
        expect(await wallet.connect()).toBeNull();
        expect(wallet.status()).toBe('error');
        expect(wallet.failure()).toBe('rejected');
        expect(server.calls).not.toContain('auth.wallet');
    });

    it('reports a refused signature as a refusal and an unreachable server as unavailable', async () =>
    {
        const wallet = useWallet();
        wallet.adopt(fakeProvider());

        server.refuse = 'bad-signature';
        expect(await wallet.connect()).toBeNull();
        expect(wallet.failure()).toBe('rejected');

        server.refuse = 'wallet-unreachable';
        expect(await wallet.connect()).toBeNull();
        expect(wallet.failure()).toBe('unavailable');

        server.refuse = 'challenge-unreachable';
        expect(await wallet.connect()).toBeNull();
        expect(wallet.failure()).toBe('unavailable');
    });

    it('forgets the account on disconnect', async () =>
    {
        const wallet = useWallet();
        wallet.adopt(fakeProvider());
        await wallet.connect();
        wallet.disconnect();
        expect(wallet.address()).toBeNull();
        expect(wallet.status()).toBe('idle');
    });

    it('subscribes and unsubscribes without leaving listeners behind', () =>
    {
        const wallet = useWallet();
        const provider = fakeProvider();
        const on = vi.fn();
        const off = vi.fn();
        wallet.adopt({ ...provider, on, removeListener: off });
        const stop = wallet.start();
        expect(on).toHaveBeenCalledTimes(2);
        stop();
        expect(off).toHaveBeenCalledTimes(2);
    });

    /**
     * The test above says "without leaving listeners behind" and only ever counted the PROVIDER's
     * own two. The window listener that EIP-6963 discovery opens was never counted, and it was the
     * one being left behind: `start()` stored its releaser in a module variable and returned a
     * teardown that did not call it, so every mount added one and overwrote the handle to the last.
     *
     * Two starts and two stops, because one of each would pass even with the bug - the leak only
     * shows when the second start overwrites a handle the first teardown never used.
     */
    it('leaves no provider-discovery listener behind, even across two starts', () =>
    {
        const wallet = useWallet();
        const provider = fakeProvider();
        wallet.adopt({ ...provider, on: vi.fn(), removeListener: vi.fn() });

        let open = 0;
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, ...rest) =>
        {
            if (type === 'eip6963:announceProvider')
            {
                open += 1;
            }
            return add(type, ...rest as [EventListenerOrEventListenerObject]);
        });
        const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type, ...rest) =>
        {
            if (type === 'eip6963:announceProvider')
            {
                open -= 1;
            }
            return remove(type, ...rest as [EventListenerOrEventListenerObject]);
        });

        try
        {
            const first = wallet.start();
            const second = wallet.start();
            first();
            second();
            expect(open, 'a discovery listener outlived the teardown that should have released it').toBe(0);
        }
        finally
        {
            addSpy.mockRestore();
            removeSpy.mockRestore();
        }
    });
});

describe('wallet identity', () =>
{
    it('builds a person from the account the server issued', () =>
    {
        const issued = walletAccount(ADDRESS);
        const person = personFor(issued);
        expect(person?.handle).toBe('71c765');
        expect(person?.id).toBe(issued.handle);
        expect(person?.displayName).toBe(shortAddress(ADDRESS.toLowerCase()));
        expect(person?.hue).toBe(issued.hue);
    });

    it('adopts the connected account into the session', async () =>
    {
        const wallet = useWallet();
        const account = useAccount();
        const session = useSession();
        wallet.adopt(fakeProvider());

        const established = await wallet.connect();
        const person = account.adoptWallet(established!);

        expect(session.signedIn()).toBe(true);
        expect(account.isWallet()).toBe(true);
        expect(account.address()).toBe(ADDRESS.toLowerCase());
        expect(person?.handle).toBe('71c765');
        expect(account.user()?.handle).toBe('71c765');
    });

    it('never mistakes a guest for a wallet', () =>
    {
        const person = personFor(guestAccount('Darya'));
        expect(person?.handle).toBe('darya');
        expect(person?.displayName).toBe('Darya');
        expect(personFor(null)).toBeNull();
    });

    it('still resolves a demo identity from its handle', () =>
    {
        expect(personFor(fixtureAccount('alex')!)?.id).toBe('alex');
    });
});
