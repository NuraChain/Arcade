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
        const lamp = rem(ruleOf('.poker-hand > .coach-line[data-lamp]'), 'margin-block-end');

        expect(disc).toBe(2.75);
        expect(row, 'the row is not as tall as the lamp that stands in it on the reader\'s turn').toBeCloseTo(disc + lamp, 5);
        expect(rem(ruleOf('.poker-muck'), 'block-size'), 'the fold is not the size of the chips beside it').toBe(disc);
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
