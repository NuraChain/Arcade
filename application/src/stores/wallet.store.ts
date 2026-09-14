import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { NURA_CHAIN, chainIsConfigured } from '../data/chain.ts';
import {
    detect,
    discoverWallets,
    failureOf,
    personalSign,
    rdnsOf,
    readAccounts,
    readChainId,
    requestAccounts,
    switchChain,
    walletName,
    type Eip1193Provider,
    type WalletFailure
} from '../lib/wallet.ts';
import { client, ApiError, type Account } from '../api.ts';

export type WalletStatus = 'idle' | 'connecting' | 'signing' | 'connected' | 'error';

export interface WalletApi
{
    status: Getter<WalletStatus>;
    address: Getter<string | null>;
    chainId: Getter<string>;
    available: Getter<boolean>;
    name: Getter<string>;
    failure: Getter<WalletFailure | null>;
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
    adopt(provider: Eip1193Provider | null): void;
    disconnect(): void;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const useWallet = createStore((): WalletApi =>
{
    const [status, setStatus] = createSignal<WalletStatus>('idle');
    const [address, setAddress] = createSignal<string | null>(null);
    const [chainId, setChainId] = createSignal('');
    const [failure, setFailure] = createSignal<WalletFailure | null>(null);
    const [present, setPresent] = createSignal(detect() !== null);

    let injected: Eip1193Provider | null = detect();
    let listening: (() => void) | null = null;
    let late: (() => void) | null = null;
    let discovery: (() => void) | null = null;

    const provider = (): Eip1193Provider | null =>
    {
        if (injected === null)
        {
            injected = detect();
            setPresent(injected !== null);
        }
        return injected;
    };

    const onAccounts = (...args: unknown[]): void =>
    {
        const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
        if (accounts.length === 0)
        {
            setAddress(null);
            setStatus('idle');
            return;
        }
        setAddress(accounts[0]);
    };

    const onChain = (...args: unknown[]): void =>
    {
        setChainId(typeof args[0] === 'string' ? args[0] : '');
    };

    return {
        status,
        address,
        chainId,
        available: present,
        name: () => walletName(untrack(() => (present() ? injected : null))),
        failure,

        onNuraChain: () => !chainIsConfigured() || chainId().toLowerCase() === NURA_CHAIN.chainId.toLowerCase(),

        async sign(message)
        {
            const wallet = provider();
            const account = address();

            if (wallet === null || account === null)
            {
                setFailure('no-wallet');
                return null;
            }

            try
            {
                return await personalSign(wallet, account, message);
            }
            catch (error)
            {
                setFailure(failureOf(error));
                return null;
            }
        },

        async connect()
        {
            const wallet = provider();
            if (wallet === null)
            {
                setFailure('no-wallet');
                setStatus('error');
                return null;
            }

            setFailure(null);
            setStatus('connecting');

            let account: string;
            try
            {
                const accounts = await requestAccounts(wallet);
                if (accounts.length === 0)
                {
                    setFailure('rejected');
                    setStatus('error');
                    return null;
                }
                account = accounts[0];
            }
            catch (error)
            {
                setFailure(failureOf(error));
                setStatus('error');
                return null;
            }

            setAddress(account);
            setChainId(await readChainId(wallet).catch(() => ''));

            if (chainIsConfigured())
            {
                await switchChain(wallet, NURA_CHAIN);
                const switched = await readChainId(wallet).catch(() => null);
                if (switched !== null)
                {
                    setChainId(switched);
                }
            }

            setStatus('signing');

            let challenge;
            try
            {
                challenge = await client.auth.challenge({ input: { address: account } });
            }
            catch
            {
                setFailure('unavailable');
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
                setFailure(failureOf(error));
                setStatus('error');
                return null;
            }

            try
            {
                const established = await client.auth.wallet({
                    input: {
                        address: account,
                        nonce: challenge.nonce,
                        signature,
                        providerRdns: rdnsOf(wallet)
                    }
                });

                setStatus('connected');
                return established.account ?? null;
            }
            catch (error)
            {
                setFailure(error instanceof ApiError && error.status === 401 ? 'rejected' : 'unavailable');
                setStatus('error');
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
            setChainId('');
        },

        disconnect()
        {
            setAddress(null);
            setChainId('');
            setStatus('idle');
            setFailure(null);
        },

        start()
        {
            const stopDiscovery = discoverWallets(() =>
            {
                injected = detect();
                setPresent(injected !== null);
            });
            discovery = stopDiscovery;

            const wallet = provider();
            if (wallet === null)
            {
                if (typeof window !== 'undefined' && late === null)
                {
                    late = (): void =>
                    {
                        injected = null;
                        provider();
                    };
                    window.addEventListener('ethereum#initialized', late, { once: true });
                }
                return (): void =>
                {
                    if (late !== null && typeof window !== 'undefined')
                    {
                        window.removeEventListener('ethereum#initialized', late);
                        late = null;
                    }
                };
            }
            if (listening !== null)
            {
                return listening;
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
            listening = (): void =>
            {
                wallet.removeListener?.('accountsChanged', onAccounts);
                wallet.removeListener?.('chainChanged', onChain);
                listening = null;
            };
            return listening;
        },

        stop()
        {
            listening?.();
            discovery?.();
            discovery = null;
        },

        reset()
        {
            listening?.();
            injected = detect();
            setPresent(injected !== null);
            setStatus('idle');
            setAddress(null);
            setChainId('');
            setFailure(null);
        }
    };
});
