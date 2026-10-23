import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FIELD, FRAME, SIZE, SQUARE } from '../../frontend/src/game/chess-layout.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const tokens = readFileSync(new URL('../../frontend/src/styles/tokens.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const art = new URL('../../frontend/public/board/chess/', import.meta.url);

const ruleOf = (selector: string) =>
{
    const at = sheet.indexOf(`\n${ selector }\n{`);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};

/** The block a query opens round rules about `holding`, where other tables open the same query. */
const blockOf = (query: string, holding: string) =>
{
    for (let at = sheet.indexOf(`\n${ query }\n{`); at !== -1; at = sheet.indexOf(`\n${ query }\n{`, at + 1))
    {
        const block = sheet.slice(at, sheet.indexOf('\n}\n', at));

        if (block.includes(holding))
        {
            return block;
        }
    }

    return '';
};

const PIECES = ['k', 'q', 'r', 'b', 'n', 'p'].flatMap((kind) => ['w', 'b'].map((side) => `${ side }${ kind }`));

describe('the chess set the board is drawn in', () =>
{
    it('is twelve pieces and a board, every one of them drawn by the stylesheet and nothing else left over', () =>
    {
        const files = readdirSync(art).sort();

        expect(files).toEqual([...PIECES.map((name) => `${ name }.svg`), 'board.svg'].sort());

        for (const name of PIECES)
        {
            expect(ruleOf(`:is(.cp, .chess-promote-piece, .chess-taken > i, .chess-figure)[data-piece='${ name }']`), name).toContain(`background-image: url('/board/chess/${ name }.svg');`);
        }

        expect(ruleOf('.chess-wood')).toContain("background: url('/board/chess/board.svg') center / 100% 100% no-repeat;");
        expect(existsSync(new URL('board.svg', art))).toBe(true);
    });

    it('lays the squares out on the board the art was drawn on', () =>
    {
        const board = readFileSync(new URL('board.svg', art), 'utf8');

        expect(FIELD).toBe(SIZE - 2 * FRAME);
        expect(SQUARE * 8).toBe(FIELD);
        expect(board).toContain(`viewBox="0 0 ${ SIZE } ${ SIZE }"`);
        expect(board).toContain(`<rect x="${ FRAME }" y="${ FRAME }" width="${ FIELD }" height="${ FIELD }" fill="none"`);
    });

    it('is a printed board that does not mirror, and lays its pieces in its own width', () =>
    {
        expect(ruleOf('.chess-wood')).toContain('\n    direction: ltr;');
        expect(ruleOf('.chess-layer')).toContain('\n    container-type: inline-size;');
        expect(ruleOf('.cp')).toContain('\n    inline-size: var(--sq);');
        expect(ruleOf('.cp')).toContain('\n    left: 0;');
        expect(ruleOf('.chess-tray')).toContain('\n    direction: ltr;');
        expect(ruleOf('.chess-clock')).toContain('\n    direction: ltr;');
    });

    it('marks a square under the pieces that stand on it', () =>
    {
        expect(ruleOf('.cp')).toContain('\n    z-index: var(--layer-piece);');
        expect(ruleOf('.cmk')).toContain('\n    z-index: calc(var(--layer-piece) - 1);');
    });

    it('is coloured from tokens of its own', () =>
    {
        for (const token of ['--chess-frame', '--chess-inlay', '--chess-light', '--chess-ink'])
        {
            expect(tokens, token).toMatch(new RegExp(`\\n    ${ token }: #[0-9A-F]{6};`));
        }

        expect(ruleOf('.chess-rail')).toMatch(/\n    background: linear-gradient\(to bottom, [^;]*var\(--chess-frame\)/);
        expect(ruleOf('.chess-rail')).toMatch(/\n    box-shadow: [^;]*var\(--chess-inlay\)/);
    });
});

describe('the sides of a chess table', () =>
{
    const fit = ruleOf('.chess-stage .table-fit');
    const beside = blockOf('@container stage (min-aspect-ratio: 4 / 3)', '.chess-stage');

    it('are rails as wide as a square board, the other side over it and the reader under it', () =>
    {
        expect(ruleOf('.chess-board')).toContain('--ratio: 1;');
        expect(fit).toContain('\n    --board-w: min(100cqw, 100cqh - 2 * var(--rail-min) - 2 * var(--gap));');
        expect(fit).toContain('\n    --rail: clamp(var(--rail-min), (100cqh - var(--board-w) - 2 * var(--gap)) / 2, var(--rail-max));');
        expect(ruleOf('.chess-stage .table-fit > .table-surface')).toContain('inline-size: var(--board-w);');
        expect(ruleOf('.chess-rail')).toContain('\n    inline-size: var(--board-w);');
        expect(ruleOf('.chess-rail:not([data-me])')).toContain('order: -1;');
        expect(ruleOf('.chess-rail[data-me]')).toContain('order: 1;');
    });

    it('stand beside the board, one over the other, where the stage is wide for its height', () =>
    {
        expect(beside).toContain('\n    .chess-stage :is(.table-fit, .table-result-tab)\n    {\n        --side: clamp(11rem, 26cqw, 17rem);');
        expect(beside).toContain('--room: calc(100cqw - var(--beside, 0px));');
        expect(beside).toContain('--board-w: min(var(--room) - var(--side) - 0.75rem, 100cqh);');
        expect(beside).toContain("grid-template-areas: 'board them' 'board me';");
        expect(beside).toContain('justify-content: center;');
        expect(beside).toMatch(/\n    \.chess-stage \.table-fit > \.table-surface\n    \{[^}]*\n        inline-size: 100%;/);
    });

    it('give a chat beside a sideways phone its room, so both clocks stay out from under it', () =>
    {
        expect(ruleOf('[data-beside] .chess-stage .table-fit')).toContain('\n    padding-inline-end: var(--beside);');
        expect(beside).toContain('\n    [data-beside] .chess-stage :is(.table-fit, .table-result-tab)\n    {\n        --side: 8.5rem;');
        expect(ruleOf('[data-beside] .chess-tray,\n[data-beside] .chess-offer,\n[data-beside] .chess-rail .coach-line')).toContain('display: none;');
    });

    it('fold the result into a tab between the two rails, never over the board', () =>
    {
        expect(beside).toMatch(/\n    \.chess-stage > \.table-result-tab\n    \{[^}]*\n        inset-inline-end: calc\(var\(--beside, 0px\) \+ \(var\(--room\) - var\(--board-w\) - 0\.75rem - var\(--side\)\) \/ 2\);[^}]*\n        inline-size: var\(--side\);[^}]*\n        translate: 0 -50%;/);
    });

    it('share one row over the board while the chat is open beside it', () =>
    {
        expect(ruleOf('[data-sheet] .chess-stage .table-fit')).toContain("grid-template-areas: 'them me' 'board board';");
    });

    it('light the clock that is running, and turn it red when it runs low', () =>
    {
        expect(ruleOf('.chess-clock[data-running]')).toContain('background: var(--chess-light);');
        expect(ruleOf('.chess-clock[data-low]')).toContain('color: var(--danger);');
    });
});

describe('the rules coach on a chess rail', () =>
{
    it('is the lamp every table draws, opening back along the rail and from the whole rail beside the board', () =>
    {
        expect(ruleOf(':is(.table-bar, .ludo-lamp, .poker-hand, .bg-rail, .chess-rail) .coach-line[data-lamp]')).toContain('inline-size: 2.75rem;');
        expect(ruleOf('.chess-rail .coach-line[data-lamp] > span:last-child')).toContain('inset-inline: auto 0;');
        expect(blockOf('@container stage (min-aspect-ratio: 4 / 3)', '.chess-stage')).toMatch(/\n    \.chess-rail \.coach-line\[data-lamp\]\n    \{\n        position: static;/);
    });

    it('goes while a half sheet shares the stage', () =>
    {
        expect(ruleOf('[data-sheet] .chess-tray,\n[data-sheet] .chess-rail .chess-first,\n[data-sheet] .chess-offer,\n[data-sheet] .chess-rail .coach-line')).toContain('display: none;');
    });
});
