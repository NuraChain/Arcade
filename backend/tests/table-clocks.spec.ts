import 'reflect-metadata';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import '../src/entities/index.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { CLOCKS, CLOCK_DEFAULT, clockFor, clockOf, isClock } from '../src/domains/table/clocks.ts';
import type { QuickClock } from '../src/domains/table/quick.ts';
import { tableCreateInput, tableQuickInput, tableRules, tableSummary } from '../src/schemas.ts';

const expressionOf = (name: string) => getMetadataArgsStorage().checks.find((one) => one.name === name)?.expression ?? '';

const controlsIn = (name: string) => [...expressionOf(name).matchAll(/'(\d+\+\d+)'/g)].map((match) => match[1]);

const rules = { seats: [2], modes: ['live', 'turns'], targets: [], stakes: 'none', partners: 'none', hasCube: false, hasBlinds: false };

describe('the time controls a table can be played under', () =>
{
    it('are one list, and the table, the game\'s rules and the wire name the same ones', () =>
    {
        expect(controlsIn('tables_clock_known')).toEqual([...CLOCKS]);
        expect(controlsIn('game_rules_clocks_known')).toEqual([...CLOCKS]);

        for (const control of [...CLOCKS, '1+0', '10', '10+', 'blitz', ''])
        {
            expect(tableRules.safeParse({ ...rules, clocks: [control] }).ok, control).toBe(isClock(control));
        }
    });

    it('are asked for by name when a table is opened or looked for, and are on a table\'s summary only when it has one', () =>
    {
        const opened = { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off', teams: false, invitees: [] };
        const summary = {
            id: 't', code: 'c', game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: 'off',
            teams: false, status: 'open', chairs: [], taken: 0, createdAt: '2026-10-23T00:00:00.000Z'
        };

        for (const control of [...CLOCKS, '1+0', 'blitz', ''])
        {
            expect(tableCreateInput.safeParse({ ...opened, clock: control }).ok, control).toBe(isClock(control));
            expect(tableQuickInput.safeParse({ game: 'ludo', voice: 'off', clock: control }).ok, control).toBe(isClock(control));
            expect(tableSummary.safeParse({ ...summary, clock: control }).ok, control).toBe(isClock(control));
        }

        expect(tableCreateInput.safeParse(opened).ok).toBe(true);
        expect(tableSummary.safeParse(summary).ok).toBe(true);
    });

    it('are the same five where quick play restates them to import nothing', () =>
    {
        const restated: Record<QuickClock, true> = { '3+2': true, '5+0': true, '10+0': true, '15+10': true, '30+0': true };

        expect(Object.keys(restated)).toEqual([...CLOCKS]);
    });

    it('are kept off a turn-based table, which gives a day a move', () =>
    {
        expect(expressionOf('tables_clock_live')).toBe(`clock is null or mode = 'live'`);
    });

    it('are the minutes each side starts with and the seconds a move adds', () =>
    {
        expect(clockOf('3+2')).toEqual({ base: 180_000, increment: 2000 });
        expect(clockOf('10+0')).toEqual({ base: 600_000, increment: 0 });
        expect(clockOf('15+10')).toEqual({ base: 900_000, increment: 10_000 });
        expect(clockOf('30+0')).toEqual({ base: 1_800_000, increment: 0 });
        expect(clockOf(null)).toBeNull();
        expect(clockOf('1+0')).toBeNull();
    });

    it('open a live table under the control asked for when the game offers it, and its default when not', () =>
    {
        expect(clockFor(CLOCKS, 'live', '3+2')).toBe('3+2');
        expect(clockFor(CLOCKS, 'live')).toBe(CLOCK_DEFAULT);
        expect(clockFor(CLOCKS, 'live', null)).toBe(CLOCK_DEFAULT);
        expect(clockFor(CLOCKS, 'live', 'blitz')).toBe(CLOCK_DEFAULT);
        expect(clockFor(['3+2', '15+10'], 'live', '5+0')).toBe('3+2');
        expect(CLOCK_DEFAULT).toBe('10+0');
    });

    it('give a turn-based table and a game that offers none no control at all', () =>
    {
        expect(clockFor(CLOCKS, 'turns', '3+2')).toBeNull();
        expect(clockFor([], 'live', '3+2')).toBeNull();
        expect(clockFor(['blitz'], 'live')).toBeNull();
    });

    it('are offered by a game only from the list', () =>
    {
        for (const seed of GAME_SEEDS)
        {
            expect(seed.clocks.every(isClock), seed.id).toBe(true);
        }
    });
});
