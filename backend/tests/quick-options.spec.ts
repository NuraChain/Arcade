import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { cubeLive } from '../src/domains/match/backgammon/cube.ts';
import { quickOf, seatsByDefault, type QuickAsk, type QuickFilter, type QuickMake, type QuickRules } from '../src/domains/table/quick.ts';
import { teamsOf } from '../src/domains/table/teams.ts';
import { tableQuickInput } from '../src/schemas.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const seeded = (id: string): QuickRules => GAME_SEEDS.find((seed) => seed.id === id)!;

const RULES = { hokm: seeded('hokm'), poker: seeded('poker'), backgammon: seeded('backgammon'), ludo: seeded('ludo') };

const EITHER: QuickRules = { ...RULES.ludo, partners: 'optional' };

const ANY: QuickFilter = { seats: null, mode: 'live', target: null, blinds: null, cube: null, teams: null };

const sought = (rules: QuickRules, ask: QuickAsk) =>
{
    const found = quickOf(rules, ask);

    if (!found.ok)
    {
        throw new Error(`refused ${ JSON.stringify(ask) }`);
    }

    return found;
};

const refused = (rules: QuickRules, ask: QuickAsk) => !quickOf(rules, ask).ok;

const finds = (filter: QuickFilter, table: QuickMake) =>
    filter.mode === table.mode
    && (['seats', 'target', 'blinds', 'cube', 'teams'] as const).every((option) => filter[option] === null || filter[option] === table[option]);

const GRID: QuickAsk[] = [undefined, 2, 3, 4, 5, 6, 9].flatMap((seats) =>
    [undefined, 'live' as const, 'turns' as const].flatMap((mode) =>
        [undefined, 1, 3, 7, 13, 99].flatMap((target) =>
            [undefined, 'low' as const, 'high' as const].flatMap((blinds) =>
                [undefined, true, false].flatMap((cube) =>
                    [undefined, true, false].map((teams) => ({
                        ...(seats === undefined ? {} : { seats }),
                        ...(mode === undefined ? {} : { mode }),
                        ...(target === undefined ? {} : { target }),
                        ...(blinds === undefined ? {} : { blinds }),
                        ...(cube === undefined ? {} : { cube }),
                        ...(teams === undefined ? {} : { teams })
                    })))))));

describe('the table a game opens when nobody says how many chairs', () =>
{
    it('is the smallest of four or more, or the largest the game plays', () =>
    {
        expect(seatsByDefault(RULES.hokm)).toBe(4);
        expect(seatsByDefault(RULES.ludo)).toBe(4);
        expect(seatsByDefault(RULES.poker)).toBe(6);
        expect(seatsByDefault(RULES.backgammon)).toBe(2);
        expect(seatsByDefault({ seats: [2, 3] })).toBe(3);
        expect(seatsByDefault({ seats: [2, 6, 9] })).toBe(6);
    });
});

describe('a quick search with nothing chosen', () =>
{
    it('matches any table of the game that is played live, whatever its seats, target, blinds, cube or sides', () =>
    {
        for (const rules of Object.values(RULES))
        {
            expect(sought(rules, {}).filter).toEqual(ANY);
        }
    });

    it('opens the table each game makes by default when there is nothing to join', () =>
    {
        expect(sought(RULES.hokm, {}).make).toEqual({ seats: 4, mode: 'live', target: 7, blinds: 'low', cube: false, teams: true });
        expect(sought(RULES.poker, {}).make).toEqual({ seats: 6, mode: 'live', target: 0, blinds: 'low', cube: false, teams: false });
        expect(sought(RULES.backgammon, {}).make).toEqual({ seats: 2, mode: 'live', target: 1, blinds: 'low', cube: false, teams: false });
        expect(sought(RULES.ludo, {}).make).toEqual({ seats: 4, mode: 'live', target: 0, blinds: 'low', cube: false, teams: false });
    });
});

describe('the pace of a quick search', () =>
{
    it('is live unless turns were asked for, never either', () =>
    {
        expect(sought(RULES.ludo, {}).filter.mode).toBe('live');
        expect(sought(RULES.ludo, { mode: 'turns' })).toMatchObject({ filter: { mode: 'turns' }, make: { mode: 'turns' } });
        expect(sought(RULES.ludo, { mode: 'live' })).toMatchObject({ filter: { mode: 'live' }, make: { mode: 'live' } });
    });

    it('is refused where the game is not played at that pace', () =>
    {
        expect(refused(RULES.poker, { mode: 'turns' })).toBe(true);
        expect(refused({ ...RULES.ludo, modes: ['turns'] }, {})).toBe(true);
    });
});

describe('an option somebody chose', () =>
{
    it('is matched exactly, and is what a new table is opened with', () =>
    {
        expect(sought(RULES.ludo, { seats: 2 })).toMatchObject({ filter: { ...ANY, seats: 2 }, make: { seats: 2 } });
        expect(sought(RULES.hokm, { target: 13 })).toMatchObject({ filter: { ...ANY, target: 13 }, make: { target: 13 } });
        expect(sought(RULES.poker, { blinds: 'high' })).toMatchObject({ filter: { ...ANY, blinds: 'high' }, make: { blinds: 'high' } });
        expect(sought(RULES.poker, { seats: 9, blinds: 'mid' }).make).toEqual({ seats: 9, mode: 'live', target: 0, blinds: 'mid', cube: false, teams: false });
    });

    it('is refused when the game makes no such table', () =>
    {
        expect(refused(RULES.hokm, { seats: 5 })).toBe(true);
        expect(refused(RULES.backgammon, { seats: 4 })).toBe(true);
        expect(refused(RULES.hokm, { target: 9 })).toBe(true);
        expect(refused(RULES.ludo, { target: 7 })).toBe(true);
        expect(refused(RULES.hokm, { blinds: 'low' })).toBe(true);
        expect(refused(RULES.poker, { cube: false })).toBe(true);
        expect(refused(RULES.hokm, { cube: true })).toBe(true);
    });
});

describe('the doubling cube in a quick search', () =>
{
    it('is matched as the table stores it, so a cube is only ever sought where it can be offered', () =>
    {
        expect(sought(RULES.backgammon, { cube: true })).toMatchObject({ filter: { ...ANY, cube: true }, make: { target: 3, cube: true } });
        expect(sought(RULES.backgammon, { cube: true, target: 5 })).toMatchObject({ filter: { target: 5, cube: true }, make: { target: 5, cube: true } });
        expect(sought(RULES.backgammon, { cube: false })).toMatchObject({ filter: { ...ANY, cube: false }, make: { target: 1, cube: false } });
        expect(sought(RULES.backgammon, { cube: false, target: 3 })).toMatchObject({ make: { target: 3, cube: false } });
    });

    it('is live at a longer match nobody said anything about, and dead at one point', () =>
    {
        expect(sought(RULES.backgammon, { target: 3 })).toMatchObject({ filter: { ...ANY, target: 3 }, make: { target: 3, cube: true } });
        expect(sought(RULES.backgammon, { target: 1 }).make).toMatchObject({ target: 1, cube: false });
    });

    it('is refused in a one-point match, which has none, and where no match is long enough to have one', () =>
    {
        expect(refused(RULES.backgammon, { cube: true, target: 1 })).toBe(true);
        expect(refused({ ...RULES.backgammon, targets: [1] }, { cube: true })).toBe(true);
        expect(refused({ ...RULES.backgammon, targets: [] }, { cube: true })).toBe(true);
    });
});

describe('two against two in a quick search', () =>
{
    it('is forced where the game has partners at four, and only there', () =>
    {
        expect(sought(RULES.hokm, { seats: 4 })).toMatchObject({ filter: { seats: 4, teams: true }, make: { seats: 4, teams: true } });
        expect(sought(RULES.hokm, {}).filter.teams).toBeNull();
        expect(sought(RULES.hokm, { seats: 2 })).toMatchObject({ filter: { seats: 2, teams: null }, make: { seats: 2, teams: false } });
        expect(sought(RULES.hokm, { teams: true })).toMatchObject({ filter: { seats: null, teams: true }, make: { seats: 4, teams: true } });
    });

    it('can be turned down for such a game, which then seeks and opens a table that is not four', () =>
    {
        expect(sought(RULES.hokm, { teams: false })).toMatchObject({ filter: { seats: null, teams: false }, make: { seats: 3, teams: false } });
        expect(refused(RULES.hokm, { teams: false, seats: 4 })).toBe(true);
        expect(refused({ ...RULES.hokm, seats: [4] }, { teams: false })).toBe(true);
    });

    it('is refused for a game with no partners, and at any table that is not four', () =>
    {
        expect(refused(RULES.ludo, { teams: true })).toBe(true);
        expect(refused(RULES.poker, { teams: true })).toBe(true);
        expect(refused(RULES.hokm, { teams: true, seats: 3 })).toBe(true);
        expect(refused(EITHER, { teams: true, seats: 2 })).toBe(true);
        expect(refused({ ...EITHER, seats: [2, 3] }, { teams: true })).toBe(true);
        expect(sought(RULES.ludo, { teams: false })).toMatchObject({ filter: { teams: false }, make: { seats: 4, teams: false } });
    });

    it('is the opener’s to choose where the game leaves it open, and a search that says nothing finds both and opens the plain game', () =>
    {
        expect(sought(EITHER, {})).toMatchObject({ filter: ANY, make: { seats: 4, teams: false } });
        expect(sought(EITHER, { seats: 4 })).toMatchObject({ filter: { seats: 4, teams: null }, make: { seats: 4, teams: false } });
        expect(sought(EITHER, { teams: true })).toMatchObject({ filter: { teams: true }, make: { seats: 4, teams: true } });
        expect(sought(EITHER, { teams: false, seats: 4 })).toMatchObject({ filter: { seats: 4, teams: false }, make: { seats: 4, teams: false } });
    });
});

describe('whatever is asked', () =>
{
    const games: [string, QuickRules][] = [...Object.entries(RULES), ['a game that leaves teams open', EITHER]];

    it('opens only a table the game makes, which opening it by hand would store unchanged', () =>
    {
        const wrong: string[] = [];
        let opened = 0;

        for (const [game, rules] of games)
        {
            for (const ask of GRID)
            {
                const found = quickOf(rules, ask);

                if (!found.ok)
                {
                    continue;
                }

                opened += 1;

                const { make } = found;
                const made = rules.seats.includes(make.seats)
                    && rules.modes.includes(make.mode)
                    && (make.target === 0 ? rules.targets.length === 0 : rules.targets.includes(make.target))
                    && (rules.hasBlinds || make.blinds === 'low')
                    && make.cube === cubeLive(make.target, rules.hasCube && make.cube)
                    && make.teams === teamsOf(rules.partners, make.seats, make.teams);

                if (!made)
                {
                    wrong.push(`${ game } ${ JSON.stringify(ask) } -> ${ JSON.stringify(make) }`);
                }
            }
        }

        expect(opened).toBeGreaterThan(100);
        expect(wrong).toEqual([]);
    });

    it('opens a table the same search would then find, so the next searcher sits down at it', () =>
    {
        const lost = games.flatMap(([game, rules]) => GRID
            .map((ask) => ({ ask, found: quickOf(rules, ask) }))
            .filter(({ found }) => found.ok && !finds(found.filter, found.make))
            .map(({ ask }) => `${ game } ${ JSON.stringify(ask) }`));

        expect(lost).toEqual([]);
    });

    it('keeps what was asked, and never widens it', () =>
    {
        const widened = games.flatMap(([game, rules]) => GRID
            .map((ask) => ({ ask, found: quickOf(rules, ask) }))
            .filter(({ ask, found }) => found.ok && (['seats', 'target', 'blinds', 'cube', 'teams'] as const)
                .some((option) => ask[option] !== undefined && found.filter[option] !== ask[option]))
            .map(({ ask }) => `${ game } ${ JSON.stringify(ask) }`));

        expect(widened).toEqual([]);
    });
});

describe('where a quick search is worked out', () =>
{
    it('is a module that imports nothing, so the browser asks the same one', () =>
    {
        const source = readFileSync(join(HERE, '..', 'src', 'domains', 'table', 'quick.ts'), 'utf8');

        expect(source).not.toMatch(/^\s*import\s/m);
        expect(source).not.toMatch(/\bfrom\s+['"]/);
        expect(source).not.toMatch(/\b(require|import)\s*\(/);
    });
});

describe('a quick search on the wire', () =>
{
    const body = { game: 'ludo', voice: 'off' };

    it('needs the game and who the call is for, and nothing else', () =>
    {
        expect(tableQuickInput.safeParse(body).ok).toBe(true);
        expect(tableQuickInput.safeParse({ voice: 'off' }).ok).toBe(false);
        expect(tableQuickInput.safeParse({ game: 'ludo' }).ok).toBe(false);
        expect(tableQuickInput.safeParse({ game: 'ludo', voice: true }).ok).toBe(false);
        expect(tableQuickInput.safeParse({ game: 'ludo', voice: 'everyone' }).ok).toBe(false);
        expect(tableQuickInput.safeParse({ game: 'x'.repeat(33), voice: 'off' }).ok).toBe(false);
    });

    it('takes each option as the table stores it, inside what a column holds', () =>
    {
        const taken: [string, unknown, boolean][] = [
            ['seats', 2, true],
            ['seats', 9, true],
            ['seats', 1, false],
            ['seats', 10, false],
            ['seats', 2.5, false],
            ['seats', '4', false],
            ['mode', 'live', true],
            ['mode', 'turns', true],
            ['mode', 'any', false],
            ['target', 1, true],
            ['target', 9999, true],
            ['target', 0, false],
            ['target', 10000, false],
            ['target', 1.5, false],
            ['blinds', 'low', true],
            ['blinds', 'mid', true],
            ['blinds', 'high', true],
            ['blinds', 'huge', false],
            ['cube', true, true],
            ['cube', false, true],
            ['cube', 'yes', false],
            ['teams', true, true],
            ['teams', false, true],
            ['teams', 1, false]
        ];

        for (const [option, value, ok] of taken)
        {
            expect(tableQuickInput.safeParse({ ...body, [option]: value }).ok, `${ option } ${ String(value) }`).toBe(ok);
        }
    });

    it('carries every option a search can be narrowed by, and no table to ask for by name', () =>
    {
        const whole = { ...body, seats: 4, mode: 'turns', target: 7, blinds: 'mid', cube: true, teams: true };

        expect(tableQuickInput.parse({ ...whole, id: 'a-table', code: 'abc234', privacy: 'invite', invitees: ['sara.k'] })).toEqual(whole);
    });
});
