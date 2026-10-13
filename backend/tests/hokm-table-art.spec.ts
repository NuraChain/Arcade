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

describe('the hand a hokm reader holds', () =>
{
    const board = read('src/components/games/hokm-board.component.azeroth');
    const numberOf = (name: string) => Number((new RegExp(`const ${ name } = ([\\d.]+);`).exec(board) ?? [])[1]);
    const slot = ruleOf('.hokm-hand > li');
    const width = ruleOf('.hokm-hands');

    it('is fanned by moving and turning each card, on a step that is a length, so a card can slide to its place', () =>
    {
        expect(slot).toContain('left: 50%;');
        expect(slot).toContain('translate: calc((var(--i) - (var(--n) - 1) / 2) * var(--step) - var(--card-w) / 2)');
        expect(slot).toContain('--step: min(calc(var(--card-w) * 0.62), calc((100cqi - var(--card-w)) / max(1, var(--n) - 1)));');
        expect(/--step:[^;]*%/.test(slot), 'a step in percent is a percent of the card once it is in translate').toBe(false);
        expect(ruleOf('.hokm-hand')).toContain('container: fan / inline-size;');
    });

    it('lets go of the cards while the board slides them by hand, so nothing moves a card twice', () =>
    {
        expect(ruleOf('.hokm-hands[data-sliding=\'true\'] .hokm-hand > li')).toContain('transition: none;');
        expect(board).toContain('data-sliding={ sliding ? \'true\' : undefined }');
    });

    it('turns, pivots and takes as long as the board that moves it by hand believes', () =>
    {
        const tilt = Number((/rotate: calc\(var\(--t\) \* ([\d.]+)deg\);/.exec(slot) ?? [])[1]);
        const pivot = Number((/transform-origin: 50% ([\d.]+)%;/.exec(slot) ?? [])[1]);
        const lengths = [...slot.matchAll(/(translate|rotate) (\d+)ms/g)].map((found) => Number(found[2]));

        expect(tilt).toBe(numberOf('FAN_TILT'));
        expect((pivot - 50) / 100).toBeCloseTo(numberOf('FAN_PIVOT'), 6);
        expect(lengths).toEqual([numberOf('FAN_MS'), numberOf('FAN_MS')]);
    });

    it('is of cards a thumb can read on a phone, in one row or in two, at the width the board reckons its rows by', () =>
    {
        const clamp = /--hand-card: clamp\(max\(([\d.]+)rem, min\(([\d.]+)rem, ([\d.]+)cqb\)\), min\(([\d.]+)cqi, ([\d.]+)cqb \/ var\(--rows, 1\)\), ([\d.]+)rem\);/.exec(width);

        expect(clamp, 'the card\'s width is not the clamp the board mirrors, or its floor gives way in a second row').not.toBeNull();
        expect(Number(clamp?.[1]) * 16).toBeCloseTo(numberOf('CARD_MIN'), 6);
        expect(Number(clamp?.[2]) * 16).toBe(numberOf('CARD_FLOOR'));
        expect(Number(clamp?.[6]) * 16).toBe(numberOf('CARD_MAX'));
        expect(board).toContain(`Math.min(CARD_FLOOR, room.height * ${ Number(clamp?.[3]) / 100 })`);
        expect(board).toContain(`Math.min(room.width * ${ Number(clamp?.[4]) / 100 }, room.height * ${ Number(clamp?.[5]) / 100 })`);
    });

    it('has its width worked out once, where it is declared, from a floor in pixels', () =>
    {
        const registered = /@property --hand-card\n\{\n    syntax: '<length>';\n    inherits: true;\n    initial-value: (\d+)px;\n\}/.exec(sheet);

        expect(registered, 'unregistered, or with a floor in rem, the width is worked out again inside the fan and against it').not.toBeNull();
        expect(Number(registered?.[1])).toBe(numberOf('CARD_FLOOR'));
        expect(ruleOf('.hokm-hand')).toContain('--card-w: var(--hand-card);');
    });

    it('is pulled up under Sort and the lamp by the room a card that may be played leaves over itself, and no further', () =>
    {
        const pull = Number((/margin-block-start: (-[\d.]+)rem;/.exec(ruleOf('.hokm-foot > .hokm-hands')) ?? [])[1]);
        const head = Number((/top: ([\d.]+)rem;/.exec(slot) ?? [])[1]);
        const lift = Number((/translate: 0 (-[\d.]+)rem;/.exec(ruleOf('.card-hold[data-legal=\'true\'] .card-face')) ?? [])[1]);

        expect(pull, 'pulled further, a card that may be played stands in the row of the controls; pulled less, the table gives up height for nothing').toBeCloseTo(-(head + lift), 6);
    });

    it('keeps the swing of its end cards to itself where Sort and the lamp stand beside it', () =>
    {
        const beside = /@container foot \(min-width: [\d.]+rem\)\n\{\n    \.hokm-foot > \.hokm-hands\n    \{[^}]*?padding-inline: calc\(var\(--hand-card\) \* 288 \/ 204 \* ([\d.]+) \* sin\(([\d.]+)deg\)\);/.exec(sheet);

        expect(beside, 'the fan fills its column and its tilted end cards turn into the controls beside it').not.toBeNull();
        expect(Number(beside?.[1])).toBeCloseTo(numberOf('FAN_PIVOT') + 0.5, 6);
        expect(Number(beside?.[2])).toBe(numberOf('FAN_TILT'));
        expect(ruleOf('.hokm-hand')).toContain('--card-h: calc(var(--card-w) * 288 / 204);');
        expect(/padding/.test(ruleOf('.hokm-foot > .hokm-hands')), 'on a phone the swing goes into the gutter of the page, and room kept for it costs every card a sliver').toBe(false);
    });

    it('tones a card that cannot be played under a veil, and never drains its colour', () =>
    {
        expect(ruleOf('.card-hold[data-legal=\'false\'] .card-face::before')).toContain('opacity: 1;');
        expect(/\.card-hold[^{]*\{[^}]*filter:/.test(sheet), 'a filter on a card in the hand').toBe(false);
        expect(ruleOf('.card-hold .card-face')).toMatch(/transition: translate \d+ms/);
        expect(/box-shadow|filter/.test(ruleOf('.card-hold .card-face')), 'a face that animates its shadow or a filter is painted again every frame').toBe(false);
    });

    it('shows which cards may be played and which is lifted with a ring that fades in, on the card itself', () =>
    {
        expect(ruleOf('.card-hold[data-legal=\'true\'] .card-face::after')).toContain('opacity: 1;');
        expect(ruleOf('.hokm-hand .card-hold[data-picked=\'true\'] .card-face::after')).toContain('opacity: 1;');
        expect(ruleOf('.card-hold[data-legal=\'true\'] .card-face')).toContain('translate: 0 -0.55rem;');
    });

    it('keeps the room a hand will be dealt into, one row or two, and hides a card until it has been dealt', () =>
    {
        const kept = /min-block-size: calc\(var\(--rows, 1\) \* \(var\(--hand-card\) \* 288 \/ 204 \+ ([\d.]+)rem\) - \(var\(--rows, 1\) - 1\) \* var\(--hand-card\) \* 144 \/ 204\);/.exec(width);
        const row = /block-size: calc\(var\(--card-h\) \+ ([\d.]+)rem\);/.exec(ruleOf('.hokm-hand'));

        expect(kept, 'the room kept is not a whole row, or a second row does not lie half over the first').not.toBeNull();
        expect(Number(kept?.[1]), 'the room kept for a row is not the height of a row').toBe(Number(row?.[1]));
        expect(ruleOf('.hokm-hand + .hokm-hand')).toContain('margin-block-start: calc(var(--card-h) * -0.5);');
        expect(board, 'the card is sized by one count of rows and its room kept by another, or by a count that can be nought').toContain('style={ `--rows: ${ roomy }` }');
        expect(board).toContain('derived roomy = Math.max(1, rows.length,');
        expect(ruleOf('.hokm-hand > li[data-dealt=\'false\']')).toContain('visibility: hidden;');
        expect(board).toContain('data-dealt={ current && unseen.has(card) ? \'false\' : undefined }');
    });

    it('keeps the deck and the stock in their places and out of sight until a card of the hand before has reached them', () =>
    {
        const unseen = ruleOf('.hokm-deck[data-ghost=\'true\'],\n.hokm-stock[data-ghost=\'true\'],\n.hokm-stock-count[data-idle=\'true\']');

        expect(unseen, 'a thing that cards fly to is taken out of the layout while it waits, and they fly to nowhere').toContain('visibility: hidden;');
        expect(/display:/.test(unseen)).toBe(false);
        expect(board).toContain('<span class="hokm-deck" data-ghost={ ghost ? \'true\' : undefined }');
        expect(board).toContain('<div class="hokm-stock" data-live={ stockLive ? \'true\' : undefined } data-ghost={ ghost ? \'true\' : undefined }>');
        expect(board).toContain('class="hokm-chip hokm-stock-count" data-idle={ counted ? undefined : \'true\' }');
    });

    it('rests the deck where a card of the dealer\'s would lie, and stacks a packet and a turning card in one box', () =>
    {
        const placed = ruleOf('.hokm-trick,\n.hokm-deck');

        expect(placed).toContain('left: calc(50% + var(--dx) * var(--reach-x));');
        expect(placed).toContain('top: calc(var(--mid) + var(--dy) * var(--reach-y));');
        expect(ruleOf('.hokm-trick'), 'the deck is tilted like a played card').toContain('rotate: var(--tilt);');
        expect(/rotate/.test(ruleOf('.hokm-deck'))).toBe(false);
        expect(ruleOf('.board-flight > .flight:is(.stack, .turning) > :is(.card-face, .card-back)')).toContain('inset: 0;');
    });

    it('never takes a card away from the keyboard, and draws the keyboard\'s place on the card itself', () =>
    {
        const held = (/<button\s+type="button"\s+class="card-hold"[\s\S]*?>\s*<CardFace/.exec(board) ?? [''])[0];

        expect(held).toContain('aria-disabled={');
        expect(/\sdisabled=/.test(held), 'a disabled button cannot be given the keyboard, and loses it when it is disabled').toBe(false);
        expect(/\.card-hold[^\n{]*:(disabled|enabled)/.test(sheet), 'the stylesheet asks a card for a state it no longer has').toBe(false);
        expect(ruleOf('.card-hold[aria-disabled=\'true\']')).toContain('cursor: default;');
        expect(ruleOf('.card-hold:focus-visible')).toContain('outline: none;');
        expect(ruleOf('.card-hold:focus-visible .card-face::after'), 'the outline went and nothing was drawn in its place').toMatch(/box-shadow: [^;]*var\(--accent\)[^;]*;\n\s+opacity: 1;/);
        expect(ruleOf('.card-hold:focus-visible .card-face'), 'a card under the keyboard does not stand out of the fan').toMatch(/translate: 0 -[\d.]+rem;/);
    });
});
