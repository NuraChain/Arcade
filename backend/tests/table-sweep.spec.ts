import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { strikes, type WaitingSeat } from '../src/domains/table/sweep.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const read = (...path: string[]) => readFileSync(join(HERE, '..', 'src', ...path), 'utf8');

const at = (tableId: string, userId: string): WaitingSeat => ({ tableId, userId });

const NOBODY = new Set<string>();

describe('who a sweep of the waiting tables stands up', () =>
{
    it('only suspects somebody the first time it finds them away', () =>
    {
        const first = strikes(NOBODY, [at('felt', 'sara')]);

        expect(first.vacate).toEqual([]);
        expect([...first.next]).toHaveLength(1);
    });

    it('stands them up the second time in a row, and the strike is spent', () =>
    {
        const first = strikes(NOBODY, [at('felt', 'sara')]);
        const second = strikes(first.next, [at('felt', 'sara')]);

        expect(second.vacate).toEqual([at('felt', 'sara')]);
        expect([...second.next]).toEqual([]);
    });

    it('forgets the strike of somebody who is back by the second sweep', () =>
    {
        const first = strikes(NOBODY, [at('felt', 'sara')]);
        const back = strikes(first.next, []);
        const awayAgain = strikes(back.next, [at('felt', 'sara')]);

        expect(back.vacate).toEqual([]);
        expect([...back.next]).toEqual([]);
        expect(awayAgain.vacate).toEqual([]);
        expect(strikes(awayAgain.next, [at('felt', 'sara')]).vacate).toEqual([at('felt', 'sara')]);
    });

    it('drops a chair that emptied by itself, so the set holds only chairs somebody is still away from', () =>
    {
        const first = strikes(NOBODY, [at('felt', 'sara'), at('felt', 'omid'), at('baize', 'mina')]);
        const second = strikes(first.next, [at('felt', 'omid')]);

        expect(second.vacate).toEqual([at('felt', 'omid')]);
        expect([...second.next]).toEqual([]);
        expect(strikes(second.next, [at('felt', 'sara')]).vacate).toEqual([]);
    });

    it('keeps a strike to the table it was earned at', () =>
    {
        const first = strikes(NOBODY, [at('felt', 'sara')]);
        const second = strikes(first.next, [at('felt', 'sara'), at('baize', 'sara'), at('felt', 'omid')]);

        expect(second.vacate).toEqual([at('felt', 'sara')]);
        expect(strikes(second.next, [at('baize', 'sara'), at('felt', 'omid')]).vacate).toEqual([at('baize', 'sara'), at('felt', 'omid')]);
    });

    it('suspects afresh somebody it stood up who is still in the chair, so a chair that would not come free is tried again', () =>
    {
        const first = strikes(NOBODY, [at('felt', 'sara')]);
        const second = strikes(first.next, [at('felt', 'sara')]);
        const third = strikes(second.next, [at('felt', 'sara')]);

        expect(third.vacate).toEqual([]);
        expect(strikes(third.next, [at('felt', 'sara')]).vacate).toEqual([at('felt', 'sara')]);
    });

    it('answers a new set and leaves the one it was handed as it was', () =>
    {
        const first = strikes(NOBODY, [at('felt', 'sara')]);
        const held = [...first.next];

        strikes(first.next, [at('felt', 'sara'), at('felt', 'omid')]);

        expect([...first.next]).toEqual(held);
        expect([...NOBODY]).toEqual([]);
    });

    it('is worked out by a module that imports nothing, with no clock in it', () =>
    {
        const source = read('domains', 'table', 'sweep.ts');

        expect(source).not.toMatch(/^\s*import\s/m);
        expect(source).not.toMatch(/\bfrom\s+['"]/);
        expect(source).not.toMatch(/\b(require|import)\s*\(/);
        expect(source).not.toMatch(/\bDate\b|setTimeout|setInterval/);
    });
});

describe('what runs the sweep of the waiting tables', () =>
{
    const main = read('main.ts');

    const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

    it('is the server, every thirty seconds, on a timer that is set again only when a sweep has finished', () =>
    {
        expect(main).toMatch(/const TABLE_SWEEP_MS = 30_000;/);
        expect(main).toMatch(/ports\.jobs\.sweepTables\(\)/);
        expect(main.match(/setTimeout\(sweepTables, TABLE_SWEEP_MS\)/g)).toHaveLength(2);
        expect(main).not.toMatch(/setInterval\(sweepTables/);
    });

    it('logs a sweep that failed and a chair that would not come free, and throws neither', () =>
    {
        const sweep = main.slice(main.indexOf('const sweepTables ='), main.indexOf('handleShutdownSignals('));

        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('table sweep failed'/);
        expect(sweep).toMatch(/log\.error\('chair not freed'/);
        expect(sweep).toMatch(/\.finally\(/);
    });

    it('is stopped on the way down, before the hub lets everybody go and has nobody left to call here', () =>
    {
        expect(shutdown).toMatch(/clearTimeout\(tables\);\s+tables = null;/);
        expect(shutdown.indexOf('clearTimeout(tables)')).toBeGreaterThan(-1);
        expect(shutdown.indexOf('clearTimeout(tables)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });

    it('is told everybody is here from the moment the server starts going down, never by a hub that has just let everybody go', () =>
    {
        expect(main).toMatch(/let goingDown = false;/);
        expect(main).toMatch(/buildPorts\(dataSource, config, hub, \{\s*present: \(userIds\) => goingDown \? new Set\(userIds\) : hub\.present\(userIds\)\s*\}\)/);
        expect(main).not.toMatch(/buildPorts\(dataSource, config, hub, hub\)/);
        expect(main.match(/goingDown = true;/g)).toHaveLength(1);
        expect(shutdown.indexOf('goingDown = true;')).toBeGreaterThan(-1);
        expect(shutdown.indexOf('goingDown = true;')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});
