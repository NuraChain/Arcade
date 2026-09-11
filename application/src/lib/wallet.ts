import type { ChainConfig } from '../data/chain.ts';

export interface Eip1193Provider
{
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on?(event: string, listener: (...args: unknown[]) => void): void;
    removeListener?(event: string, listener: (...args: unknown[]) => void): void;
    isMetaMask?: boolean;
    isRabby?: boolean;
    isCoinbaseWallet?: boolean;
    isBraveWallet?: boolean;
    providers?: Eip1193Provider[];
}

export type WalletFailure = 'no-wallet' | 'rejected' | 'pending' | 'chain' | 'unknown';

export interface ProviderError
{
    code?: number;
    message?: string;
}

const REJECTED = 4001;
const UNRECOGNISED_CHAIN = 4902;
const ALREADY_PENDING = -32002;

export function detect(): Eip1193Provider | null
{
    if (typeof window === 'undefined')
    {
        return null;
    }
    const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (injected === undefined)
    {
        return null;
    }
    if (Array.isArray(injected.providers) && injected.providers.length > 0)
    {
        return injected.providers.find((provider) => provider.isMetaMask === true) ?? injected.providers[0];
    }
    return injected;
}

export function walletName(provider: Eip1193Provider | null): string
{
    if (provider === null)
    {
        return 'MetaMask';
    }
    if (provider.isRabby === true)
    {
        return 'Rabby';
    }
    if (provider.isCoinbaseWallet === true)
    {
        return 'Coinbase Wallet';
    }
    if (provider.isBraveWallet === true)
    {
        return 'Brave Wallet';
    }
    return provider.isMetaMask === true ? 'MetaMask' : 'Browser wallet';
}

export function failureOf(error: unknown): WalletFailure
{
    const code = (error as ProviderError | null)?.code;
    if (code === REJECTED)
    {
        return 'rejected';
    }
    if (code === ALREADY_PENDING)
    {
        return 'pending';
    }
    if (code === UNRECOGNISED_CHAIN)
    {
        return 'chain';
    }
    return 'unknown';
}

export function isAddress(value: string): boolean
{
    return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function shortAddress(address: string, lead = 6, tail = 4): string
{
    if (!isAddress(address))
    {
        return address;
    }
    return `${ address.slice(0, lead) }…${ address.slice(-tail) }`;
}

export function addressHue(address: string): number
{
    let hash = 0;
    for (let index = 2; index < address.length; index += 1)
    {
        hash = (hash * 31 + address.charCodeAt(index)) % 360;
    }
    return hash;
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]>
{
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    return Array.isArray(accounts) ? accounts.filter((entry): entry is string => typeof entry === 'string') : [];
}

export async function readAccounts(provider: Eip1193Provider): Promise<string[]>
{
    const accounts = await provider.request({ method: 'eth_accounts' });
    return Array.isArray(accounts) ? accounts.filter((entry): entry is string => typeof entry === 'string') : [];
}

export async function readChainId(provider: Eip1193Provider): Promise<string>
{
    const chainId = await provider.request({ method: 'eth_chainId' });
    return typeof chainId === 'string' ? chainId : '';
}

export async function personalSign(provider: Eip1193Provider, address: string, message: string): Promise<string>
{
    const signature = await provider.request({ method: 'personal_sign', params: [message, address] });
    return typeof signature === 'string' ? signature : '';
}

export async function switchChain(provider: Eip1193Provider, chain: ChainConfig): Promise<boolean>
{
    try
    {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.chainId }] });
        return true;
    }
    catch (error)
    {
        if (failureOf(error) !== 'chain')
        {
            return false;
        }
    }

    try
    {
        await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
                chainId: chain.chainId,
                chainName: chain.name,
                nativeCurrency: chain.currency,
                rpcUrls: chain.rpcUrls,
                blockExplorerUrls: chain.explorerUrls.length > 0 ? chain.explorerUrls : undefined
            }]
        });
        return true;
    }
    catch
    {
        return false;
    }
}
