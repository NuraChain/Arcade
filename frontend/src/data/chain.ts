export interface ChainConfig
{
    chainId: string;
    name: string;
    currency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    explorerUrls: string[];
    site: string;
}

export const NURA_CHAIN: ChainConfig = {
    chainId: '1020',
    name: 'NuraChain',
    currency: { name: 'Nura', symbol: 'NURA', decimals: 18 },
    rpcUrls: ['https://rpc.nurachain.net'],
    explorerUrls: ['https://explorer.nurachain.net'],
    site: 'https://nurachain.net'
};

export function chainIsConfigured(chain: ChainConfig = NURA_CHAIN)
{
    return /^0x[0-9a-fA-F]+$/.test(chain.chainId) && chain.rpcUrls.length > 0;
}
