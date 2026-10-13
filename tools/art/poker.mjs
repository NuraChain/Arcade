import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUIT_PATH } from './suits.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public', 'board');

const GOLD = '#D9B45A';

const MEDAL = 130;

const round = (value) => Math.round(value * 100) / 100;

function medallion()
{
    const half = MEDAL + 5;
    const pips = [
        ['spade', 0, -1],
        ['heart', 1, 0],
        ['club', 0, 1],
        ['diamond', -1, 0]
    ].map(([suit, dx, dy]) =>
        `<path d="${ SUIT_PATH[suit] }" transform="translate(${ round(dx * MEDAL * 0.62) } ${ round(dy * MEDAL * 0.62) }) scale(${ round(MEDAL / 60) })"/>`).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ half * 2 } ${ half * 2 }" width="${ half * 2 }" height="${ half * 2 }">
<g transform="translate(${ half } ${ half })">
    <circle r="${ MEDAL }" fill="#04201B" fill-opacity="0.2" stroke="${ GOLD }" stroke-opacity="0.3" stroke-width="2.5"/>
    <circle r="${ round(MEDAL * 0.88) }" fill="none" stroke="${ GOLD }" stroke-opacity="0.16" stroke-width="1.5" stroke-dasharray="3 7"/>
    <g fill="${ GOLD }" fill-opacity="0.06" stroke="${ GOLD }" stroke-opacity="0.14" stroke-width="1.2">${ pips }</g>
</g>
</svg>
`;
}

function grain({ width, height, frequency, octaves, seed, slope, lift, opacity })
{
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ width } ${ height }" width="${ width }" height="${ height }">
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${ frequency }" numOctaves="${ octaves }" seed="${ seed }" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${ slope } ${ lift }"/>
</filter>
<rect width="${ width }" height="${ height }" filter="url(#grain)" opacity="${ opacity }"/>
</svg>
`;
}

const DRAWINGS = [
    ['poker-medallion.svg', medallion()],
    ['poker-felt.svg', grain({ width: 256, height: 256, frequency: '0.95', octaves: 2, seed: 3, slope: -1.4, lift: 0.86, opacity: 0.42 })],
    ['poker-leather.svg', grain({ width: 200, height: 200, frequency: '1.5', octaves: 2, seed: 7, slope: -1.2, lift: 0.74, opacity: 0.3 })],
    ['poker-wood.svg', grain({ width: 512, height: 256, frequency: '0.008 0.22', octaves: 3, seed: 11, slope: -2.2, lift: 1.25, opacity: 0.45 })]
];

for (const [name, drawing] of DRAWINGS)
{
    writeFileSync(join(OUT, name), drawing);
    console.log(`board ${ name }`);
}
