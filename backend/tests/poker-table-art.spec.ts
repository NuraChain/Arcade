import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../frontend/${ path }`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const sheet = read('src/styles/app.css');

const served = readdirSync(new URL('../../frontend/public/board/', import.meta.url)).map((name) => `/board/${ name }`);

const ruleOf = (selector: string) =>
{
    const alone = `\n${ selector }\n{`;
    let at = sheet.indexOf(alone);

    while (at > 0 && sheet[at - 1] === ',')
    {
        at = sheet.indexOf(alone, at + 1);
    }

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};

const sizeOf = (svg: string) => (/viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? []).slice(1).map(Number);

describe('the table a poker game is played on', () =>
{
    const rail = ruleOf('.poker-table::before');
    const cloth = ruleOf('.poker-table::after');
    const leather = Number(/\n    inset: ([\d.]+)cqmin;/.exec(cloth)?.[1]);
    const wood = Number(/\n    border: ([\d.]+)cqmin solid transparent;/.exec(cloth)?.[1]);

    it('is drawn from files the server has, and leaves none it does not draw', () =>
    {
        const asked = [...new Set([...sheet.matchAll(/url\('(\/board\/poker-[^']+)'\)/g)].map((found) => found[1]))].sort();

        expect(asked).toEqual(['/board/poker-felt.svg', '/board/poker-leather.svg', '/board/poker-medallion.svg', '/board/poker-wood.svg']);
        expect(asked.filter((path) => !served.includes(path)), 'the stylesheet asks for art that is not in public/board').toEqual([]);
        expect(served.filter((path) => path.startsWith('/board/poker-') && !asked.includes(path)), 'art in public/board that nothing draws').toEqual([]);
    });

    it('is a drawing and not a photograph, so its rail is as thick at any shape and sharp at any size', () =>
    {
        expect(served.filter((path) => path.startsWith('/board/poker-') && !path.endsWith('.svg'))).toEqual([]);
        expect(ruleOf('.poker-table::before,\n.poker-table::after')).toContain('border-radius: 999px;');
        expect(rail).not.toContain('border-image');
        expect(cloth).not.toContain('border-image');
    });

    it('has a rail that is not black: leather the colour of a saddle, stitched, with a brass bead where it meets the wood', () =>
    {
        const tones = [...rail.matchAll(/linear-gradient\(180deg, (#[0-9A-F]{6})/g)].map((found) => found[1]);
        const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt((tones[0] ?? '#000000').slice(at, at + 2), 16));

        expect(tones).toHaveLength(1);
        expect(red, 'the rail is dark again').toBeGreaterThan(120);
        expect(red).toBeGreaterThan(green);
        expect(green).toBeGreaterThan(blue);
        expect(rail).toMatch(/\n    outline: max\(1px, [\d.]+cqmin\) dashed /);
        expect(cloth).toMatch(/\n        0 0 0 max\(1px, [\d.]+cqmin\) #D2AC5F,/);
    });

    it('takes the room it is given, between a shape too tall and a shape too wide to be a table', () =>
    {
        const rule = ruleOf('.poker-stage .table-surface.poker-table');
        const wide = Number(/inline-size: min\(100cqw, 100cqh \* ([\d.]+)\);/.exec(rule)?.[1]);
        const tall = Number(/block-size: min\(100cqh, 100cqw \/ ([\d.]+)\);/.exec(rule)?.[1]);

        expect(rule).toContain('aspect-ratio: auto;');
        expect(wide, 'a phone turned over gives a room about three times as wide as it is tall, and the table has to take 70% of it').toBeGreaterThanOrEqual(2.3);
        expect(wide).toBeLessThanOrEqual(2.6);
        expect(tall).toBeGreaterThanOrEqual(0.45);
        expect(tall).toBeLessThanOrEqual(0.55);
    });

    it('stands its seats on the middle of the rail the stylesheet draws', () =>
    {
        const seats = Number(/export const RAIL = ([\d.]+);/.exec(read('src/game/poker-seats.ts'))?.[1]);

        expect(leather).toBeGreaterThan(0);
        expect(wood).toBeGreaterThan(0);
        expect((leather + wood) / 100, 'the rail the seats stand on is not the rail that is drawn').toBeCloseTo(seats, 6);
    });

    it('draws each grain at the size it was made, so no speck of it is stretched', () =>
    {
        for (const [file, rule] of [['poker-leather', rail], ['poker-felt', cloth], ['poker-wood', cloth]])
        {
            const drawn = new RegExp(`url\\('/board/${ file }\\.svg'\\) 0 0 / ([\\d.]+)rem ([\\d.]+)rem`).exec(rule);

            expect([Number(drawn?.[1]) * 16, Number(drawn?.[2]) * 16], file).toEqual(sizeOf(read(`public/board/${ file }.svg`)));
        }
    });

    it('draws the medallion in the middle at the scale of the table: a thousand of it is the shorter side', () =>
    {
        const [width, height] = sizeOf(read('public/board/poker-medallion.svg'));
        const drawn = /url\('\/board\/poker-medallion\.svg'\) center \/ ([\d.]+)cqmin ([\d.]+)cqmin no-repeat/.exec(cloth);

        expect(width).toBe(height);
        expect([Number(drawn?.[1]), Number(drawn?.[2])]).toEqual([width / 10, height / 10]);
    });

    it('draws the betting line inside the cloth, by an outline that follows the rail', () =>
    {
        const inside = Number(/\n    outline-offset: -([\d.]+)cqmin;/.exec(cloth)?.[1]);

        expect(cloth).toMatch(/\n    outline: max\(1px, [\d.]+cqmin\) solid /);
        expect(inside, 'the line lies on the wood').toBeGreaterThan(wood + 3);
        expect(inside).toBeLessThan(wood + 10);
    });
});

describe('what lies on a poker table', () =>
{
    const things = ruleOf('.poker-table > *');
    const numberOf = (name: string, rule: string) => new RegExp(`--${ name }: clamp\\(([\\d.]+)rem, var\\(--u\\) \\* ([\\d.]+), ([\\d.]+)rem\\);`).exec(rule)?.slice(1).map(Number) ?? [];

    it('is sized by a hundredth of the table\'s shorter side, between a floor and a ceiling', () =>
    {
        expect(sheet).toContain('@property --u\n{\n    syntax: \'<length>\';\n    inherits: true;\n    initial-value: 0px;\n}');
        expect(things).toContain('--u: 1cqmin;');

        for (const name of ['face', 'type', 'pill-w', 'col-w', 'back-w'])
        {
            const [floor, share, ceiling] = numberOf(name, things);

            expect(share, name).toBeGreaterThan(0);
            expect(ceiling, name).toBeGreaterThan(floor);
        }
    });

    it('is never written smaller than eleven pixels', () =>
    {
        expect(numberOf('type', things)[0] * 16).toBeGreaterThanOrEqual(11);
        expect(ruleOf('.poker-tally')).toMatch(/font-size: clamp\(0\.75rem, /);
        expect(ruleOf('.poker-blinds')).toContain('font-size: max(0.6875rem, 0.9em);');
        expect(ruleOf('.poker-puck')).toMatch(/font-size: clamp\(0\.6875rem, /);
    });

    it('gives the board a card of 44 pixels on a phone held upright, and of a twentieth of the table and more on a big screen', () =>
    {
        const upright = /--card-w: clamp\(([\d.]+)rem, min\(([\d.]+)cqw, ([\d.]+)cqh\), ([\d.]+)rem\);/.exec(ruleOf('.poker-centre'))?.slice(1).map(Number) ?? [];

        expect(upright[1] / 100 * 358, 'a board card on a table 358 wide').toBeGreaterThanOrEqual(44);
        expect(upright[1] * 5.36, 'five cards and their gaps are wider than the cloth between the rails').toBeLessThanOrEqual(100 - 2 * 10.7 - 2);
        expect(upright[3] * 16, 'the ceiling on a card stops it short of 5.5% of a table 1784 wide').toBeGreaterThanOrEqual(0.055 * 1784);
    });

    it('keeps the cards a seat holds in front of its plate, towards the felt, and a bet out of sight until it has been seated', () =>
    {
        const cards = ruleOf('.poker-backs');

        expect(cards).toContain('left: calc(50% + var(--ux) * (50% + var(--gap)));');
        expect(cards).toContain('top: calc(50% + var(--uy) * (50% + var(--gap)));');
        expect(cards).toContain('translate: calc((var(--ux) - 1) * 50%) calc((var(--uy) - 1) * 50%);');
        expect(ruleOf('.poker-bet:not([data-placed]),\n.poker-bet[data-landing],\n.poker-puck:not([data-placed])')).toContain('visibility: hidden;');
    });

    it('lays a plate along its rail: a row where the rail runs across, a column where it runs down', () =>
    {
        expect(ruleOf('.poker-seat[data-lies=\'flat\'] .table-plate')).toContain('grid-template-areas: \'face name\' \'face line\';');
        expect(ruleOf('.poker-seat[data-lies=\'upright\'] .table-plate')).toContain('grid-template-areas: \'face\' \'name\' \'line\';');
        expect(ruleOf('.poker-seat .table-plate:has(> .table-plate-tag) .table-plate-facts'), 'a tag and a stack are both drawn, and the plate grows by a line').toContain('visibility: hidden;');
    });

    it('has nothing in a corner: no rule is left for a chip or a clock that stood there', () =>
    {
        expect(sheet).not.toMatch(/\.table-corner|\.poker-chips|\.poker-chip\b|\.poker-bar-facts|\.poker-dealer/);
    });
});

describe('what the reader holds and presses at a poker table', () =>
{
    const rem = (rule: string, property: string) => Number(new RegExp(`\\n    ${ property }: ([0-9.]+)rem;`).exec(rule)?.[1]);

    it('keeps room in the reader\'s row for the things to press, so the table is the size it was when the turn comes', () =>
    {
        const row = rem(ruleOf('.poker-hand'), 'min-block-size');
        const disc = rem(ruleOf('.poker-disc'), 'block-size');
        const lamp = rem(ruleOf('.poker-side > .coach-line[data-lamp]'), 'margin-block-end');

        expect(disc).toBe(2.75);
        expect(row, 'the row is not as tall as the lamp that stands in it on the reader\'s turn').toBeCloseTo(disc + lamp, 5);
        expect(rem(ruleOf('.poker-muck'), 'block-size'), 'the fold is not the size of the chips beside it').toBe(disc);
    });

    it('keeps the reader\'s cards where they are when the things to press come and go: the cards have the middle column, and the column after them is as wide whatever stands in it', () =>
    {
        const row = ruleOf('.poker-hand');
        const side = ruleOf('.poker-side');
        const floor = /\n    grid-template-columns: minmax\(0, 1fr\) auto minmax\(min\(([0-9.]+)rem, 100% - 2 \* var\(--card-w\) - ([0-9.]+)rem\), 1fr\);/.exec(row);
        const lamp = rem(ruleOf(':is(.table-bar, .ludo-lamp, .poker-hand) .coach-line[data-lamp]'), 'inline-size');
        const needed = rem(side, 'margin-inline-start') + rem(ruleOf('.poker-acts'), 'min-inline-size') + rem(side, 'gap') + lamp;

        expect(row).toContain('display: grid;');
        expect(floor, 'the cards are not between two columns that share what is left, the second with a floor that does not depend on what is in it').not.toBeNull();
        expect(row, 'the row is one centred group again, and the cards move over when the things to press come').not.toContain('justify-content: center;');
        expect(row, 'a gap is kept before the cards on a narrow row, where there is nothing before them').not.toMatch(/\n    (column-)?gap:/);
        expect(Number(floor?.[1]), 'the column is not kept wide enough for three things, the lamp and a longer word under one of them').toBeGreaterThan(needed);
        expect(Number(floor?.[2]), 'on a narrow row the column is not all that the two cards leave').toBe(rem(ruleOf('.poker-hole'), 'gap'));
        expect(ruleOf('.poker-own')).toContain('grid-area: 1 / 2;');
        expect([side, side]).toEqual([expect.stringContaining('grid-area: 1 / 3;'), expect.stringContaining('justify-self: start;')]);
        expect(sheet, 'on a narrow stage the table reaches into the page\'s padding and the reader\'s row does not, so three things and the lamp run off a small phone').toContain(
            '    .poker-stage .table-fit,\n    .poker-stage .table-hand\n    {\n        margin-inline: calc(0.375rem - var(--page-pad, 1rem));\n    }'
        );
    });

    it('writes the name of the reader\'s hand without moving their cards: over them it takes no room of its own, and beside them on a low stage it has the column before theirs', () =>
    {
        const name = ruleOf('.poker-hand-name');
        const low = sheet.slice(sheet.indexOf('\n@container stage (max-height: 24rem)\n{\n    .poker-hand\n'));
        const beside = sheet.slice(sheet.indexOf('\n@container stage (max-height: 24rem)\n{\n    .poker-hand-name\n'));

        expect(name, 'a long name puts the reader\'s cards further from the edge than a short one').toContain('\n    inline-size: 0;\n    min-inline-size: 100%;');
        expect(name).toContain('text-align: center;');
        expect(name, 'the name is cut short at the width of two cards').not.toMatch(/overflow: hidden|text-overflow: ellipsis/);
        expect(ruleOf('.poker-hole')).toContain('grid-area: 1 / 2;');
        expect(low.slice(0, low.indexOf('\n}\n')), 'on a low stage the name and the cards are one box again, and the name moves the cards').toContain('    .poker-own\n    {\n        display: contents;\n    }');
        expect(beside.slice(0, beside.indexOf('\n}\n'))).toContain('grid-area: 1 / 1;\n        justify-self: end;');
        expect(beside.slice(0, beside.indexOf('\n}\n')), 'a long name on a low stage runs under the cards').toContain('max-inline-size: calc(100% - 0.5rem);\n        margin-inline-end: 0.5rem;\n        text-overflow: ellipsis;');
    });

    it('keeps the room of three things to press before the lamp, whether they are there or not, and opens the tip back over that room and never over the cards', () =>
    {
        const thing = rem(ruleOf('.poker-thing'), 'min-inline-size');
        const three = 3 * thing + 2 * rem(ruleOf('.poker-acts'), 'gap');
        const lamp = rem(ruleOf(':is(.table-bar, .ludo-lamp, .poker-hand) .coach-line[data-lamp]'), 'inline-size');
        const bubble = ruleOf('.poker-side > .coach-line[data-lamp][data-open] > span:last-child');
        const wide = Number(/\n    inline-size: min\(([0-9.]+)rem, 100cqw - 2rem\);/.exec(bubble)?.[1]);

        expect(rem(ruleOf('.poker-acts'), 'min-inline-size'), 'two things to press take less room than three, and the lamp moves').toBeCloseTo(three, 5);
        expect(rem(ruleOf('.poker-side::before'), 'inline-size'), 'the room kept while there is nothing to press is not the room of three things').toBeCloseTo(three, 5);
        expect(ruleOf('.poker-side:has(> .poker-acts)::before'), 'the room is kept beside the things it was kept for').toContain('display: none;');
        expect(ruleOf('.poker-side > .coach-line[data-lamp] > span:last-child'), 'the tip opens away from the things to press').toContain('inset-inline-end: 0;');
        expect(wide, 'the tip is wider than the things to press and the lamp, and lies over the reader\'s cards').toBeLessThanOrEqual(three + rem(ruleOf('.poker-side'), 'gap') + lamp);
    });

    it('draws the discs of a bet inside the box its dot had, one edge under the top disc for each disc more', () =>
    {
        const box = ruleOf('.chip-stack');
        const top = ruleOf('.chip-stack::before');
        const line = Number(/\n    line-height: ([\d.]+);/.exec(ruleOf('.poker-bet'))?.[1]);
        const face = Number(/\n    block-size: ([\d.]+)em;/.exec(top)?.[1]);
        const edges = [2, 3, 4, 5].map((discs) => [...ruleOf(`.chip-stack[data-chips='${ discs }']::before`).matchAll(/0 ([\d.]+)em 0 var\(--chip-(?:rim|band)\)/g)].map((found) => Number(found[1])));

        expect(box).toContain('inline-size: 0.85em;');
        expect(box).toContain('block-size: 0.85em;');
        expect(edges.map((one) => one.length)).toEqual([1, 2, 3, 4]);
        expect(edges[3], 'the edges do not go down by even steps').toEqual([0.14, 0.28, 0.42, 0.56]);
        expect(face + (edges[3].at(-1) ?? 0), 'five discs stand taller than the line of the pill they are in').toBeLessThanOrEqual(line);
        expect([2, 3, 4, 5].map((discs) => ruleOf(`.chip-stack[data-chips='${ discs }']`))).toEqual([2, 3, 4, 5].map((discs) => expect.stringContaining(`--chips: ${ discs };`)));
        expect(ruleOf('.chip-stack[data-chips=\'0\']::before'), 'no chips are drawn as one').toContain('content: none;');
    });

    it('has no rule left for cards that fold, or for the dot a bet wore', () =>
    {
        expect(sheet).not.toMatch(/\.poker-thing\[data-armed\]|\.poker-thing > \.poker-hole|\.poker-bet-disc/);
    });
});
