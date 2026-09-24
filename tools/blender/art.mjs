import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD = join(HERE, '..', '..', 'application', 'public', 'board');
const OUT = join(HERE, 'scratch', 'art');

export const CARD_CODES = ['AH', 'KH', 'QH', 'JH', '10H', 'AS', 'KS', 'QS', 'JS', 'AD', 'KD', '10D', '7D'];

const SUIT_ROW = { C: 0, D: 1, H: 2, S: 3 };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SPRITE = { width: 204, height: 288 };
const ATLAS = { width: 2048, height: 1024 };
const COLUMNS = 7;
const CELL = { width: Math.floor(ATLAS.width / COLUMNS), height: Math.floor(ATLAS.width / COLUMNS * SPRITE.height / SPRITE.width) };
const BOARD_SIZE = 2048;

const CHIP_COLOURS = [
    ['red', '#B91C1C', '#7F1111'],
    ['green', '#15803D', '#0E5A2A'],
    ['blue', '#1D4ED8', '#0F3A8C'],
    ['black', '#1E293B', '#020617'],
    ['gold', '#D97706', '#92400E']
];
const CHIP = { face: 204, edge: 40, width: 1020 };

const dataUrl = (file) => `data:image/svg+xml;base64,${ readFileSync(join(BOARD, file)).toString('base64') }`;

const sourceOf = (code) => ({
    x: RANKS.indexOf(code.slice(0, -1)) * SPRITE.width,
    y: SUIT_ROW[code.slice(-1)] * SPRITE.height
});

export async function rasterise()
{
    mkdirSync(OUT, { recursive: true });

    const cells = [...CARD_CODES, 'back'].map((code, index) => ({
        code,
        x: (index % COLUMNS) * CELL.width,
        y: Math.floor(index / COLUMNS) * CELL.height,
        width: CELL.width,
        height: CELL.height
    }));

    const browser = await launchChrome();
    try
    {
        const page = await browser.newPage();

        const atlas = await page.evaluate(async ({ deck, back, cells, sources, width, height }) =>
        {
            const load = (src) => new Promise((resolve, reject) =>
            {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = src;
            });
            const [sprite, cover] = await Promise.all([load(deck), load(back)]);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.imageSmoothingQuality = 'high';
            for (const cell of cells)
            {
                if (cell.code === 'back')
                {
                    context.drawImage(cover, cell.x, cell.y, cell.width, cell.height);
                    continue;
                }
                const source = sources[cell.code];
                context.drawImage(sprite, source.x, source.y, 204, 288, cell.x, cell.y, cell.width, cell.height);
            }
            return canvas.toDataURL('image/png');
        }, {
            deck: dataUrl('deck.svg'),
            back: dataUrl('card-back.svg'),
            cells,
            sources: Object.fromEntries(CARD_CODES.map((code) => [code, sourceOf(code)])),
            width: ATLAS.width,
            height: ATLAS.height
        });

        const board = await page.evaluate(async ({ src, size }) =>
        {
            const image = await new Promise((resolve, reject) =>
            {
                const element = new Image();
                element.onload = () => resolve(element);
                element.onerror = reject;
                element.src = src;
            });
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext('2d');
            context.imageSmoothingQuality = 'high';
            context.drawImage(image, 0, 0, size, size);
            return canvas.toDataURL('image/png');
        }, { src: dataUrl('ludo-board.svg'), size: BOARD_SIZE });

        const chipCells = CHIP_COLOURS.map(([name], index) => ({
            name,
            face: { x: index * CHIP.face, y: 0, width: CHIP.face, height: CHIP.face },
            edge: { x: 0, y: CHIP.face + index * CHIP.edge, width: CHIP.width, height: CHIP.edge }
        }));

        const chips = await page.evaluate(({ colours, cells, size }) =>
        {
            const canvas = document.createElement('canvas');
            canvas.width = size.width;
            canvas.height = size.height;
            const context = canvas.getContext('2d');
            const SPOTS = 8;
            cells.forEach((cell, index) =>
            {
                const [, body, rim] = colours[index];
                const { x, y, width } = cell.face;
                const radius = width / 2;
                const cx = x + radius;
                const cy = y + radius;
                context.fillStyle = body;
                context.beginPath();
                context.arc(cx, cy, radius, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = '#F8FAFC';
                for (let spot = 0; spot < SPOTS; spot += 1)
                {
                    const angle = (spot / SPOTS) * Math.PI * 2;
                    context.save();
                    context.translate(cx, cy);
                    context.rotate(angle);
                    context.fillRect(radius * 0.74, -radius * 0.11, radius * 0.26, radius * 0.22);
                    context.restore();
                }
                context.strokeStyle = 'rgba(248, 250, 252, 0.85)';
                context.lineWidth = radius * 0.035;
                context.setLineDash([radius * 0.09, radius * 0.06]);
                context.beginPath();
                context.arc(cx, cy, radius * 0.64, 0, Math.PI * 2);
                context.stroke();
                context.setLineDash([]);
                context.fillStyle = rim;
                context.beginPath();
                context.arc(cx, cy, radius * 0.56, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = body;
                context.beginPath();
                context.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
                context.fill();

                const edge = cell.edge;
                context.fillStyle = body;
                context.fillRect(edge.x, edge.y, edge.width, edge.height);
                context.fillStyle = '#F8FAFC';
                const stripe = edge.width / SPOTS;
                for (let spot = 0; spot < SPOTS; spot += 1)
                {
                    context.fillRect(edge.x + spot * stripe + stripe * 0.37, edge.y, stripe * 0.26, edge.height);
                }
            });
            return canvas.toDataURL('image/png');
        }, { colours: CHIP_COLOURS, cells: chipCells, size: { width: CHIP.width, height: CHIP.face + CHIP_COLOURS.length * CHIP.edge } });

        const write = (name, url) => writeFileSync(join(OUT, name), Buffer.from(url.split(',')[1], 'base64'));
        write('cards.png', atlas);
        write('ludo-board.png', board);
        write('chips.png', chips);
        writeFileSync(join(OUT, 'cards.json'), JSON.stringify({ ...ATLAS, cells }, null, 4));
        writeFileSync(join(OUT, 'chips.json'), JSON.stringify({ width: CHIP.width, height: CHIP.face + CHIP_COLOURS.length * CHIP.edge, cells: chipCells }, null, 4));
    }
    finally
    {
        await browser.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
    await rasterise();
    console.log(`  art         ${ OUT }`);
}
