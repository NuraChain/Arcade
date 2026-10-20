import { describe, it, expect } from 'vitest';

import { createResampler } from '../src/services/voice.resample.ts';
import { framed } from '../src/services/voice.relay.ts';

const tone = (hz: number, rate: number, length: number, level = 0.5) =>
    Float32Array.from({ length }, (_, at) => level * Math.sin(2 * Math.PI * hz * at / rate));

const level = (samples: Float32Array, from = 0, to = samples.length) =>
{
    let sum = 0;

    for (let at = from; at < to; at += 1)
    {
        sum += samples[at] * samples[at];
    }

    return Math.sqrt(sum / Math.max(1, to - from));
};

const crossings = (samples: Float32Array, from: number, to: number) =>
{
    let count = 0;

    for (let at = from + 1; at < to; at += 1)
    {
        if ((samples[at - 1] < 0) !== (samples[at] < 0))
        {
            count += 1;
        }
    }

    return count;
};

describe('sound brought from one rate to another', () =>
{
    it('brings a steady sound down to the telephone\'s rate and up again without moving it', () =>
    {
        const down = createResampler(48_000, 16_000).push(new Float32Array(4800).fill(0.3));
        const up = createResampler(16_000, 48_000).push(new Float32Array(1600).fill(-0.2));

        expect(down.length).toBeGreaterThan(1580);
        expect(down.length).toBeLessThanOrEqual(1600);
        expect(down.slice(100, 1500).every((value) => Math.abs(value - 0.3) < 1e-5), 'a steady sound came out at another level').toBe(true);
        expect(up.slice(300, 4500).every((value) => Math.abs(value + 0.2) < 1e-5), 'a steady sound came out at another level').toBe(true);
    });

    it('keeps a tone the telephone can carry, and takes out one that would fold back into what it can', () =>
    {
        const kept = createResampler(48_000, 16_000).push(tone(1000, 48_000, 48_000));
        const folded = createResampler(48_000, 16_000).push(tone(12_000, 48_000, 48_000));

        expect(level(kept, 200, 15_000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
        expect(crossings(kept, 1000, 15_000)).toBeGreaterThan(1740);
        expect(crossings(kept, 1000, 15_000)).toBeLessThan(1760);
        expect(level(folded, 200, 15_000), 'a tone above what the telephone carries was folded into what it does').toBeLessThan(0.005);
    });

    it('brings a sound down in pieces exactly as it would whole', () =>
    {
        const whole = tone(440, 44_100, 2646 * 6);
        const once = createResampler(44_100, 48_000).push(whole);
        const pieces = createResampler(44_100, 48_000);
        const joined: number[] = [];

        for (let at = 0; at < whole.length; at += 2646)
        {
            joined.push(...pieces.push(whole.slice(at, at + 2646)));
        }

        expect(joined.length).toBe(once.length);
        expect(joined.every((value, at) => Math.abs(value - once[at]) < 1e-6)).toBe(true);
    });

    it('brings 44.1 kHz up to Opus\'s 48 kHz with the tone where it was', () =>
    {
        const up = createResampler(44_100, 48_000).push(tone(440, 44_100, 44_100));

        expect(Math.abs(up.length - 48_000)).toBeLessThan(40);
        expect(crossings(up, 1000, 47_000)).toBeGreaterThan(Math.floor(880 * 46 / 48) - 2);
        expect(crossings(up, 1000, 47_000)).toBeLessThan(Math.ceil(880 * 46 / 48) + 2);
        expect(level(up, 1000, 47_000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    });

    it('puts every sample between two others where it falls in time', () =>
    {
        const step = 44_100 / 48_000;
        const up = createResampler(44_100, 48_000).push(tone(1000, 44_100, 44_100));
        let worst = 0;

        for (let at = 200; at < up.length - 200; at += 1)
        {
            const time = at * step - 16;

            worst = Math.max(worst, Math.abs(up[at] - 0.5 * Math.sin(2 * Math.PI * 1000 * time / 44_100)));
        }

        expect(worst, 'a sample was taken from the wrong moment').toBeLessThan(0.005);
    });

    it('hands every frame over at the length a frame is, whatever a resampler gave this time', () =>
    {
        const frame = framed(4);

        expect([...frame(Float32Array.from([1, 2, 3]))]).toEqual([1, 2, 3, 3]);
        expect([...frame(Float32Array.from([4, 5, 6, 7, 8]))]).toEqual([4, 5, 6, 7]);
        expect([...frame(Float32Array.from([9, 10, 11]))]).toEqual([8, 9, 10, 11]);
    });
});
