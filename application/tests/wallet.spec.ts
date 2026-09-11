import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { NURA_CHAIN, chainHost, chainIsConfigured } from '../src/data/chain.ts';
import { resetDataset } from '../src/data/mock/index.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import {
    addressHue,
    detect,
    failureOf,
    isAddress,
    shortAddress,
    walletName,
    type Eip1193Provider
} from '../src/lib/wallet.ts';
import { buildSignInMessage, handleFor, nonceFor } from '../src/services/wallet.service.ts';
import { resolveRecord, useAccount, walletFor } from '../src/stores/account.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useWallet } from '../src/stores/wallet.store.ts';

const ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

let clock: ManualClock;

const memory = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

interface FakeOptions
{
    accounts?: string[];
    chainId?: string;
    rejectAccounts?: boolean;
    rejectSign?: boolean;
    isMetaMask?: boolean;
}

function fakeProvider(options: FakeOptions = {}): Eip1193Provider & { calls: string[] }
{
    const calls: string[] = [];
    return {
        calls,
        isMetaMask: options.isMetaMask ?? true,
        async request({ method })
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
    resetDataset();
    memory.clear();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string): string | null => memory.get(key) ?? null,
            setItem: (key: string, value: string): void =>
            {
                memory.set(key, value);
            },
            removeItem: (key: string): void =>
            {
                memory.delete(key);
            }
        }
    });
    useSession().reset();
    useWallet().reset();
});

afterEach(() =>
{
    useWallet().reset();
    useSession().reset();
    delete (window as unknown as { ethereum?: unknown }).ethereum;
    if (originalStorage !== undefined)
    {
        Object.defineProperty(window, 'localStorage', originalStorage);
    }
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

    it('derives a short handle from the address', () =>
    {
        expect(handleFor(ADDRESS)).toBe('71c765');
    });
});

describe('provider detection', () =>
{
    it('finds nothing when the browser has no wallet', () =>
    {
        expect(detect()).toBeNull();
    });

    it('prefers MetaMask when several wallets are injected', () =>
    {
        const rabby = { ...fakeProvider({ isMetaMask: false }), isRabby: true };
        const metamask = fakeProvider();
        (window as unknown as { ethereum: Eip1193Provider }).ethereum = { ...metamask, providers: [rabby, metamask] };
        expect(detect()).toBe(metamask);
    });

    it('names the wallet it found', () =>
    {
        expect(walletName(fakeProvider())).toBe('MetaMask');
        expect(walletName({ ...fakeProvider({ isMetaMask: false }), isRabby: true })).toBe('Rabby');
        expect(walletName(fakeProvider({ isMetaMask: false }))).toBe('Browser wallet');
        expect(walletName(null)).toBe('MetaMask');
    });

    it('reads the standard provider error codes', () =>
    {
        expect(failureOf({ code: 4001 })).toBe('rejected');
        expect(failureOf({ code: -32002 })).toBe('pending');
        expect(failureOf({ code: 4902 })).toBe('chain');
        expect(failureOf(new Error('boom'))).toBe('unknown');
    });
});

describe('sign-in message', () =>
{
    it('names the domain, the address, the chain and a nonce', () =>
    {
        const message = buildSignInMessage({
            domain: 'nurachain.net',
            address: ADDRESS,
            chainId: '0x1',
            nonce: 'abc123',
            issuedAt: 1_700_000_000_000,
            statement: 'Sign in to Nura Games.',
            uri: 'https://nurachain.net'
        });
        expect(message).toContain('nurachain.net wants you to sign in with your wallet:');
        expect(message).toContain(ADDRESS);
        expect(message).toContain('Chain ID: 0x1');
        expect(message).toContain('Nonce: abc123');
        expect(message).toContain('Issued At: 2023-11-14T22:13:20.000Z');
    });

    it('mints the same nonce for the same second and a different one later', () =>
    {
        expect(nonceFor(4, ADDRESS, 1_700_000_000_000)).toBe(nonceFor(4, ADDRESS, 1_700_000_000_400));
        expect(nonceFor(4, ADDRESS, 1_700_000_000_000)).not.toBe(nonceFor(4, ADDRESS, 1_700_000_060_000));
        expect(nonceFor(4, ADDRESS, 1_700_000_000_000)).not.toBe(nonceFor(5, ADDRESS, 1_700_000_000_000));
    });

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

    it('connects, signs once, and reports the account', async () =>
    {
        const wallet = useWallet();
        const provider = fakeProvider();
        wallet.adopt(provider);

        expect(await wallet.connect()).toBe(ADDRESS);
        expect(wallet.status()).toBe('connected');
        expect(wallet.address()).toBe(ADDRESS);
        expect(wallet.chainId()).toBe('0x1');
        expect(provider.calls).toContain('eth_requestAccounts');
        expect(provider.calls.filter((method) => method === 'personal_sign').length).toBe(1);
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

    it('stops cleanly when the signature is turned down', async () =>
    {
        const wallet = useWallet();
        wallet.adopt(fakeProvider({ rejectSign: true }));
        expect(await wallet.connect()).toBeNull();
        expect(wallet.status()).toBe('error');
        expect(wallet.failure()).toBe('rejected');
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
});

describe('wallet identity', () =>
{
    it('builds a person from an address with a stable handle and hue', () =>
    {
        const person = walletFor(ADDRESS);
        expect(person.handle).toBe('71c765');
        expect(person.id).toBe(`wallet-${ ADDRESS.toLowerCase() }`);
        expect(person.hue).toBe(addressHue(ADDRESS));
        expect(person.name.en).toBe(shortAddress(ADDRESS));
        expect(person.name.fa).toBe(shortAddress(ADDRESS));
    });

    it('signs in with a wallet and remembers the address', () =>
    {
        const account = useAccount();
        const session = useSession();
        account.signInWithWallet(ADDRESS);
        expect(session.signedIn()).toBe(true);
        expect(account.isWallet()).toBe(true);
        expect(account.address()).toBe(ADDRESS);
        expect(account.user()?.handle).toBe('71c765');
    });

    it('restores a wallet session from its record', () =>
    {
        const person = resolveRecord({ id: `wallet-${ ADDRESS.toLowerCase() }`, handle: '71c765', kind: 'wallet', address: ADDRESS });
        expect(person?.name.en).toBe(shortAddress(ADDRESS));
    });

    it('still resolves a demo identity', () =>
    {
        expect(resolveRecord({ id: 'alex', handle: 'alex' })?.handle).toBe('alex');
    });
});
