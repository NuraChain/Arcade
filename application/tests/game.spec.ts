import { describe, expect, it, vi } from 'vitest';

import { CELL, GRID, MARGIN, RIM, centreOf, tokenRadius } from '../src/game/layout.ts';
import { FINISHED, YARD, pathBetween } from '../src/game/board/path.ts';
import { createSound } from '../src/game/sound.ts';
import { ENTRY, RING_CELLS, cellAt } from '../../server/src/domains/match/ludo/board.ts';

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
