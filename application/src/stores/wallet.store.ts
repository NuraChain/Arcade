import { createStore, createSignal, untrack, type Getter } from 'azerothjs';

import { NURA_CHAIN, chainHost, chainIsConfigured } from '../data/chain.ts';
import { runtime } from '../lib/runtime.ts';
import {
    detect,
    failureOf,
    personalSign,
    readAccounts,
    readChainId,
    requestAccounts,
    switchChain,
    walletName,
    type Eip1193Provider,
    type WalletFailure
} from '../lib/wallet.ts';
import { buildSignInMessage, nonceFor } from '../services/wallet.service.ts';

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
    connect(): Promise<string | null>;
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
                setChainId(await readChainId(wallet).catch(() => chainId()));
            }

            setStatus('signing');
            const now = runtime().clock.now();
            const message = buildSignInMessage({
                domain: chainHost(),
                address: account,
                chainId: chainId() === '' ? NURA_CHAIN.name : chainId(),
                nonce: nonceFor(runtime().seed, account, now),
                issuedAt: now,
                statement: 'Sign in to Nura Games. This proves the seat is yours. It costs nothing and moves nothing.',
                uri: typeof window === 'undefined' ? NURA_CHAIN.site : window.location.origin
            });

            try
            {
                await personalSign(wallet, account, message);
            }
            catch (error)
            {
                setFailure(failureOf(error));
                setStatus('error');
                return null;
            }

            setStatus('connected');
            return account;
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
