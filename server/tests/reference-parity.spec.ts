import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import '../src/entities/index.ts';

import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { RUNGS } from '../src/domains/achieve/families.ts';
import { NOTICES, NOTICE_OF } from '../src/domains/notify/notices.ts';
import { GAMES } from '../../application/src/data/games.ts';
import { TABLE_RULES } from '../../application/src/data/tables.ts';

/**
 * The catalogue is split on purpose.
 *
 * The SERVER owns what a game IS - its seats, modes, targets, fairness, whether it has a cube.
 * The CLIENT keeps where its table stands in the 3D market: `anchor`, `rotation`, `table`, `set`.
 * That half is scene geometry, it changes only when a Blender script changes, and the landing
 * route is `render: 'static'` - it must paint with no JavaScript and no server.
 *
 * A split like that drifts silently: someone adds a fifth game to one side and the other never
 * learns. These tests are the join. They import the browser's own modules directly, which is safe
 * because both carry only type-level imports of anything else.
 *
 * When the mock is finally deleted (it is the whole point of the domain PRs), the client-side
 * arrays go with it and these assertions get pointed at the api response instead.
 */

describe('games: the server and the 3D market agree', () =>
{
    it('knows the same four games, in the same order', () =>
    {
        expect(GAME_SEEDS.map((game) => game.id)).toEqual(GAMES.map((game) => game.id));
    });

    it('agrees on every field both halves hold', () =>
    {
        for (const seed of GAME_SEEDS)
        {
            const client = GAMES.find((game) => game.id === seed.id);
            expect(client, `no client entry for ${ seed.id }`).toBeDefined();

            expect(seed.slug).toBe(client!.slug);
            expect(seed.category).toBe(client!.category);
            expect(seed.minPlayers).toBe(client!.minPlayers);
            expect(seed.maxPlayers).toBe(client!.maxPlayers);
        }
    });

    it('derives the message keys the locale catalogues actually publish', () =>
    {
        // The server stores KEYS, not prose, so a wrong key is an empty string on the page rather
        // than a crash. Pinning them here is what turns that into a failing test.
        for (const seed of GAME_SEEDS)
        {
            const client = GAMES.find((game) => game.id === seed.id)!;
            expect(`games.${ seed.id }.name`).toBe(client.nameKey);
            expect(`games.${ seed.id }.blurb`).toBe(client.blurbKey);
            expect(`games.category.${ seed.category }`).toBe(client.categoryKey);
        }
    });

    it('agrees on every table rule', () =>
    {
        for (const seed of GAME_SEEDS)
        {
            const rules = TABLE_RULES[seed.id as keyof typeof TABLE_RULES];
            expect(rules, `no client rules for ${ seed.id }`).toBeDefined();

            expect(seed.seats).toEqual([...rules.seats]);
            expect(seed.modes).toEqual([...rules.modes]);
            expect(seed.targets).toEqual([...rules.targets]);
            expect(seed.stakes).toBe(rules.stakes);
            expect(seed.partners).toBe(rules.partners);
        }
    });

    it('offers a cube and blinds exactly where the create form does', () =>
    {
        // `create-game-form.component.azeroth` branches on the game id for these two. Moving the
        // decision to a column is what lets a fifth game arrive without editing that component.
        expect(GAME_SEEDS.filter((game) => game.hasCube).map((game) => game.id)).toEqual(['backgammon']);
        expect(GAME_SEEDS.filter((game) => game.hasBlinds).map((game) => game.id)).toEqual(['poker']);
    });

    it('never lets a seat count fall outside the advertised range', () =>
    {
        for (const seed of GAME_SEEDS)
        {
            for (const count of seed.seats)
            {
                expect(count).toBeGreaterThanOrEqual(seed.minPlayers);
                expect(count).toBeLessThanOrEqual(seed.maxPlayers);
            }
        }
    });
});

describe('achievements: the server definitions hold together', () =>
{
    it('gives every one a distinct id', () =>
    {
        expect(new Set(RUNGS.map((one) => one.id)).size).toBe(RUNGS.length);
    });

    it('never ships an untranslated string, which the CHECK constraint also refuses', () =>
    {
        for (const seed of RUNGS)
        {
            for (const text of [seed.nameEn, seed.nameFa, seed.blurbEn, seed.blurbFa])
            {
                expect(text.trim().length).toBeGreaterThan(0);
            }
        }

        // And the two languages must actually differ - a Persian field holding the English string
        // is the failure `tests/data.spec.ts` already guards on the client side.
        for (const seed of RUNGS)
        {
            expect(seed.nameFa).not.toBe(seed.nameEn);
            expect(seed.blurbFa).not.toBe(seed.blurbEn);
        }
    });

    it('seeds only seat counts both seat CHECKs accept', () =>
    {
        for (const name of ['matches_seats_range', 'tables_seats_range'])
        {
            const check = getMetadataArgsStorage().checks.find((one) => one.name === name);
            const range = /seats between (\d+) and (\d+)/.exec(check?.expression ?? '');

            expect(range, name).not.toBeNull();

            for (const game of GAME_SEEDS)
            {
                for (const seats of game.seats)
                {
                    expect(seats, `${ game.id } seats ${ seats } against ${ name }`).toBeGreaterThanOrEqual(Number(range![1]));
                    expect(seats, `${ game.id } seats ${ seats } against ${ name }`).toBeLessThanOrEqual(Number(range![2]));
                }
            }
        }
    });
});

describe('notices: the kinds a person can switch off hold together', () =>
{
    const listed = (name: string): string[] =>
        [...(getMetadataArgsStorage().checks.find((one) => one.name === name)?.expression ?? '').matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

    it('names in the CHECK exactly the notices the service knows', () =>
    {
        expect(listed('mutes_notice_known').filter((one) => one !== 'notice').sort()).toEqual([...NOTICES].sort());
    });

    it('files every kind of notification under a notice somebody can switch off', () =>
    {
        expect(Object.keys(NOTICE_OF).sort()).toEqual(listed('notifications_kind_known').sort());
        expect(new Set(Object.values(NOTICE_OF))).toEqual(new Set(NOTICES));
    });
});
