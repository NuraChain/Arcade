import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELD, FRAME, SIZE } from '../../frontend/src/game/chess-layout.ts';
import { KINDS, pieceSvg } from './chess-set.mjs';

/**
 * The chess table's art: the twelve pieces of `chess-set.mjs` as files, and the board, a walnut
 * board with a brass inlay and maple and walnut squares.
 *
 * The board carries no letters: which file and rank stand at the foot depends on who is looking,
 * so the page writes the coordinates over the frame itself.
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public', 'board', 'chess');

const SQUARE = FIELD / 8;

const round = (value) => Math.round(value * 100) / 100;

/**
 * The board: a walnut frame to the edge with a brass line inset in it, and the 64 squares, a1
 * dark. Turned round for whoever plays Black, a1's square lands where h8's stood, and h8 is dark
 * too, so one drawing serves both sides of the table.
 */
function board()
{
    const squares = [];

    for (let rank = 0; rank < 8; rank += 1)
    {
        for (let file = 0; file < 8; file += 1)
        {
            const light = (file + rank) % 2 === 1;
            const x = round(FRAME + file * SQUARE);
            const y = round(FRAME + (7 - rank) * SQUARE);

            squares.push(`<rect x="${ x }" y="${ y }" width="${ round(SQUARE) }" height="${ round(SQUARE) }" fill="${ light ? 'url(#maple)' : 'url(#walnut)' }"/>`);
        }
    }

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ SIZE } ${ SIZE }">`,
        '<defs>',
        '<linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5C3A22"/><stop offset="0.5" stop-color="#4A2C18"/><stop offset="1" stop-color="#3A2112"/></linearGradient>',
        '<linearGradient id="maple" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F0DDB8"/><stop offset="1" stop-color="#E2C899"/></linearGradient>',
        '<linearGradient id="walnut" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A9764B"/><stop offset="1" stop-color="#8E5E38"/></linearGradient>',
        '<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.38" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.15  0 0 0 0 0.06  0 0 0 0.22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>',
        '</defs>',
        `<rect x="0" y="0" width="${ SIZE }" height="${ SIZE }" rx="22" fill="url(#frame)"/>`,
        `<rect x="0" y="0" width="${ SIZE }" height="${ SIZE }" rx="22" fill="#000" filter="url(#grain)"/>`,
        `<rect x="${ round(FRAME * 0.42) }" y="${ round(FRAME * 0.42) }" width="${ round(SIZE - FRAME * 0.84) }" height="${ round(SIZE - FRAME * 0.84) }" rx="12" fill="none" stroke="#C9A25A" stroke-width="2.4" stroke-opacity="0.85"/>`,
        `<rect x="${ round(FRAME - 6) }" y="${ round(FRAME - 6) }" width="${ round(FIELD + 12) }" height="${ round(FIELD + 12) }" rx="4" fill="#2A170B"/>`,
        ...squares,
        `<rect x="${ FRAME }" y="${ FRAME }" width="${ FIELD }" height="${ FIELD }" fill="#000" filter="url(#grain)" opacity="0.7"/>`,
        `<rect x="${ FRAME }" y="${ FRAME }" width="${ FIELD }" height="${ FIELD }" fill="none" stroke="#1E1008" stroke-width="2"/>`,
        '</svg>'
    ].join('');
}

mkdirSync(OUT, { recursive: true });

for (const colour of ['w', 'b'])
{
    for (const kind of KINDS)
    {
        writeFileSync(join(OUT, `${ colour }${ kind }.svg`), pieceSvg(colour, kind));
    }
}

writeFileSync(join(OUT, 'board.svg'), board());

console.log(`chess: 12 pieces and the board into ${ OUT }`);
