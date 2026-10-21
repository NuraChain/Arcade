import 'reflect-metadata';

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { concat, keccak256, type Hex } from 'viem';

import { OPENING, bytesOf, drawOf, drawsOf, hexOf, seedOf } from '../src/domains/match/fair.ts';
import { ENGINES } from '../src/domains/match/service.ts';
import { hmacSha256, keccak } from '../src/lib/crypto.ts';

const SECRETS = [`0x${ '11'.repeat(32) }`, `0x${ '22'.repeat(32) }`];

const SIGNATURES = [`0x${ 'aa'.repeat(65) }`, `0x${ 'bb'.repeat(65) }`];

const seed = seedOf(keccak, SECRETS, SIGNATURES);

const word = (key: Uint8Array, label: string) => createHmac('sha256', key).update(label).digest().readUInt32BE(0);

const oracle = (key: Uint8Array, rev: number, index: number, sides: number) =>
{
    const ceiling = 2 ** 32 - (2 ** 32 % sides);

    for (let round = 0; ; round += 1)
    {
        const value = word(key, `${ rev }.${ index }.${ round }`);

        if (value < ceiling)
        {
            return (value % sides) + 1;
        }
    }
};

describe('the seed of a game played for NURA', () =>
{
    it('is the keccak of every secret and then every signature, in seat order', () =>
    {
        expect(hexOf(seed)).toBe(keccak256(concat([...SECRETS, ...SIGNATURES] as Hex[])));
    });

    it('changes with any one of them, and with their order', () =>
    {
        const others = [
            seedOf(keccak, [SECRETS[1], SECRETS[0]], SIGNATURES),
            seedOf(keccak, SECRETS, [SIGNATURES[1], SIGNATURES[0]]),
            seedOf(keccak, [`0x${ '12'.repeat(32) }`, SECRETS[1]], SIGNATURES),
            seedOf(keccak, SECRETS, [SIGNATURES[0], `0x${ 'bc'.repeat(65) }`])
        ].map(hexOf);

        expect(new Set([hexOf(seed), ...others]).size).toBe(5);
    });

    it('reads hex with or without its prefix and gives it back with one', () =>
    {
        expect(hexOf(bytesOf('0x00ff10'))).toBe('0x00ff10');
        expect(hexOf(bytesOf('00FF10'))).toBe('0x00ff10');
    });
});

describe('a draw from the seed', () =>
{
    it('is HMAC-SHA256 of the seed over "revision.draw.round", read as a 32-bit number', () =>
    {
        for (const sides of [2, 6, 13, 36, 52])
        {
            for (let index = 0; index < 40; index += 1)
            {
                expect(drawOf(hmacSha256, seed, 7, index, sides)).toBe(oracle(seed, 7, index, sides));
            }
        }
    });

    it('counts its draws within one action, and starts again at the next', () =>
    {
        const first = drawsOf(hmacSha256, seed, 3);
        const again = drawsOf(hmacSha256, seed, 3);
        const next = drawsOf(hmacSha256, seed, 4);
        const faces = Array.from({ length: 20 }, () => first.die(6));

        expect(Array.from({ length: 20 }, () => again.die(6))).toEqual(faces);
        expect(Array.from({ length: 20 }, () => next.die(6))).not.toEqual(faces);
        expect(faces).toEqual(faces.map((_, index) => oracle(seed, 3, index, 6)));
    });

    it('draws again rather than read a number that would favour the low faces', () =>
    {
        const asked: string[] = [];
        const topped = (key: Uint8Array, message: Uint8Array) =>
        {
            asked.push(new TextDecoder().decode(message));

            return asked.length === 1 ? new Uint8Array(32).fill(0xff) : hmacSha256(key, message);
        };

        expect(drawOf(topped, seed, 1, 0, 6)).toBe((word(seed, '1.0.1') % 6) + 1);
        expect(asked).toEqual(['1.0.0', '1.0.1']);
    });

    it('answers one for a die of one side or none, as the server\'s own die does', () =>
    {
        expect(drawOf(hmacSha256, seed, 1, 0, 1)).toBe(1);
        expect(drawOf(hmacSha256, seed, 1, 0, 0)).toBe(1);
    });

    it('lands on every face about as often as any other', () =>
    {
        const counts = [0, 0, 0, 0, 0, 0];
        const dice = drawsOf(hmacSha256, seed, 9);

        for (let draw = 0; draw < 6000; draw += 1)
        {
            counts[dice.die(6) - 1] += 1;
        }

        expect(Math.min(...counts)).toBeGreaterThan(880);
        expect(Math.max(...counts)).toBeLessThan(1120);
    });
});

describe('the revision a game opens at', () =>
{
    it('is the one every engine opens at, so the opening draws are keyed to the revision they make', () =>
    {
        for (const engine of ENGINES)
        {
            for (const format of engine.formats)
            {
                const seats = Array.from({ length: format.seats }, (_, seat) => seat);
                const made = engine.create(seats, drawsOf(hmacSha256, seed, OPENING), { target: 3, cube: true, blinds: 'low', variant: format.variant });

                expect((made.state as { rev: number }).rev, `${ engine.id } ${ format.seats } ${ format.variant }`).toBe(OPENING);
            }
        }
    });
});
