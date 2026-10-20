import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const plate = readFileSync(new URL('../../frontend/src/components/games/table-plate.component.azeroth', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ruleOf = (selector: string) =>
{
    const at = sheet.indexOf(`\n${ selector }\n{`);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};

describe('the press that lies over a plate', () =>
{
    const press = ruleOf('.table-plate-press');

    it('covers the plate it lies in and takes its shape, because the plate is what it is laid against', () =>
    {
        expect(ruleOf('.table-plate')).toContain('\n    position: relative;');
        expect(press).toContain('\n    position: absolute;');
        expect(press).toContain('\n    inset: 0;');
        expect(press).toContain('\n    border-radius: inherit;');
    });

    it('lies over what a seat pins to the edge of its plate, so a finger on the plate is on the press', () =>
    {
        const over = Number(/\n    z-index: (\d+);/.exec(press)?.[1] ?? Number.NaN);
        const pinned = Number(/\n    z-index: (\d+);/.exec(ruleOf('.hokm-seat > .hokm-clock'))?.[1] ?? Number.NaN);

        expect(ruleOf('.hokm-seat > .hokm-clock'), 'Hokm\'s clock no longer overlaps its plate, so this guards nothing').toContain('top: calc(100% - 0.3rem);');
        expect(over).toBeGreaterThan(pinned);
        expect(ruleOf('.table-plate')).not.toMatch(/\n    z-index:/);
    });

    it('is the last thing in the plate, so nothing drawn on a plate lies over it', () =>
    {
        expect(plate).toMatch(/<Show when=\{ theirs \}>\n\s+\{ \(\) => <button type="button" class="table-plate-press"[^\n]*<\/button> \}\n\s+<\/Show>\n    <\/div>\n\}\n$/);
    });

    it('grows to a finger\'s 44px where its plate is shorter, above and below only, and only for a finger', () =>
    {
        expect(sheet).toMatch(/\n@media \(pointer: coarse\)\n\{\n    \.table-plate-press::before\n    \{\n        content: '';\n        position: absolute;\n        inset: min\(0px, \(100% - 2\.75rem\) \/ 2\) 0;\n    \}\n\}/);
    });

    it('tells a mouse it can be pressed and answers a finger, and has no other rule than these', () =>
    {
        expect(press).toContain('\n    cursor: pointer;');
        expect(sheet).toMatch(/\n@media \(hover: hover\)\n\{\n    \.table-plate-press:hover\n    \{\n        background: rgb\(255 255 255 \/ 0\.07\);\n    \}\n\}/);
        expect(ruleOf('.table-plate-press:active')).toContain('\n    background: rgb(255 255 255 / 0.12);');
        expect(sheet.split('\n').filter((line) => line.includes('.table-plate-press')).map((line) => line.trim())).toEqual([
            '.table-plate-press',
            '.table-plate-press:active',
            '.table-plate-press:hover',
            '.table-plate-press::before'
        ]);
    });

    it('is left whole by every game\'s dressing of the plate: none clips it, and none takes away the box it is laid against', () =>
    {
        const dressed = [...sheet.matchAll(/\n([^\n{}]*\.table-plate(?:\[[^\]]*\])?(?:,\n[^\n{}]*)*)\n\s*\{([^}]*)\}/g)]
            .filter(([, selector, body]) => selector.trim() !== '.table-plate' && /overflow|clip-path|contain:|position:|display: contents/.test(body))
            .map(([, selector]) => selector.trim());

        expect(sheet.match(/\.table-plate\n/g)?.length ?? 0, 'the dressings were not found at all').toBeGreaterThan(10);
        expect(dressed).toEqual([]);
    });
});
