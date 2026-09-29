import { describe, expect, it } from 'vitest';

import { allowedUrl, fetchPublic, holdingsFrom, isPublicIp, resolveUri, sniffNftImage, type NftTransfer } from '../src/chain/nfts.ts';

const ME = '0x1111111111111111111111111111111111111111';
const THEM = '0x2222222222222222222222222222222222222222';
const COLLECTION = '0x3333333333333333333333333333333333333333';

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
