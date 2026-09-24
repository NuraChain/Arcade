import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'sound-src');
const OUT = join(HERE, '..', '..', 'application', 'src', 'game', 'sound');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

export const SOUNDS = [
    ['card-slide', 'card-slide-1.ogg', 0.4],
    ['card-slide', 'card-slide-5.ogg', 0.4],
    ['card-slide', 'card-slide-7.ogg', 0.4],
    ['card-place', 'card-place-1.ogg', 0.35],
    ['card-place', 'card-place-4.ogg', 0.35],
    ['card-gather', 'card-shove-2.ogg', 0.5],
    ['card-shuffle', 'card-shuffle.ogg', 1.2],
    ['card-fan', 'card-fan-1.ogg', 0.5],
    ['die-land', 'die-throw-1.ogg', 0.35],
    ['die-land', 'die-throw-4.ogg', 0.35],
    ['die-shake', 'dice-shake-1.ogg', 1.0],
    ['token-step', 'impactWood_light_000.ogg', 0.15],
    ['token-step', 'impactWood_light_002.ogg', 0.15],
    ['token-capture', 'impactWood_heavy_001.ogg', 0.35],
    ['token-yard', 'impactSoft_medium_001.ogg', 0.25],
    ['win', 'jingles_PIZZI01.ogg', 1.0],
    ['hand-won', 'jingles_PIZZI16.ogg', 0.46],
    ['chip-lay', 'chip-lay-1.ogg', 0.3],
    ['chip-lay', 'chip-lay-3.ogg', 0.3],
    ['chips-stack', 'chips-stack-2.ogg', 0.5]
];

const scratch = mkdtempSync(join(tmpdir(), 'nura-sound-'));
const index = {};
const bodies = [];
let offset = 0;

for (const [cue, source, most] of SOUNDS)
{
    const target = join(scratch, `${ bodies.length }.mp3`);
    const fade = Math.max(0, most - 0.06).toFixed(3);

    execFileSync(FFMPEG, [
        '-y', '-v', 'error',
        '-i', join(SOURCE, source),
        '-ac', '1', '-ar', '44100',
        '-af', `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002,atrim=0:${ most },afade=t=out:st=${ fade }:d=0.06`,
        '-c:a', 'libmp3lame', '-b:a', '96k',
        target
    ]);

    const body = readFileSync(target);

    index[cue] = [...(index[cue] ?? []), [offset, body.length]];
    bodies.push(body);
    offset += body.length;
}

rmSync(scratch, { recursive: true, force: true });

const header = Buffer.from(JSON.stringify(index), 'utf8');
const lead = Buffer.alloc(8);

lead.write('NCUE', 0, 'ascii');
lead.writeUInt32LE(header.length, 4);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'table.cues'), Buffer.concat([lead, header, ...bodies]));

console.log(`sound table.cues ${ 8 + header.length + offset } bytes, ${ bodies.length } takes of ${ Object.keys(index).length } cues`);
