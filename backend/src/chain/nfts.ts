import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { createPublicClient, http, isAddress, parseAbi, type Address, type PublicClient } from 'viem';

export type NftStandard = 'erc721' | 'erc1155';

export type NftImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface NftTransfer
{
    from: string;
    to: string;
    contractAddress: string;
    tokenID: string;
    tokenName: string;
    tokenValue?: string;
}

export interface NftHolding
{
    contract: string;
    tokenId: string;
    standard: NftStandard;
    amount: string;
    collection: string;
}

export interface NftMeta
{
    name: string;
    image: string;
}

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const ARWEAVE_GATEWAY = 'https://arweave.net/';
const EXPLORER_PAGE = 10_000;
const EXPLORER_PAGES = 5;
const HOLDINGS_TTL_MS = 60_000;
const META_TTL_MS = 60 * 60_000;
const META_MAX = 2_000;
const META_BYTES = 256 * 1024;
const IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const REDIRECTS = 3;
const TOKEN_ID = /^\d{1,78}$/;

const ABI = parseAbi([
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function uri(uint256 id) view returns (string)'
]);

const PRIVATE = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const)
{
    PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const)
{
    PRIVATE.addSubnet(network, prefix, 'ipv6');
}

export function isPublicIp(ip: string): boolean
{
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped !== null)
    {
        return isPublicIp(mapped[1]);
    }
    const family = isIP(ip);
    if (family === 0)
    {
        return false;
    }
    return !PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export function holdingsFrom(address: string, erc721: readonly NftTransfer[], erc1155: readonly NftTransfer[])
{
    const me = address.toLowerCase();
    const owned = new Map<string, NftHolding>();

    for (const t of erc721)
    {
        const contract = t.contractAddress.toLowerCase();
        const key = `721:${ contract }:${ t.tokenID }`;
        if (t.to.toLowerCase() === me)
        {
            owned.set(key, { contract, tokenId: t.tokenID, standard: 'erc721', amount: '1', collection: t.tokenName });
        }
        else if (t.from.toLowerCase() === me)
        {
            owned.delete(key);
        }
    }

    const balances = new Map<string, { holding: NftHolding; amount: bigint }>();
    for (const t of erc1155)
    {
        if (!/^\d+$/.test(t.tokenValue ?? ''))
        {
            continue;
        }
        const contract = t.contractAddress.toLowerCase();
        const key = `1155:${ contract }:${ t.tokenID }`;
        const entry = balances.get(key)
            ?? { holding: { contract, tokenId: t.tokenID, standard: 'erc1155' as const, amount: '0', collection: t.tokenName }, amount: 0n };
        const value = BigInt(t.tokenValue!);
        if (t.to.toLowerCase() === me)
        {
            entry.amount += value;
        }
        if (t.from.toLowerCase() === me)
        {
            entry.amount -= value;
        }
        balances.set(key, entry);
    }
    for (const [key, entry] of balances)
    {
        if (entry.amount > 0n)
        {
            owned.set(key, { ...entry.holding, amount: entry.amount.toString() });
        }
    }

    return [...owned.values()].filter((one) => isAddress(one.contract) && TOKEN_ID.test(one.tokenId));
}

export function resolveUri(uri: string): string | null
{
    const value = uri.trim();
    if (value.startsWith('data:'))
    {
        return value;
    }
    const ipfs = /^ipfs:\/\/(?:ipfs\/)?(.+)$/i.exec(value);
    if (ipfs !== null)
    {
        return `${ IPFS_GATEWAY }${ ipfs[1] }`;
    }
    const arweave = /^ar:\/\/(.+)$/i.exec(value);
    if (arweave !== null)
    {
        return `${ ARWEAVE_GATEWAY }${ arweave[1] }`;
    }
    try
    {
        return new URL(value).protocol === 'https:' ? value : null;
    }
    catch
    {
        return null;
    }
}

export function sniffNftImage(bytes: Uint8Array): NftImageType | null
{
    const opens = (at: number, expected: readonly number[]) => expected.every((v, i) => bytes[at + i] === v);
    if (opens(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    {
        return 'image/png';
    }
    if (opens(0, [0xff, 0xd8, 0xff]))
    {
        return 'image/jpeg';
    }
    if (opens(0, [0x52, 0x49, 0x46, 0x46]) && opens(8, [0x57, 0x45, 0x42, 0x50]))
    {
        return 'image/webp';
    }
    if (opens(0, [0x47, 0x49, 0x46, 0x38]))
    {
        return 'image/gif';
    }
    return null;
}

const publicLookup: LookupFunction = (hostname, options, callback) =>
{
    dnsLookup(hostname, { all: true }, (error, addresses: LookupAddress[]) =>
    {
        if (error !== null)
        {
            callback(error, '', 0);
            return;
        }
        if (addresses.length === 0 || addresses.some((one) => !isPublicIp(one.address)))
        {
            callback(Object.assign(new Error('refused: not a public address'), { code: 'EREFUSED' }), '', 0);
            return;
        }
        if ((options as { all?: boolean }).all === true)
        {
            (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, addresses);
            return;
        }
        callback(null, addresses[0].address, addresses[0].family);
    });
};

const decodeData = (uri: string, maxBytes: number): Buffer | null =>
{
    const comma = uri.indexOf(',');
    if (comma < 0)
    {
        return null;
    }
    const head = uri.slice(5, comma);
    const body = uri.slice(comma + 1);
    const bytes = head.endsWith(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
    return bytes.length <= maxBytes ? bytes : null;
};

export function allowedUrl(uri: string): URL | null
{
    try
    {
        const url = new URL(uri);
        const literal = url.hostname.replace(/^\[|\]$/g, '');
        return url.protocol === 'https:' && (isIP(literal) === 0 || isPublicIp(literal)) ? url : null;
    }
    catch
    {
        return null;
    }
}

export function fetchPublic(uri: string, maxBytes: number, hops = REDIRECTS): Promise<Buffer | null>
{
    if (uri.startsWith('data:'))
    {
        return Promise.resolve(decodeData(uri, maxBytes));
    }

    const url = allowedUrl(uri);
    if (url === null)
    {
        return Promise.resolve(null);
    }

    return new Promise((resolve) =>
    {
        const req = request(url, { lookup: publicLookup, timeout: FETCH_TIMEOUT_MS, headers: { accept: '*/*' } }, (res) =>
        {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location !== undefined && hops > 0)
            {
                res.resume();
                const next = resolveUri(new URL(res.headers.location, url).toString());
                resolve(next === null || next.startsWith('data:') ? null : fetchPublic(next, maxBytes, hops - 1));
                return;
            }
            if (status !== 200)
            {
                res.resume();
                resolve(null);
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) =>
            {
                size += chunk.length;
                if (size > maxBytes)
                {
                    req.destroy();
                    resolve(null);
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', () => resolve(null));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
        req.end();
    });
}

export interface NftSettings
{
    rpcUrl: string;
    explorerApi: string;
}

export interface NftReader
{
    readonly configured: boolean;
    holdings(address: string): Promise<NftHolding[]>;
    meta(holding: Pick<NftHolding, 'contract' | 'tokenId' | 'standard'>): Promise<NftMeta>;
    image(holding: NftHolding): Promise<{ type: NftImageType; bytes: Uint8Array } | null>;
}

export function createNftReader(settings: NftSettings): NftReader
{
    const configured = settings.rpcUrl !== '' && settings.explorerApi !== '';
    let client: PublicClient | null = null;
    const reader = () =>
    {
        client ??= createPublicClient({ transport: http(settings.rpcUrl, { timeout: FETCH_TIMEOUT_MS }) });
        return client;
    };

    const held = new Map<string, { at: number; value: NftHolding[] }>();
    const metas = new Map<string, { at: number; value: NftMeta }>();

    const transfers = async (action: string, address: string) =>
    {
        const all: NftTransfer[] = [];
        for (let page = 1; page <= EXPLORER_PAGES; page++)
        {
            const url = new URL(settings.explorerApi);
            for (const [key, value] of Object.entries({ module: 'account', action, address, page: String(page), offset: String(EXPLORER_PAGE), sort: 'asc' }))
            {
                url.searchParams.set(key, value);
            }
            const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!response.ok)
            {
                throw new Error(`the explorer answered ${ response.status }`);
            }
            const body = await response.json() as { status?: string; message?: string; result?: unknown };
            if (!Array.isArray(body.result))
            {
                throw new Error(`the explorer refused: ${ String(body.message ?? 'no result') }`);
            }
            all.push(...body.result as NftTransfer[]);
            if (body.result.length < EXPLORER_PAGE)
            {
                break;
            }
        }
        return all;
    };

    const uriOf = async (contract: string, tokenId: string, standard: NftStandard) =>
    {
        const id = BigInt(tokenId);
        const raw = await reader().readContract({
            address: contract as Address,
            abi: ABI,
            functionName: standard === 'erc721' ? 'tokenURI' : 'uri',
            args: [id]
        });
        return standard === 'erc1155' ? raw.replace('{id}', id.toString(16).padStart(64, '0')) : raw;
    };

    const remember = (key: string, value: NftMeta) =>
    {
        if (metas.size >= META_MAX)
        {
            metas.delete(metas.keys().next().value!);
        }
        metas.set(key, { at: Date.now(), value });
        return value;
    };

    const meta: NftReader['meta'] = async ({ contract, tokenId, standard }) =>
    {
        const key = `${ standard }:${ contract }:${ tokenId }`;
        const cached = metas.get(key);
        if (cached !== undefined && Date.now() - cached.at < META_TTL_MS)
        {
            return cached.value;
        }
        try
        {
            const location = resolveUri(await uriOf(contract, tokenId, standard));
            const body = location === null ? null : await fetchPublic(location, META_BYTES);
            const parsed = body === null ? null : JSON.parse(body.toString('utf8')) as { name?: unknown; image?: unknown; image_url?: unknown };
            const image = typeof parsed?.image === 'string' ? parsed.image : typeof parsed?.image_url === 'string' ? parsed.image_url : '';
            return remember(key, {
                name: typeof parsed?.name === 'string' ? parsed.name.slice(0, 120) : '',
                image: resolveUri(image) ?? ''
            });
        }
        catch
        {
            return remember(key, { name: '', image: '' });
        }
    };

    return {
        configured,

        async holdings(address)
        {
            if (!configured || !isAddress(address))
            {
                return [];
            }
            const key = address.toLowerCase();
            const cached = held.get(key);
            if (cached !== undefined && Date.now() - cached.at < HOLDINGS_TTL_MS)
            {
                return cached.value;
            }
            const [erc721, erc1155] = await Promise.all([transfers('tokennfttx', key), transfers('token1155tx', key)]);
            const value = holdingsFrom(key, erc721, erc1155);
            held.set(key, { at: Date.now(), value });
            return value;
        },

        meta,

        async image(holding)
        {
            if (!configured)
            {
                return null;
            }
            const source = (await meta(holding)).image;
            if (source === '')
            {
                return null;
            }
            const bytes = await fetchPublic(source, IMAGE_BYTES);
            const type = bytes === null ? null : sniffNftImage(bytes);
            return bytes === null || type === null ? null : { type, bytes: new Uint8Array(bytes) };
        }
    };
}
