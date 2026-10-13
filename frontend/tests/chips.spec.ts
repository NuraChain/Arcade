import { describe, expect, it } from 'vitest';

import { discsFor, pour, type Pour } from '../src/game/stage/chips.ts';
import { createStage } from '../src/game/stage/stage.ts';
import { manualClock } from '../src/lib/clock.ts';

describe('how many discs stand for an amount of chips', () =>
{
    it.each([
        [0, 0],
        [10, 1],
        [20, 1],
        [30, 2],
        [50, 2],
        [60, 3],
        [120, 3],
        [130, 4],
        [300, 4],
        [320, 5],
        [1500, 5],
        [1_000_000, 5]
    ])('%i chips against a big blind of 20 are %i', (amount, discs) =>
    {
        expect(discsFor(amount, 20)).toBe(discs);
    });

    it('never draws fewer discs for more chips, and never more than five', () =>
    {
        const drawn = Array.from({ length: 400 }, (_, step) => discsFor(step * 5, 20));

        expect(drawn.every((discs, at) => at === 0 || discs >= drawn[at - 1])).toBe(true);
        expect(Math.max(...drawn)).toBe(5);
        expect(drawn[0]).toBe(0);
        expect(drawn[1]).toBe(1);
    });

    it('measures against the blind and not the number: the same stack is smaller when the blinds have risen', () =>
    {
        expect(discsFor(600, 20)).toBe(5);
        expect(discsFor(600, 200)).toBe(3);
        expect(discsFor(600, 2000)).toBe(1);
    });

    it('still draws something where there is no blind to measure against', () =>
    {
        expect(discsFor(0, 0)).toBe(0);
        expect(discsFor(1, 0)).toBe(1);
        expect(discsFor(40, 0)).toBe(5);
    });
});

describe('discs poured from one place to another', () =>
{
    const from = { x: 20, y: 300, width: 120, height: 40 };
    const to = { x: 200, y: 100, width: 10, height: 10 };

    const poured = (quiet: boolean, flight: Partial<Pour> = {}) =>
    {
        const clock = manualClock(0);
        const stage = createStage({ clock, quiet: () => quiet });
        const layer = document.createElement('div');
        let landed = false;

        document.body.append(layer);

        const run = pour(stage, layer, from, to, { discs: 3, duration: 300, gap: 45, easing: 'linear', ...flight });

        void run.done.then(() =>
        {
            landed = true;
        });

        return { clock, stage, layer, run, landed: () => landed, discs: () => [...layer.querySelectorAll<HTMLElement>('.flight.chip-stack')] };
    };

    const turns = async () =>
    {
        await Promise.resolve();
        await Promise.resolve();
    };

    it('are as many as were asked for, each the size of the place it lands on and drawn as one disc', () =>
    {
        const { discs } = poured(false);

        expect(discs()).toHaveLength(3);
        expect(discs().map((one) => [one.dataset.chips, one.style.width, one.style.height, one.style.left, one.style.top])).toEqual(Array.from({ length: 3 }, () => ['1', '10px', '10px', '200px', '100px']));
        expect(discs().every((one) => one.getAttribute('aria-hidden') === 'true')).toBe(true);
        expect(Number.parseFloat(discs()[0].style.fontSize), 'the disc is not drawn at the size of the box it lands in').toBeCloseTo(10 / 0.85, 5);
    });

    it('leave one after another and are gone as each lands, and the pour is over when the last one has', async () =>
    {
        const { clock, discs, landed, run } = poured(false);

        expect(run.length).toBe(390);

        clock.advance(299);
        await turns();
        expect(discs()).toHaveLength(3);

        clock.advance(1);
        await turns();
        expect(discs()).toHaveLength(2);
        expect(landed()).toBe(false);

        clock.advance(45);
        await turns();
        expect(discs()).toHaveLength(1);

        clock.advance(45);
        await turns();
        expect(discs()).toHaveLength(0);
        expect(landed()).toBe(true);
    });

    it('wait their turn when they are told to leave later', async () =>
    {
        const { clock, discs, landed, run } = poured(false, { discs: 1, delay: 120 });

        expect(run.length).toBe(420);

        clock.advance(419);
        await turns();
        expect([discs().length, landed()]).toEqual([1, false]);

        clock.advance(1);
        await turns();
        expect([discs().length, landed()]).toEqual([0, true]);
    });

    it('pour one disc when none was asked for, so that something is seen to move', () =>
    {
        expect(poured(false, { discs: 0 }).discs()).toHaveLength(1);
    });

    it('never say they landed when the stage is cleared under them, and leave the layer to the table that owns it', async () =>
    {
        const { clock, discs, landed, stage } = poured(false);

        clock.advance(100);
        stage.clear();
        clock.advance(1000);
        await turns();

        expect(landed()).toBe(false);
        expect(discs(), 'the kit emptied a layer it does not own').toHaveLength(3);
    });

    it('still land when the reader asked for less motion, in the time of a fade and in the same order', async () =>
    {
        const { clock, discs, landed } = poured(true);

        expect(discs()).toHaveLength(3);

        clock.advance(140);
        await turns();
        expect(discs()).toHaveLength(2);

        clock.advance(90);
        await turns();
        expect(discs()).toHaveLength(0);
        expect(landed()).toBe(true);
    });
});
