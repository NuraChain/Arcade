import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * How every take sounds, measured, because a sound here is chosen and levelled without anybody
 * listening. With no arguments it reads every pack `npm run sound` built; given files, it reads those.
 * For each: its length, how long it is actually sounding, its peak, its loudest 10 ms, the same in the
 * band a phone's speaker plays (300 Hz to 4 kHz), that against the chess click as it sits in its pack
 * (`vs click`), where its energy sits (`centre`), and how many onsets it has a second (`onsets`): a step
 * is short and bright, a capture heavier, and a bed for the background few onsets and a warm centre.
 *
 *   node tools/art/sound-levels.mjs            every take of every pack
 *   node tools/art/sound-levels.mjs a.ogg ...  those files
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = join(HERE, '..', '..', 'frontend', 'src', 'game', 'sound');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const RATE = 48000;
const BANDS = [[40, 80], [80, 160], [160, 320], [320, 640], [640, 1280], [1280, 2560], [2560, 5120], [5120, 10240]];

const samplesOf = (file, filter = 'anull') =>
{
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-af', filter, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 256 * 1024 * 1024 });

    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};

const db = (value) => 20 * Math.log10(Math.max(value, 1e-9));

/** The mean power of each `ms` of the signal. */
const powers = (signal, ms) =>
{
    const frame = Math.round(RATE * ms / 1000);
    const out = [];

    for (let at = 0; at + frame <= signal.length; at += frame)
    {
        let sum = 0;

        for (let n = 0; n < frame; n += 1)
        {
            sum += signal[at + n] ** 2;
        }

        out.push(sum / frame);
    }

    return out;
};

const band = (low, high) => `highpass=f=${ low },highpass=f=${ low },lowpass=f=${ high },lowpass=f=${ high }`;

const centreOf = (file) =>
{
    let weighted = 0;
    let total = 0;

    for (const [low, high] of BANDS)
    {
        const energy = samplesOf(file, band(low, high)).reduce((sum, one) => sum + one * one, 0);

        weighted += energy * Math.sqrt(low * high);
        total += energy;
    }

    return total === 0 ? 0 : weighted / total;
};

/** Onsets a second: 10 ms frames whose power rises 6 dB over the mean of the 50 ms before them. */
const onsetsOf = (whole) =>
{
    let count = 0;

    for (let at = 5; at < whole.length; at += 1)
    {
        const before = whole.slice(at - 5, at).reduce((sum, one) => sum + one, 0) / 5;

        if (whole[at] > before * 4 && whole[at] > 1e-6 && whole[at - 1] <= before * 4)
        {
            count += 1;
        }
    }

    return count / Math.max(whole.length / 100, 0.01);
};

const measure = (file) =>
{
    const all = samplesOf(file);
    const whole = powers(all, 10);
    const top = Math.max(0, ...whole);
    const phone = Math.max(0, ...powers(samplesOf(file, band(300, 4000)), 10));

    return {
        length: Math.round(all.length / RATE * 1000),
        sounding: whole.filter((one) => one > top / 1000).length * 10,
        peak: db(all.reduce((most, one) => Math.max(most, Math.abs(one)), 0)),
        top: db(Math.sqrt(top)),
        phone: db(Math.sqrt(phone)),
        centre: Math.round(centreOf(file)),
        onsets: onsetsOf(whole)
    };
};

/** Every take of every pack, written out as files of their own under a scratch directory. */
const takesOfPacks = (scratch) =>
{
    const takes = [];

    for (const name of readdirSync(PACKS).filter((one) => one.endsWith('.cues')).sort())
    {
        const bytes = readFileSync(join(PACKS, name));
        const start = 8 + bytes.readUInt32LE(4);
        const index = JSON.parse(bytes.subarray(8, start).toString('utf8'));

        for (const [cue, list] of Object.entries(index))
        {
            list.forEach(([offset, size], at) =>
            {
                const file = join(scratch, `${ name.slice(0, -5) }.${ cue }.${ at }.mp3`);

                writeFileSync(file, bytes.subarray(start + offset, start + offset + size));
                takes.push({ label: `${ name.slice(0, -5) } ${ cue } ${ at + 1 }`, file });
            });
        }
    }

    return takes;
};

const scratch = mkdtempSync(join(tmpdir(), 'nura-levels-'));

try
{
    const packed = takesOfPacks(scratch);
    const asked = process.argv.slice(2);
    const takes = asked.length === 0 ? packed : asked.map((file) => ({ label: file.split(/[\\/]/).pop(), file }));
    const click = packed.find((one) => one.label === 'chess piece-move 1');
    const reference = click === undefined ? null : measure(click.file).phone;

    for (const { label, file } of takes)
    {
        const one = measure(file);
        const versus = reference === null ? '' : `  vs click ${ (one.phone - reference).toFixed(1).padStart(6) }`;

        console.log(`${ label.slice(0, 40).padEnd(40) } ${ String(one.length).padStart(6) } ms  sounding ${ String(one.sounding).padStart(5) } ms  peak ${ one.peak.toFixed(1).padStart(6) }  top ${ one.top.toFixed(1).padStart(6) }  phone ${ one.phone.toFixed(1).padStart(6) }${ versus }  centre ${ String(one.centre).padStart(5) } Hz  onsets ${ one.onsets.toFixed(2).padStart(5) }/s`);
    }
}
finally
{
    rmSync(scratch, { recursive: true, force: true });
}
