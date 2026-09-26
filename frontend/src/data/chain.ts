export interface ChainConfig
{
    chainId: string;
    name: string;
    currency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    explorerUrls: string[];
    site: string;
}

function fromEnv(key: string, fallback: string): string
{
    const value = (import.meta.env as Record<string, string | undefined>)[key];
    return value === undefined || value === '' ? fallback : value;
}

export const NURA_CHAIN: ChainConfig = {
    chainId: fromEnv('VITE_NURA_CHAIN_ID', ''),
    name: fromEnv('VITE_NURA_CHAIN_NAME', 'NuraChain'),
    currency: {
        name: fromEnv('VITE_NURA_CURRENCY_NAME', 'Nura'),
        symbol: fromEnv('VITE_NURA_CURRENCY_SYMBOL', 'NURA'),
        decimals: 18
    },
    rpcUrls: fromEnv('VITE_NURA_RPC_URL', '').split(',').filter(Boolean),
    explorerUrls: fromEnv('VITE_NURA_EXPLORER_URL', '').split(',').filter(Boolean),
    site: fromEnv('VITE_NURA_SITE', 'https://nurachain.net')
};

export function chainIsConfigured(chain: ChainConfig = NURA_CHAIN): boolean
{
    return /^0x[0-9a-fA-F]+$/.test(chain.chainId) && chain.rpcUrls.length > 0;
}
