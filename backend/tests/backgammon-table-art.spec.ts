import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ruleOf = (selector: string) =>
{
    const at = sheet.indexOf(`\n${ selector }\n{`);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};

const blockOf = (query: string) =>
{
    const at = sheet.indexOf(`\n${ query }\n{`);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}\n', at));
};

describe('the seats of a backgammon table', () =>
{
    const fit = ruleOf('.bg-stage .table-fit');
    const rail = ruleOf('.bg-rail');
    const beside = blockOf('@container stage (min-aspect-ratio: 4 / 3)');

    it('are rails as wide as the board, made of its wood and edged with its brass', () =>
    {
        expect(rail).toContain('\n    inline-size: var(--board-w);');
        expect(rail).toContain('\n    block-size: var(--rail);');
        expect(rail).toMatch(/\n    background: linear-gradient\(to bottom, [^;]*var\(--nard-frame\)/);
        expect(rail).toMatch(/\n    box-shadow: [^;]*var\(--nard-inlay\)/);
    });

    it('are as tall as the room lets them be, between a floor and a ceiling, and leave the board its shape', () =>
    {
        expect(ruleOf('.bg-board')).toContain('--ratio: 1.2195;');
        expect(fit).toContain('\n    --rail-min: 4rem;');
        expect(fit).toContain('\n    --rail-max: 7.5rem;');
        expect(fit).toContain('\n    --board-w: min(100cqw, (100cqh - 2 * var(--rail-min) - 2 * var(--gap)) * 1.2195);');
        expect(fit).toContain('\n    --rail: clamp(var(--rail-min), (100cqh - var(--board-w) / 1.2195 - 2 * var(--gap)) / 2, var(--rail-max));');
        expect(ruleOf('.bg-stage .table-fit > .table-surface')).toContain('inline-size: var(--board-w);');
    });

    it('stand the other side over the board and the reader under it', () =>
    {
        expect(ruleOf('.bg-rail:not([data-me])')).toContain('order: -1;');
        expect(ruleOf('.bg-rail[data-me]')).toContain('order: 1;');
    });

    it('stand beside the board, one over the other, where the stage is wide for its height, and the lot is centred', () =>
    {
        expect(beside).toContain('--board-w: min(100cqw - var(--side) - 0.75rem, 100cqh * 1.2195);');
        expect(beside).toContain('grid-template-columns: var(--board-w) var(--side);');
        expect(beside).toContain('grid-template-areas: \'board them\' \'board me\';');
        expect(beside).toContain('justify-content: center;');
        expect(beside).toContain('justify-self: stretch;');
    });

    it('have the stage whole: the column other tables keep beside them for words is taken back', () =>
    {
        const grid = ruleOf('.bg-grid');

        expect(grid).toContain('grid-template-columns: minmax(0, 1fr);');
        expect(grid).toContain('grid-template-areas: \'fit\';');
        expect(ruleOf('.bg-bar')).toContain('clip-path: inset(50%);');
    });

    it('write the pips at twenty pixels and more, and size the face by the rail', () =>
    {
        expect(ruleOf('.bg-pips > b')).toMatch(/\n    font-size: clamp\(1\.25rem, /);
        expect(fit).toContain('\n    --face: clamp(2rem, var(--rail) * 0.5, 3.25rem);');
        expect(ruleOf('.bg-rail .table-plate-avatar > [role=\'img\']')).toContain('inline-size: var(--face);');
    });

    it('open the tip from the lamp back along the rail, and from the whole card where the seats stand beside the board', () =>
    {
        expect(sheet.split(':is(.table-bar, .ludo-lamp, .poker-hand, .bg-rail) .coach-line[data-lamp]')).toHaveLength(4);
        expect(ruleOf('.bg-rail .coach-line[data-lamp] > span:last-child')).toContain('inset-inline: auto 0;');
        expect(beside).toMatch(/\n    \.bg-rail\n    \{\n        position: relative;/);
        expect(beside).toMatch(/\n    \.bg-rail \.coach-line\[data-lamp\]\n    \{\n        position: static;/);
    });

    it('lie side by side over the board while a chat sheet has half the screen, without a clock, a lamp or the word under the pips', () =>
    {
        expect(ruleOf('[data-sheet] .bg-stage .table-fit')).toContain('grid-template-areas: \'them me\' \'board board\';');
        expect(ruleOf('[data-sheet] .bg-clock,\n[data-sheet] .bg-rail .coach-line,\n[data-sheet] .bg-pips > small')).toContain('display: none;');
    });

    it('leave no rule behind for the two sets of plates there were', () =>
    {
        expect(sheet).not.toMatch(/\.bg-plate\b/);
        expect(sheet).not.toContain('--plates');
    });
});

describe('the cursor of a backgammon table', () =>
{
    const cursor = ruleOf('.bg-cursor');
    const stop = ruleOf('.bg-stop');
    const dice = ruleOf('.bg-stop[data-stop=\'dice\']');
    const valueOf = (rule: string, property: string) => new RegExp(`\\n    ${ property }: ([^;]+);`).exec(rule)?.[1] ?? '';

    it('lies over the whole board and measures by it, as the layer the dice are drawn in does', () =>
    {
        for (const rule of [cursor, ruleOf('.bg-layer')])
        {
            expect(rule).toContain('\n    position: absolute;');
            expect(rule).toContain('\n    inset: 0;');
            expect(rule).toContain('\n    container-type: inline-size;');
        }
    });

    it('takes no touch and no click from the board under it', () =>
    {
        expect(cursor).toContain('\n    pointer-events: none;');
        expect(stop).toContain('\n    pointer-events: none;');
        expect(sheet).not.toMatch(/\.bg-stop[^\n{]*\n\{[^}]*pointer-events: auto/);
    });

    it('shows nothing until a keyboard is on it, and then a ring drawn inside the stop', () =>
    {
        const held = ruleOf('.bg-stop:focus-visible');

        expect(stop).not.toMatch(/\n    (background|box-shadow|border|outline):/);
        expect(held).toMatch(/\n    box-shadow: inset 0 0 0 [^;]*var\(--accent\)/);
        expect(sheet).not.toContain('.bg-stop:focus\n');
    });

    it('keeps an outline no eye sees for a screen whose colours are forced, where a shadow is not drawn', () =>
    {
        const held = ruleOf('.bg-stop:focus-visible');

        expect(held).toMatch(/\n    outline: [^;]+ solid transparent;/);
        expect(valueOf(held, 'outline-offset')).toMatch(/\* -1\)$/);
        expect(sheet).not.toMatch(/\.bg-stop[^\n{]*\n\{[^}]*outline: none/);
    });

    it('has a stop for the dice the size of the place a finger presses them, measured as they are', () =>
    {
        const hit = ruleOf('.bgt-hit');

        expect(valueOf(hit, 'inline-size')).not.toBe('');
        expect([valueOf(dice, 'inline-size'), valueOf(dice, 'block-size'), valueOf(dice, 'translate')]).toEqual([valueOf(hit, 'inline-size'), valueOf(hit, 'block-size'), valueOf(hit, 'translate')]);
        expect(valueOf(ruleOf('.bgt-dice'), '--dice-em')).toMatch(/^clamp\(/);
        expect(valueOf(dice, 'font-size')).toBe(valueOf(ruleOf('.bgt-dice'), '--dice-em'));
    });
});
