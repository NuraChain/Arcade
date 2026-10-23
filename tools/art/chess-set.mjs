/**
 * The chess set: twelve Staunton pieces in ivory and ebony, every one drawn here from shapes and
 * nothing taken from a third-party set. Each piece is layered shapes in a 100-unit box, filled
 * under a soft light from the upper left and outlined in the walnut ink the board's own lines use,
 * so the set reads as one object at a phone's 40px square and at a desktop's 110. `chess.mjs`
 * writes each piece as a file of its own; the game's card in `games.mjs` stands the same pieces on
 * its board, each under ids of its own.
 */

const INK = '#2B1A0E';

const SHADES = {
    w: { top: '#FFFBF1', middle: '#F2E5CB', bottom: '#D4BF9A', line: INK, gloss: 0.55, detail: '#7A5A3A' },
    b: { top: '#5E544C', middle: '#302A26', bottom: '#161311', line: '#0B0908', gloss: 0.24, detail: '#A89A8C' }
};

/** The parts every piece stands on: a plinth with a lip, and the ring above it. */
const BASE = [
    { kind: 'path', d: 'M19 92 C19 85.5 23 83.2 30 82.8 L70 82.8 C77 83.2 81 85.5 81 92 Z' },
    { kind: 'path', d: 'M26 83.2 C26.8 78.6 30.5 76.6 35.5 76.4 L64.5 76.4 C69.5 76.6 73.2 78.6 74 83.2 Z' }
];

const PIECES = {
    p: [
        { kind: 'path', d: 'M35.5 76.6 C37.4 66.8 42.6 59.6 44.6 51.4 L55.4 51.4 C57.4 59.6 62.6 66.8 64.5 76.6 Z' },
        { kind: 'ellipse', cx: 50, cy: 50.6, rx: 11.6, ry: 3.6 },
        { kind: 'circle', cx: 50, cy: 37, r: 11.4 }
    ],
    r: [
        { kind: 'path', d: 'M32 76.6 C33.6 66 35.2 56 36.4 46.4 L63.6 46.4 C64.8 56 66.4 66 68 76.6 Z' },
        { kind: 'path', d: 'M30.6 46.6 L30.6 39.4 C30.6 38 31.6 37.2 33 37.2 L67 37.2 C68.4 37.2 69.4 38 69.4 39.4 L69.4 46.6 Z' },
        { kind: 'path', d: 'M29.6 37.4 L29.6 21.4 L38.6 21.4 L38.6 27.4 L45.2 27.4 L45.2 21.4 L54.8 21.4 L54.8 27.4 L61.4 27.4 L61.4 21.4 L70.4 21.4 L70.4 37.4 Z' },
        { kind: 'line', d: 'M35.4 57.4 L64.6 57.4', detail: true }
    ],
    b: [
        { kind: 'path', d: 'M36.6 76.6 C38.6 67.2 43.6 61.4 45 55.6 L55 55.6 C56.4 61.4 61.4 67.2 63.4 76.6 Z' },
        { kind: 'ellipse', cx: 50, cy: 54.8, rx: 12, ry: 3.6 },
        { kind: 'path', d: 'M50 21.6 C59.6 28.4 63.6 38.6 59.6 47.4 C57.6 51.2 54.2 52.6 50 52.6 C45.8 52.6 42.4 51.2 40.4 47.4 C36.4 38.6 40.4 28.4 50 21.6 Z' },
        { kind: 'circle', cx: 50, cy: 18.4, r: 4.4 },
        { kind: 'line', d: 'M55.6 31.6 L46.4 42.6', detail: true }
    ],
    n: [
        { kind: 'path', d: 'M33.4 76.6 C32.2 67.6 33.8 60.4 39.2 54.6 C35.4 53.6 30.8 52.4 26.2 49.8 C21.6 47.4 19.8 43.2 21.6 39.6 C23.6 35.4 27.8 32.6 31.4 28.6 C34 25.6 36.8 21.2 41.8 18.2 L42.6 11.8 C44.6 12.2 46.6 14.4 47.6 16.4 C49.2 15.2 51.4 14.6 53.4 15.6 C62.2 18.6 68.4 26.8 70.2 37.8 C71.8 48.2 70.2 61.6 67.6 76.6 Z' },
        { kind: 'line', d: 'M53.4 16.6 C61.4 22.4 65 31.4 65.6 42.4 C66.2 51.8 64.6 62.4 63 72', detail: true },
        { kind: 'line', d: 'M22.4 44.6 C24.8 45.4 27.4 45.6 29.8 45', detail: true },
        { kind: 'dot', cx: 37.6, cy: 27.4, r: 2.2 },
        { kind: 'dot', cx: 25.2, cy: 40.4, r: 1.3 }
    ],
    q: [
        { kind: 'path', d: 'M34.6 76.6 C37.6 64.8 42.4 57.4 43.6 49.2 L56.4 49.2 C57.6 57.4 62.4 64.8 65.4 76.6 Z' },
        { kind: 'ellipse', cx: 50, cy: 48.4, rx: 12.8, ry: 3.8 },
        { kind: 'path', d: 'M37.4 45.6 L31.8 26.6 L40.6 36.4 L42.2 21.8 L48 34.6 L50 19.4 L52 34.6 L57.8 21.8 L59.4 36.4 L68.2 26.6 L62.6 45.6 Z' },
        { kind: 'circle', cx: 31.6, cy: 25, r: 3.2 },
        { kind: 'circle', cx: 42.2, cy: 20.2, r: 3.2 },
        { kind: 'circle', cx: 50, cy: 17.6, r: 3.4 },
        { kind: 'circle', cx: 57.8, cy: 20.2, r: 3.2 },
        { kind: 'circle', cx: 68.4, cy: 25, r: 3.2 }
    ],
    k: [
        { kind: 'path', d: 'M34.6 76.6 C37.6 64.8 42.4 57.4 43.6 49.2 L56.4 49.2 C57.6 57.4 62.4 64.8 65.4 76.6 Z' },
        { kind: 'ellipse', cx: 50, cy: 48.4, rx: 12.8, ry: 3.8 },
        { kind: 'path', d: 'M37.6 46 C34.2 37.6 37.4 30.8 44 30 C46.4 29.8 48.4 30.6 50 31.6 C51.6 30.6 53.6 29.8 56 30 C62.6 30.8 65.8 37.6 62.4 46 Z' },
        { kind: 'path', d: 'M47.4 7.4 L52.6 7.4 L52.6 13.6 L58.4 13.6 L58.4 18.8 L52.6 18.8 L52.6 29.6 L47.4 29.6 L47.4 18.8 L41.6 18.8 L41.6 13.6 L47.4 13.6 Z' },
        { kind: 'line', d: 'M40.4 40.2 C45.8 38.4 54.2 38.4 59.6 40.2', detail: true }
    ]
};

export const KINDS = Object.keys(PIECES);

const shapeOf = (shape, paint) =>
{
    if (shape.kind === 'circle')
    {
        return `<circle cx="${ shape.cx }" cy="${ shape.cy }" r="${ shape.r }" ${ paint }/>`;
    }

    if (shape.kind === 'ellipse')
    {
        return `<ellipse cx="${ shape.cx }" cy="${ shape.cy }" rx="${ shape.rx }" ry="${ shape.ry }" ${ paint }/>`;
    }

    return `<path d="${ shape.d }" ${ paint }/>`;
};

/** The two gradients a piece is lit with, named by `id` so that many pieces can share one drawing. */
export function pieceDefs(colour, id)
{
    const shade = SHADES[colour];

    return [
        `<linearGradient id="${ id }-body" x1="0.18" y1="0" x2="0.82" y2="1"><stop offset="0" stop-color="${ shade.top }"/><stop offset="0.55" stop-color="${ shade.middle }"/><stop offset="1" stop-color="${ shade.bottom }"/></linearGradient>`,
        `<radialGradient id="${ id }-gloss" cx="0.32" cy="0.22" r="0.62"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${ shade.gloss }"/><stop offset="0.7" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`
    ].join('');
}

/** One piece in its 100-unit box: every body filled under the light and outlined, then its ink details, then the gloss. */
export function pieceBody(colour, kind, id)
{
    const shade = SHADES[colour];
    const bodies = [...BASE, ...PIECES[kind]].filter((shape) => shape.kind !== 'line' && shape.kind !== 'dot');
    const details = PIECES[kind].filter((shape) => shape.kind === 'line' || shape.kind === 'dot');
    const outline = `stroke="${ shade.line }" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

    return [
        '<g transform="translate(50 52) scale(1.08) translate(-50 -52)">',
        ...bodies.map((shape) => shapeOf(shape, `fill="url(#${ id }-body)" ${ outline }`)),
        ...details.map((shape) => (shape.kind === 'dot'
            ? shapeOf(shape, `fill="${ shade.line }"`)
            : shapeOf(shape, `fill="none" stroke="${ colour === 'w' ? shade.line : shade.detail }" stroke-width="2" stroke-linecap="round" stroke-opacity="${ colour === 'w' ? 0.75 : 0.6 }"`))),
        ...bodies.map((shape) => shapeOf(shape, `fill="url(#${ id }-gloss)"`)),
        '</g>'
    ].join('');
}

/** A piece as a file of its own. */
export function pieceSvg(colour, kind)
{
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
        `<defs>${ pieceDefs(colour, 'p') }</defs>`,
        pieceBody(colour, kind, 'p'),
        '</svg>'
    ].join('');
}
