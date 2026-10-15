import { describe, it, expect } from 'vitest';

import { Playout } from '../src/services/voice.playout.ts';

const RATE = 48_000;

const FRAME = 2880;

const SLICE = 128;

interface Sent
{
    index: number;
    samples: Float32Array;
    arrival: number;
}

let seed = 1;

const random = () =>
{
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
};

const tone = (index: number, hz = 220, level = 0.3) =>
    Float32Array.from({ length: FRAME }, (_, at) => level * Math.sin(2 * Math.PI * hz * (index * FRAME + at) / RATE));

const ms = (value: number) => Math.round(value * RATE / 1000);

function line(count: number, delay: (index: number) => number, skip: (index: number) => boolean = () => false, make = tone)
{
    const sent: Sent[] = [];
    let last = 0;

    for (let index = 0; index < count; index += 1)
    {
        if (skip(index))
        {
            continue;
        }

        const arrival = Math.max(last, (index + 1) * FRAME + ms(delay(index)));

        last = arrival;
        sent.push({ index, samples: make(index), arrival });
    }

    return sent;
}

function play(sent: readonly Sent[], length: number, playout = new Playout(RATE, 60))
{
    const out = new Float32Array(length);
    let next = 0;

    for (let now = 0; now + SLICE <= length; now += SLICE)
    {
        while (next < sent.length && sent[next].arrival <= now)
        {
            playout.take(sent[next].index, sent[next].samples, now);
            next += 1;
        }

        const slice = new Float32Array(SLICE);

        playout.fill(slice, now);
        out.set(slice, now);
    }

    return { out, playout };
}

const steps = (out: Float32Array, from = 0, to = out.length) =>
{
    let most = 0;

    for (let at = Math.max(1, from); at < to; at += 1)
    {
        most = Math.max(most, Math.abs(out[at] - out[at - 1]));
    }

    return most;
};

const level = (out: Float32Array, from: number, to: number) =>
{
    let sum = 0;

    for (let at = from; at < to; at += 1)
    {
        sum += out[at] * out[at];
    }

    return Math.sqrt(sum / Math.max(1, to - from));
};

const sinStep = 0.3 * 2 * Math.PI * 220 / RATE;

const runOf = (out: Float32Array, value: number, from: number) =>
{
    for (let at = Math.max(0, from); at + 20 <= out.length; at += 1)
    {
        if (out.subarray(at, at + 20).every((one) => Math.abs(one - value) < 1e-3))
        {
            return at;
        }
    }

    return -1;
};

describe('a carried voice, played', () =>
{
    it('starts a call as far behind as a line that is not yet known needs, and comes down to what the line shows', () =>
    {
        const early = new Playout(RATE, 60);

        play(line(6, () => 30), FRAME * 8, early);

        expect(early.stats().buffer).toBeGreaterThan(100);
    });

    it('plays a steady line in order, without a click, about the least buffer behind it once the line is known', () =>
    {
        const { out, playout } = play(line(200, () => 30), FRAME * 210);
        const stats = playout.stats();

        expect(stats.jitter).toBeLessThanOrEqual(3);
        expect(stats.buffer).toBe(20);
        expect(stats.taken, 'every frame that came is counted, so a share of them can be said').toBe(200);
        expect(stats.late).toBe(0);
        expect(steps(out, ms(400)), 'a sample jumped further than the tone it plays').toBeLessThan(sinStep * 1.6);
        expect(level(out, FRAME * 100, FRAME * 150)).toBeCloseTo(0.3 / Math.SQRT2, 2);
    });

    it('holds as much as the line has shown it needs, and nothing is late once it has learned the line', () =>
    {
        seed = 7;

        const sent = line(1000, () => 10 + random() * 90);
        const { out, playout } = play(sent, FRAME * 1010);
        const early = new Playout(RATE, 60);

        play(sent.slice(0, 300), FRAME * 310, early);

        const stats = playout.stats();

        expect(stats.jitter).toBeGreaterThan(75);
        expect(stats.jitter).toBeLessThan(105);
        expect(stats.buffer).toBeGreaterThanOrEqual(stats.jitter);
        expect(stats.late, 'frames were late long after the line had been learned').toBe(early.stats().late);
        expect(steps(out, ms(500)), 'a sample jumped further than the tone it plays').toBeLessThan(sinStep * 1.6);
    });

    it('waits for a frame that comes late, covering the wait with the last sound fading, and plays everything it carried', () =>
    {
        const marked = (index: number) => (index === 60 ? new Float32Array(FRAME).fill(0.5) : tone(index));
        const sent = line(120, (index) => (index === 60 ? 400 : 30), () => false, marked);
        const { out, playout } = play(sent, FRAME * 140);
        const arrival = sent.find((one) => one.index === 60)!.arrival;
        const after = out.subarray(arrival, arrival + FRAME * 2);
        const steady = after.filter((value) => Math.abs(value - 0.5) < 1e-3).length;

        expect(playout.stats().late).toBeGreaterThanOrEqual(1);
        expect(playout.stats().concealed).toBeGreaterThan(0);
        expect(steady, 'the late frame was not played whole').toBeGreaterThan(FRAME * 0.9);
        expect(steps(out, ms(400)), 'the wait or the return to the sound clicked').toBeLessThan(0.3);
    });

    it('takes a pause in what was sent for silence, and starts the next phrase the measured moment after it arrives', () =>
    {
        const sent = line(240, () => 30, (index) => index >= 150 && index < 180);
        const { out, playout } = play(sent, FRAME * 250);
        const resumed = sent.find((one) => one.index === 180)!.arrival;
        const quiet = level(out, FRAME * 154 + ms(200), resumed);
        const first = out.findIndex((value, at) => at > resumed - ms(200) && Math.abs(value) > 0.01);

        expect(quiet).toBeLessThan(1e-4);
        expect(first - resumed).toBeGreaterThanOrEqual(ms(20) - SLICE);
        expect(first - resumed).toBeLessThanOrEqual(ms(20) + SLICE);
        expect(playout.stats().late).toBe(0);
        expect(steps(out, ms(400)), 'the phrase ended or began with a click').toBeLessThan(sinStep * 1.6);
    });

    it('covers one frame lost inside a phrase and plays the next one in its place in time', () =>
    {
        seed = 3;

        const marked = (index: number) => (index === 151 ? new Float32Array(FRAME).fill(0.4) : (index === 149 ? new Float32Array(FRAME).fill(0.2) : tone(index)));
        const sent = line(200, (index) => (index > 140 && index < 160 ? 40 : 10 + random() * 90), (index) => index === 150, marked);
        const { out, playout } = play(sent, FRAME * 210);
        const due = sent.find((one) => one.index === 151)!.arrival;
        const start = runOf(out, 0.4, due - FRAME);
        const before = runOf(out, 0.2, due - FRAME * 4);

        expect(playout.stats().concealed).toBeGreaterThan(0);
        expect(level(out, start - FRAME, start - FRAME + ms(20)), 'the lost frame was silence and not covered').toBeGreaterThan(0.05);
        expect(Math.abs(start - before - 2 * FRAME), 'the frame after a lost one was not played where it belongs').toBeLessThan(ms(6));
        expect(steps(out, ms(400))).toBeLessThan(0.45);
    });

    it('goes from the cover back to the sound without a click when a frame comes a moment late', () =>
    {
        const sent = line(240, (index) => (index === 160 ? 75 : 30));
        const { out, playout } = play(sent, FRAME * 250);
        const late = sent.find((one) => one.index === 160)!.arrival;

        expect(playout.stats().concealed).toBeGreaterThan(0);
        expect(steps(out, late - ms(80), late + ms(80)), 'the sound came back over the cover with a click').toBeLessThan(0.06);
    });

    it('takes one stall of the line for one late moment, and catches up afterwards in the quiet rather than by cutting the sound', () =>
    {
        const speech = (index: number) => (Math.floor(index / 5) % 2 === 0 ? tone(index) : new Float32Array(FRAME));
        const sent = line(400, (index) => (index === 100 ? 600 : 30), () => false, speech);
        const { out, playout } = play(sent, FRAME * 410);
        const ends = new Playout(RATE, 60);

        play(sent.slice(0, 160), FRAME * 160, ends);

        expect(playout.stats().late).toBeGreaterThanOrEqual(1);
        expect(playout.stats().skipped).toBeGreaterThan(0);
        expect(ends.stats().buffer, 'one stall raised what the line is given for good').toBeLessThan(80);
        expect(playout.stats().buffer).toBeLessThan(80);
        expect(steps(out, ms(400)), 'catching up clicked').toBeLessThan(0.3);
    });

    it('lets a frame fall that comes after its place has been played', () =>
    {
        const playout = new Playout(RATE, 60);

        play(line(80, () => 30), FRAME * 90, playout);

        const before = playout.stats().late;

        playout.take(10, tone(10), FRAME * 95);

        expect(playout.frames.has(10)).toBe(false);
        expect(playout.stats().late).toBe(before + 1);
    });
});
