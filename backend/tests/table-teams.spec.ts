import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import '../src/entities/index.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { variantOf, type Variant } from '../src/domains/match/sides.ts';
import { PARTNERS, teamsOf } from '../src/domains/table/teams.ts';
import { tableCreateInput, tableRules } from '../src/schemas.ts';
import { TABLE_RULES, defaultTable } from '../../frontend/src/data/tables.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const wordsIn = (check: string) =>
    [...(getMetadataArgsStorage().checks.find((one) => one.name === check)?.expression ?? '').matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

const rules = (partners: unknown) => ({ seats: [2, 4], modes: ['live'], targets: [], stakes: 'none', partners, hasCube: false, hasBlinds: false });

const body = { game: 'hokm', seats: 4, mode: 'live', privacy: 'public', target: 7, cube: false, blinds: 'low', chat: true, voice: 'off', invitees: [] };

describe('whether a table is two against two', () =>
{
    it('is the game and the seat count, and the opener only where the game leaves it open', () =>
    {
        for (const asked of [true, false])
        {
            for (const seats of [2, 3, 4, 6, 9])
            {
                expect(teamsOf('none', seats, asked), `none at ${ seats }, asked ${ asked }`).toBe(false);
                expect(teamsOf('required', seats, asked), `required at ${ seats }, asked ${ asked }`).toBe(seats === 4);
                expect(teamsOf('optional', seats, asked), `optional at ${ seats }, asked ${ asked }`).toBe(seats === 4 && asked);
            }
        }
    });

    it('is asked of a module that imports nothing, so the browser asks the same one', () =>
    {
        expect(readFileSync(join(HERE, '..', 'src', 'domains', 'table', 'teams.ts'), 'utf8')).not.toMatch(/^\s*import\s/m);
    });

    it('has three answers for a game, and the catalogue, the wire and the list name the same three', () =>
    {
        expect(wordsIn('game_rules_partners_known').sort()).toEqual([...PARTNERS].sort());

        for (const word of [...PARTNERS, 'sometimes', 'true', ''])
        {
            expect(tableRules.safeParse(rules(word)).ok, word).toBe((PARTNERS as readonly string[]).includes(word));
        }

        expect(tableRules.safeParse(rules(true)).ok).toBe(false);
    });

    it('is forced for hokm and closed to every other game the catalogue seeds, in the browser as on the server', () =>
    {
        expect(Object.fromEntries(GAME_SEEDS.map((game) => [game.id, game.partners]))).toEqual({
            hokm: 'required',
            poker: 'none',
            backgammon: 'none',
            ludo: 'none'
        });

        for (const seed of GAME_SEEDS)
        {
            expect(TABLE_RULES[seed.id as keyof typeof TABLE_RULES].partners, seed.id).toBe(seed.partners);
        }
    });

    it('has to be said by whoever opens a table', () =>
    {
        expect(tableCreateInput.safeParse(body).ok).toBe(false);
        expect(tableCreateInput.safeParse({ ...body, teams: true }).ok).toBe(true);
        expect(tableCreateInput.safeParse({ ...body, teams: false }).ok).toBe(true);
        expect(tableCreateInput.safeParse({ ...body, teams: 'yes' }).ok).toBe(false);
    });

    it('is a variant a match can be played under, beside the standard one, and a table is started as one of the two', () =>
    {
        const played: Record<Variant, true> = { standard: true, teams: true };

        expect(wordsIn('matches_variant_known').sort()).toEqual(Object.keys(played).sort());
        expect([variantOf(false), variantOf(true)]).toEqual(['standard', 'teams']);
    });

    it('opens a default table as what the game makes of it at that many seats', () =>
    {
        expect(defaultTable('hokm')).toMatchObject({ seats: 4, teams: true });
        expect(defaultTable('ludo')).toMatchObject({ seats: 4, teams: false });
        expect(defaultTable('backgammon')).toMatchObject({ seats: 2, teams: false });
        expect(defaultTable('poker').teams).toBe(false);
    });
});
