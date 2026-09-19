import { describe, expect, it, vi } from 'vitest';

import { CELL, GRID, MARGIN, RIM, centreOf, tokenRadius } from '../src/game/layout.ts';
import { FINISHED, YARD, pathBetween } from '../src/game/board/path.ts';
import { createSound } from '../src/game/sound.ts';
import { ENTRY, RING_CELLS, cellAt } from '../../server/src/domains/match/ludo/board.ts';
import { chairsOf, ludoOf, type LudoSeat } from '../src/data/match.ts';
import { seatsFor } from '../src/components/games/seats.ts';
import { aroundTable } from '../src/components/games/table-seats.ts';
import type { MatchView } from '../src/api.ts';
import { RANKS as CLIENT_RANKS, SUITS as CLIENT_SUITS, SUIT_ICON, rankOf as clientRank, suitOf as clientSuit } from '../src/data/cards.ts';
import { RANKS as SERVER_RANKS, SUITS as SERVER_SUITS, rankOf as serverRank, suitOf as serverSuit } from '../../server/src/domains/match/hokm/cards.ts';

/**
 * The board, from the three angles a rendering test cannot reach.
 *
 * `npm run qa` reads overflow, hit targets, a landmark and the console, and every one of those
 * passes over a canvas drawing the wrong thing - so the numbers that decide WHERE a token lands,
 * WHICH squares it walks over on the way, and whether the sound layer can fail a matrix cell all
 * have to be asserted here or nowhere.
 */

describe('where the grid sits inside the plate', () =>
{
    /**
     * The canvas and the DOM fallback draw the same board two ways, and the fallback is what a
     * browser with no WebGL gets - so a drift between them is a board that is correct until the
     * moment it matters. `.board-token` places its box at `rim + col * cell + cell * 0.10` and makes
     * it `cell * 0.80` across; this is that arithmetic, and it has to land exactly where `centreOf`
     * and `tokenRadius` put the drawn one.
     */
    it('puts a fallback token exactly where the canvas draws it', () =>
    {
        const size = 1000;

        for (const [col, row] of [[0, 0], [7, 2], [14, 14], [6, 9]])
        {
            const left = (MARGIN + col * CELL + CELL * 0.10) * size;
            const top = (MARGIN + row * CELL + CELL * 0.10) * size;
            const across = CELL * 0.80 * size;

            const drawn = centreOf(col, row, size);

            expect(left + across / 2, `column ${ col } sits elsewhere in the fallback`).toBeCloseTo(drawn.x, 6);
            expect(top + across / 2, `row ${ row } sits elsewhere in the fallback`).toBeCloseTo(drawn.y, 6);
            expect(across / 2).toBeCloseTo(tokenRadius(size), 6);
        }
    });

    it('starts the grid inside the walnut rim, not at the paper edge', () =>
    {
        expect(MARGIN).toBeGreaterThan(RIM);
    });

    it('fits fifteen cells inside the paper with the gutter to spare', () =>
    {
        const end = MARGIN + CELL * GRID;

        expect(end).toBeLessThan(1 - RIM);
        expect(1 - RIM - end).toBeCloseTo(MARGIN - RIM, 6);
    });

    it('centres a cell rather than cornering it', () =>
    {
        const first = centreOf(0, 0, 1000);
        const last = centreOf(GRID - 1, GRID - 1, 1000);

        expect(first.x).toBeCloseTo((MARGIN + CELL / 2) * 1000, 6);
        expect(first.x + last.x).toBeCloseTo(1000, 6);
        expect(first.y).toBeCloseTo(first.x, 6);
    });

    it('scales the token with the board', () =>
    {
        expect(tokenRadius(2000)).toBeCloseTo(tokenRadius(1000) * 2, 6);
        expect(tokenRadius(1000) * 2).toBeLessThan(CELL * 1000);
    });
});

describe('the squares a token walks over', () =>
{
    it('steps onto the entry square when it leaves the yard', () =>
    {
        const walk = pathBetween('red', YARD, 0);

        expect(walk).toHaveLength(1);
        expect(walk[0]).toEqual(cellAt('red', 0));
    });

    /**
     * A straight tween between two squares cuts the corner of the ring and crosses the middle of
     * the board - which is where a token never goes. The walk is what makes a capture something a
     * player watches happen on the squares it happened on.
     */
    it('names every square in between, in order, and not the one it started on', () =>
    {
        const walk = pathBetween('green', 3, 9);

        expect(walk).toHaveLength(6);
        expect(walk[0]).toEqual(cellAt('green', 4));
        expect(walk[walk.length - 1]).toEqual(cellAt('green', 9));

        for (let step = 1; step < walk.length; step += 1)
        {
            const gap = Math.max(
                Math.abs(walk[step].col - walk[step - 1].col),
                Math.abs(walk[step].row - walk[step - 1].row)
            );

            expect(gap, 'a walk jumped a square').toBe(1);
        }
    });

    it('turns the ring rather than cutting across it', () =>
    {
        const walk = pathBetween('red', 0, 51);
        const seen = new Set(walk.map((cell) => `${ cell.col }:${ cell.row }`));

        expect(walk).toHaveLength(51);
        expect(seen.size).toBe(51);
        expect(seen.has(`${ (GRID - 1) / 2 }:${ (GRID - 1) / 2 }`)).toBe(false);
    });

    /**
     * Home is not a square anybody stands on, so the walk stops on the last home cell and the
     * flourish takes it from there. Walking to FINISHED itself would ask the board for a cell that
     * does not exist and quietly drop the last step.
     */
    it('stops on the last home cell when a token finishes', () =>
    {
        const walk = pathBetween('blue', 53, FINISHED);

        expect(walk[walk.length - 1]).toEqual(cellAt('blue', FINISHED - 1));
        expect(walk.every((cell) => cell !== null)).toBe(true);
    });

    it('walks nowhere when a token has not moved', () =>
    {
        expect(pathBetween('yellow', 12, 12)).toHaveLength(0);
    });

    it('enters each colour at its own printed square', () =>
    {
        const entries = new Set<string>();

        for (const colour of ['red', 'green', 'yellow', 'blue'] as const)
        {
            const walk = pathBetween(colour, YARD, 0);

            expect(walk[0], `${ colour } enters somewhere else`).toEqual(RING_CELLS[ENTRY[colour]]);
            entries.add(`${ walk[0].col }:${ walk[0].row }`);
        }

        expect(entries.size, 'two colours share an entry square').toBe(4);
    });
});

describe('the sound layer', () =>
{
    const stub = (): { made: () => number; started: () => number } =>
    {
        let made = 0;
        let started = 0;

        const node = (): Record<string, unknown> => ({
            gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
            frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
            connect: () => undefined,
            start: () => started += 1,
            stop: () => undefined
        });

        vi.stubGlobal('AudioContext', class
        {
            public currentTime = 0;

            public state = 'running';

            public destination = {};

            constructor()
            {
                made += 1;
            }

            public createGain(): Record<string, unknown>
            {
                return node();
            }

            public createOscillator(): Record<string, unknown>
            {
                return node();
            }

            public close(): Promise<void>
            {
                return Promise.resolve();
            }
        });

        return { made: () => made, started: () => started };
    };

    /**
     * This is the whole reason the cues are synthesised behind a gesture rather than played by
     * Phaser. An `AudioContext` constructed without one makes Chrome log "The AudioContext was not
     * allowed to start", the 640-cell matrix reads every console line, and a sound nobody asked for
     * would fail whole routes over a game they never opened.
     */
    it('constructs no audio context until a gesture has been through the window', () =>
    {
        const counts = stub();
        const sound = createSound(true);

        sound.play('roll');
        sound.play('win');

        expect(counts.made()).toBe(0);
        expect(counts.started(), 'a cue was scheduled with no context').toBe(0);

        window.dispatchEvent(new Event('pointerdown'));

        expect(counts.made()).toBe(1);

        window.dispatchEvent(new Event('pointerdown'));
        window.dispatchEvent(new Event('keydown'));

        expect(counts.made(), 'the arming listener was not one-shot').toBe(1);

        sound.dispose();
        vi.unstubAllGlobals();
    });

    it('plays every cue once it is armed, and none of them while it is off', () =>
    {
        const counts = stub();
        const sound = createSound(true);

        window.dispatchEvent(new Event('pointerdown'));

        for (const cue of ['roll', 'step', 'capture', 'home', 'win', 'turn'] as const)
        {
            const before = counts.started();

            sound.play(cue);

            expect(counts.started(), `${ cue } scheduled nothing`).toBeGreaterThan(before);
        }

        const armed = counts.started();

        sound.setEnabled(false);
        sound.play('win');

        expect(counts.started(), 'a cue played with sound turned off').toBe(armed);

        sound.dispose();
        vi.unstubAllGlobals();
    });

    it('opens nothing at all in a browser with no WebAudio', () =>
    {
        vi.stubGlobal('AudioContext', undefined);
        vi.stubGlobal('webkitAudioContext', undefined);

        const sound = createSound(true);

        window.dispatchEvent(new Event('pointerdown'));

        expect(() => sound.play('capture')).not.toThrow();

        sound.dispose();
        vi.unstubAllGlobals();
    });

    it('stops listening once it is disposed', () =>
    {
        const counts = stub();
        const sound = createSound(true);

        sound.dispose();

        window.dispatchEvent(new Event('pointerdown'));

        expect(counts.made()).toBe(0);

        vi.unstubAllGlobals();
    });
});

describe('the two halves of a chair', () =>
{
    /**
     * `matchView` used to carry one flat player: who is sitting there AND where their tokens stand.
     * The server split them so a hokm hand and a poker hole card have somewhere to live that the
     * viewer's own seat decides, and these are the browser's side of that split.
     *
     * The interesting one is what happens to a seat the board did NOT mention. Ludo shows every
     * chair to everybody so it never occurs here - and the day it does, an invented chair with a
     * blank colour and no tokens would render as a fact about the game rather than as a fact about
     * the viewer, which is precisely the confusion the split exists to prevent.
     */
    const match = (seats: LudoSeat[], players: number[]): MatchView => ({
        id: 'm', tableId: 't', game: 'ludo', rev: 3, seats: players.length, turn: 0,
        players: players.map((seat) => ({ seat, who: `p${ seat }`, timeouts: 0 })),
        view: { kind: 'ludo', die: 6, moves: [1], seats },
        startedAt: '2026-09-18T00:00:00.000Z'
    }) as MatchView;

    const seat = (index: number, colour: string): LudoSeat => ({
        seat: index,
        colour,
        home: 0,
        out: false,
        tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 }))
    });

    it('reads the board off a view it recognises', () =>
    {
        expect(ludoOf(match([seat(0, 'red')], [0]))?.die).toBe(6);
    });

    it('joins each player to their own colour', () =>
    {
        const chairs = chairsOf(match([seat(0, 'red'), seat(1, 'green')], [0, 1]));

        expect(chairs.map((chair) => [chair.player.who, chair.seat.colour]))
            .toEqual([['p0', 'red'], ['p1', 'green']]);
    });

    it('drops a player the board did not mention, rather than inventing one', () =>
    {
        const chairs = chairsOf(match([seat(0, 'red')], [0, 1]));

        expect(chairs).toHaveLength(1);
        expect(chairs[0].player.who).toBe('p0');
    });

    /**
     * A watcher passes no seat, so nothing on their board can be pressed. `moves` is what the seat
     * this board was COMPOSED FOR may do, so a board offering a move to somebody with no chair
     * would be offering one they cannot take - which is the whole shape of the watch route.
     *
     * Only the viewer's own seat is asked. A board composed for seat 0 carries seat 0's moves, so
     * reading it as seat 1 is not a state that occurs: `mine` and `view` arrive in one payload.
     */
    it('offers a move only to the seat it was composed for, and none to a watcher', () =>
    {
        const board = ludoOf(match([seat(0, 'red'), seat(1, 'green')], [0, 1]))!;

        expect(seatsFor(board, 0).filter((token) => token.playable).map((token) => token.key))
            .toEqual(['0-1']);

        expect(seatsFor(board).some((token) => token.playable)).toBe(false);
    });
});

describe('the browser reads a card the way the server wrote it', () =>
{
    /**
     * `data/cards.ts` is a second copy of four lines from the server's own `hokm/cards.ts`, and it is
     * a copy on purpose: nothing under `domains/` is client-safe, so importing it would drag a whole
     * engine into the web typecheck program for two arrays. A copy needs a test, which is the same
     * arrangement `handleFromName` has with the browser's fake api.
     *
     * A disagreement here would be silent and total: every card in every hand drawn as the wrong
     * rank, or the wrong suit, with nothing anywhere failing.
     */
    it('decodes all fifty-two exactly as the engine encodes them', () =>
    {
        for (let card = 0; card < 52; card += 1)
        {
            expect(clientSuit(card), `card ${ card }`).toBe(serverSuit(card));
            expect(clientRank(card), `card ${ card }`).toBe(SERVER_RANKS[serverRank(card)]);
        }

        expect(CLIENT_SUITS).toEqual([...SERVER_SUITS]);
        expect(CLIENT_RANKS).toEqual([...SERVER_RANKS]);
    });

    it('has an icon for every suit and never a bare character', () =>
    {
        for (const suit of CLIENT_SUITS)
        {
            expect(SUIT_ICON[suit], suit).toMatch(/^suit-/);
        }
    });
});

describe('where a card lands on the felt', () =>
{
    /**
     * The one thing that makes a table readable: your own card is nearest you and your partner's is
     * across from you, whoever you are. Drawn from seat zero instead, a player in seat 2 would watch
     * their own card land at the far edge and their opponent's land under their chin - which reads
     * as a shuffled table rather than as a bug, and is therefore never reported.
     */
    it('seats the reader at the bottom whichever chair the server gave them', () =>
    {
        for (const seats of [2, 3, 4])
        {
            for (let mine = 0; mine < seats; mine += 1)
            {
                const chairs = aroundTable(seats, mine);
                const own = chairs.find((chair) => chair.seat === mine)!;

                expect(own.place, `seat ${ mine } of ${ seats }`).toBe(0);
                expect(own.x).toBeCloseTo(0.5, 6);
                expect(own.y, 'the reader is not at the bottom').toBeGreaterThan(0.5);
            }
        }
    });

    /**
     * Play passes to the right, which is counter-clockwise at a table and clockwise looking down at
     * one. Backwards, a four-handed game still works - partners are opposite either way - and
     * everybody watches the turn travel the wrong way round the table all evening.
     */
    it('puts the next player on the reader right and the partner across', () =>
    {
        const chairs = aroundTable(4, 1);

        expect(chairs[2].place).toBe(1);
        expect(chairs[2].x, 'the next seat is not to the right').toBeGreaterThan(0.5);
        expect(chairs[2].y).toBeCloseTo(0.5, 6);

        const own = chairs[1];
        const partner = chairs[3];

        expect(partner.place).toBe(2);
        expect(partner.x + own.x).toBeCloseTo(1, 6);
        expect(partner.y + own.y).toBeCloseTo(1, 6);
    });

    it('keeps every card on the cloth and gives a watcher a full table', () =>
    {
        for (const seats of [2, 3, 4])
        {
            const chairs = aroundTable(seats, null);

            expect(chairs).toHaveLength(seats);
            expect(new Set(chairs.map((chair) => chair.place)).size).toBe(seats);

            for (const chair of chairs)
            {
                expect(chair.x).toBeGreaterThan(0.2);
                expect(chair.x).toBeLessThan(0.8);
                expect(chair.y).toBeGreaterThan(0.2);
                expect(chair.y).toBeLessThan(0.8);
                expect(Math.abs(chair.tilt)).toBeLessThan(10);
            }
        }
    });
});
