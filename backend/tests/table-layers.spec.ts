import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../frontend/src/${ path }`, import.meta.url), 'utf8');

const SHEET = read('styles/app.css');

const LADDER = read('game/stage/layers.ts');

const rungs = [...LADDER.matchAll(/^ {4}([a-z]+): (\d+),?$/gm)].map((found) => ({ name: found[1], at: Number(found[2]) }));

describe('the layers of a table, in the stylesheet', () =>
{
    it('reads the ladder the renderers import', () =>
    {
        expect(rungs.map((rung) => rung.name)).toEqual(expect.arrayContaining(['piece', 'count', 'cube', 'moving', 'dice']));
        expect(rungs.map((rung) => rung.at)).toEqual([...rungs.map((rung) => rung.at)].sort((one, other) => one - other));
    });

    it('names only rungs the ladder has, and sets none of its own', () =>
    {
        const named = [...SHEET.matchAll(/var\(--layer-([a-z]+)\)/g)].map((found) => found[1]);

        expect(named.length).toBeGreaterThan(2);

        for (const name of named)
        {
            expect(rungs.map((rung) => rung.name), name).toContain(name);
        }

        expect(SHEET).not.toMatch(/--layer-[a-z]+\s*:/);
    });

    it('keeps the result above anything in flight, under names the theme does not use', () =>
    {
        const token = (name: string) => Number(new RegExp(`--stage-${ name }:\\s*(\\d+)`).exec(SHEET)?.[1]);

        expect(token('flight')).toBeGreaterThan(0);
        expect(token('result')).toBeGreaterThan(token('flight'));
        expect(SHEET).not.toMatch(/--z-(felt|seat|float|flight|result)\b/);
        expect(SHEET).toMatch(/\.table-stage\s*\{[^}]*isolation:\s*isolate/);
    });
});
