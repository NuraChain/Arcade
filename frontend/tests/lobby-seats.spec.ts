import { describe, it, expect } from 'vitest';

import { COLOURS, coloursFor } from '../../backend/src/domains/match/ludo/board.ts';
import { lobbySeats } from '../src/components/games/lobby-seats.ts';
import { aroundStadium } from '../src/game/poker-seats.ts';

const SOURCES = import.meta.glob('../src/components/games/{match-board,hokm-board}.component.azeroth', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const sourceOf = (file: string) => SOURCES[`../src/components/games/${ file }`] ?? '';

const places = (game: string, seats: number, mine?: number) => lobbySeats(game, seats, mine).map(({ x, y }) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);

const edge = ([x, y]: readonly number[]) => (Math.abs(x - 0.5) > Math.abs(y - 0.5) ? (x > 0.5 ? 'right' : 'left') : (y > 0.5 ? 'bottom' : 'top'));

describe('where a chair stands at the table of a waiting room', () =>
{
    it('is the corner of the colour its seat will play at a Ludo table, as the board itself has it', () =>
    {
        const corners = Object.fromEntries([...sourceOf('match-board.component.azeroth').matchAll(/^\s+(red|green|blue|yellow): '(top|bottom)-(left|right)',?$/gm)]
            .map(([, colour, row, side]) => [colour, [side === 'left' ? 0 : 1, row === 'top' ? 0 : 1]]));

        expect(Object.keys(corners).sort(), 'the board no longer says where each colour sits').toEqual([...COLOURS].sort());

        for (const seats of [2, 3, 4])
        {
            expect(places('ludo', seats), `${ seats } seats`).toEqual(coloursFor(seats).map((colour) => corners[colour]));
        }
    });

    it('does not move a Ludo chair for whoever is reading: a colour has one corner', () =>
    {
        expect(places('ludo', 4, 2)).toEqual(places('ludo', 4));
        expect(places('ludo', 2, 1)).toEqual(places('ludo', 2));
    });

    it('puts the reader at the foot of a Hokm table and the next to play on their right, as the table itself does', () =>
    {
        const [, listed = ''] = /const FOUR: readonly Side\[\] = \[([^\]]+)\]/.exec(sourceOf('hokm-board.component.azeroth')) ?? [];
        const four = listed.split(',').map((one) => one.trim().replace(/'/g, ''));

        expect(four, 'the table no longer says where four sit').toHaveLength(4);
        expect(places('hokm', 4, 0).map(edge)).toEqual(four);
        expect(places('hokm', 4, 2).map(edge), 'from the third chair').toEqual([four[2], four[3], four[0], four[1]]);
        expect(places('hokm', 2, 1)).toEqual([[0.5, 0], [0.5, 1]]);
        expect(places('hokm', 3, 0).map(([x, y]) => [x > 0.5 ? 'right' : (x < 0.5 ? 'left' : 'middle'), y > 0.5 ? 'foot' : 'head'])).toEqual([['middle', 'foot'], ['right', 'head'], ['left', 'head']]);
    });

    it('goes the other way round a poker table, where the deal goes to the left, as the table itself does', () =>
    {
        for (const seats of [2, 6, 9])
        {
            const real = aroundStadium(seats, 1.6).map((spot) => Math.sign(Math.round(spot.x - 50)));
            const here = places('poker', seats, 0).map(([x]) => Math.sign(Math.round((x - 0.5) * 100)));

            expect(here, `${ seats } seats`).toEqual(real);
        }

        expect(places('poker', 6, 4)[4]).toEqual([0.5, 1]);
    });

    it('seats the two of a backgammon table across from each other, the reader at the foot', () =>
    {
        expect(places('backgammon', 2, 0)).toEqual([[0.5, 1], [0.5, 0]]);
        expect(places('backgammon', 2, 1)).toEqual([[0.5, 0], [0.5, 1]]);
    });

    it('draws a table from its first chair for somebody who is not sitting at it', () =>
    {
        expect(places('hokm', 4)).toEqual(places('hokm', 4, 0));
        expect(places('poker', 9)).toEqual(places('poker', 9, 0));
    });

    it('keeps every chair on the table\'s box and no two in one place, up to nine', () =>
    {
        for (const game of ['hokm', 'poker', 'backgammon', 'ludo'])
        {
            for (const seats of game === 'poker' ? [2, 3, 4, 5, 6, 7, 8, 9] : (game === 'backgammon' ? [2] : [2, 3, 4]))
            {
                const all = lobbySeats(game, seats, 0);

                expect(all.map((one) => one.seat)).toEqual(Array.from({ length: seats }, (_, seat) => seat));
                expect(all.every(({ x, y }) => x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9), `${ game } ${ seats }`).toBe(true);
                expect(new Set(places(game, seats, 0).map((one) => one.join(','))).size, `${ game } ${ seats }`).toBe(seats);
            }
        }
    });
});
