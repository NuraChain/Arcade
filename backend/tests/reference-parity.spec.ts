import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import '../src/entities/index.ts';

import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { RUNGS } from '../src/domains/achieve/families.ts';
import type { Plan } from '../src/domains/match/judge.ts';
import { NOTICES, NOTICE_OF } from '../src/domains/notify/notices.ts';
import { quickOf, seatsByDefault } from '../src/domains/table/quick.ts';
import type { MatchOutcome } from '../src/entities/match.entity.ts';
import { matchHistoryEntry, matchPlayer, matchView } from '../src/schemas.ts';
import { GAMES } from '../../frontend/src/data/games.ts';
import { TABLE_RULES, formatsOf } from '../../frontend/src/data/tables.ts';

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

describe('games: the server and the landing agree', () =>
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

    it('seeds every game the landing prints as live as available', () =>
    {
        expect(GAME_SEEDS.filter((seed) => seed.status !== 'available').map((seed) => seed.id)).toEqual([]);
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

    it('leaves two against two at a ludo table of four to whoever opens it, in the browser as on the server', () =>
    {
        const seed = GAME_SEEDS.find((game) => game.id === 'ludo')!;
        const named = (rules: Parameters<typeof formatsOf>[0]) => formatsOf(rules).map((format) => `${ format.seats }${ format.teams ? ' in pairs' : '' }`);

        expect(seed.partners).toBe('optional');
        expect(TABLE_RULES.ludo.partners).toBe('optional');
        expect(named(seed)).toEqual(['2', '3', '4', '4 in pairs']);
        expect(named(TABLE_RULES.ludo)).toEqual(named(seed));
        expect(quickOf(seed, { teams: true })).toMatchObject({ ok: true, make: { seats: 4, teams: true } });
        expect(quickOf(seed, {})).toMatchObject({ ok: true, make: { seats: 4, teams: false } });
    });

    it('offers a cube and blinds exactly where the create form does', () =>
    {
        expect(GAME_SEEDS.filter((game) => game.hasCube).map((game) => game.id)).toEqual(['backgammon']);
        expect(GAME_SEEDS.filter((game) => game.hasBlinds).map((game) => game.id)).toEqual(['poker']);

        for (const seed of GAME_SEEDS)
        {
            const rules = TABLE_RULES[seed.id as keyof typeof TABLE_RULES];

            expect(rules.hasCube, `${ seed.id } cube`).toBe(seed.hasCube);
            expect(rules.hasBlinds, `${ seed.id } blinds`).toBe(seed.hasBlinds);
        }
    });

    it('opens a table nobody chose the seats of at the same count in the browser as on the server', () =>
    {
        for (const seed of GAME_SEEDS)
        {
            const rules = TABLE_RULES[seed.id as keyof typeof TABLE_RULES];

            expect(seatsByDefault(rules), seed.id).toBe(seatsByDefault(seed));
            expect(quickOf(rules, {}), seed.id).toEqual(quickOf(seed, {}));
        }
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

describe('match results: the database and the wire name the same ones', () =>
{
    const known = [...(getMetadataArgsStorage().checks.find((one) => one.name === 'match_players_result_known')?.expression ?? '').matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

    const row = (result: string) => ({ id: 'm', game: 'ludo', finishedAt: '2026-10-04T00:00:00.000Z', result, players: [] });
    const seat = (result: string) => ({ seat: 0, who: 'dana.w', timeouts: 0, result });

    it('keeps a seat the match never judged as void', () =>
    {
        expect([...known].sort()).toEqual(['abandoned', 'lost', 'void', 'won']);
    });

    it('carries exactly the results the CHECK accepts, in a history row and on a seat', () =>
    {
        const candidates = new Set([...known, 'won', 'lost', 'abandoned', 'void', 'closed', 'draw', 'left', 'resign', 'timeout', 'Void', '']);

        for (const result of candidates)
        {
            expect(matchHistoryEntry.safeParse(row(result)).ok, result).toBe(known.includes(result));
            expect(matchPlayer.safeParse(seat(result)).ok, result).toBe(known.includes(result));
        }
    });

    it('sends a history row what its two screens read, and neither a seat count nor how the match ended', () =>
    {
        const sent = matchHistoryEntry.parse({ ...row('void'), seats: 2, outcome: 'abandoned', ratingBefore: 1200, ratingAfter: 1184 });

        expect(Object.keys(sent).sort()).toEqual(['finishedAt', 'game', 'id', 'players', 'ratingAfter', 'ratingBefore', 'result']);
    });
});

describe('match outcomes: the judge, the database and the wire name the same ones', () =>
{
    const judged: Record<Plan['outcome'], true> = { abandoned: true, won: true };
    const stored: Record<MatchOutcome, true> = judged;

    const known = [...(getMetadataArgsStorage().checks.find((one) => one.name === 'matches_outcome_known')?.expression ?? '').matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

    const finished = (outcome: string) => ({
        id: 'm',
        tableId: 't',
        game: 'ludo',
        rev: 9,
        seats: 2,
        players: [{ seat: 0, who: 'dana.w', timeouts: 0 }, { seat: 1, who: 'mina', timeouts: 0 }],
        view: { kind: 'ludo', moves: [], controls: 0, seats: [] },
        outcome,
        startedAt: '2026-10-07T00:00:00.000Z',
        finishedAt: '2026-10-07T00:10:00.000Z'
    });

    it('lets a match end only the ways the judge ends one', () =>
    {
        expect([...known].sort()).toEqual(Object.keys(stored).sort());
    });

    it('carries exactly the outcomes the CHECK accepts on a finished match', () =>
    {
        const candidates = new Set([...known, 'won', 'abandoned', 'closed', 'lost', 'void', 'draw', 'Won', '']);

        for (const outcome of candidates)
        {
            expect(matchView.safeParse(finished(outcome)).ok, outcome).toBe(known.includes(outcome));
        }
    });
});
