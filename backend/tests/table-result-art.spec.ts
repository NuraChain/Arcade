import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const base = readFileSync(new URL('../../frontend/src/styles/base.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const card = readFileSync(new URL('../../frontend/src/components/games/table-result.component.azeroth', import.meta.url), 'utf8');

const ruleOf = (selector: string) =>
{
    const at = sheet.indexOf(`\n${ selector }\n{`);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};

const spanOf = (rule: string) => Number(/\n    transition: opacity (\d+)ms var\(--ease-ui, ease\);/.exec(rule)?.[1] ?? Number.NaN);

describe('a result that leaves as it came', () =>
{
    const standing = ruleOf('.table-result');
    const folded = ruleOf('.table-result-tab');
    const leaving = ruleOf('.table-result[data-leaving],\n.table-result-tab[data-leaving]');

    it('comes and goes by one rule: its opacity, eased over a quarter of a second, from nothing and to nothing', () =>
    {
        expect(spanOf(standing)).toBe(240);
        expect(sheet, 'the card has nowhere to come from, so it is simply there').toMatch(/\n@starting-style\n\{\n    \.table-result\n    \{\n        opacity: 0;\n    \}\n\}/);
        expect(leaving.replace(/\s+/g, ' ')).toBe(' .table-result[data-leaving], .table-result-tab[data-leaving] { opacity: 0;');
    });

    it('goes from wherever it had got to, so a card taken away while it is still arriving is not drawn at full strength first', () =>
    {
        expect(`${ standing }${ folded }${ leaving }`).not.toMatch(/animation/);
        expect(sheet).not.toMatch(/@keyframes result-(in|out)/);
    });

    it('goes the same way when it is folded to its tab', () =>
    {
        expect(spanOf(folded)).toBe(spanOf(standing));
    });

    it('takes exactly as long as the board waits for it before it plays the opening of the next game', () =>
    {
        const waited = Number(/\nexport const RESULT_OUT = (\d+);\n/.exec(card)?.[1] ?? Number.NaN);

        expect(waited).toBe(spanOf(standing));
        expect(card, 'the card is taken away on some other count than the one the boards are handed').toContain('runtime().clock.after(RESULT_OUT, gone)');
    });

    it('is simply there, and simply gone, for somebody who asked for less motion', () =>
    {
        expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)\n\{\n    \*,\n    \*::before,\n    \*::after\n    \{\n        animation-duration: 0\.01ms !important;\n        animation-iteration-count: 1 !important;\n        transition-duration: 0\.01ms !important;/);
    });
});
