import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CELL, MARGIN, NEST, NEST_RADIUS, NEST_SPREAD, NEST_WELLS, RIM } from '../../application/src/game/layout.ts';
import { ENTRY, HOME_CELLS, RING, RING_CELLS, RING_STEPS, SAFE, ringIndex } from '../../server/src/domains/match/ludo/board.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'board');
const S = 1024;
const G = MARGIN * S;
const C = CELL * S;
const EDGE = RIM * S;

const round = (value) => Math.round(value * 100) / 100;

const INK = '#2A1E5C';

const PAPER = '#FFF4DC';

export const PAINT = {
    red: { fill: '#FF5A4E', light: '#FF9489', dark: '#D8372D', tint: '#FFD0CA', well: '#F2A79E' },
    green: { fill: '#2FC262', light: '#74DE96', dark: '#1B9646', tint: '#C6F0D3', well: '#8FD6A6' },
    yellow: { fill: '#FFC72C', light: '#FFE07A', dark: '#DE9C00', tint: '#FFEDB8', well: '#F2CF72' },
    blue: { fill: '#3F8CFF', light: '#86B6FF', dark: '#2463D1', tint: '#CCE0FF', well: '#96BDF5' }
};

const COLOURS = Object.keys(PAINT);

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

const WHITE = { fill: '#FFFFFF', light: '#FFFFFF', dark: '#E6D6B4' };

const LINE = 3;

const at = (col, row) => [round(G + col * C), round(G + row * C)];

function starPath(radius, inner = 0.5)
{
    const points = [];

    for (let index = 0; index < 10; index += 1)
    {
        const angle = -Math.PI / 2 + index * Math.PI / 5;
        const reach = index % 2 === 0 ? radius : radius * inner;

        points.push(`${ round(Math.cos(angle) * reach) } ${ round(Math.sin(angle) * reach) }`);
    }

    return `M${ points.join('L') }Z`;
}

function sticker(x, y, width, height, radius, paint, line, lift)
{
    return `<rect x="${ round(x) }" y="${ round(y + lift) }" width="${ round(width) }" height="${ round(height) }" rx="${ round(radius) }" fill="${ paint.dark }" stroke="${ INK }" stroke-width="${ line }"/>
<rect x="${ round(x) }" y="${ round(y) }" width="${ round(width) }" height="${ round(height) }" rx="${ round(radius) }" fill="${ paint.fill }" stroke="${ INK }" stroke-width="${ line }"/>
<rect x="${ round(x + line * 1.6) }" y="${ round(y + line * 1.6) }" width="${ round(width - line * 3.2) }" height="${ round(Math.min(height * 0.24, C * 0.34)) }" rx="${ round(Math.max(1, radius - line * 1.6)) }" fill="${ paint.light }" opacity="0.5"/>`;
}

function frame()
{
    const inner = round(S - EDGE * 2);

    const grain = [
        [0.18, 0.012], [0.46, 0.018], [0.74, 0.011],
        [0.3, 0.988], [0.62, 0.982], [0.86, 0.989]
    ].map(([u, v]) => `<path d="M${ round(u * S - 26) } ${ round(v * S) }h52" stroke="#B8662A" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`)
        .concat([[0.012, 0.3], [0.018, 0.64], [0.988, 0.38], [0.982, 0.72]]
            .map(([u, v]) => `<path d="M${ round(u * S) } ${ round(v * S - 26) }v52" stroke="#B8662A" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`))
        .join('\n');

    return `<rect x="5" y="9" width="${ S - 10 }" height="${ S - 12 }" rx="58" fill="#A85A22" stroke="${ INK }" stroke-width="6"/>
<rect x="5" y="5" width="${ S - 10 }" height="${ S - 14 }" rx="58" fill="#D9843F" stroke="${ INK }" stroke-width="6"/>
<rect x="18" y="14" width="${ S - 36 }" height="16" rx="8" fill="#F2AC6A" opacity="0.9"/>
${ grain }
<rect x="${ round(EDGE - 2) }" y="${ round(EDGE + 2) }" width="${ inner + 4 }" height="${ inner }" rx="24" fill="#8C4A1B"/>
<rect x="${ round(EDGE) }" y="${ round(EDGE) }" width="${ inner }" height="${ inner }" rx="22" fill="${ PAPER }" stroke="${ INK }" stroke-width="5"/>`;
}

function yard(colour)
{
    const [col, row] = CORNER[colour];
    const [x, y] = at(col, row);
    const paint = PAINT[colour];
    const gap = round(C * 0.24);
    const size = C * 6 - gap * 2;
    const cx = round(G + (col + NEST[colour][0]) * C);
    const cy = round(G + (row + NEST[colour][1]) * C);
    const reach = round(C * NEST_RADIUS);
    const seat = round(C * 0.36);

    const seats = NEST_WELLS.map(([dx, dy]) =>
    {
        const sx = round(cx + dx * NEST_SPREAD * C);
        const sy = round(cy + dy * NEST_SPREAD * C);

        return `<circle cx="${ sx }" cy="${ sy }" r="${ seat }" fill="${ paint.well }"/>
    <circle cx="${ sx }" cy="${ round(sy + 3.5) }" r="${ round(seat - 2) }" fill="${ paint.tint }"/>
    <circle cx="${ sx }" cy="${ sy }" r="${ seat }" fill="none" stroke="${ INK }" stroke-width="${ LINE }"/>`;
    }).join('\n    ');

    return `<g>
    ${ sticker(x + gap, y + gap, size, size, C * 0.55, paint, 4, 6) }
    <ellipse cx="${ round(x + gap + C * 0.62) }" cy="${ round(y + gap + C * 0.5) }" rx="${ round(C * 0.2) }" ry="${ round(C * 0.12) }" fill="#FFFFFF" opacity="0.85" transform="rotate(-30 ${ round(x + gap + C * 0.62) } ${ round(y + gap + C * 0.5) })"/>
    <circle cx="${ round(x + gap + C * 0.98) }" cy="${ round(y + gap + C * 0.36) }" r="${ round(C * 0.07) }" fill="#FFFFFF" opacity="0.85"/>
    <circle cx="${ cx }" cy="${ round(cy + 5) }" r="${ reach }" fill="${ paint.dark }" stroke="${ INK }" stroke-width="4"/>
    <circle cx="${ cx }" cy="${ cy }" r="${ reach }" fill="${ PAPER }" stroke="${ INK }" stroke-width="4"/>
    <circle cx="${ cx }" cy="${ cy }" r="${ round(reach - 9) }" fill="none" stroke="${ paint.tint }" stroke-width="5"/>
    ${ seats }
</g>`;
}

function tile(col, row, paint)
{
    const [x, y] = at(col, row);
    const gap = 2.6;

    return sticker(x + gap, y + gap, C - gap * 2, C - gap * 2 - 2.5, C * 0.2, paint, LINE, 2.5);
}

function star(col, row, fill)
{
    const [x, y] = at(col, row);
    const cx = round(x + C / 2);
    const cy = round(y + C / 2 - 1);

    return `<g transform="translate(${ cx } ${ cy })">
    <path d="${ starPath(C * 0.33) }" fill="${ fill }" stroke="${ INK }" stroke-width="${ LINE }" stroke-linejoin="round"/>
    <ellipse cx="${ round(-C * 0.07) }" cy="${ round(-C * 0.11) }" rx="${ round(C * 0.05) }" ry="${ round(C * 0.03) }" fill="#FFFFFF" opacity="0.9" transform="rotate(-30)"/>
</g>`;
}

function arrow(colour)
{
    const last = RING_CELLS[ringIndex(colour, RING_STEPS - 1)];
    const first = HOME_CELLS[colour][0];
    const turn = round((Math.atan2(first.row - last.row, first.col - last.col) * 180 / Math.PI + 360) % 360);
    const [x, y] = at(last.col, last.row);
    const u = C / 100;
    const path = `M${ round(-30 * u) } ${ round(-9 * u) }H${ round(2 * u) }V${ round(-24 * u) }L${ round(33 * u) } 0L${ round(2 * u) } ${ round(24 * u) }V${ round(9 * u) }H${ round(-30 * u) }Q${ round(-36 * u) } 0 ${ round(-30 * u) } ${ round(-9 * u) }Z`;

    return `<path d="${ path }" transform="translate(${ round(x + C / 2) } ${ round(y + C / 2 - 1) }) rotate(${ turn })" fill="${ PAINT[colour].fill }" stroke="${ INK }" stroke-width="${ LINE }" stroke-linejoin="round"/>`;
}

function centre()
{
    const [x, y] = at(6, 6);
    const gap = 2.6;
    const size = round(C * 3 - gap * 2);
    const x0 = round(x + gap);
    const y0 = round(y + gap);
    const x1 = round(x0 + size);
    const y1 = round(y0 + size);
    const mx = round(x0 + size / 2);
    const my = round(y0 + size / 2);
    const faces = [
        ['red', `${ x0 } ${ y0 } ${ x0 } ${ y1 } ${ mx } ${ my }`, `${ round(x0 + 8) } ${ round(y0 + 18) } ${ round(x0 + 8) } ${ round(my - 6) } ${ round(x0 + 24) } ${ round(my - 22) }`],
        ['green', `${ x0 } ${ y0 } ${ x1 } ${ y0 } ${ mx } ${ my }`, `${ round(x0 + 18) } ${ round(y0 + 8) } ${ round(mx - 6) } ${ round(y0 + 8) } ${ round(mx - 22) } ${ round(y0 + 24) }`],
        ['yellow', `${ x1 } ${ y0 } ${ x1 } ${ y1 } ${ mx } ${ my }`, `${ round(x1 - 8) } ${ round(y0 + 18) } ${ round(x1 - 8) } ${ round(my - 6) } ${ round(x1 - 24) } ${ round(my - 22) }`],
        ['blue', `${ x0 } ${ y1 } ${ x1 } ${ y1 } ${ mx } ${ my }`, `${ round(x0 + 18) } ${ round(y1 - 8) } ${ round(mx - 6) } ${ round(y1 - 8) } ${ round(mx - 22) } ${ round(y1 - 24) }`]
    ];

    return `<rect x="${ x0 }" y="${ round(y0 + 4) }" width="${ size }" height="${ size }" rx="14" fill="#8C6A3E" stroke="${ INK }" stroke-width="4"/>
<g clip-path="url(#centre-clip)">
    ${ faces.map(([colour, face, shine]) => `<polygon points="${ face }" fill="${ PAINT[colour].fill }" stroke="${ INK }" stroke-width="${ LINE }" stroke-linejoin="round"/>
    <polygon points="${ shine }" fill="${ PAINT[colour].light }" opacity="0.6"/>`).join('\n    ') }
</g>
<rect x="${ x0 }" y="${ y0 }" width="${ size }" height="${ size }" rx="14" fill="none" stroke="${ INK }" stroke-width="4"/>
<circle cx="${ mx }" cy="${ round(my + 3) }" r="${ round(C * 0.62) }" fill="#C9A45C" stroke="${ INK }" stroke-width="4"/>
<circle cx="${ mx }" cy="${ my }" r="${ round(C * 0.62) }" fill="${ PAPER }" stroke="${ INK }" stroke-width="4"/>
<g transform="translate(${ mx } ${ round(my + 1) })">
    <path d="${ starPath(C * 0.44, 0.48) }" fill="#FFC72C" stroke="${ INK }" stroke-width="${ LINE }" stroke-linejoin="round"/>
    <ellipse cx="${ round(-C * 0.1) }" cy="${ round(-C * 0.15) }" rx="${ round(C * 0.07) }" ry="${ round(C * 0.04) }" fill="#FFFFFF" opacity="0.9" transform="rotate(-30)"/>
</g>`;
}

function ludoBoard()
{
    const starts = new Map(COLOURS.map((colour) => [ENTRY[colour], colour]));
    const tiles = [];
    const marks = [];

    RING_CELLS.forEach((cell, index) =>
    {
        const owner = starts.get(index);

        if (owner !== undefined)
        {
            tiles.push(tile(cell.col, cell.row, PAINT[owner]));
            marks.push(star(cell.col, cell.row, '#FFFFFF'));
            return;
        }

        tiles.push(tile(cell.col, cell.row, WHITE));

        if (SAFE.includes(index))
        {
            marks.push(star(cell.col, cell.row, PAINT[ARM(cell.col, cell.row)].fill));
        }
    });

    for (const colour of COLOURS)
    {
        for (const cell of HOME_CELLS[colour])
        {
            tiles.push(tile(cell.col, cell.row, PAINT[colour]));
        }

        marks.push(arrow(colour));
    }

    const [cx, cy] = at(6, 6);
    const csize = round(C * 3 - 5.2);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ S } ${ S }" width="${ S }" height="${ S }">
<defs>
<clipPath id="centre-clip"><rect x="${ round(cx + 2.6) }" y="${ round(cy + 2.6) }" width="${ csize }" height="${ csize }" rx="14"/></clipPath>
</defs>
${ frame() }
${ COLOURS.map(yard).join('\n') }
${ tiles.join('\n') }
${ centre() }
${ marks.join('\n') }
</svg>
`;
}

function pawn(colour)
{
    const paint = PAINT[colour];
    const line = 9;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<g stroke="${ INK }" stroke-width="${ line }" stroke-linejoin="round" stroke-linecap="round">
    <ellipse cx="128" cy="203" rx="80" ry="28" fill="${ paint.dark }"/>
    <ellipse cx="128" cy="191" rx="80" ry="28" fill="${ paint.fill }"/>
    <path d="M60 190C68 154 86 128 96 110H160C170 128 188 154 196 190C176 207 80 207 60 190Z" fill="${ paint.fill }"/>
    <ellipse cx="128" cy="109" rx="44" ry="15" fill="${ paint.dark }"/>
    <circle cx="128" cy="62" r="56" fill="${ paint.fill }"/>
</g>
<path d="M162 120C174 142 184 164 188 188C178 196 168 198 158 199C156 172 154 146 150 122Z" fill="${ paint.dark }" opacity="0.5"/>
<path d="M80 184C84 160 94 140 106 124" stroke="${ paint.light }" stroke-width="11" stroke-linecap="round" fill="none"/>
<path d="M177 35A56 56 0 0 1 152 113A52 52 0 0 0 177 35Z" fill="${ paint.dark }" opacity="0.45"/>
<path d="M88 46A44 44 0 0 1 120 18" stroke="${ paint.light }" stroke-width="12" stroke-linecap="round" fill="none"/>
<ellipse cx="104" cy="36" rx="12" ry="8" fill="#FFFFFF" transform="rotate(-30 104 36)"/>
<path d="M66 196C88 209 168 209 190 196" stroke="${ paint.light }" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.8"/>
</svg>
`;
}

function pawnShadow()
{
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 128" width="256" height="128">
<ellipse cx="136" cy="54" rx="80" ry="26" fill="${ INK }" opacity="0.32"/>
</svg>
`;
}

const PIP_GRID = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
};

function dice()
{
    const size = 180;
    const faces = [1, 2, 3, 4, 5, 6].map((value, index) =>
    {
        const x = index * 256 + (256 - size) / 2;
        const y = (256 - size) / 2 - 6;
        const cx = x + size / 2;
        const cy = y + size / 2;
        const pips = PIP_GRID[value]
            .map(([u, v]) => `<circle cx="${ round(cx + u * size * 0.27) }" cy="${ round(cy + v * size * 0.27) }" r="${ round(size * 0.085) }" fill="${ INK }"/>`)
            .join('');

        return `<g>
    <rect x="${ x }" y="${ y + 12 }" width="${ size }" height="${ size }" rx="40" fill="#E6D6B4" stroke="${ INK }" stroke-width="8"/>
    <rect x="${ x }" y="${ y }" width="${ size }" height="${ size }" rx="40" fill="#FFFFFF" stroke="${ INK }" stroke-width="8"/>
    <rect x="${ x + 16 }" y="${ y + 14 }" width="${ size - 32 }" height="30" rx="15" fill="#FFF4DC"/>
    ${ pips }
    <ellipse cx="${ x + 40 }" cy="${ y + 30 }" rx="12" ry="7" fill="#FFFFFF" transform="rotate(-30 ${ x + 40 } ${ y + 30 })"/>
</g>`;
    }).join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 256" width="2048" height="256">
${ faces }
</svg>
`;
}

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

writeFileSync(join(OUT, 'ludo-board.svg'), ludoBoard());
console.log('board ludo-board.svg');

for (const colour of COLOURS)
{
    writeFileSync(join(OUT, `pawn-${ colour }.svg`), pawn(colour));
    console.log(`board pawn-${ colour }.svg`);
}

writeFileSync(join(OUT, 'pawn-shadow.svg'), pawnShadow());
console.log('board pawn-shadow.svg');

writeFileSync(join(OUT, 'ludo-dice.svg'), dice());
console.log('board ludo-dice.svg');
