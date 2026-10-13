import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ruleOf = (selector: string) =>
{
    const at = sheet.indexOf(`\n${ selector }\n{`);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};

const framesOf = (name: string) =>
{
    const at = sheet.indexOf(`\n@keyframes ${ name }\n{`);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}\n', at));
};

describe('a table that arrives', () =>
{
    const stage = ruleOf('.table-stage');
    const arriving = framesOf('stage-in');

    it('comes in over a quarter of a second, fading in as it rises into its place', () =>
    {
        expect(stage).toContain('\n    animation: stage-in 240ms var(--ease-ui, ease);');
        expect(arriving).toContain('opacity: 0;');
        expect(arriving).toContain('translate: 0 0.5rem;');
        expect(arriving, 'the table also has somewhere to arrive at written down, and can stop short of its own place').not.toMatch(/\n    to\n|\n    100%\n/);
    });

    it('is never scaled or turned on its way: what flies over it is measured on the screen, and a smaller table is another measure', () =>
    {
        expect(arriving).not.toBe('');
        expect(arriving).not.toMatch(/scale|rotate|transform/);
    });

    it('does not hold its last frame, so nothing takes a table that has arrived for one that is moving', () =>
    {
        expect(stage).not.toMatch(/\n    animation: [^;]*\b(both|forwards)\b/);
    });

    it('simply stands there for somebody who asked for less motion', () =>
    {
        expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)\n\{\n    \.table-plate-bubble,\n    \.table-result,\n    \.table-stage\n    \{\n        animation: none;\n    \}/);
    });
});
