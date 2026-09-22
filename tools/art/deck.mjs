import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUIT_PATH } from './suits.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'board');
const W = 204;
const H = 288;
const CX = W / 2;
const CY = H / 2;

const SUITS = [
    { name: 'club', ink: '#1B2233', tint: '#EEF1F7', accent: '#23304F' },
    { name: 'diamond', ink: '#D0213A', tint: '#FDEEEF', accent: '#A3162B' },
    { name: 'heart', ink: '#D0213A', tint: '#FDEEEF', accent: '#A3162B' },
    { name: 'spade', ink: '#1B2233', tint: '#EEF1F7', accent: '#23304F' }
];

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const SERIF = 'Georgia, \'Times New Roman\', \'Noto Serif\', serif';

const L = 64;
const R = W - 64;
const TOP = 62;
const BOTTOM = H - 62;
const ROW_A = TOP + (BOTTOM - TOP) / 3;
const ROW_B = TOP + (BOTTOM - TOP) * 2 / 3;

const PIPS = {
    2: [[CX, TOP], [CX, BOTTOM]],
    3: [[CX, TOP], [CX, CY], [CX, BOTTOM]],
    4: [[L, TOP], [R, TOP], [L, BOTTOM], [R, BOTTOM]],
    5: [[L, TOP], [R, TOP], [CX, CY], [L, BOTTOM], [R, BOTTOM]],
    6: [[L, TOP], [R, TOP], [L, CY], [R, CY], [L, BOTTOM], [R, BOTTOM]],
    7: [[L, TOP], [R, TOP], [CX, (TOP + CY) / 2], [L, CY], [R, CY], [L, BOTTOM], [R, BOTTOM]],
    8: [[L, TOP], [R, TOP], [CX, (TOP + CY) / 2], [L, CY], [R, CY], [CX, (CY + BOTTOM) / 2], [L, BOTTOM], [R, BOTTOM]],
    9: [[L, TOP], [R, TOP], [L, ROW_A], [R, ROW_A], [CX, CY], [L, ROW_B], [R, ROW_B], [L, BOTTOM], [R, BOTTOM]],
    10: [[L, TOP], [R, TOP], [CX, (TOP + ROW_A) / 2], [L, ROW_A], [R, ROW_A], [L, ROW_B], [R, ROW_B], [CX, (ROW_B + BOTTOM) / 2], [L, BOTTOM], [R, BOTTOM]]
};

const round = (value) => Math.round(value * 100) / 100;

function pip(suit, x, y, scale)
{
    const flip = y > CY + 1 ? ` rotate(180)` : '';

    return `<use href="#${ suit.name }" transform="translate(${ round(x) } ${ round(y) })${ flip } scale(${ scale })" fill="${ suit.ink }"/>`;
}

function index(rank, suit)
{
    const wide = rank === '10';

    return `<g>
    <text x="${ wide ? 26 : 25 }" y="46" font-family="${ SERIF }" font-size="${ wide ? 36 : 44 }" font-weight="700" text-anchor="middle" fill="${ suit.ink }"${ wide ? ' letter-spacing="-2"' : '' }>${ rank }</text>
    <use href="#${ suit.name }" transform="translate(25 72) scale(0.95)" fill="${ suit.ink }"/>
</g>`;
}

const CROWNS = {
    K: 'M-30 14L-30 -8L-17 4L-8 -18L0 0L8 -18L17 4L30 -8L30 14Z',
    Q: 'M-27 14C-27 -2-15 -13 0 -16C15 -13 27 -2 27 14Z',
    J: 'M-24 14C-24 -6-8 -16 8 -13C18 -11 24 -3 24 14Z'
};

function court(rank, suit)
{
    const band = `<rect x="-31" y="13" width="62" height="9" rx="2" fill="#D4A73A" stroke="#8C6A1C" stroke-width="1.5"/>`;
    const jewels = rank === 'K'
        ? '<circle cx="-17" cy="4" r="3" fill="#FFFFFF"/><circle cx="0" cy="0" r="3.4" fill="' + suit.accent + '"/><circle cx="17" cy="4" r="3" fill="#FFFFFF"/><circle cx="-30" cy="-8" r="3" fill="#D4A73A"/><circle cx="-8" cy="-18" r="3" fill="#D4A73A"/><circle cx="8" cy="-18" r="3" fill="#D4A73A"/><circle cx="30" cy="-8" r="3" fill="#D4A73A"/>'
        : rank === 'Q'
            ? '<circle cx="0" cy="-17" r="5" fill="' + suit.accent + '" stroke="#8C6A1C" stroke-width="1.5"/><path d="M-18 6Q0 -8 18 6" fill="none" stroke="#FFFFFF" stroke-opacity="0.8" stroke-width="2"/>'
            : '<path d="M8 -13C20 -30 36 -30 40 -22C30 -22 22 -16 14 -9Z" fill="' + suit.accent + '" stroke="#8C6A1C" stroke-width="1.5"/>';
    const crownFill = rank === 'J' ? suit.accent : '#E3B64B';
    const half = `<g transform="translate(${ CX } 74)">
        <path d="${ CROWNS[rank] }" fill="${ crownFill }" stroke="#8C6A1C" stroke-width="2" stroke-linejoin="round"/>
        ${ band }
        ${ jewels }
        <use href="#${ suit.name }" transform="translate(0 44) scale(1.05)" fill="${ suit.ink }"/>
    </g>`;

    return `<g>
    <rect x="40" y="32" width="${ W - 80 }" height="${ H - 64 }" rx="8" fill="${ suit.tint }" stroke="#C9A24A" stroke-width="3"/>
    <rect x="46" y="38" width="${ W - 92 }" height="${ H - 76 }" rx="5" fill="url(#court-${ suit.name })" stroke="${ suit.accent }" stroke-opacity="0.35" stroke-width="1.5"/>
    <path d="M46 ${ CY }H${ W - 46 }" stroke="#C9A24A" stroke-width="2"/>
    ${ half }
    <g transform="rotate(180 ${ CX } ${ CY })">${ half }</g>
</g>`;
}

function ace(suit)
{
    const big = suit.name === 'spade' ? 3.7 : 3.1;
    const ring = suit.name === 'spade'
        ? `<circle cx="${ CX }" cy="${ CY }" r="68" fill="none" stroke="#C9A24A" stroke-width="2.5"/><circle cx="${ CX }" cy="${ CY }" r="62" fill="none" stroke="#C9A24A" stroke-opacity="0.45" stroke-width="1.5"/>`
        : '';

    return `${ ring }<use href="#${ suit.name }" transform="translate(${ CX } ${ CY + 4 }) scale(${ big })" fill="${ suit.ink }"/>`;
}

function face(rank, suit, column, row)
{
    let middle;

    if (rank === 'A')
    {
        middle = ace(suit);
    }
    else if (rank === 'J' || rank === 'Q' || rank === 'K')
    {
        middle = court(rank, suit);
    }
    else
    {
        middle = PIPS[Number(rank)].map(([x, y]) => pip(suit, x, y, 1.42)).join('');
    }

    return `<g transform="translate(${ column * W } ${ row * H })">
    <rect width="${ W }" height="${ H }" fill="url(#paper)"/>
    ${ index(rank, suit) }
    <g transform="rotate(180 ${ CX } ${ CY })">${ index(rank, suit) }</g>
    ${ middle }
</g>`;
}

function deck()
{
    const cards = [];

    SUITS.forEach((suit, row) =>
    {
        RANKS.forEach((rank, column) => cards.push(face(rank, suit, column, row)));
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W * 13 } ${ H * 4 }" width="${ W * 13 }" height="${ H * 4 }">
<defs>
    ${ Object.entries(SUIT_PATH).map(([name, d]) => `<path id="${ name }" d="${ d }"/>`).join('\n    ') }
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F6F2EA"/></linearGradient>
    ${ SUITS.map((suit) => `<pattern id="lattice-${ suit.name }" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H10M0 0V10" stroke="${ suit.accent }" stroke-opacity="0.12" stroke-width="1.2"/></pattern>
    <linearGradient id="court-${ suit.name }" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ suit.tint }"/><stop offset="0.5" stop-color="#FFFFFF"/><stop offset="1" stop-color="${ suit.tint }"/></linearGradient>`).join('\n    ') }
</defs>
${ cards.join('\n') }
</svg>
`;
}

function back()
{
    const star = [];

    for (let index = 0; index < 16; index += 1)
    {
        const angle = -Math.PI / 2 + index * Math.PI / 8;
        const reach = index % 2 === 0 ? (index % 4 === 0 ? 34 : 24) : 9;

        star.push(`${ round(CX + Math.cos(angle) * reach) } ${ round(CY + Math.sin(angle) * reach) }`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W } ${ H }" width="${ W }" height="${ H }">
<defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2F5FD0"/><stop offset="0.55" stop-color="#1E3A8A"/><stop offset="1" stop-color="#15286A"/></linearGradient>
    <pattern id="weave" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H14M0 0V14" stroke="#9CC2FF" stroke-opacity="0.28" stroke-width="1.4"/><circle cx="7" cy="7" r="1.4" fill="#9CC2FF" fill-opacity="0.3"/></pattern>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#60A5FA" stop-opacity="0.45"/><stop offset="1" stop-color="#60A5FA" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${ W }" height="${ H }" fill="#F8F6F0"/>
<rect x="9" y="9" width="${ W - 18 }" height="${ H - 18 }" rx="10" fill="url(#field)"/>
<rect x="9" y="9" width="${ W - 18 }" height="${ H - 18 }" rx="10" fill="url(#weave)"/>
<rect x="17" y="17" width="${ W - 34 }" height="${ H - 34 }" rx="6" fill="none" stroke="#E3C170" stroke-opacity="0.85" stroke-width="2"/>
<rect x="22" y="22" width="${ W - 44 }" height="${ H - 44 }" rx="4" fill="none" stroke="#E3C170" stroke-opacity="0.35" stroke-width="1"/>
<circle cx="${ CX }" cy="${ CY }" r="70" fill="url(#glow)"/>
<circle cx="${ CX }" cy="${ CY }" r="48" fill="#172554" stroke="#E3C170" stroke-width="3"/>
<circle cx="${ CX }" cy="${ CY }" r="41" fill="none" stroke="#E3C170" stroke-opacity="0.5" stroke-width="1.2"/>
<polygon points="${ star.join(' ') }" fill="#E3C170" stroke="#8C6A1C" stroke-width="1"/>
<circle cx="${ CX }" cy="${ CY }" r="6" fill="#172554" stroke="#E3C170" stroke-width="2"/>
${ [[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]].map(([x, y]) => `<path d="M${ x } ${ y - 8 }L${ x + 8 } ${ y }L${ x } ${ y + 8 }L${ x - 8 } ${ y }Z" fill="#E3C170" fill-opacity="0.8"/>`).join('') }
</svg>
`;
}

writeFileSync(join(OUT, 'deck.svg'), deck());
console.log('board deck.svg');
writeFileSync(join(OUT, 'card-back.svg'), back());
console.log('board card-back.svg');
