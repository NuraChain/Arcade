import { createServer, type IncomingMessage, type RequestOptions, type ServerResponse } from 'node:http';
import type * as Https from 'node:https';

import { decodeFunctionData, encodeFunctionResult, parseAbi, toFunctionSelector } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { allowedUrl, createNftReader, fetchPublic, holdingsFrom, isPublicIp, resolveUri, sniffNftImage, type NftTransfer } from '../src/chain/nfts.ts';
import { callOf, closeChains, fakeChain, listen, lookupGateway, offchainLookup, silentChain, type Answer } from './fake-chain.ts';

const metadataHost = vi.hoisted(() => ({ name: 'tarpit.test', port: 0 }));

vi.mock('node:https', async (importOriginal) =>
{
    const https = await importOriginal<typeof Https>();
    const http = await import('node:http');
    return {
        ...https,
        request: (url: URL, options: RequestOptions, answer: (response: IncomingMessage) => void) => url.hostname === metadataHost.name
            ? http.request({ ...options, host: '127.0.0.1', port: metadataHost.port, path: `${ url.pathname }${ url.search }` }, answer)
            : https.request(url, options, answer)
    };
});

const ME = '0x1111111111111111111111111111111111111111';
const THEM = '0x2222222222222222222222222222222222222222';
const COLLECTION = '0x3333333333333333333333333333333333333333';

const hosts: Array<ReturnType<typeof createServer>> = [];

afterEach(() =>
{
    hosts.splice(0).forEach((server) =>
    {
        server.closeAllConnections();
        server.close();
    });
});

const later = (ms: number, then: () => void) => setTimeout(then, ms);

const openMetadataHost = async (answer: (path: string, response: ServerResponse) => void) =>
{
    const asked: string[] = [];
    let released = 0;
    const server = createServer((request, response) =>
    {
        asked.push(request.url ?? '');
        response.on('close', () =>
        {
            released += 1;
        });
        answer(request.url ?? '', response);
    });
    hosts.push(server);
    metadataHost.port = Number(new URL(await listen(server)).port);
    return { asked, released: () => released };
};

const trickle = (response: ServerResponse) =>
{
    response.writeHead(200, { 'content-type': 'application/json' });
    const drip = setInterval(() => response.write(' '), 100);
    response.on('close', () => clearInterval(drip));
};

const bounce = (delay: number) => (path: string, response: ServerResponse) =>
{
    const hop = Number(/^\/hop\/(\d+)$/.exec(path)?.[1] ?? 0);
    later(delay, () =>
    {
        if (response.destroyed)
        {
            return;
        }
        if (hop < 3)
        {
            response.writeHead(302, { location: `/hop/${ hop + 1 }` });
            response.end();
            return;
        }
        response.end('{"name":"far"}');
    });
};

const move = (from: string, to: string, tokenID: string, tokenValue?: string): NftTransfer =>
    ({ from, to, contractAddress: COLLECTION, tokenID, tokenName: 'Knights', ...(tokenValue === undefined ? {} : { tokenValue }) });

describe('what a wallet holds, worked out from its transfers', () =>
{
    it('keeps an ERC-721 token that arrived and never left', () =>
    {
        const held = holdingsFrom(ME, [move(THEM, ME, '7'), move(THEM, ME, '8'), move(ME, THEM, '8')], []);

        expect(held).toEqual([{ contract: COLLECTION, tokenId: '7', standard: 'erc721', amount: '1', collection: 'Knights' }]);
    });

    it('counts a token that came back after it was sent away', () =>
    {
        expect(holdingsFrom(ME, [move(THEM, ME, '9'), move(ME, THEM, '9'), move(THEM, ME, '9')], [])).toHaveLength(1);
    });

    it('sums ERC-1155 balances in and out, and drops a balance that reached zero', () =>
    {
        const held = holdingsFrom(ME, [], [
            move(THEM, ME, '1', '5'), move(ME, THEM, '1', '2'),
            move(THEM, ME, '2', '1'), move(ME, THEM, '2', '1')
        ]);

        expect(held).toEqual([{ contract: COLLECTION, tokenId: '1', standard: 'erc1155', amount: '3', collection: 'Knights' }]);
    });

    it('ignores a row whose amount or token id is not a number', () =>
    {
        expect(holdingsFrom(ME, [move(THEM, ME, 'x')], [move(THEM, ME, '1', 'lots')])).toEqual([]);
    });
});

describe('where metadata and pictures may be fetched from', () =>
{
    it('sends ipfs and arweave through a public gateway and keeps https as it is', () =>
    {
        expect(resolveUri('ipfs://bafyhash/1.json')).toBe('https://ipfs.io/ipfs/bafyhash/1.json');
        expect(resolveUri('ipfs://ipfs/bafyhash')).toBe('https://ipfs.io/ipfs/bafyhash');
        expect(resolveUri('ar://tx-id')).toBe('https://arweave.net/tx-id');
        expect(resolveUri('https://example.com/a.png')).toBe('https://example.com/a.png');
    });

    it('refuses plain http and anything that is not a web address', () =>
    {
        expect(resolveUri('http://example.com/a.png')).toBeNull();
        expect(resolveUri('file:///etc/passwd')).toBeNull();
        expect(resolveUri('javascript:alert(1)')).toBeNull();
    });

    it('treats loopback, private, link-local and mapped addresses as off limits', () =>
    {
        for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])
        {
            expect(isPublicIp(ip), ip).toBe(false);
        }
        expect(isPublicIp('8.8.8.8')).toBe(true);
        expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
    });

    it('never connects to a private address written into the url itself', () =>
    {
        expect(allowedUrl('https://127.0.0.1/secret')).toBeNull();
        expect(allowedUrl('https://2130706433/secret')).toBeNull();
        expect(allowedUrl('https://[::1]/secret')).toBeNull();
        expect(allowedUrl('https://169.254.169.254/latest/meta-data')).toBeNull();
        expect(allowedUrl('http://example.com/')).toBeNull();
        expect(allowedUrl('https://example.com/a.png')?.hostname).toBe('example.com');
        expect(allowedUrl('https://8.8.8.8/a.png')?.hostname).toBe('8.8.8.8');
    });

    it('reads a data url in place, and refuses one over the size it was given', async () =>
    {
        expect((await fetchPublic('data:application/json,%7B%22name%22%3A%22A%22%7D', 1024))?.toString()).toBe('{"name":"A"}');
        expect(await fetchPublic(`data:text/plain;base64,${ Buffer.alloc(64).toString('base64') }`, 16)).toBeNull();
    });
});

describe('how long a metadata host may keep this server waiting', () =>
{
    it('follows a host\'s redirects to the answer when they come in time', async () =>
    {
        const host = await openMetadataHost(bounce(20));

        expect((await fetchPublic(`https://${ metadataHost.name }/hop/0`, 1024))?.toString()).toBe('{"name":"far"}');
        expect(host.asked).toEqual(['/hop/0', '/hop/1', '/hop/2', '/hop/3']);
    });

    it('gives up eight seconds after asking a host that trickles bytes to keep the socket alive, and lets the socket go', async () =>
    {
        const host = await openMetadataHost((_path, response) => trickle(response));
        const started = performance.now();

        await expect(fetchPublic(`https://${ metadataHost.name }/meta.json`, 256 * 1024)).resolves.toBeNull();
        expect(performance.now() - started).toBeGreaterThan(7_500);
        expect(performance.now() - started).toBeLessThan(9_000);
        await vi.waitFor(() => expect(host.released()).toBe(1));
    }, 12_000);

    it('holds every redirect to the one deadline, so a host cannot buy time by bouncing', async () =>
    {
        const host = await openMetadataHost(bounce(400));
        const started = performance.now();

        await expect(fetchPublic(`https://${ metadataHost.name }/hop/0`, 1024, AbortSignal.timeout(1_000))).resolves.toBeNull();
        expect(performance.now() - started).toBeLessThan(1_500);
        expect(host.asked).toEqual(['/hop/0', '/hop/1', '/hop/2']);
        await vi.waitFor(() => expect(host.released()).toBe(3));
    });
});

describe('what counts as a picture', () =>
{
    it('knows PNG, JPEG, WebP and GIF by their bytes, and nothing else', () =>
    {
        const pad = (...values: number[]): Uint8Array => new Uint8Array([...values, ...new Array(16).fill(0)]);

        expect(sniffNftImage(pad(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
        expect(sniffNftImage(pad(0xff, 0xd8, 0xff))).toBe('image/jpeg');
        expect(sniffNftImage(pad(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
        expect(sniffNftImage(pad(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
        expect(sniffNftImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    });
});

describe('naming a token through a chain that may not answer', () =>
{
    const TOKEN_URI = parseAbi(['function tokenURI(uint256 tokenId) view returns (string)']);
    const KNIGHT = { contract: COLLECTION, tokenId: '7', standard: 'erc721' as const };
    const METADATA = `data:application/json,${ encodeURIComponent(JSON.stringify({ name: 'Knight #7', image: 'ipfs://bafyknight/7.png' })) }`;
    const NAMED = { name: 'Knight #7', image: 'https://ipfs.io/ipfs/bafyknight/7.png' };
    const NAMELESS = { name: '', image: '' };
    const REFUSED: Answer = { error: { code: -32000, message: 'execution reverted' } };

    afterEach(closeChains);

    const tokenUri = (uri: string): Answer => ({ result: encodeFunctionResult({ abi: TOKEN_URI, functionName: 'tokenURI', result: uri }) });

    const readerOf = (rpcUrl: string) => createNftReader({ rpcUrl, explorerApi: 'http://127.0.0.1:1/api' });

    it('names a token from the metadata its contract points at', async () =>
    {
        const fake = await fakeChain((rpc) =>
        {
            const { to, data } = callOf(rpc);
            const { args } = decodeFunctionData({ abi: TOKEN_URI, data });
            return to?.toLowerCase() === COLLECTION && args[0] === 7n ? tokenUri(METADATA) : REFUSED;
        });

        await expect(readerOf(fake.url).meta(KNIGHT)).resolves.toEqual(NAMED);
    });

    it('gives up on a chain that takes the connection and never answers, well inside the browser\'s patience', async () =>
    {
        const reader = readerOf(await silentChain());
        const started = performance.now();

        await expect(reader.meta(KNIGHT)).resolves.toEqual(NAMELESS);
        expect(performance.now() - started).toBeLessThan(6_000);
    }, 12_000);

    it('gives up on a chain that sends the headers and then stalls the body, within the same patience', async () =>
    {
        const fake = await fakeChain(() => 'stall');
        const started = performance.now();

        await expect(readerOf(fake.url).meta(KNIGHT)).resolves.toEqual(NAMELESS);
        expect(performance.now() - started).toBeLessThan(6_000);
    }, 12_000);

    it('never follows an offchain lookup a token contract answers with', async () =>
    {
        const gateway = await lookupGateway();
        const selector = toFunctionSelector('tokenURI(uint256)');
        const fake = await fakeChain((rpc) => callOf(rpc).data.startsWith(selector) ? offchainLookup(COLLECTION, gateway.url) : { result: '0x' });

        await expect(readerOf(fake.url).meta(KNIGHT)).resolves.toEqual(NAMELESS);
        expect(gateway.hits()).toBe(0);
        expect(fake.asked).toEqual(['eth_call']);
    });

    it('asks again after a read it could not make, rather than remembering the token as nameless', async () =>
    {
        let calls = 0;
        const fake = await fakeChain(() =>
        {
            calls += 1;
            return calls === 1 ? { status: 502 } : tokenUri(METADATA);
        });
        const reader = readerOf(fake.url);

        await expect(reader.meta(KNIGHT)).resolves.toEqual(NAMELESS);
        await expect(reader.meta(KNIGHT)).resolves.toEqual(NAMED);
        expect(fake.asked).toEqual(['eth_call', 'eth_call']);
    });

    it('remembers what a contract really answered, and does not ask it again', async () =>
    {
        const fake = await fakeChain(() => REFUSED);
        const reader = readerOf(fake.url);

        await expect(reader.meta(KNIGHT)).resolves.toEqual(NAMELESS);
        await expect(reader.meta(KNIGHT)).resolves.toEqual(NAMELESS);
        expect(fake.asked).toEqual(['eth_call']);
    });

    it('shares one read between views that ask about the same token at once', async () =>
    {
        const host = await openMetadataHost((_path, response) => later(200, () => response.end(JSON.stringify({ name: 'Knight #7', image: 'ipfs://bafyknight/7.png' }))));
        const fake = await fakeChain(() => tokenUri(`https://${ metadataHost.name }/7.json`));
        const reader = readerOf(fake.url);

        await expect(Promise.all(Array.from({ length: 5 }, () => reader.meta(KNIGHT)))).resolves.toEqual(Array.from({ length: 5 }, () => NAMED));
        expect(fake.asked).toEqual(['eth_call']);
        expect(host.asked).toEqual(['/7.json']);
    });
});
