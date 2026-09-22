import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CELL, MARGIN, RIM } from '../../application/src/game/layout.ts';
import { ENTRY, HOME_CELLS, RING_CELLS, RING_STEPS, SAFE } from '../../server/src/domains/match/ludo/board.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'board');
const S = 1024;
const G = MARGIN * S;
const C = CELL * S;
const EDGE = RIM * S;
const GAP = 2.6;

const round = (value) => Math.round(value * 100) / 100;

export const LUDO_INK = {
    red: { light: '#FF7A6B', base: '#E5392F', dark: '#AD1F1B', deep: '#7A1411' },
    green: { light: '#5BD98A', base: '#1FA24C', dark: '#137535', deep: '#0B5023' },
    yellow: { light: '#FFE070', base: '#F7B814', dark: '#C98A00', deep: '#8F6100' },
    blue: { light: '#6AAEFF', base: '#2270E6', dark: '#1550B3', deep: '#0C367D' }
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

const ARROW = {
    red: { at: [0, 7], turn: 0 },
    green: { at: [7, 0], turn: 90 },
    yellow: { at: [14, 7], turn: 180 },
    blue: { at: [7, 14], turn: 270 }
};

const at = (col, row) => [round(G + col * C), round(G + row * C)];

function starPath(radius, inner = 0.46)
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

function gradients()
{
    const parts = [];

    for (const colour of COLOURS)
    {
        const ink = LUDO_INK[colour];

        parts.push(`<linearGradient id="yard-${ colour }" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ ink.light }"/><stop offset="0.22" stop-color="${ ink.base }"/><stop offset="1" stop-color="${ ink.dark }"/></linearGradient>`);
        parts.push(`<radialGradient id="well-${ colour }" cx="0.5" cy="0.38" r="0.62"><stop offset="0" stop-color="${ ink.deep }" stop-opacity="0.55"/><stop offset="0.75" stop-color="${ ink.dark }" stop-opacity="0.35"/><stop offset="1" stop-color="${ ink.light }" stop-opacity="0.5"/></radialGradient>`);
        parts.push(`<radialGradient id="pool-${ colour }" cx="0.42" cy="0.36" r="0.7"><stop offset="0" stop-color="${ ink.base }"/><stop offset="1" stop-color="${ ink.dark }"/></radialGradient>`);
        parts.push(`<linearGradient id="tile-${ colour }" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ ink.light }"/><stop offset="0.5" stop-color="${ ink.base }"/><stop offset="1" stop-color="${ ink.dark }"/></linearGradient>`);
        parts.push(`<linearGradient id="peak-a-${ colour }" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ ink.light }"/><stop offset="1" stop-color="${ ink.base }"/></linearGradient>`);
        parts.push(`<linearGradient id="peak-b-${ colour }" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ ink.base }"/><stop offset="1" stop-color="${ ink.dark }"/></linearGradient>`);
    }

    return parts.join('\n');
}

function tileSymbol(id, fill, edge)
{
    const size = round(C - GAP * 2);

    return `<symbol id="${ id }" overflow="visible">
    <rect x="${ GAP }" y="${ GAP + 1.6 }" width="${ size }" height="${ size }" rx="7" fill="${ edge }"/>
    <rect x="${ GAP }" y="${ GAP }" width="${ size }" height="${ size - 1.2 }" rx="7" fill="${ fill }"/>
    <rect x="${ GAP + 1.2 }" y="${ GAP + 1.2 }" width="${ size - 2.4 }" height="${ round((size - 2.4) * 0.46) }" rx="6" fill="#FFFFFF" opacity="0.2"/>
</symbol>`;
}

function frame()
{
    return `<rect width="${ S }" height="${ S }" rx="46" fill="url(#wood)"/>
<rect width="${ S }" height="${ S }" rx="46" fill="#4A260C" opacity="0.5" filter="url(#grain)"/>
<rect x="3" y="3" width="${ S - 6 }" height="${ S - 6 }" rx="43" fill="none" stroke="#FFD9A0" stroke-opacity="0.45" stroke-width="3"/>
<rect x="1" y="1" width="${ S - 2 }" height="${ S - 2 }" rx="45" fill="none" stroke="#2A1305" stroke-opacity="0.8" stroke-width="2"/>
<rect x="${ round(EDGE - 5) }" y="${ round(EDGE - 5) }" width="${ round(S - EDGE * 2 + 10) }" height="${ round(S - EDGE * 2 + 10) }" rx="20" fill="none" stroke="#FFE2B5" stroke-opacity="0.35" stroke-width="2"/>
<rect x="${ round(EDGE) }" y="${ round(EDGE) }" width="${ round(S - EDGE * 2) }" height="${ round(S - EDGE * 2) }" rx="16" fill="#2B1A10"/>
<rect x="${ round(EDGE) }" y="${ round(EDGE) }" width="${ round(S - EDGE * 2) }" height="${ round(S - EDGE * 2) }" rx="16" fill="none" stroke="#120904" stroke-opacity="0.9" stroke-width="5" filter="url(#blur-2)"/>`;
}

function yard(colour)
{
    const [col, row] = CORNER[colour];
    const [x, y] = at(col, row);
    const size = round(C * 6 - GAP * 2);
    const cx = round(G + (col + 3) * C);
    const cy = round(G + (row + 3) * C);
    const wells = [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]]
        .map(([dx, dy]) => `<circle cx="${ round(cx + dx * C) }" cy="${ round(cy + dy * C) }" r="${ round(C * 0.44) }" fill="url(#well-${ colour })"/>
    <circle cx="${ round(cx + dx * C) }" cy="${ round(cy + dy * C) }" r="${ round(C * 0.44) }" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2"/>`)
        .join('\n    ');

    return `<g>
    <rect x="${ round(x + GAP) }" y="${ round(y + GAP + 2) }" width="${ size }" height="${ size }" rx="18" fill="${ LUDO_INK[colour].deep }"/>
    <rect x="${ round(x + GAP) }" y="${ round(y + GAP) }" width="${ size }" height="${ size }" rx="18" fill="url(#yard-${ colour })"/>
    <rect x="${ round(x + GAP) }" y="${ round(y + GAP) }" width="${ size }" height="${ size }" rx="18" fill="url(#sheen)"/>
    <rect x="${ round(x + GAP + 2) }" y="${ round(y + GAP + 2) }" width="${ size - 4 }" height="${ size - 4 }" rx="16" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2.5"/>
    <circle cx="${ cx }" cy="${ round(cy + 3) }" r="${ round(C * 2.2) }" fill="${ LUDO_INK[colour].deep }" opacity="0.45" filter="url(#blur-4)"/>
    <circle cx="${ cx }" cy="${ cy }" r="${ round(C * 2.2) }" fill="url(#pool-${ colour })"/>
    <circle cx="${ cx }" cy="${ cy }" r="${ round(C * 2.2) }" fill="none" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="5"/>
    <circle cx="${ cx }" cy="${ cy }" r="${ round(C * 1.92) }" fill="none" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2"/>
    ${ wells }
</g>`;
}

function tile(col, row, symbol)
{
    const [x, y] = at(col, row);

    return `<use href="#${ symbol }" x="${ x }" y="${ y }"/>`;
}

function star(col, row, fill, stroke)
{
    const [x, y] = at(col, row);

    return `<path d="${ starPath(C * 0.3) }" transform="translate(${ round(x + C / 2) } ${ round(y + C / 2) })" fill="${ fill }" stroke="${ stroke }" stroke-width="2" stroke-linejoin="round"/>`;
}

function arrow(colour)
{
    const { at: [col, row], turn } = ARROW[colour];
    const [x, y] = at(col, row);
    const u = C / 100;
    const path = `M${ round(-30 * u) } ${ round(-8 * u) }H${ round(4 * u) }V${ round(-22 * u) }L${ round(32 * u) } 0L${ round(4 * u) } ${ round(22 * u) }V${ round(8 * u) }H${ round(-30 * u) }Z`;

    return `<path d="${ path }" transform="translate(${ round(x + C / 2) } ${ round(y + C / 2) }) rotate(${ turn })" fill="${ LUDO_INK[colour].base }" stroke="${ LUDO_INK[colour].dark }" stroke-width="2" stroke-linejoin="round"/>`;
}

function centre()
{
    const [x, y] = at(6, 6);
    const size = round(C * 3 - GAP * 2);
    const x0 = round(x + GAP);
    const y0 = round(y + GAP);
    const x1 = round(x0 + size);
    const y1 = round(y0 + size);
    const mx = round(x0 + size / 2);
    const my = round(y0 + size / 2);
    const faces = [
        ['red', `${ x0 } ${ y0 } ${ x0 } ${ my } ${ mx } ${ my }`, `${ x0 } ${ my } ${ x0 } ${ y1 } ${ mx } ${ my }`],
        ['green', `${ x0 } ${ y0 } ${ mx } ${ y0 } ${ mx } ${ my }`, `${ mx } ${ y0 } ${ x1 } ${ y0 } ${ mx } ${ my }`],
        ['yellow', `${ x1 } ${ y0 } ${ x1 } ${ my } ${ mx } ${ my }`, `${ x1 } ${ my } ${ x1 } ${ y1 } ${ mx } ${ my }`],
        ['blue', `${ x0 } ${ y1 } ${ mx } ${ y1 } ${ mx } ${ my }`, `${ mx } ${ y1 } ${ x1 } ${ y1 } ${ mx } ${ my }`]
    ];

    return `<g clip-path="url(#centre-clip)">
    ${ faces.map(([colour, a, b]) => `<polygon points="${ a }" fill="url(#peak-a-${ colour })"/>
    <polygon points="${ b }" fill="url(#peak-b-${ colour })"/>`).join('\n    ') }
    <path d="M${ x0 } ${ y0 }L${ x1 } ${ y1 }M${ x1 } ${ y0 }L${ x0 } ${ y1 }" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2"/>
</g>
<rect x="${ x0 }" y="${ y0 }" width="${ size }" height="${ size }" rx="10" fill="none" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="2"/>
<circle cx="${ mx }" cy="${ my }" r="${ round(C * 0.2) }" fill="url(#gem)" stroke="#FFFFFF" stroke-opacity="0.8" stroke-width="2"/>`;
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
            tiles.push(tile(cell.col, cell.row, `tile-${ owner }-face`));
            marks.push(star(cell.col, cell.row, '#FFFFFF', LUDO_INK[owner].dark));
            return;
        }

        tiles.push(tile(cell.col, cell.row, 'tile-plain'));

        if (SAFE.includes(index))
        {
            const colour = ARM(cell.col, cell.row);

            marks.push(star(cell.col, cell.row, LUDO_INK[colour].base, LUDO_INK[colour].dark));
        }
    });

    for (const colour of COLOURS)
    {
        for (const cell of HOME_CELLS[colour])
        {
            tiles.push(tile(cell.col, cell.row, `tile-${ colour }-face`));
        }

        marks.push(arrow(colour));
    }

    const [cx, cy] = at(6, 6);
    const csize = round(C * 3 - GAP * 2);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ S } ${ S }" width="${ S }" height="${ S }">
<defs>
<linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D99A55"/><stop offset="0.4" stop-color="#B8783A"/><stop offset="0.75" stop-color="#96592A"/><stop offset="1" stop-color="#74431D"/></linearGradient>
<filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.11" numOctaves="3" seed="11" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.3 -0.55"/>
    <feComposite in2="SourceGraphic" operator="in"/>
</filter>
<filter id="blur-2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>
<filter id="blur-4" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.2"/><stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0.04"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
<linearGradient id="cream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EAE3D6"/></linearGradient>
<radialGradient id="gem" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9DEE8"/></radialGradient>
<linearGradient id="varnish" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.12"/></linearGradient>
<clipPath id="centre-clip"><rect x="${ round(cx + GAP) }" y="${ round(cy + GAP) }" width="${ csize }" height="${ csize }" rx="10"/></clipPath>
${ gradients() }
${ tileSymbol('tile-plain', 'url(#cream)', '#B9AE98') }
${ COLOURS.map((colour) => tileSymbol(`tile-${ colour }-face`, `url(#tile-${ colour })`, LUDO_INK[colour].deep)).join('\n') }
</defs>
${ frame() }
${ COLOURS.map(yard).join('\n') }
${ tiles.join('\n') }
${ centre() }
${ marks.join('\n') }
<rect x="${ round(EDGE) }" y="${ round(EDGE) }" width="${ round(S - EDGE * 2) }" height="${ round(S - EDGE * 2) }" rx="16" fill="url(#varnish)"/>
</svg>
`;
}

function pawn(colour)
{
    const ink = LUDO_INK[colour];

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100" height="120">
<defs>
<linearGradient id="body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ ink.deep }"/><stop offset="0.28" stop-color="${ ink.light }"/><stop offset="0.55" stop-color="${ ink.base }"/><stop offset="1" stop-color="${ ink.deep }"/></linearGradient>
<radialGradient id="head" cx="0.36" cy="0.3" r="0.78"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/><stop offset="0.18" stop-color="${ ink.light }"/><stop offset="0.6" stop-color="${ ink.base }"/><stop offset="1" stop-color="${ ink.deep }"/></radialGradient>
<linearGradient id="foot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ ink.deep }"/><stop offset="0.3" stop-color="${ ink.base }"/><stop offset="1" stop-color="${ ink.deep }"/></linearGradient>
<filter id="shade" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter>
</defs>
<ellipse cx="52" cy="108" rx="36" ry="9" fill="#000000" opacity="0.42" filter="url(#shade)"/>
<path d="M16 98C16 92 30 88 50 88C70 88 84 92 84 98V103C84 109 70 113 50 113C30 113 16 109 16 103Z" fill="url(#foot)"/>
<ellipse cx="50" cy="98" rx="34" ry="10" fill="${ ink.base }"/>
<path d="M24 98C30 84 36 70 39 56H61C64 70 70 84 76 98C70 103 60 105 50 105C40 105 30 103 24 98Z" fill="url(#body)"/>
<ellipse cx="50" cy="55" rx="18" ry="6.5" fill="${ ink.dark }"/>
<ellipse cx="50" cy="53" rx="18" ry="6.5" fill="url(#foot)"/>
<circle cx="50" cy="33" r="21" fill="url(#head)"/>
<ellipse cx="42" cy="24" rx="7" ry="4.5" transform="rotate(-28 42 24)" fill="#FFFFFF" opacity="0.75"/>
<path d="M33 92C36 80 40 70 42 60" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round" fill="none"/>
</svg>
`;
}

function flourish()
{
    return 'M0 0C38 0 64 10 84 30C66 22 48 20 30 24C44 34 50 48 48 64C40 50 28 42 12 40C22 58 22 76 12 92C8 70 4 46 0 0Z'
        + 'M22 8C44 10 60 18 70 30M8 22C10 44 18 60 30 70';
}

function hokmTable(width, height)
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
<linearGradient id="walnut" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A5530"/><stop offset="0.45" stop-color="#6A3E20"/><stop offset="1" stop-color="#4A2A14"/></linearGradient>
<radialGradient id="baize" cx="0.5" cy="0.45" r="0.72"><stop offset="0" stop-color="#1D7A4C"/><stop offset="0.6" stop-color="#136038"/><stop offset="1" stop-color="#0B4227"/></radialGradient>
<radialGradient id="shade" cx="0.5" cy="0.5" r="0.7"><stop offset="0.62" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.45"/></radialGradient>
<filter id="nap" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0"/>
    <feComposite in2="SourceGraphic" operator="in"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.003 0.08" numOctaves="3" seed="3" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.2 -0.5"/>
    <feComposite in2="SourceGraphic" operator="in"/>
</filter>
<filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${ round(rim * 0.25) }"/></filter>
<path id="flourish" d="${ flourish() }"/>
</defs>
<rect width="${ width }" height="${ height }" rx="${ rim * 1.6 }" fill="url(#walnut)"/>
<rect width="${ width }" height="${ height }" rx="${ rim * 1.6 }" fill="#2A1508" opacity="0.55" filter="url(#grain)"/>
<rect x="3" y="3" width="${ width - 6 }" height="${ height - 6 }" rx="${ rim * 1.6 - 3 }" fill="none" stroke="#E7B57E" stroke-opacity="0.4" stroke-width="3"/>
<rect x="${ rim }" y="${ rim }" width="${ width - rim * 2 }" height="${ height - rim * 2 }" rx="${ rim * 1.1 }" fill="#2B170A"/>
<rect x="${ fx }" y="${ fx }" width="${ fw }" height="${ fh }" rx="${ rim * 0.9 }" fill="url(#baize)"/>
<rect x="${ fx }" y="${ fx }" width="${ fw }" height="${ fh }" rx="${ rim * 0.9 }" fill="#FFFFFF" filter="url(#nap)"/>
<rect x="${ fx }" y="${ fx }" width="${ fw }" height="${ fh }" rx="${ rim * 0.9 }" fill="url(#shade)"/>
<rect x="${ fx }" y="${ fx }" width="${ fw }" height="${ fh }" rx="${ rim * 0.9 }" fill="none" stroke="#000000" stroke-opacity="0.55" stroke-width="${ rim * 0.5 }" filter="url(#soft)"/>
<rect x="${ fx + inset }" y="${ fx + inset }" width="${ fw - inset * 2 }" height="${ fh - inset * 2 }" rx="${ rim * 0.5 }" fill="none" stroke="#D9B45A" stroke-opacity="0.38" stroke-width="2.5"/>
<rect x="${ fx + inset + 8 }" y="${ fx + inset + 8 }" width="${ fw - inset * 2 - 16 }" height="${ fh - inset * 2 - 16 }" rx="${ rim * 0.4 }" fill="none" stroke="#D9B45A" stroke-opacity="0.16" stroke-width="1.5"/>
${ corners.map(([x, y, turn]) => `<use href="#flourish" transform="translate(${ x } ${ y }) rotate(${ turn }) scale(${ round(Math.min(fw, fh) / 700) })" fill="#D9B45A" fill-opacity="0.34" stroke="#D9B45A" stroke-opacity="0.3" stroke-width="2"/>`).join('\n') }
<g transform="translate(${ cx } ${ cy })">
    <circle r="${ medal }" fill="#0B4227" fill-opacity="0.35" stroke="#D9B45A" stroke-opacity="0.32" stroke-width="3"/>
    <circle r="${ round(medal * 0.9) }" fill="none" stroke="#D9B45A" stroke-opacity="0.18" stroke-width="1.5" stroke-dasharray="3 7"/>
    <g fill="#D9B45A" fill-opacity="0.07" stroke="#D9B45A" stroke-opacity="0.14" stroke-width="1.5">${ petals }</g>
</g>
</svg>
`;
}

writeFileSync(join(OUT, 'hokm-table-wide.svg'), hokmTable(1600, 1000));
console.log('board hokm-table-wide.svg');
writeFileSync(join(OUT, 'hokm-table-tall.svg'), hokmTable(1000, 1200));
console.log('board hokm-table-tall.svg');

writeFileSync(join(OUT, 'ludo-board.svg'), ludoBoard());
console.log('board ludo-board.svg');

for (const colour of COLOURS)
{
    writeFileSync(join(OUT, `pawn-${ colour }.svg`), pawn(colour));
    console.log(`board pawn-${ colour }.svg`);
}

if (RING_CELLS.length !== RING_STEPS + 1)
{
    throw new Error(`the ring has ${ RING_CELLS.length } cells`);
}
