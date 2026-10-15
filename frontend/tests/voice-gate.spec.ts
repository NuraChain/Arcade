import { describe, it, expect } from 'vitest';

import { Gate } from '../src/services/voice.gate.ts';

const RATE = 48_000;

const BLOCK = 128;

const ms = (value: number) => Math.round(value * RATE / 1000);

let seed = 5;

const random = () =>
{
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
};

const noise = (length: number, db: number) =>
{
    const level = 10 ** (db / 20) * Math.sqrt(3);

    return Float32Array.from({ length }, () => (random() * 2 - 1) * level);
};

const tone = (length: number, db: number, hz = 300) =>
{
    const peak = 10 ** (db / 20) * Math.SQRT2;

    return Float32Array.from({ length }, (_, at) => peak * Math.sin(2 * Math.PI * hz * at / RATE));
};

const join = (...parts: Float32Array[]) =>
{
    const out = new Float32Array(parts.reduce((sum, one) => sum + one.length, 0));
    let at = 0;

    for (const part of parts)
    {
        out.set(part, at);
        at += part.length;
    }

    return out;
};

function run(gate: Gate, signal: Float32Array, between?: (at: number) => void)
{
    const out = new Float32Array(signal.length);
    const readings = [];

    for (let at = 0; at + BLOCK <= signal.length; at += BLOCK)
    {
        between?.(at);

        const block = new Float32Array(BLOCK);

        gate.process(signal.subarray(at, at + BLOCK), block);
        out.set(block, at);
        readings.push({ at, ...gate.reading() });
    }

    return { out, readings };
}

const rms = (samples: Float32Array, from: number, to: number) =>
{
    let sum = 0;

    for (let at = from; at < to; at += 1)
    {
        sum += samples[at] * samples[at];
    }

    return Math.sqrt(sum / Math.max(1, to - from));
};

const steps = (samples: Float32Array, from: number, to: number) =>
{
    let most = 0;

    for (let at = Math.max(1, from); at < to; at += 1)
    {
        most = Math.max(most, Math.abs(samples[at] - samples[at - 1]));
    }

    return most;
};

describe('the gate a voice goes through', () =>
{
    it('learns the room\'s noise and sets its bar a little above it, sending nothing of the noise', () =>
    {
        const gate = new Gate(RATE);
        const { out, readings } = run(gate, noise(ms(3000), -60));
        const last = readings.at(-1)!;

        expect(last.threshold).toBeGreaterThan(-52);
        expect(last.threshold).toBeLessThan(-44);
        expect(last.open).toBe(false);
        expect(rms(out, ms(2000), ms(3000))).toBe(0);
    });

    it('opens for a voice above the bar before the voice\'s first sound reaches the other end', () =>
    {
        const gate = new Gate(RATE);
        const start = ms(2000);
        const speech = tone(ms(500), -20);
        const { out } = run(gate, join(noise(start, -60), speech, noise(ms(200), -60)));
        const lead = ms(10);

        for (let at = 0; at < 20; at += 1)
        {
            expect(Math.abs(out[start + lead + at] - (speech[at] + 0)), 'the first sound of the voice was cut').toBeLessThan(0.002 + Math.abs(speech[at]) * 0.02);
        }
    });

    it('stays open through a short pause, lets go after a longer one, and fades rather than clicks', () =>
    {
        const gate = new Gate(RATE);
        const { out, readings } = run(gate, join(noise(ms(1500), -60), tone(ms(400), -20), noise(ms(300), -60), tone(ms(300), -20), noise(ms(800), -60)));
        const pause = ms(1500 + 400);
        const after = ms(1500 + 400 + 300 + 300);

        expect(readings.filter((one) => one.at >= pause && one.at < pause + ms(300)).every((one) => one.open), 'a short pause closed the gate').toBe(true);
        expect(readings.filter((one) => one.at > after + ms(600)).every((one) => !one.open), 'a long pause left the gate open').toBe(true);
        expect(steps(out, ms(1000), out.length), 'the gate clicked as it opened or closed').toBeLessThan(0.02);
    });

    it('takes a bar it is given instead of one it learns', () =>
    {
        const gate = new Gate(RATE);

        gate.set(false, false, 0, false, -30);

        const quiet = run(gate, tone(ms(600), -35));

        expect(quiet.readings.at(-1)!.threshold).toBe(-30);
        expect(quiet.readings.some((one) => one.open), 'a voice under the bar opened the gate').toBe(false);

        const loud = run(gate, tone(ms(600), -25));

        expect(loud.readings.at(-1)!.open).toBe(true);
    });

    it('opens only while the talk key is held when it is held to talk, and goes on for the release after', () =>
    {
        const gate = new Gate(RATE);
        const voice = tone(ms(1600), -20, 290);
        let pressed = false;

        gate.set(true, false, 200, true, -50);

        const { out } = run(gate, voice, (at) =>
        {
            const now = at >= ms(400) && at < ms(800);

            if (now !== pressed)
            {
                pressed = now;
                gate.set(true, pressed, 200, true, -50);
            }
        });

        gate.set(true, false, 200, true, -50);

        expect(rms(out, 0, ms(390)), 'the voice went out before the key was held').toBeLessThan(1e-4);
        expect(steps(out, ms(380), ms(1200)), 'the key clicked as it opened or closed the voice').toBeLessThan(0.012);
        expect(rms(out, ms(450), ms(800))).toBeGreaterThan(0.09);
        expect(rms(out, ms(850), ms(990)), 'the release was cut short').toBeGreaterThan(0.09);
        expect(rms(out, ms(1150), ms(1600)), 'the voice went on long after the release').toBeLessThan(1e-4);
    });

    it('stays open for a voice that falls just under the bar once it has opened', () =>
    {
        const gate = new Gate(RATE);

        gate.set(false, false, 0, false, -40);

        const { readings } = run(gate, join(tone(ms(300), -20), tone(ms(1500), -42)));

        expect(readings.filter((one) => one.at > ms(400)).every((one) => one.open), 'a voice a little under the bar was cut').toBe(true);
    });

    it('says how loud it hears the voice', () =>
    {
        const gate = new Gate(RATE);
        const { readings } = run(gate, tone(ms(800), -24));

        expect(readings.at(-1)!.level).toBeGreaterThan(-25);
        expect(readings.at(-1)!.level).toBeLessThan(-22);
    });

    it('keeps its learned bar between quiet and loud bounds', () =>
    {
        const silent = run(new Gate(RATE), new Float32Array(ms(3000)));
        const loud = run(new Gate(RATE), noise(ms(20_000), -20));

        expect(silent.readings.at(-1)!.threshold).toBe(-70);
        expect(loud.readings.at(-1)!.threshold).toBe(-30);
    });
});
