import { writeFileSync } from 'node:fs';

export const RATE = 48_000;

export const STEP = 480;

export const db = (value) => 20 * Math.log10(Math.max(value, 1e-9));

export function rmsOf(samples, from, to)
{
    let sum = 0;

    for (let index = from; index < to; index += 1)
    {
        sum += samples[index] * samples[index];
    }

    return Math.sqrt(sum / Math.max(1, to - from));
}

export function writeWav(path, samples, rate = RATE)
{
    const data = Buffer.alloc(samples.length * 2);

    for (let index = 0; index < samples.length; index += 1)
    {
        data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767))), index * 2);
    }

    const head = Buffer.alloc(44);

    head.write('RIFF', 0);
    head.writeUInt32LE(36 + data.length, 4);
    head.write('WAVE', 8);
    head.write('fmt ', 12);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(1, 22);
    head.writeUInt32LE(rate, 24);
    head.writeUInt32LE(rate * 2, 28);
    head.writeUInt16LE(2, 32);
    head.writeUInt16LE(16, 34);
    head.write('data', 36);
    head.writeUInt32LE(data.length, 40);
    writeFileSync(path, Buffer.concat([head, data]));
}

function seeded(start)
{
    let seed = start >>> 0;

    return () =>
    {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        return seed / 4_294_967_296;
    };
}

const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720]];

function syllable(out, at, length, random)
{
    const f0 = 105 + random() * 70;
    const glide = (random() - 0.5) * 30;
    const [first, second] = VOWELS[Math.floor(random() * VOWELS.length)];
    const fricative = random() < 0.45 ? Math.round(RATE * (0.03 + random() * 0.03)) : 0;
    let phase = 0;

    for (let index = 0; index < fricative && at + index < out.length; index += 1)
    {
        const envelope = Math.sin(Math.PI * index / fricative);

        out[at + index] += (random() * 2 - 1) * 0.08 * envelope * (index % 2 === 0 ? 1 : -1);
    }

    for (let index = 0; index < length && at + fricative + index < out.length; index += 1)
    {
        const progress = index / length;
        const pitch = f0 + glide * progress;
        const envelope = Math.min(1, index / (RATE * 0.015)) * Math.min(1, (length - index) / (RATE * 0.04));
        let value = 0;

        phase += 2 * Math.PI * pitch / RATE;

        for (let harmonic = 1; harmonic * pitch < 4000; harmonic += 1)
        {
            const hz = harmonic * pitch;
            const weight = Math.exp(-(((hz - first) / 180) ** 2)) + 0.6 * Math.exp(-(((hz - second) / 260) ** 2)) + 0.05 / harmonic;

            value += weight * Math.sin(harmonic * phase);
        }

        out[at + fricative + index] += value * envelope * 0.12;
    }

    return fricative + length;
}

export function speechLike(seconds, start = 7)
{
    const random = seeded(start);
    const out = new Float32Array(Math.round(seconds * RATE));
    let at = Math.round(RATE * 0.6);

    while (at < out.length - RATE)
    {
        const syllables = 3 + Math.floor(random() * 4);

        for (let index = 0; index < syllables && at < out.length - RATE; index += 1)
        {
            at += syllable(out, at, Math.round(RATE * (0.12 + random() * 0.14)), random);
            at += Math.round(RATE * (0.04 + random() * 0.05));
        }

        at += Math.round(RATE * (0.5 + random() * 0.4));
    }

    let loud = 0;
    let count = 0;

    for (let from = 0; from + STEP <= out.length; from += STEP)
    {
        const value = rmsOf(out, from, from + STEP);

        if (value > 0.003)
        {
            loud += value * value;
            count += 1;
        }
    }

    const gain = 10 ** (-20 / 20) / Math.sqrt(loud / Math.max(1, count));

    for (let index = 0; index < out.length; index += 1)
    {
        out[index] *= gain;
    }

    return out;
}

export function noiseBed(length, start = 11)
{
    const random = seeded(start);
    const out = new Float32Array(length);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let index = 0; index < length; index += 1)
    {
        const white = random() * 2 - 1;

        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        out[index] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
    }

    const pink = 10 ** (-36 / 20) / rmsOf(out, 0, length);
    const hum = 10 ** (-48 / 20) * Math.SQRT2;

    for (let index = 0; index < length; index += 1)
    {
        out[index] = out[index] * pink + hum * (Math.sin(2 * Math.PI * 50 * index / RATE) + 0.5 * Math.sin(2 * Math.PI * 150 * index / RATE));
    }

    let at = Math.round(RATE * 0.3);

    while (at < length - RATE * 0.05)
    {
        const end = Math.min(length - RATE * 0.05, at + RATE * (0.9 + random() * 1.4));

        while (at < end)
        {
            const size = Math.floor(RATE * (0.004 + random() * 0.006));
            const peak = 10 ** ((-18 + random() * 8) / 20);
            let previous = 0;

            for (let step = 0; step < size; step += 1)
            {
                const white = random() * 2 - 1;

                out[at + step] += (white - previous * 0.6) * peak * Math.exp(-step / (size / 4));
                previous = white;
            }

            at += Math.floor(RATE * (0.09 + random() * 0.18));
        }

        at += Math.floor(RATE * (0.8 + random() * 1.6));
    }

    return out;
}

export function levels(samples)
{
    const out = [];

    for (let at = 0; at + STEP <= samples.length; at += STEP)
    {
        out.push(db(rmsOf(samples, at, at + STEP)));
    }

    return out;
}

const pearson = (a, b) =>
{
    const n = a.length;

    if (n < 3)
    {
        return 0;
    }

    let ma = 0;
    let mb = 0;

    for (let index = 0; index < n; index += 1)
    {
        ma += a[index];
        mb += b[index];
    }

    ma /= n;
    mb /= n;

    let num = 0;
    let da = 0;
    let dbb = 0;

    for (let index = 0; index < n; index += 1)
    {
        num += (a[index] - ma) * (b[index] - mb);
        da += (a[index] - ma) ** 2;
        dbb += (b[index] - mb) ** 2;
    }

    return num / Math.sqrt(Math.max(da * dbb, 1e-12));
};

function bestShift(rec, ref, from, to, candidates)
{
    let best = { shift: 0, score: -2 };
    const period = ref.length;

    for (const shift of candidates)
    {
        const a = [];
        const b = [];

        for (let k = from; k < to; k += 1)
        {
            const j = (((k + shift) % period) + period) % period;

            a.push(Math.max(rec[k], -60));
            b.push(Math.max(ref[j], -60));
        }

        const score = pearson(a, b);

        if (score > best.score)
        {
            best = { shift, score };
        }
    }

    return best;
}

const powerMean = (values) => values.length === 0 ? null : Number(db(Math.sqrt(values.reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length)).toFixed(1));

export const SETTLE = 100;

export function analyse(received, refs)
{
    const rec = levels(received);
    const clean = levels(refs.clean);
    const noise = levels(refs.noise);
    const period = clean.length;
    const global = bestShift(rec, clean, SETTLE, rec.length, Array.from({ length: period }, (_, shift) => shift));
    const WINDOW = 200;
    const shifts = new Array(rec.length).fill(global.shift);
    const windows = [];

    for (let from = SETTLE; from < rec.length; from += WINDOW)
    {
        const to = Math.min(rec.length, from + WINDOW);
        const local = bestShift(rec, clean, from, to, Array.from({ length: 81 }, (_, index) => global.shift + index - 40));

        windows.push({ from, shift: local.shift, score: Number(local.score.toFixed(3)) });

        for (let k = from; k < to; k += 1)
        {
            shifts[k] = local.score > 0.3 ? local.shift : global.shift;
        }
    }

    const at = (k) => (((k + shifts[k]) % period) + period) % period;
    const speaking = (j) => clean[j] > -40;
    const still = (j) => Array.from({ length: 21 }, (_, step) => clean[(j + step - 10 + period) % period]).every((value) => value < -70);
    const typed = (j) => Array.from({ length: 5 }, (_, step) => noise[(j + step - 2 + period) % period]).some((value) => value > -28);
    const inside = (j) => speaking(j) && speaking((j - 1 + period) % period) && speaking((j + 1) % period);
    const speech = [];
    const pause = [];
    const clicky = [];
    const room = [];
    const roomClicks = [];
    const holes = [];
    let edges = 0;
    let open = null;

    const close = (k) =>
    {
        if (open !== null)
        {
            holes.push({ from: open, to: k });
            open = null;
        }
    };

    for (let k = SETTLE; k < rec.length; k += 1)
    {
        const j = at(k);

        if (speaking(j))
        {
            speech.push(rec[k]);

            if (rec[k] < -55 && !inside(j))
            {
                edges += 1;
            }
        }

        if (inside(j) && rec[k] < -55)
        {
            open ??= k;
        }
        else
        {
            close(k);
        }

        if (clean[j] < -70)
        {
            pause.push(rec[k]);

            if (noise[j] > -28)
            {
                clicky.push(rec[k]);
            }

            if (still(j) && noise[j] > -28)
            {
                roomClicks.push(rec[k]);
            }
            else if (still(j) && !typed(j))
            {
                room.push(rec[k]);
            }
        }
    }

    close(rec.length);

    const recorder = holes.filter((one) => one.to - one.from <= 2 && rec.slice(one.from, one.to).every((value) => value < -150) && (rec[one.from - 1] ?? -180) > -40 && (rec[one.to] ?? -180) > -40);
    const breaks = holes.filter((one) => !recorder.includes(one));
    const dropped = breaks.reduce((sum, one) => sum + one.to - one.from, 0);

    return {
        aligned: Number(global.score.toFixed(3)),
        latencyMoves: new Set(windows.filter((one) => one.score > 0.3).map((one) => one.shift)).size - 1,
        speechFrames: speech.length,
        dropoutPct: Number((100 * dropped / Math.max(1, speech.length)).toFixed(2)),
        dropoutRuns: breaks.length,
        longestBreakMs: breaks.reduce((most, one) => Math.max(most, (one.to - one.from) * 10), 0),
        breaksAt: breaks.map((one) => `${ (one.from / 100).toFixed(2) }s+${ (one.to - one.from) * 10 }ms`),
        edges,
        recorderGaps: recorder.length,
        speechDb: powerMean(speech),
        pauseDb: powerMean(pause),
        clickDb: powerMean(clicky),
        roomDb: powerMean(room),
        roomClickDb: powerMean(roomClicks)
    };
}
