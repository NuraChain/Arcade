import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { NURA_CHAIN, chainIsConfigured } from '../src/data/chain.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetKeyStore, setKeyStore, type DeviceKeys, type KeyStore } from '../src/lib/device-keys.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import {
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
import { fixtureAccount, server, walletAccount } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

let clock: ManualClock;

interface FakeOptions
{
    permissions?: unknown[] | 'refused';
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
            if (method === 'wallet_getPermissions')
            {
                if (options.permissions === 'refused')
                {
                    throw { code: -32601, message: 'The method does not exist.' };
                }

                return options.permissions ?? null;
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

describe('a wallet whose account goes while the page is open', () =>
{
    const OTHER = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';

    const live = async (options: FakeOptions = {}) =>
    {
        const provider = fakeProvider(options);
        const heard: ((...args: unknown[]) => void)[] = [];
        const gone: string[] = [];

        provider.on = (event: string, listener: (...args: unknown[]) => void) =>
        {
            if (event === 'accountsChanged')
            {
                heard.push(listener);
            }
        };
        (window as unknown as { ethereum?: unknown }).ethereum = provider;
        useWallet().reset();

        const stop = useWallet().start();
        const off = useWallet().onLeft((address) => gone.push(address));

        await flush();

        return {
            gone,
            say: async (accounts: string[]) =>
            {
                for (const listener of heard)
                {
                    listener(accounts);
                }

                await flush();
            },
            stop: () =>
            {
                off();
                stop();
            }
        };
    };

    const flush = async () =>
    {
        for (let step = 0; step < 8; step += 1)
        {
            await Promise.resolve();
        }
    };

    it('says which account left when the wallet offers another one instead', async () =>
    {
        const wallet = await live();

        await wallet.say([OTHER]);

        expect(wallet.gone).toEqual([ADDRESS]);
        expect(useWallet().address()).toBe(OTHER);
        wallet.stop();
    });

    it('says which account left when this site was disconnected from the wallet', async () =>
    {
        const wallet = await live({ permissions: [] });

        await wallet.say([]);

        expect(wallet.gone).toEqual([ADDRESS]);
        wallet.stop();
    });

    it('says nothing when the wallet is only locked, because the site is still connected to it', async () =>
    {
        const wallet = await live({ permissions: [{ parentCapability: 'eth_accounts' }] });

        await wallet.say([]);

        expect(wallet.gone).toEqual([]);
        expect(useWallet().address()).toBeNull();
        wallet.stop();
    });

    it('says nothing when the wallet cannot say whether it is locked or disconnected', async () =>
    {
        const wallet = await live({ permissions: 'refused' });

        await wallet.say([]);

        expect(wallet.gone).toEqual([]);
        wallet.stop();
    });

    it('says nothing about an account it had not offered, or one offered again in another case', async () =>
    {
        const wallet = await live({ accounts: [] });

        await wallet.say([OTHER]);
        await wallet.say([OTHER.toLowerCase()]);

        expect(wallet.gone).toEqual([]);
        wallet.stop();
    });
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
        expect(walletName({ ...fakeProvider(), isNuraWallet: true })).toBe('Nura Wallet');
        expect(walletName({ ...fakeProvider({ isMetaMask: false }), isRabby: true })).toBe('Rabby');
        expect(walletName(fakeProvider({ isMetaMask: false })), 'an unnamed wallet was named, in one language').toBeNull();
        expect(walletName(null)).toBeNull();
    });

    it('reads the standard provider error codes', () =>
    {
        expect(failureOf({ code: 4001 })).toBe('rejected');
        expect(failureOf({ code: 4100 })).toBe('unauthorized');
        expect(failureOf({ code: -32002 })).toBe('pending');
        expect(failureOf({ code: 4902 })).toBe('chain');
        expect(failureOf(new Error('boom'))).toBe('unknown');
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

describe('connecting a wallet adds this browser', () =>
{
    const memoryKeys = () =>
    {
        const store: KeyStore & { minted: number; held: DeviceKeys | null } = {
            minted: 0,
            held: null,
            available: () => true,
            async load()
            {
                return store.held;
            },
            async secrets()
            {
                return null;
            },
            async mint()
            {
                store.minted += 1;
                store.held = { id: `device-${ store.minted }`, exchangeKey: `exchange-${ store.minted }`, signingKey: `signing-${ store.minted }` };

                return store.held;
            },
            async forget()
            {
                store.held = null;
            }
        };

        return store;
    };

    let keys: ReturnType<typeof memoryKeys>;

    beforeEach(() =>
    {
        keys = memoryKeys();
        setKeyStore(keys);
    });

    afterEach(() =>
    {
        resetKeyStore();
    });

    const signs = (provider: ReturnType<typeof fakeProvider>) => provider.calls.filter((method) => method === 'personal_sign').length;

    it('makes keys for a browser that has none, and names them in the one message the wallet signs', async () =>
    {
        const provider = fakeProvider();
        useWallet().adopt(provider);

        await useWallet().connect();

        expect(keys.minted).toBe(1);
        expect(signs(provider)).toBe(1);
        expect(provider.signed[0]).toContain(`Browser key: ${ keys.held?.id }`);
        expect(server.received?.device?.id).toBe(keys.held?.id);
    });

    it('keeps keys this account already has here, and asks for no device in what the wallet signs', async () =>
    {
        const held = await keys.mint();

        server.addDevice({ id: held.id, exchangeKey: held.exchangeKey, signingKey: held.signingKey });

        const provider = fakeProvider();
        useWallet().adopt(provider);

        await useWallet().connect();

        expect(keys.minted, 'keys this account holds were thrown away').toBe(1);
        expect(signs(provider)).toBe(1);
        expect(provider.signed[0]).not.toContain('Browser key:');
        expect(server.calls.filter((call) => call === 'auth.challenge')).toHaveLength(1);
    });

    it('makes new keys before the wallet signs when the ones here are not this account’s, so one signature still adds the browser', async () =>
    {
        const stale = await keys.mint();

        server.addDevice({ id: stale.id, exchangeKey: stale.exchangeKey, signingKey: stale.signingKey, revoked: true });

        const provider = fakeProvider();
        useWallet().adopt(provider);

        await useWallet().connect();

        expect(keys.minted, 'the keys the server would refuse were kept').toBe(2);
        expect(keys.held?.id).not.toBe(stale.id);
        expect(signs(provider), 'the browser was added with a second signature').toBe(1);
        expect(provider.signed[0]).toContain(`Browser key: ${ keys.held?.id }`);
        expect(provider.signed[0]).not.toContain(stale.id);
        expect(server.received?.device?.id).toBe(keys.held?.id);
    });

    it('makes nothing for a browser that cannot hold keys, and still signs in', async () =>
    {
        setKeyStore({ ...memoryKeys(), available: () => false });

        const provider = fakeProvider();
        useWallet().adopt(provider);

        expect(await useWallet().connect()).toEqual(walletAccount(ADDRESS));
        expect(provider.signed[0]).not.toContain('Browser key:');
        expect(server.received?.device).toBeUndefined();
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
        expect(account.address()).toBe(ADDRESS.toLowerCase());
        expect(person?.handle).toBe('71c765');
        expect(account.user()?.handle).toBe('71c765');
    });

    it('resolves nothing for a browser that is signed out', () =>
    {
        expect(personFor(null)).toBeNull();
    });

    it('still resolves a demo identity from its handle', () =>
    {
        expect(personFor(fixtureAccount('alex')!)?.id).toBe('alex');
    });
});
