import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public', 'art', 'games');
const W = 480;
const H = 320;

const round = (value) => Math.round(value * 100) / 100;

function project(x, y, { cx, cy, angle, squash })
{
    const a = angle * Math.PI / 180;
    const rx = x * Math.cos(a) - y * Math.sin(a);
    const ry = x * Math.sin(a) + y * Math.cos(a);
    return [round(cx + rx), round(cy + ry * squash)];
}

const shared = `
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#020617" flood-opacity="0.5"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise"/>
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/>
        <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <radialGradient id="vignette" cx="0.5" cy="0.42" r="0.75">
        <stop offset="0.55" stop-color="#020617" stop-opacity="0"/>
        <stop offset="1" stop-color="#020617" stop-opacity="0.72"/>
    </radialGradient>
    <radialGradient id="spot" cx="0.5" cy="0.15" r="0.7">
        <stop offset="0" stop-color="#FFF6E0" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#FFF6E0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="card-face" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFFFFF"/>
        <stop offset="1" stop-color="#E2E8F0"/>
    </linearGradient>
    <linearGradient id="card-back" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3B6FE0"/>
        <stop offset="1" stop-color="#172E7A"/>
    </linearGradient>
    <pattern id="lattice" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0H8M0 0V8" stroke="#93C5FD" stroke-width="1" opacity="0.32"/>
    </pattern>
    <radialGradient id="gloss" cx="0.25" cy="0.12" r="0.95">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.3"/>
        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pip" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#FFFFFF"/>
        <stop offset="1" stop-color="#D5DDE8"/>
    </radialGradient>
    <path id="heart" d="M0 7.5C-1.2 6.4-12 -1.1-12 -7.6C-12 -12-8.6-15-5-15C-2.6-15-0.8-13.7 0-12C0.8-13.7 2.6-15 5-15C8.6-15 12-12 12-7.6C12-1.1 1.2 6.4 0 7.5Z"/>
    <path id="spade" d="M0 -15C-1.2 -12.6-12 -5.8-12 1.6C-12 6-8.8 8.6-5.4 8.6C-3.4 8.6-1.8 7.7-0.9 6.4C-1.1 9.6-2.4 12.2-4.6 14H4.6C2.4 12.2 1.1 9.6 0.9 6.4C1.8 7.7 3.4 8.6 5.4 8.6C8.8 8.6 12 6 12 1.6C12 -5.8 1.2 -12.6 0 -15Z"/>
    <path id="diamond" d="M0 -15L10.5 0L0 15L-10.5 0Z"/>
    <path id="club" d="M0 -15A6.2 6.2 0 0 1 5.4 -5.8A6.2 6.2 0 1 1 1.6 5.2C1.9 8.6 3.1 11.6 5 14H-5C-3.1 11.6-1.9 8.6-1.6 5.2A6.2 6.2 0 1 1-5.4 -5.8A6.2 6.2 0 0 1 0 -15Z"/>`;

function svg(defs, body)
{
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W } ${ H }" preserveAspectRatio="xMidYMid slice">
<defs>${ shared }${ defs }
</defs>
${ body }
<rect width="${ W }" height="${ H }" fill="url(#spot)"/>
<rect width="${ W }" height="${ H }" fill="url(#vignette)"/>
</svg>
`;
}

function table(light, dark, grain = true)
{
    return `<radialGradient id="surface" cx="0.5" cy="0.35" r="0.8"><stop offset="0" stop-color="${ light }"/><stop offset="1" stop-color="${ dark }"/></radialGradient>`
        + (grain ? '' : '');
}

function surface()
{
    return `<rect width="${ W }" height="${ H }" fill="url(#surface)"/>
<rect width="${ W }" height="${ H }" fill="#FFFFFF" filter="url(#grain)"/>`;
}

const SUIT = { heart: '#DC2626', diamond: '#DC2626', spade: '#0F172A', club: '#0F172A' };

function card({ x, y, rotate = 0, rank, suit, back = false, w = 72, h = 100 })
{
    const r = w * 0.09;
    if (back)
    {
        return `<g transform="translate(${ x } ${ y }) rotate(${ rotate })" filter="url(#lift)">
    <rect x="${ -w / 2 }" y="${ -h / 2 }" width="${ w }" height="${ h }" rx="${ r }" fill="url(#card-back)"/>
    <rect x="${ -w / 2 + 5 }" y="${ -h / 2 + 5 }" width="${ w - 10 }" height="${ h - 10 }" rx="${ r * 0.6 }" fill="url(#lattice)" stroke="#BFDBFE" stroke-opacity="0.55" stroke-width="1"/>
    <circle r="${ w * 0.15 }" fill="#1E3A8A" stroke="#BFDBFE" stroke-width="1.2"/>
    <use href="#diamond" fill="#BFDBFE" transform="scale(${ w * 0.006 })"/>
    <rect x="${ -w / 2 }" y="${ -h / 2 }" width="${ w }" height="${ h }" rx="${ r }" fill="url(#gloss)"/>
</g>`;
    }
    const colour = SUIT[suit];
    const corner = (flip) => `<g ${ flip ? 'transform="rotate(180)"' : '' }>
        <text x="${ -w / 2 + w * 0.17 }" y="${ -h / 2 + h * 0.2 }" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${ w * 0.2 }" font-weight="800" fill="${ colour }" text-anchor="middle">${ rank }</text>
        <use href="#${ suit }" fill="${ colour }" transform="translate(${ -w / 2 + w * 0.17 } ${ -h / 2 + h * 0.31 }) scale(${ w * 0.0068 })"/>
    </g>`;
    return `<g transform="translate(${ x } ${ y }) rotate(${ rotate })" filter="url(#lift)">
    <rect x="${ -w / 2 }" y="${ -h / 2 }" width="${ w }" height="${ h }" rx="${ r }" fill="url(#card-face)"/>
    <rect x="${ -w / 2 + 0.6 }" y="${ -h / 2 + 0.6 }" width="${ w - 1.2 }" height="${ h - 1.2 }" rx="${ r }" fill="none" stroke="#CBD5E1" stroke-width="1.2"/>
    ${ corner(false) }
    ${ corner(true) }
    <use href="#${ suit }" fill="${ colour }" transform="translate(0 ${ h * 0.02 }) scale(${ w * 0.024 })"/>
    <rect x="${ -w / 2 }" y="${ -h / 2 }" width="${ w }" height="${ h }" rx="${ r }" fill="url(#gloss)"/>
</g>`;
}

const CHIP = {
    red: ['#F87171', '#B91C1C', '#7F1111'],
    green: ['#4ADE80', '#15803D', '#0E5A2A'],
    blue: ['#60A5FA', '#1D4ED8', '#0F3A8C'],
    black: ['#64748B', '#1E293B', '#020617'],
    gold: ['#FCD34D', '#D97706', '#92400E']
};

function chipDefs()
{
    return Object.entries(CHIP).map(([name, [top, bottom]]) =>
        `<linearGradient id="chip-${ name }" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ top }"/><stop offset="1" stop-color="${ bottom }"/></linearGradient>`).join('');
}

function chipStack(x, y, colours, rx = 26)
{
    const ry = rx * 0.38;
    const t = rx * 0.26;
    const layers = colours.map((name, index) =>
    {
        const [, , side] = CHIP[name];
        const cy = y - index * (t + 1);
        const jitter = (index % 2 === 0 ? 1 : -1) * rx * 0.03;
        return `<g transform="translate(${ round(x + jitter) } ${ round(cy) })">
        <ellipse cy="${ t }" rx="${ rx }" ry="${ ry }" fill="${ side }"/>
        <rect x="${ -rx }" y="0" width="${ rx * 2 }" height="${ t }" fill="url(#chip-${ name })"/>
        <ellipse cy="${ t / 2 }" rx="${ rx }" ry="${ ry }" fill="none" stroke="#FFFFFF" stroke-width="${ t * 0.9 }" stroke-dasharray="${ rx * 0.2 } ${ rx * 0.36 }" opacity="0.92"/>
        <ellipse rx="${ rx }" ry="${ ry }" fill="url(#chip-${ name })"/>
        <ellipse rx="${ rx * 0.68 }" ry="${ ry * 0.68 }" fill="none" stroke="#FFFFFF" stroke-width="1.3" stroke-dasharray="3.4 3.4" opacity="0.75"/>
    </g>`;
    }).join('\n    ');
    const top = y - (colours.length - 1) * (t + 1);
    return `<ellipse cx="${ x + 6 }" cy="${ y + t + ry * 0.6 }" rx="${ rx * 1.15 }" ry="${ ry * 0.9 }" fill="#000000" opacity="0.5" filter="url(#softer)"/>
<g>
    ${ layers }
    <ellipse cx="${ x - rx * 0.25 }" cy="${ round(top - ry * 0.25) }" rx="${ rx * 0.42 }" ry="${ ry * 0.3 }" fill="#FFFFFF" opacity="0.2"/>
</g>`;
}

function die(x, y, size, rotate, face, side, pips)
{
    const s = size;
    const r = s * 0.22;
    const spots = pips.map(([px, py]) => `<circle cx="${ px * s }" cy="${ py * s }" r="${ s * 0.09 }"/>`).join('');
    return `<ellipse cx="${ x + s * 0.12 }" cy="${ y + s * 0.62 }" rx="${ s * 0.62 }" ry="${ s * 0.16 }" fill="#000000" opacity="0.5" filter="url(#softer)"/>
<g transform="translate(${ x } ${ y }) rotate(${ rotate })">
    <rect x="${ -s / 2 + s * 0.04 }" y="${ -s / 2 + s * 0.1 }" width="${ s }" height="${ s }" rx="${ r }" fill="${ side }"/>
    <rect x="${ -s / 2 }" y="${ -s / 2 }" width="${ s }" height="${ s }" rx="${ r }" fill="${ face }"/>
    <rect x="${ -s / 2 }" y="${ -s / 2 }" width="${ s }" height="${ s }" rx="${ r }" fill="url(#gloss)"/>
    <g fill="#000000" opacity="0.28" transform="translate(${ s * 0.015 } ${ s * 0.02 })">${ spots }</g>
    <g fill="${ face.includes('ivory') ? '#1E293B' : 'url(#pip)' }">${ spots }</g>
</g>`;
}

const FIVE = [[-0.25, -0.25], [0.25, -0.25], [0, 0], [-0.25, 0.25], [0.25, 0.25]];
const THREE = [[-0.24, -0.24], [0, 0], [0.24, 0.24]];
const SIX = [[-0.24, -0.26], [-0.24, 0], [-0.24, 0.26], [0.24, -0.26], [0.24, 0], [0.24, 0.26]];
const FOUR = [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]];

function ludo()
{
    const view = { cx: 238, cy: 150, angle: -28, squash: 0.56 };
    const cell = 18;
    const half = cell * 7.5;
    const board = [];
    const colours = { red: '#E0443C', green: '#2F9E5B', yellow: '#EFB82E', blue: '#2F6FD6' };
    board.push(`<rect x="${ -half - 14 }" y="${ -half - 14 }" width="${ half * 2 + 28 }" height="${ half * 2 + 28 }" rx="16" fill="url(#frame)"/>`);
    board.push(`<rect x="${ -half }" y="${ -half }" width="${ half * 2 }" height="${ half * 2 }" rx="4" fill="#F7F1E4"/>`);
    const yards = [['red', -1, -1], ['green', 1, -1], ['yellow', 1, 1], ['blue', -1, 1]];
    for (const [name, sx, sy] of yards)
    {
        const x0 = sx < 0 ? -half : half - cell * 6;
        const y0 = sy < 0 ? -half : half - cell * 6;
        board.push(`<rect x="${ x0 }" y="${ y0 }" width="${ cell * 6 }" height="${ cell * 6 }" fill="${ colours[name] }"/>`);
        board.push(`<rect x="${ x0 + cell }" y="${ y0 + cell }" width="${ cell * 4 }" height="${ cell * 4 }" rx="8" fill="#FBF7EE"/>`);
        for (const [dx, dy] of [[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]])
        {
            board.push(`<circle cx="${ x0 + dx * cell }" cy="${ y0 + dy * cell }" r="${ cell * 0.62 }" fill="${ colours[name] }" opacity="0.9"/>`);
        }
    }
    for (let i = 0; i < 15; i += 1)
    {
        for (let j = 0; j < 15; j += 1)
        {
            const inArm = (i >= 6 && i <= 8) !== (j >= 6 && j <= 8);
            if (!inArm)
            {
                continue;
            }
            const x = -half + i * cell;
            const y = -half + j * cell;
            let fill = '#FFFFFF';
            if (i === 7 && j >= 1 && j <= 5) fill = colours.green;
            if (i === 7 && j >= 9 && j <= 13) fill = colours.blue;
            if (j === 7 && i >= 1 && i <= 5) fill = colours.red;
            if (j === 7 && i >= 9 && i <= 13) fill = colours.yellow;
            board.push(`<rect x="${ x }" y="${ y }" width="${ cell }" height="${ cell }" fill="${ fill }" stroke="#D8CFBE" stroke-width="0.8"/>`);
        }
    }
    const c = cell * 1.5;
    board.push(`<path d="M${ -c } ${ -c }L0 0L${ -c } ${ c }Z" fill="${ colours.red }"/>`);
    board.push(`<path d="M${ -c } ${ -c }L0 0L${ c } ${ -c }Z" fill="${ colours.green }"/>`);
    board.push(`<path d="M${ c } ${ -c }L0 0L${ c } ${ c }Z" fill="${ colours.yellow }"/>`);
    board.push(`<path d="M${ -c } ${ c }L0 0L${ c } ${ c }Z" fill="${ colours.blue }"/>`);
    const transform = `translate(${ view.cx } ${ view.cy }) scale(1 ${ view.squash }) rotate(${ view.angle })`;
    const edge = `translate(${ view.cx } ${ view.cy + 10 }) scale(1 ${ view.squash }) rotate(${ view.angle })`;

    const pawnAt = (bx, by, name, scale = 1) =>
    {
        const [x, y] = project(bx, by, view);
        const s = 11 * scale;
        return { y, markup: `<g transform="translate(${ x } ${ y })">
    <ellipse cx="2" cy="1" rx="${ s * 1.05 }" ry="${ s * 0.42 }" fill="#000000" opacity="0.42" filter="url(#softer)"/>
    <ellipse cy="0" rx="${ s * 0.95 }" ry="${ s * 0.38 }" fill="url(#pawn-${ name }-dark)"/>
    <path d="M${ -s * 0.95 } 0C${ -s * 0.9 } ${ -s * 0.6 } ${ -s * 0.45 } ${ -s * 1.2 } ${ -s * 0.38 } ${ -s * 1.75 }H${ s * 0.38 }C${ s * 0.45 } ${ -s * 1.2 } ${ s * 0.9 } ${ -s * 0.6 } ${ s * 0.95 } 0Z" fill="url(#pawn-${ name })"/>
    <ellipse cy="${ -s * 1.78 }" rx="${ s * 0.5 }" ry="${ s * 0.2 }" fill="url(#pawn-${ name }-dark)"/>
    <circle cy="${ -s * 2.3 }" r="${ s * 0.62 }" fill="url(#pawn-${ name })"/>
    <circle cx="${ -s * 0.2 }" cy="${ -s * 2.5 }" r="${ s * 0.2 }" fill="#FFFFFF" opacity="0.6"/>
</g>` };
    };
    const pawnDefs = Object.entries(colours).map(([name, colour]) =>
        `<radialGradient id="pawn-${ name }" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/><stop offset="0.18" stop-color="${ colour }"/><stop offset="1" stop-color="${ colour }" stop-opacity="1"/></radialGradient>`
        + `<linearGradient id="pawn-${ name }-dark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ colour }"/><stop offset="1" stop-color="#1E293B"/></linearGradient>`).join('');
    const pawns = [
        pawnAt(-half + cell * 1.9, -half + cell * 1.9, 'red'),
        pawnAt(-half + cell * 4.1, -half + cell * 4.1, 'red'),
        pawnAt(half - cell * 1.9, -half + cell * 4.1, 'green'),
        pawnAt(half - cell * 4.1, half - cell * 1.9, 'yellow'),
        pawnAt(half - cell * 1.9, half - cell * 4.1, 'yellow'),
        pawnAt(-half + cell * 4.1, half - cell * 1.9, 'blue'),
        pawnAt(-half + cell * 6.5, -half + cell * 2.5, 'green', 1.05),
        pawnAt(half - cell * 2.5, -half + cell * 7.5, 'red', 1.05),
        pawnAt(-half + cell * 8.5, half - cell * 3.5, 'blue', 1.05)
    ].sort((a, b) => a.y - b.y).map((pawn) => pawn.markup).join('\n');
    const defs = table('#6B4428', '#1A0F07') + pawnDefs
        + '<linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B8773F"/><stop offset="1" stop-color="#6A3A14"/></linearGradient>'
        + '<linearGradient id="red-die" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A8A"/><stop offset="0.5" stop-color="#EF4444"/><stop offset="1" stop-color="#B91C1C"/></linearGradient>'
        + '<linearGradient id="blue-die" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93C5FD"/><stop offset="0.5" stop-color="#3B82F6"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient>';
    return svg(defs, `${ surface() }
<g transform="${ edge }"><rect x="${ -half - 14 }" y="${ -half - 14 }" width="${ half * 2 + 28 }" height="${ half * 2 + 28 }" rx="16" fill="#3A1D08"/></g>
<g transform="translate(0 16)" opacity="0.55" filter="url(#soft)"><g transform="${ transform }"><rect x="${ -half - 14 }" y="${ -half - 14 }" width="${ half * 2 + 28 }" height="${ half * 2 + 28 }" rx="16" fill="#000000"/></g></g>
<g transform="${ edge }"><rect x="${ -half - 14 }" y="${ -half - 14 }" width="${ half * 2 + 28 }" height="${ half * 2 + 28 }" rx="16" fill="#3A1D08"/></g>
<g transform="${ transform }">${ board.join('') }</g>
${ pawns }
${ die(392, 262, 34, -16, 'url(#red-die)', '#7F1111', FIVE) }
${ die(434, 236, 30, 12, 'url(#blue-die)', '#172554', THREE) }`);
}

function hokm()
{
    const hand = [
        { rank: '10', suit: 'diamond' },
        { rank: 'J', suit: 'club' },
        { rank: 'Q', suit: 'heart' },
        { rank: 'K', suit: 'spade' },
        { rank: 'A', suit: 'heart' }
    ];
    const fan = hand.map((one, index) =>
    {
        const angle = (index - 2) * 11;
        const a = angle * Math.PI / 180;
        const x = 240 + Math.sin(a) * 150;
        const y = 352 - Math.cos(a) * 150;
        return card({ x: round(x), y: round(y), rotate: angle, rank: one.rank, suit: one.suit, w: 84, h: 118 });
    }).join('\n');
    const defs = table('#2E8A57', '#0B3320');
    return svg(defs, `${ surface() }
<ellipse cx="240" cy="92" rx="170" ry="60" fill="#FFFFFF" opacity="0.05"/>
${ card({ x: 96, y: 78, rotate: -24, back: true, w: 58, h: 80 }) }
${ card({ x: 104, y: 74, rotate: -12, back: true, w: 58, h: 80 }) }
${ card({ x: 206, y: 70, rotate: -10, rank: '7', suit: 'spade', w: 50, h: 70 }) }
${ card({ x: 252, y: 64, rotate: 4, rank: '9', suit: 'spade', w: 50, h: 70 }) }
${ card({ x: 300, y: 70, rotate: 14, rank: 'A', suit: 'spade', w: 50, h: 70 }) }
<g opacity="0.9">
    <circle cx="398" cy="70" r="22" fill="#0B1220" opacity="0.35" filter="url(#softer)"/>
    <circle cx="396" cy="66" r="20" fill="#F8FAFC"/>
    <circle cx="396" cy="66" r="15" fill="none" stroke="#1D4ED8" stroke-width="2.5"/>
    <use href="#spade" fill="#1D4ED8" transform="translate(396 67) scale(0.62)"/>
</g>
${ fan }`);
}

function backgammon()
{
    const view = { cx: 240, cy: 158, angle: -10, squash: 0.62 };
    const bw = 206;
    const bh = 150;
    const point = (x, top, colour, w, h) => top
        ? `<path d="M${ x } ${ -bh + 12 }h${ w }l${ -w / 2 } ${ h }Z" fill="${ colour }"/>`
        : `<path d="M${ x } ${ bh - 12 }h${ w }l${ -w / 2 } ${ -h }Z" fill="${ colour }"/>`;
    const parts = [];
    parts.push(`<rect x="${ -bw - 16 }" y="${ -bh - 16 }" width="${ (bw + 16) * 2 }" height="${ (bh + 16) * 2 }" rx="18" fill="url(#frame)"/>`);
    for (const side of [-1, 1])
    {
        const x0 = side < 0 ? -bw : 12;
        parts.push(`<rect x="${ x0 }" y="${ -bh }" width="${ bw - 12 }" height="${ bh * 2 }" rx="4" fill="url(#leather)"/>`);
        const w = (bw - 24) / 6;
        for (let i = 0; i < 6; i += 1)
        {
            const x = x0 + 6 + i * w;
            parts.push(point(x, true, i % 2 === 0 ? '#C2410C' : '#F1E6CF', w, bh * 0.78));
            parts.push(point(x, false, i % 2 === 0 ? '#F1E6CF' : '#C2410C', w, bh * 0.78));
        }
    }
    parts.push(`<rect x="-12" y="${ -bh }" width="24" height="${ bh * 2 }" fill="#6A3A14"/>`);
    parts.push(`<rect x="-3" y="${ -bh }" width="6" height="${ bh * 2 }" fill="#C9A227" opacity="0.7"/>`);
    const transform = `translate(${ view.cx } ${ view.cy }) scale(1 ${ view.squash }) rotate(${ view.angle })`;
    const edge = `translate(${ view.cx } ${ view.cy + 12 }) scale(1 ${ view.squash }) rotate(${ view.angle })`;
    const w = (bw - 24) / 6;
    const checkers = [];
    const stack = (column, top, count, light) =>
    {
        const x0 = column < 6 ? -bw + 6 : 12 + 6;
        const x = x0 + (column % 6) * w + w / 2;
        for (let k = 0; k < count; k += 1)
        {
            const y = top ? -bh + 12 + w * 0.55 + k * w * 0.98 : bh - 12 - w * 0.55 - k * w * 0.98;
            const [sx, sy] = project(x, y, view);
            checkers.push({ y: sy, light, markup: [sx, sy] });
        }
    };
    stack(0, true, 5, true);
    stack(4, false, 3, false);
    stack(5, true, 2, false);
    stack(7, false, 3, true);
    stack(11, true, 2, false);
    stack(11, false, 3, true);
    stack(2, false, 1, true);
    const rx = w * 0.46;
    const ry = rx * view.squash;
    const disc = checkers.sort((a, b) => a.y - b.y).map(({ light, markup: [x, y] }) => `<g transform="translate(${ x } ${ y })">
    <ellipse cy="${ ry * 0.55 }" rx="${ rx }" ry="${ ry }" fill="${ light ? '#9AA6B6' : '#020617' }"/>
    <ellipse rx="${ rx }" ry="${ ry }" fill="url(#${ light ? 'ivory' : 'ebony' })"/>
    <ellipse rx="${ rx * 0.62 }" ry="${ ry * 0.62 }" fill="none" stroke="${ light ? '#94A3B8' : '#475569' }" stroke-width="1" opacity="0.8"/>
</g>`).join('\n');
    const defs = table('#5C3A22', '#150C06')
        + '<linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C98547"/><stop offset="0.5" stop-color="#8F5122"/><stop offset="1" stop-color="#5E3210"/></linearGradient>'
        + '<linearGradient id="leather" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23513B"/><stop offset="1" stop-color="#153626"/></linearGradient>'
        + '<radialGradient id="ivory" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#CBD5E1"/></radialGradient>'
        + '<radialGradient id="ebony" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#475569"/><stop offset="1" stop-color="#0B1220"/></radialGradient>'
        + '<linearGradient id="ivory-die" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E2D9C6"/></linearGradient>';
    return svg(defs, `${ surface() }
<g transform="translate(0 18)" opacity="0.55" filter="url(#soft)"><g transform="${ transform }"><rect x="${ -bw - 16 }" y="${ -bh - 16 }" width="${ (bw + 16) * 2 }" height="${ (bh + 16) * 2 }" rx="18" fill="#000000"/></g></g>
<g transform="${ edge }"><rect x="${ -bw - 16 }" y="${ -bh - 16 }" width="${ (bw + 16) * 2 }" height="${ (bh + 16) * 2 }" rx="18" fill="#2E1606"/></g>
<g transform="${ transform }">${ parts.join('') }</g>
${ disc }
${ die(368, 176, 26, 14, 'url(#ivory-die)', '#A89A80', SIX).replace('url(#pip)', '#1E293B') }
${ die(402, 160, 26, -10, 'url(#ivory-die)', '#A89A80', FOUR).replace('url(#pip)', '#1E293B') }`);
}

function poker()
{
    const defs = table('#1F7A4D', '#08281A') + chipDefs()
        + '<linearGradient id="rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5A3A22"/><stop offset="1" stop-color="#23140A"/></linearGradient>';
    return svg(defs, `${ surface() }
<ellipse cx="240" cy="420" rx="360" ry="150" fill="none" stroke="url(#rail)" stroke-width="40"/>
<ellipse cx="240" cy="420" rx="336" ry="128" fill="none" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="2"/>
${ card({ x: 160, y: 96, rotate: -2, rank: 'Q', suit: 'heart', w: 52, h: 74 }) }
${ card({ x: 216, y: 94, rotate: 1, rank: '10', suit: 'spade', w: 52, h: 74 }) }
${ card({ x: 272, y: 95, rotate: -1, rank: 'J', suit: 'diamond', w: 52, h: 74 }) }
${ card({ x: 328, y: 93, rotate: 2, back: true, w: 52, h: 74 }) }
${ chipStack(92, 214, ['black', 'blue', 'blue', 'green', 'red'], 28) }
${ chipStack(150, 250, ['green', 'green', 'red', 'red'], 28) }
${ chipStack(384, 206, ['red', 'blue', 'black', 'gold', 'gold', 'blue'], 28) }
${ card({ x: 222, y: 236, rotate: -14, rank: 'A', suit: 'spade', w: 78, h: 110 }) }
${ card({ x: 280, y: 232, rotate: 10, rank: 'K', suit: 'heart', w: 78, h: 110 }) }
<g>
    <ellipse cx="352" cy="272" rx="22" ry="8" fill="#000000" opacity="0.45" filter="url(#softer)"/>
    <ellipse cx="350" cy="266" rx="20" ry="8" fill="#CBD5E1"/>
    <ellipse cx="350" cy="263" rx="20" ry="8" fill="#F8FAFC"/>
    <text x="350" y="269" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="14" font-weight="800" fill="#0F172A" text-anchor="middle" transform="translate(350 264) scale(1.3 0.62) translate(-350 -264)">D</text>
</g>`);
}

const SCENES = { ludo, hokm, backgammon, poker };
for (const [name, build] of Object.entries(SCENES))
{
    writeFileSync(join(OUT, `${ name }.svg`), build());
    console.log(`art ${ name }.svg`);
}
