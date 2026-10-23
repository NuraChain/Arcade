import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ruleOf = (selector: string, from = 0) =>
{
    const at = sheet.indexOf(`\n${ selector }\n{`, from);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};


describe('the table a waiting room is drawn as', () =>
{
    it('is a box of its own, laid out left to right in either language, with the chairs and the art its own children', () =>
    {
        const table = ruleOf('.lobby-table');

        expect(table).toContain('\n    position: relative;');
        expect(table).toContain('\n    isolation: isolate;');
        expect(table).toContain('\n    direction: ltr;');
        expect(table).toContain('\n    aspect-ratio: 5 / 6;');
        expect(ruleOf('.lobby')).toContain('\n    container: lobby / inline-size;');
    });

    it('lies wide where the room is, and the chairs grow with it', () =>
    {
        const at = sheet.indexOf('\n@container lobby (min-width: 34rem)\n{\n    .lobby-table\n    {');
        const wide = sheet.slice(at, sheet.indexOf('\n}', at));

        expect(at, 'the table never lies wide').toBeGreaterThan(-1);
        expect(wide).toContain('aspect-ratio: 16 / 9;');
        expect(wide).toMatch(/--chair-w: 6\.5rem;/);
    });

    it('draws a game\'s art in a box the game\'s own rules can measure, the chairs half on its edge', () =>
    {
        const top = ruleOf('.lobby-top');
        const ring = ruleOf('.lobby-ring');

        expect(top).toContain('\n    container-type: size;');
        expect(top).toContain('\n    inset: calc(var(--chair-h) / 2) calc(var(--chair-w) / 2);');
        expect(ring).toContain('\n    inset: calc(var(--chair-h) / 2) calc(var(--chair-w) / 2);');
        expect(sheet, 'the poker table no longer draws itself from the box it is given').toContain('\n.poker-table::before\n{');
        expect(sheet, 'the Hokm table no longer draws itself from the box it is given').toContain('\n.hokm-table::before\n{');
    });

    it('puts each chair at the point its seat is given, by its middle', () =>
    {
        const seat = ruleOf('.lobby-seat');

        expect(seat).toContain('\n    top: calc(var(--y) * 100%);');
        expect(seat).toContain('\n    left: calc(var(--x) * 100%);');
        expect(seat).toContain('\n    translate: -50% -50%;');
        expect(seat).toContain('\n    inline-size: var(--chair-w);');
        expect(seat).toContain('\n    block-size: var(--chair-h);');
    });

    it('gives a Ludo board on a wide table the height, with the chairs in the corners beside it, after the rule it has to beat', () =>
    {
        const narrow = sheet.indexOf('\n.lobby-table:is([data-game=\'ludo\'], [data-game=\'backgammon\'], [data-game=\'chess\']) .lobby-top\n{');
        const wide = sheet.indexOf('\n    .lobby-table[data-game=\'ludo\'] .lobby-top\n    {\n        inset: 0.75rem calc(var(--chair-w) + 0.75rem);');

        expect(narrow).toBeGreaterThan(-1);
        expect(wide, 'a wide Ludo table keeps its board between two rows of chairs').toBeGreaterThan(narrow);
    });

    it('lays a chess board between the two chairs, drawn from the board the table is played on', () =>
    {
        const board = ruleOf('.lobby-board[data-board=\'chess\']');

        expect(board).toContain('\n    background-image: url(\'/board/chess/board.svg\');');
        expect(board, 'the corner is the drawing\'s own').toContain('\n    border-radius: 2.2%;');
        expect(sheet.indexOf('\n.lobby-board[data-board=\'chess\']'), 'after the Ludo board it takes the place of').toBeGreaterThan(sheet.indexOf('\n.lobby-board\n{'));
    });

    it('rings a chair in its side\'s colour on a table two sides play at, as a plate is marked', () =>
    {
        expect(ruleOf('.lobby-chair[data-side=\'0\']')).toContain('\n    --ring: var(--accent);');
        expect(ruleOf('.lobby-chair[data-side=\'1\']')).toContain('\n    --ring: var(--gold);');
        expect(ruleOf('.table-plate-team')).toContain('\n    background: var(--accent);');
        expect(ruleOf('.table-plate-team[data-side=\'1\']')).toContain('\n    background: var(--gold);');
        expect(sheet.indexOf('\n.lobby-chair[data-side=\'0\']'), 'the side is coloured over by being ready').toBeGreaterThan(sheet.indexOf('\n.lobby-chair[data-state=\'ready\']'));
    });

    it('lets a person arrive and leave by what moves alone, turns the tick where it is, and keeps still where less motion is asked for', () =>
    {
        expect(ruleOf('.lobby-chair-seat')).toContain('\n    animation: chair-in 220ms var(--ease-ui, ease);');
        expect(ruleOf('.lobby-chair[data-leaving] .lobby-chair-seat')).toContain('\n    animation: chair-out 180ms var(--ease-ui, ease) forwards;');

        for (const name of ['chair-in', 'chair-out'])
        {
            const at = sheet.indexOf(`\n@keyframes ${ name }\n{`);
            const frames = sheet.slice(at, sheet.indexOf('\n}', at));

            expect(at, `${ name } is not there`).toBeGreaterThan(-1);
            expect(frames.match(/\n\s+([a-z-]+):/g)?.map((one) => one.trim().replace(':', '')).filter((one) => !['from', 'to'].includes(one)).sort(), `${ name } moves something a frame has to be laid out for`).toEqual(name === 'chair-in' ? ['opacity', 'scale', 'translate'] : ['opacity', 'scale']);
        }

        expect(sheet, 'the tick no longer turns where it is').toMatch(/\n\.lobby-chair-tick\n\{\n(?: {4}[^\n]*\n)* {4}transition: opacity 160ms ease, scale 200ms var\(--ease-ui, ease\);/);
        expect(sheet).toMatch(/\n@media \(prefers-reduced-motion: reduce\)\n\{\n    \.lobby-chair-seat,\n    \.lobby-chair\[data-leaving\] \.lobby-chair-seat\n    \{\n        animation: none;\n    \}/);
    });

    it('gives the cross that takes somebody out a finger\'s 44px, over the chair it is pinned to', () =>
    {
        expect(ruleOf('.lobby-chair-out')).toContain('\n    z-index: 2;');
        expect(ruleOf('.lobby-chair-out > button::before')).toContain('\n    inset: min(0px, (100% - 2.75rem) / 2);');
        expect(ruleOf('.lobby-chair-press')).toContain('\n    inset: 0;');
        expect(ruleOf('.lobby-chair-press'), 'the press of a chair lies over the cross').not.toMatch(/z-index/);
    });

    it('makes an empty chair to invite somebody to as large as the chair', () =>
    {
        const invite = ruleOf('.lobby-chair-seat[data-invites]');

        expect(invite).toContain('\n    inline-size: 100%;');
        expect(invite).toContain('\n    block-size: 100%;');
    });

    it('keeps the names of a crowded table for a screen reader when there is no room to draw them', () =>
    {
        const hidden = ruleOf('.lobby-table[data-crowd] .lobby-chair .table-plate-tag');

        expect(hidden).toContain('\n    clip-path: inset(50%);');
        expect(hidden).not.toMatch(/display: none|visibility: hidden/);
    });
});
