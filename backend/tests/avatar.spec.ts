import { describe, expect, it } from 'vitest';

import { avatarFile, avatarHashOf, avatarUrl, sniffAvatar } from '../src/domains/identity/avatar.ts';

const ORIGIN = 'http://localhost:3100';
const HASH = 'ab'.repeat(32);

const bytes = (...values: number[]): Uint8Array => new Uint8Array([...values, ...new Array(16).fill(0)]);

describe('what a picture is, read from its bytes rather than its name', () =>
{
    it('knows a PNG, a JPEG and a WebP by their signatures', () =>
    {
        expect(sniffAvatar(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
        expect(sniffAvatar(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
        expect(sniffAvatar(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    });

    it('refuses anything else, an SVG and a RIFF that is not a WebP included', () =>
    {
        expect(sniffAvatar(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
        expect(sniffAvatar(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
        expect(sniffAvatar(new Uint8Array())).toBeNull();
    });
});

describe('the link a picture is published under', () =>
{
    it('names the hash and the type, under this origin', () =>
    {
        expect(avatarUrl(ORIGIN, HASH, 'image/webp')).toBe(`${ ORIGIN }/avatars/${ HASH }.webp`);
        expect(avatarUrl(ORIGIN, HASH, 'image/jpeg')).toBe(`${ ORIGIN }/avatars/${ HASH }.jpg`);
    });

    it('reads the hash back out of a file name, and nothing out of anything else', () =>
    {
        expect(avatarFile(`${ HASH }.png`)).toBe(HASH);
        expect(avatarFile(`${ HASH }.svg`)).toBeNull();
        expect(avatarFile(`${ HASH.toUpperCase() }.png`)).toBeNull();
        expect(avatarFile(`../${ HASH }.png`)).toBeNull();
    });

    it('accepts only a picture uploaded here, never somebody else\'s link', () =>
    {
        expect(avatarHashOf(ORIGIN, `${ ORIGIN }/avatars/${ HASH }.webp`)).toBe(HASH);
        expect(avatarHashOf(ORIGIN, `https://elsewhere.example/avatars/${ HASH }.webp`)).toBeNull();
        expect(avatarHashOf(ORIGIN, `ipfs://bafy${ HASH }`)).toBeNull();
        expect(avatarHashOf(ORIGIN, `${ ORIGIN }/avatars/${ HASH }.webp?x=1`)).toBeNull();
    });
});
