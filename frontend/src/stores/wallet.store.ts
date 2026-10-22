import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { NURA_CHAIN, chainIsConfigured } from '../data/chain.ts';
import { keyStore, type DeviceKeys } from '../lib/device-keys.ts';
import {
    detect,
    discoverWallets,
    failureOf,
    permitted,
    personalSign,
    rdnsOf,
    readAccounts,
    readChainId,
    sendTransaction,
    signTypedData,
    chainHex,
    transactionReceipt,
    requestAccounts,
    switchChain,
    walletName,
    type Eip1193Provider,
    type WalletFailure
} from '../lib/wallet.ts';
import { namesDevice } from '../../../backend/src/domains/device/resource.ts';
import { client, ApiError, type Account } from '../api.ts';
import { useDevice } from './device.store.ts';
import { useLocale } from './locale.store.ts';

export type WalletStatus = 'idle' | 'connecting' | 'signing' | 'connected' | 'error';

export interface Suspended
{
    category: string;
    until?: string;
    vault?: string;
}

export interface WalletApi
{
    status: Getter<WalletStatus>;
    address: Getter<string | null>;
    chainId: Getter<string>;
    available: Getter<boolean>;
    name: Getter<string | null>;
    failure: Getter<WalletFailure | null>;
    suspension: Getter<Suspended | null>;
    onNuraChain: Getter<boolean>;
    connect(): Promise<Account | null>;

    /**
     * Asks the connected wallet to sign a message the SERVER composed.
     *
     * Null when there is no provider, no address, or the person said no - all three are answers
     * rather than errors. Device enrolment is the caller: the bytes it passes name one device in
     * their `Resources` line, so what comes back authorises that device and nothing else.
     */
    sign(message: string): Promise<string | null>;
    /**
     * Sends a transaction the server composed, answering with its hash or null.
     *
     * The wallet is the only thing that can sign one, and the person is the only thing that
     * can approve it - so a refusal is an ordinary answer here exactly as it is for sign().
     */
    send(to: string, data: string, extra?: { value?: string; gasPrice?: string }): Promise<string | null>;

    signTyped(typedData: string): Promise<string | null>;

    toChain(chainId: number): Promise<boolean>;

    /** Whether a sent transaction landed. Null means the chain has not mined it yet. */
    settled(hash: string): Promise<boolean | null>;

    reach(): Promise<string | null>;
    adopt(provider: Eip1193Provider | null): void;
    disconnect(): void;

    /**
     * The account this wallet offered here has gone: it now offers another, or this site was
     * disconnected from it. A wallet that is only locked is still connected and says nothing, and
     * nor does one that cannot say which of the two it is.
     */
    onLeft(listener: (address: string) => void): () => void;
    start(): () => void;
    stop(): void;
    reset(): void;
}

function serverFailure(error: unknown)
{
    return error instanceof ApiError && error.status === 429 ? 'busy' : 'unavailable';
}

const toldOf = (details: unknown, key: string) =>
{
    const value: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, key) : undefined;

    return typeof value === 'string' ? value : null;
};

function suspensionOf(error: unknown)
{
    if (!(error instanceof ApiError) || error.status !== 403 || error.code !== 'suspended')
    {
        return null;
    }

    const until = toldOf(error.details, 'until');
    const vault = toldOf(error.details, 'vault');
    const held: Suspended = { category: toldOf(error.details, 'category') ?? 'other' };

    if (until !== null)
    {
        held.until = until;
    }

    if (vault !== null)
    {
        held.vault = vault;
    }

    return held;
}

export const useWallet = createStore((): WalletApi =>
{
    const [status, setStatus] = createSignal<WalletStatus>('idle');
    const [address, setAddress] = createSignal<string | null>(null);
    const [chainId, setChainId] = createSignal('');
    const [failure, setFailure] = createSignal<WalletFailure | null>(null);
    const [suspension, setSuspension] = createSignal<Suspended | null>(null);
    const [present, setPresent] = createSignal(detect() !== null);

    let injected: Eip1193Provider | null = detect();
    let listening: (() => void) | null = null;
    let late: (() => void) | null = null;
    let discovery: (() => void) | null = null;

    const provider = () =>
    {
        if (injected === null)
        {
            injected = detect();
            setPresent(injected !== null);
        }
        return injected;
    };

    const leaving = new Set<(address: string) => void>();

    const left = (gone: string) =>
    {
        for (const listener of [...leaving])
        {
            listener(gone);
        }
    };

    const onAccounts = (...args: unknown[]) =>
    {
        const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
        const was = untrack(address);
        const wallet = injected;

        if (accounts.length === 0)
        {
            setAddress(null);
            setStatus('idle');

            if (was !== null && wallet !== null)
            {
                void permitted(wallet).then((still) =>
                {
                    if (still === false)
                    {
                        left(was);
                    }
                });
            }

            return;
        }

        setAddress(accounts[0]);

        if (was !== null && was.toLowerCase() !== accounts[0].toLowerCase())
        {
            left(was);
        }
    };

    const onChain = (...args: unknown[]) =>
    {
        setChainId(typeof args[0] === 'string' ? args[0] : '');
    };

    const why = (step: string, reason: unknown) =>
    {
        console.warn('[wallet]', step, reason);
    };

    const heldKeys = async (): Promise<DeviceKeys | null> =>
    {
        const store = keyStore();
        if (!store.available())
        {
            return null;
        }
        try
        {
            return await store.load();
        }
        catch (error)
        {
            why('keys', error);
            return null;
        }
    };

    const newKeys = async (): Promise<DeviceKeys | null> =>
    {
        const store = keyStore();
        if (!store.available())
        {
            return null;
        }
        try
        {
            return await store.mint();
        }
        catch (error)
        {
            why('keys', error);
            return null;
        }
    };

    const release = () =>
    {
        listening?.();
        discovery?.();
        discovery = null;
        if (late !== null && typeof window !== 'undefined')
        {
            window.removeEventListener('ethereum#initialized', late);
            late = null;
        }
    };

    return {
        status,
        address,
        chainId,
        available: present,
        name: () => walletName(untrack(() => (present() ? injected : null))),
        failure,
        suspension,

        onNuraChain: () => !chainIsConfigured() || chainId().toLowerCase() === NURA_CHAIN.chainId.toLowerCase(),

        async sign(message)
        {
            const wallet = provider();
            const account = address();

            if (wallet === null || account === null)
            {
                why('sign', wallet === null ? 'no provider' : 'no connected address');
                setFailure('no-wallet');
                return null;
            }

            try
            {
                return await personalSign(wallet, account, message);
            }
            catch (error)
            {
                why('sign', error);
                setFailure(failureOf(error));
                return null;
            }
        },

        /**
         * Sends a transaction the SERVER composed, and answers with its hash.
         *
         * Null covers all three of no wallet, no address and the person saying no, which are
         * answers rather than errors - `failure()` says which. Landing is a separate question:
         * a hash is a transaction that was accepted for inclusion and nothing more.
         */
        async send(to, data, extra = {})
        {
            const wallet = provider();
            const account = address();

            if (wallet === null || account === null)
            {
                why('send', wallet === null ? 'no provider' : 'no connected address');
                setFailure('no-wallet');
                return null;
            }

            try
            {
                setFailure(null);
                return await sendTransaction(wallet, account, to, data, extra);
            }
            catch (error)
            {
                why('send', error);
                setFailure(failureOf(error));
                return null;
            }
        },

        async signTyped(typedData)
        {
            const wallet = provider();
            const account = address();

            if (wallet === null || account === null)
            {
                why('signTyped', wallet === null ? 'no provider' : 'no connected address');
                setFailure('no-wallet');
                return null;
            }

            try
            {
                setFailure(null);
                return await signTypedData(wallet, account, typedData);
            }
            catch (error)
            {
                why('signTyped', error);
                setFailure(failureOf(error));
                return null;
            }
        },

        async toChain(id)
        {
            const wallet = provider();
            const wanted = chainHex(id);

            if (wallet === null)
            {
                setFailure('no-wallet');
                return false;
            }

            const held = await readChainId(wallet).catch(() => '');

            if (held.toLowerCase() === wanted)
            {
                setChainId(held);
                return true;
            }

            const known = String(id) === NURA_CHAIN.chainId
                ? { ...NURA_CHAIN, chainId: wanted }
                : { ...NURA_CHAIN, chainId: wanted, name: `Chain ${ id }`, rpcUrls: [], explorerUrls: [] };

            if (await switchChain(wallet, known))
            {
                setChainId(wanted);
                return true;
            }

            setFailure('chain');
            return false;
        },

        /** Whether a sent transaction has landed: true, false for a revert, null for not yet. */
        async settled(hash)
        {
            const wallet = provider();
            return wallet === null ? null : transactionReceipt(wallet, hash).catch(() => null);
        },

        async connect()
        {
            const wallet = provider();
            if (wallet === null)
            {
                why('connect', 'no provider');
                setFailure('no-wallet');
                setStatus('error');
                return null;
            }

            setFailure(null);
            setSuspension(null);
            setStatus('connecting');

            let account: string;
            try
            {
                const accounts = await requestAccounts(wallet);
                if (accounts.length === 0)
                {
                    why('eth_requestAccounts', 'the wallet answered with no accounts');
                    setFailure('rejected');
                    setStatus('error');
                    return null;
                }
                account = accounts[0];
            }
            catch (error)
            {
                why('eth_requestAccounts', error);
                setFailure(failureOf(error));
                setStatus('error');
                return null;
            }

            setAddress(account);
            setChainId(await readChainId(wallet).catch(() => ''));

            if (chainIsConfigured())
            {
                if (!(await switchChain(wallet, NURA_CHAIN)))
                {
                    why('wallet_switchEthereumChain', `could not move to ${ NURA_CHAIN.name } (${ NURA_CHAIN.chainId })`);
                }
                const switched = await readChainId(wallet).catch(() => null);
                if (switched !== null)
                {
                    setChainId(switched);
                }
            }

            setStatus('signing');

            const held = await heldKeys();
            let keys = held ?? await newKeys();

            let challenge;
            try
            {
                challenge = await client.auth.challenge({ input: { address: account, ...(keys === null ? {} : { device: keys.id }) } });

                const fresh = held !== null && namesDevice(challenge.message, held.id) ? await newKeys() : null;

                if (fresh !== null)
                {
                    keys = fresh;
                    challenge = await client.auth.challenge({ input: { address: account, device: fresh.id } });
                }
            }
            catch (error)
            {
                why('auth.challenge', error);
                setFailure(serverFailure(error));
                setStatus('error');
                return null;
            }

            let signature: string;
            try
            {
                signature = await personalSign(wallet, account, challenge.message);
            }
            catch (error)
            {
                why('personal_sign', error);
                setFailure(failureOf(error));
                setStatus('error');
                return null;
            }

            try
            {
                const label = useLocale().t(useDevice().posture() === 'phone' ? 'wallet.thisPhone' : 'wallet.thisBrowser');
                const established = await client.auth.wallet({
                    input: {
                        address: account,
                        nonce: challenge.nonce,
                        signature,
                        providerRdns: rdnsOf(wallet),
                        ...(keys === null ? {} : { device: { ...keys, label } })
                    }
                });

                setStatus('connected');
                return established.account ?? null;
            }
            catch (error)
            {
                const held = suspensionOf(error);

                why('auth.wallet', error);
                setSuspension(held);
                setFailure(held !== null ? 'suspended' : error instanceof ApiError && error.status === 401 ? 'rejected' : serverFailure(error));
                setStatus('error');
                return null;
            }
        },

        async reach()
        {
            const wallet = provider();
            if (wallet === null)
            {
                why('reach', 'no provider');
                setFailure('no-wallet');
                return null;
            }

            try
            {
                const first = (await requestAccounts(wallet))[0] ?? null;
                setAddress(first);
                setFailure(first === null ? 'rejected' : null);
                return first;
            }
            catch (error)
            {
                why('eth_requestAccounts', error);
                setFailure(failureOf(error));
                return null;
            }
        },

        adopt(next)
        {
            injected = next;
            setPresent(next !== null);
            setStatus('idle');
            setAddress(null);
            setFailure(null);
            setSuspension(null);
            setChainId('');
        },

        disconnect()
        {
            setAddress(null);
            setChainId('');
            setStatus('idle');
            setFailure(null);
            setSuspension(null);
        },

        onLeft(listener)
        {
            leaving.add(listener);

            return () =>
            {
                leaving.delete(listener);
            };
        },

        /**
         * Every path out of here hands back everything it took, and the discovery listener is the one
         * that used to be missed.
         *
         * `start()` opened an `eip6963:announceProvider` listener, stored its releaser in `discovery`,
         * and then returned one of three teardowns - none of which released it. Only `stop()` did, and
         * nothing in the product calls `stop()`; the shell and the sign-in page both take the teardown
         * `start()` returns. So each mount added a listener AND overwrote the handle to the previous
         * one, putting it beyond reach. Navigating inside the app is safe - the shell is a layout route
         * and mounts once - but a sign-out and back in leaks one every time.
         */
        start()
        {
            discovery?.();
            discovery = discoverWallets(() =>
            {
                injected = detect();
                setPresent(injected !== null);
            });

            const undiscover = () =>
            {
                discovery?.();
                discovery = null;
            };

            const wallet = provider();
            if (wallet === null)
            {
                if (typeof window !== 'undefined' && late === null)
                {
                    late = () =>
                    {
                        injected = null;
                        provider();
                    };
                    window.addEventListener('ethereum#initialized', late, { once: true });
                }
                return () =>
                {
                    if (late !== null && typeof window !== 'undefined')
                    {
                        window.removeEventListener('ethereum#initialized', late);
                        late = null;
                    }
                    undiscover();
                };
            }
            if (listening !== null)
            {
                const already = listening;
                return () =>
                {
                    already();
                    undiscover();
                };
            }
            wallet.on?.('accountsChanged', onAccounts);
            wallet.on?.('chainChanged', onChain);
            void readAccounts(wallet).then((accounts) =>
            {
                if (accounts.length > 0 && untrack(address) === null)
                {
                    setAddress(accounts[0]);
                }
            }).catch(() => undefined);
            void readChainId(wallet).then((id) => setChainId(id)).catch(() => undefined);
            listening = () =>
            {
                wallet.removeListener?.('accountsChanged', onAccounts);
                wallet.removeListener?.('chainChanged', onChain);
                listening = null;
            };
            const stopListening = listening;
            return () =>
            {
                stopListening();
                undiscover();
            };
        },

        stop()
        {
            release();
        },

        reset()
        {
            release();
            injected = detect();
            setPresent(injected !== null);
            setStatus('idle');
            setAddress(null);
            setChainId('');
            setFailure(null);
            setSuspension(null);
        }
    };
});
