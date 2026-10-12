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

const cut = (rule: string) =>
{
    const found = /border-image: url\('([^']+)'\) (\d+)( fill)? \/ ([\d.]+)cqmin stretch;/.exec(rule);

    return found === null ? null : { file: found[1], slice: Number(found[2]), fills: found[3] !== undefined, drawn: Number(found[4]) };
};

const boxOf = (svg: string) => (/viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? []).slice(1).map(Number);

describe('the table a hokm game is played on', () =>
{
    const photo = cut(ruleOf('.hokm-table::before'));
    const frame = cut(ruleOf('.hokm-table::after'));
    const medal = /background: url\('([^']+)'\) center \/ ([\d.]+)cqmin ([\d.]+)cqmin no-repeat;/.exec(ruleOf('.hokm-table::after'));

    it('is drawn from files the server has, and leaves none it does not draw', () =>
    {
        const asked = [...sheet.matchAll(/url\('(\/board\/hokm-[^']+)'\)/g)].map((found) => found[1]);

        expect(asked.length).toBeGreaterThanOrEqual(4);
        expect(asked.filter((path) => !served.includes(path)), 'the stylesheet asks for art that is not in public/board').toEqual([]);
        expect(served.filter((path) => path.startsWith('/board/hokm-') && !asked.includes(path)), 'art in public/board that nothing draws').toEqual([]);
    });

    it('is a photograph cut in nine, so its corners keep their shape on a table of any shape', () =>
    {
        expect(photo).toMatchObject({ file: '/board/hokm-table-tall.webp', fills: true });
        expect((photo?.slice ?? 0) / (photo?.drawn ?? 1), 'a thousand of the photograph is not the table\'s shorter side').toBe(10);
        expect(sheet).toContain('border-image-source: url(\'/board/hokm-table-wide.webp\');');
    });

    it('lays its gold thread and corner leaves over that at the same scale, and cuts them clear of the leaves', () =>
    {
        const svg = read('public/board/hokm-frame.svg');
        const [width, height] = boxOf(svg);
        const leaves = [...svg.matchAll(/translate\((\d+) (\d+)\) rotate\(\d+\) scale\(([\d.]+)\)/g)].map((found) => ({ x: Number(found[1]), scale: Number(found[3]) }));
        const reach = Math.max(...leaves.map((leaf) => Math.min(leaf.x, width - leaf.x) + 92 * leaf.scale));

        expect(frame).toMatchObject({ file: '/board/hokm-frame.svg', fills: false });
        expect([width, height]).toEqual([1000, 1000]);
        expect((frame?.slice ?? 0) / (frame?.drawn ?? 1)).toBe(width / 100);
        expect(leaves.length).toBe(4);
        expect(reach, 'a corner leaf is cut through by the slice').toBeLessThan(frame?.slice ?? 0);
        expect((frame?.slice ?? 0) * 2, 'the two corners meet and leave no edge to stretch').toBeLessThan(width);
    });

    it('draws the medallion in the middle at that scale too', () =>
    {
        const [width, height] = boxOf(read('public/board/hokm-medallion.svg'));

        expect(medal?.[1]).toBe('/board/hokm-medallion.svg');
        expect(width).toBe(height);
        expect(Number(medal?.[2])).toBe(width / 10);
        expect(Number(medal?.[3])).toBe(height / 10);
    });

    it('takes the room it is given, between a shape too tall and a shape too wide to be a table', () =>
    {
        const rule = ruleOf('.hokm-stage .table-surface.hokm-table');
        const wide = /inline-size: min\(100cqw, 100cqh \* ([\d.]+)\);/.exec(rule);
        const tall = /block-size: min\(100cqh, 100cqw \/ ([\d.]+)\);/.exec(rule);

        expect(rule).toContain('aspect-ratio: auto;');
        expect(Number(wide?.[1])).toBeGreaterThanOrEqual(2.4);
        expect(Number(tall?.[1])).toBeLessThanOrEqual(0.6);
        expect(Number(tall?.[1])).toBeGreaterThanOrEqual(0.5);
    });

    it('sizes a card on the felt by the table, a sixth of its shorter side or so', () =>
    {
        const trick = /--trick-w: min\(clamp\(([\d.]+)rem, ([\d.]+)cqmin, ([\d.]+)rem\),/.exec(sheet);

        expect(Number(trick?.[2]), 'a played card is under 15% of the table\'s shorter side').toBeGreaterThanOrEqual(15);
        expect(Number(trick?.[3]) * 16, 'the cap on a played card stops it growing on a table a desktop draws').toBeGreaterThanOrEqual(0.15 * 900);
    });
});
