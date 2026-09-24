import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUIT_PATH } from './suits.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'board');

const MARGIN = 0.012;
const RAIL = 0.085;
const TRACK = 0.05;
const GROOVE = 0.008;

const GOLD = '#D9B45A';

const round = (value) => Math.round(value * 100) / 100;

function stadium(x, y, width, height)
{
    const radius = Math.min(width, height) / 2;

    return `<rect x="${ round(x) }" y="${ round(y) }" width="${ round(width) }" height="${ round(height) }" rx="${ round(radius) }"/>`;
}

function ornaments(width, height)
{
    const short = Math.min(width, height);
    const felt = short * (MARGIN + RAIL + TRACK + GROOVE);
    const fw = width - felt * 2;
    const fh = height - felt * 2;
    const line = short * 0.07;
    const cx = width / 2;
    const cy = height / 2;
    const medal = short * 0.13;
    const pips = [
        ['spade', 0, -1],
        ['heart', 1, 0],
        ['club', 0, 1],
        ['diamond', -1, 0]
    ].map(([suit, dx, dy]) =>
        `<path d="${ SUIT_PATH[suit] }" transform="translate(${ round(dx * medal * 0.62) } ${ round(dy * medal * 0.62) }) scale(${ round(medal / 60) })"/>`).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ width } ${ height }" width="${ width }" height="${ height }">
<g fill="none" stroke="${ GOLD }">
    <g stroke-opacity="0.36" stroke-width="2.5">${ stadium(felt + line, felt + line, fw - line * 2, fh - line * 2) }</g>
    <g stroke-opacity="0.14" stroke-width="1.5">${ stadium(felt + line + 9, felt + line + 9, fw - line * 2 - 18, fh - line * 2 - 18) }</g>
</g>
<g transform="translate(${ round(cx) } ${ round(cy) })">
    <circle r="${ round(medal) }" fill="#062E28" fill-opacity="0.18" stroke="${ GOLD }" stroke-opacity="0.26" stroke-width="2.5"/>
    <circle r="${ round(medal * 0.88) }" fill="none" stroke="${ GOLD }" stroke-opacity="0.14" stroke-width="1.5" stroke-dasharray="3 7"/>
    <g fill="${ GOLD }" fill-opacity="0.05" stroke="${ GOLD }" stroke-opacity="0.12" stroke-width="1.2">${ pips }</g>
</g>
</svg>
`;
}

for (const [name, width, height] of [['poker-ornaments-wide.svg', 1600, 1000], ['poker-ornaments-tall.svg', 1000, 1250]])
{
    writeFileSync(join(OUT, name), ornaments(width, height));
    console.log(`board ${ name }`);
}
