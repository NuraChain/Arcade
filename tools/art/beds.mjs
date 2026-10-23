import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'bed-src');
const OUT = join(HERE, '..', '..', 'frontend', 'src', 'game', 'sound', 'beds');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE ?? 'ffprobe';

/** Every bed is brought to this loudness (EBU R128, integrated), so a reader's volume means the same for each. */
const LOUDNESS = -24;

/** Half a second in and out against a click: the player crossfades the loop itself. */
const EDGE = 0.5;

/**
 * A bed is what plays behind a table: a calm stretch of a recording, kept in `bed-src/` as that stretch
 * (its page and the seconds it was cut from are in `bed-src/LICENSE.txt`), brought to one loudness by a
 * gain and never by squeezing it, its peaks held a decibel under full scale, faded at each end, and
 * written as MP3 at `kbps` under a neutral extension (`.bed`), because a download manager empties any
 * `.mp3` a page fetches. A piece of music is cut where its last four seconds sound as its first four do, because
 * the player hands its loop from one copy to the other during them: a stretch found by measurement, or a loop its
 * composer made with its first four seconds again at its end.
 */
export const BEDS = [
    ['ludo', 'opengameart-bedazzled.ogg', { kbps: 96 }],
    ['hokm', 'opengameart-town-3.ogg', { kbps: 96 }],
    ['backgammon', 'opengameart-medieval-the-bards-tale.ogg', { kbps: 96 }],
    ['poker', 'opengameart-just-you-and-me-guitar.ogg', { kbps: 96 }],
    ['chess', 'opengameart-calm-piano-1-vaporware.ogg', { kbps: 96 }],
    ['rain', 'bigsoundbank-1019-summer-rain-on-terrace.ogg', { kbps: 64 }],
    ['birds', 'bigsoundbank-2713-forest-and-stream-1.ogg', { kbps: 64 }]
];

const loudnessOf = (file) =>
{
    const log = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { maxBuffer: 64 * 1024 * 1024 }).stderr.toString();

    return Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf('Summary:')))?.[1]);
};

const lengthOf = (file) => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

mkdirSync(OUT, { recursive: true });

for (const [name, source, { kbps }] of BEDS)
{
    const from = join(SOURCE, source);
    const to = join(OUT, `${ name }.bed`);
    const gain = LOUDNESS - loudnessOf(from);
    const seconds = lengthOf(from);

    execFileSync(FFMPEG, [
        '-y', '-v', 'error', '-i', from,
        '-af', `volume=${ gain.toFixed(2) }dB,alimiter=limit=0.891:level=false,afade=t=in:d=${ EDGE },afade=t=out:st=${ (seconds - EDGE).toFixed(3) }:d=${ EDGE }`,
        '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', `${ kbps }k`, '-f', 'mp3', to
    ]);

    console.log(`bed ${ name }.bed ${ statSync(to).size } bytes, ${ seconds.toFixed(1) } s, ${ gain >= 0 ? '+' : '' }${ gain.toFixed(1) } dB`);
}
