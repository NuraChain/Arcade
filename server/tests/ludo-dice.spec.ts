import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { rollDie, pickBelow } from '../src/lib/crypto.ts';

/**
 * The client cannot choose a die, and that is structural rather than a rule somebody remembers.
 *
 * The wire has no field to put one in and the engine has no randomness to subvert, so supplying a
 * dice result would take a change in three places - `schemas.ts`, `api.ts` and `service.ts` - and
 * this spec reads the first two as text and fails on the first of them.
 *
 * The sibling of the assertion in `tests/lib.spec.ts` that the `fairness` key is ABSENT: a claim a
 * mechanism does not support should be impossible to reintroduce quietly.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const read = (name: string): string => readFileSync(join(HERE, '..', 'src', name), 'utf8');

describe('the die', () =>
{
    it('is always a face', () =>
    {
        const seen = new Set<number>();

        for (let draw = 0; draw < 4000; draw += 1)
        {
            const die = rollDie();

            expect(Number.isInteger(die)).toBe(true);
            expect(die).toBeGreaterThanOrEqual(1);
            expect(die).toBeLessThanOrEqual(6);
            seen.add(die);
        }

        expect(seen.size, 'four thousand draws should have shown every face').toBe(6);
    });

    it('draws who goes first from the same generator, and never out of range', () =>
    {
        expect(pickBelow(1)).toBe(0);
        expect(pickBelow(0)).toBe(0);

        for (let draw = 0; draw < 2000; draw += 1)
        {
            const index = pickBelow(4);

            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(4);
        }
    });
});

describe('the wire', () =>
{
    it('gives a caller nowhere to put a dice result', () =>
    {
        const schemas = read('schemas.ts');
        const inputs = [...schemas.matchAll(/export const (match\w*Input) = object\(\{([\s\S]*?)\n\}\);/g)];

        expect(inputs.length, 'no match input schemas found, so this checked nothing').toBeGreaterThanOrEqual(2);

        for (const [, name, body] of inputs)
        {
            expect(body, `${ name } declares a die`).not.toMatch(/\bdie\b/);
            expect(body, `${ name } declares a roll`).not.toMatch(/\broll\b\s*:/);
        }
    });

    it('declares no route that takes a die', () =>
    {
        const api = read('api.ts');
        const matches = api.slice(api.indexOf("matches: feature('/matches'"));

        expect(matches.length, 'the matches feature was not found').toBeGreaterThan(0);
        expect(matches.slice(0, matches.indexOf('})),'))).not.toMatch(/\bdie\b/);
    });

    it('says nothing anywhere about provable fairness', () =>
    {
        for (const name of ['schemas.ts', 'api.ts', 'domains/match/service.ts', 'lib/crypto.ts'])
        {
            const source = read(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

            for (const word of ['provably', 'provable', 'verifiable', 'guaranteed fair'])
            {
                expect(source.toLowerCase(), `${ name } claims ${ word }`).not.toContain(word);
            }
        }
    });
});
