import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CELL, MARGIN, NEST, NEST_RADIUS, NEST_SPREAD, NEST_WELLS, RIM } from '../../application/src/game/layout.ts';
import { ENTRY, HOME_CELLS, RING, RING_CELLS, RING_STEPS, SAFE, ringIndex } from '../../server/src/domains/match/ludo/board.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'board');

const round = (value) => Math.round(value * 100) / 100;

export const LUDO_INK = {
    red: { base: '#E5392F', shade: '#B01A14', deep: '#72100C', keyline: '#4A0806', tint: '#ED9E96' },
    green: { base: '#1FA24C', shade: '#0E7A36', deep: '#075022', keyline: '#033317', tint: '#94CDA3' },
    yellow: { base: '#F7B814', shade: '#D48A0C', deep: '#A45F04', keyline: '#6B3C02', tint: '#F5D78A' },
    blue: { base: '#2270E6', shade: '#0A4DB0', deep: '#062F74', keyline: '#041D4D', tint: '#96B7E8' }
};

const COLOURS = Object.keys(LUDO_INK);

const CORNER = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };

const ARM = (col, row) =>
{
    if (row < 6)
    {
        return 'green';
    }

    if (row > 8)
    {
        return 'blue';
    }

    return col < 6 ? 'red' : 'yellow';
};

function flourish()
{
    return 'M0 0C38 0 64 10 84 30C66 22 48 20 30 24C44 34 50 48 48 64C40 50 28 42 12 40C22 58 22 76 12 92C8 70 4 46 0 0Z'
        + 'M22 8C44 10 60 18 70 30M8 22C10 44 18 60 30 70';
}

function hokmOrnaments(width, height)
{
    const rim = Math.round(Math.min(width, height) * 0.045);
    const lip = Math.round(rim * 0.35);
    const fx = rim + lip;
    const fw = width - fx * 2;
    const fh = height - fx * 2;
    const inset = Math.round(Math.min(fw, fh) * 0.045);
    const cx = width / 2;
    const cy = height / 2;
    const medal = Math.round(Math.min(fw, fh) * 0.2);
    const corners = [
        [fx + inset, fx + inset, 0],
        [width - fx - inset, fx + inset, 90],
        [width - fx - inset, height - fx - inset, 180],
        [fx + inset, height - fx - inset, 270]
    ];
    const petals = Array.from({ length: 8 }, (_, index) =>
        `<ellipse cx="0" cy="${ -medal * 0.52 }" rx="${ round(medal * 0.13) }" ry="${ round(medal * 0.36) }" transform="rotate(${ index * 45 })"/>`).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ width } ${ height }" width="${ width }" height="${ height }">
<defs>
<path id="flourish" d="${ flourish() }"/>
</defs>
<rect x="${ fx + inset }" y="${ fx + inset }" width="${ fw - inset * 2 }" height="${ fh - inset * 2 }" rx="${ rim * 0.5 }" fill="none" stroke="#D9B45A" stroke-opacity="0.34" stroke-width="2.5"/>
<rect x="${ fx + inset + 8 }" y="${ fx + inset + 8 }" width="${ fw - inset * 2 - 16 }" height="${ fh - inset * 2 - 16 }" rx="${ rim * 0.4 }" fill="none" stroke="#D9B45A" stroke-opacity="0.14" stroke-width="1.5"/>
${ corners.map(([x, y, turn]) => `<use href="#flourish" transform="translate(${ x } ${ y }) rotate(${ turn }) scale(${ round(Math.min(fw, fh) / 700) })" fill="#D9B45A" fill-opacity="0.3" stroke="#D9B45A" stroke-opacity="0.26" stroke-width="2"/>`).join('\n') }
<g transform="translate(${ cx } ${ cy })">
    <circle r="${ medal }" fill="#0B4227" fill-opacity="0.22" stroke="#D9B45A" stroke-opacity="0.3" stroke-width="3"/>
    <circle r="${ round(medal * 0.9) }" fill="none" stroke="#D9B45A" stroke-opacity="0.16" stroke-width="1.5" stroke-dasharray="3 7"/>
    <g fill="#D9B45A" fill-opacity="0.06" stroke="#D9B45A" stroke-opacity="0.13" stroke-width="1.5">${ petals }</g>
</g>
</svg>
`;
}

if (RING_CELLS.length !== RING)
{
    throw new Error(`the ring has ${ RING_CELLS.length } cells`);
}

writeFileSync(join(OUT, 'hokm-ornaments-wide.svg'), hokmOrnaments(1600, 1000));
console.log('board hokm-ornaments-wide.svg');
writeFileSync(join(OUT, 'hokm-ornaments-tall.svg'), hokmOrnaments(1000, 1200));
console.log('board hokm-ornaments-tall.svg');

const startOf = new Map(COLOURS.map((colour) => [ENTRY[colour], colour]));

const geometry = {
    margin: MARGIN,
    cell: CELL,
    rim: RIM,
    ring: RING_CELLS.map((cell, index) => ({
        col: cell.col,
        row: cell.row,
        start: startOf.get(index) ?? null,
        safe: SAFE.includes(index) && !startOf.has(index) ? ARM(cell.col, cell.row) : null
    })),
    home: Object.fromEntries(COLOURS.map((colour) => [colour, HOME_CELLS[colour].map((cell) => [cell.col, cell.row])])),
    arrows: COLOURS.map((colour) =>
    {
        const last = RING_CELLS[ringIndex(colour, RING_STEPS - 1)];
        const first = HOME_CELLS[colour][0];

        return { colour, col: last.col, row: last.row, dx: first.col - last.col, dy: first.row - last.row };
    }),
    corners: CORNER,
    nest: NEST,
    nestRadius: NEST_RADIUS,
    nestSpread: NEST_SPREAD,
    wells: NEST_WELLS,
    ink: LUDO_INK
};

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'blender', 'ludo-geometry.json'), JSON.stringify(geometry, null, 1) + '\n');
console.log('board ludo-geometry.json');
