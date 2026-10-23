import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'sound-src');
const OUT = join(HERE, '..', '..', 'frontend', 'src', 'game', 'sound');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const HOOVES = 'bigsoundbank-0610-horse-trotting.ogg';

/**
 * A take is its pack, its cue, its source and the most of it kept, in seconds, taken from the source's first
 * sound. Each pack is written to a file of its own, which only the tables that play it fetch.
 * A take with a shape is made rather than cut: `cuts` are the stretches of the source it keeps, each `apart`
 * seconds after the one before (two hooves of a trot), each faded out over `tail`; `layer` is a second source
 * mixed under them at a level in decibels; `pitch` plays the whole slower and lower; `filter` is an ffmpeg
 * filter on the mix; `low` takes away what is under that many hertz; `gain` is in decibels; and `kbps` spends
 * fewer bits on a long voice than the 96 a knock needs. The levels were set by measuring each take beside the
 * chess click: a hoof as loud as the click, a step 4 dB under it on a phone's speaker, a call 6 dB under it.
 */
export const SOUNDS = [
    ['common', 'win', 'jingles_PIZZI01.ogg', 1.0],
    ['common', 'hand-won', 'jingles_PIZZI16.ogg', 0.46],
    ['cards', 'card-slide', 'card-slide-1.ogg', 0.4],
    ['cards', 'card-slide', 'card-slide-5.ogg', 0.4],
    ['cards', 'card-slide', 'card-slide-7.ogg', 0.4],
    ['cards', 'card-place', 'card-place-1.ogg', 0.35],
    ['cards', 'card-place', 'card-place-4.ogg', 0.35],
    ['cards', 'card-gather', 'card-shove-2.ogg', 0.5],
    ['cards', 'card-shuffle', 'card-shuffle.ogg', 1.2],
    ['cards', 'card-fan', 'card-fan-1.ogg', 0.5],
    ['ludo', 'die-land', 'die-throw-1.ogg', 0.35],
    ['ludo', 'die-land', 'die-throw-4.ogg', 0.35],
    ['ludo', 'die-shake', 'dice-shake-1.ogg', 1.0],
    ['ludo', 'pawn-step', 'impactWood_light_000.ogg', 0.15],
    ['ludo', 'pawn-step', 'impactWood_light_002.ogg', 0.15],
    ['ludo', 'pawn-hit', 'impactWood_heavy_001.ogg', 0.35],
    ['ludo', 'pawn-yard', 'impactSoft_medium_001.ogg', 0.25],
    ['backgammon', 'dice-wood', 'die-throw-1.ogg', 0.35],
    ['backgammon', 'dice-wood', 'die-throw-4.ogg', 0.35],
    ['backgammon', 'cup-shake', 'dice-shake-1.ogg', 1.0],
    ['backgammon', 'checker', 'impactWood_light_000.ogg', 0.15],
    ['backgammon', 'checker', 'impactWood_light_002.ogg', 0.15],
    ['backgammon', 'checker-hit', 'impactWood_heavy_001.ogg', 0.35],
    ['backgammon', 'checker-bar', 'impactSoft_medium_001.ogg', 0.25],
    ['backgammon', 'checker-off', 'impactSoft_medium_001.ogg', 0.25],
    ['poker', 'chip-lay', 'chip-lay-1.ogg', 0.3],
    ['poker', 'chip-lay', 'chip-lay-3.ogg', 0.3],
    ['poker', 'chips-stack', 'chips-stack-2.ogg', 0.5],
    ['chess', 'piece-move', 'impactGeneric_light_000.ogg', 0.16],
    ['chess', 'piece-move', 'impactGeneric_light_003.ogg', 0.16],
    ['chess', 'piece-move', 'impactGeneric_light_004.ogg', 0.16],
    ['chess', 'piece-capture', 'impactWood_medium_002.ogg', 0.24],
    ['chess', 'piece-capture', 'impactWood_medium_003.ogg', 0.24],
    ['chess', 'horse-step', HOOVES, 0.21, { cuts: [[1.252, 1.330], [0.508, 0.575]], apart: 0.11, low: 90, gain: 10 }],
    ['chess', 'horse-step', HOOVES, 0.22, { cuts: [[2.000, 2.075], [0.893, 0.960]], apart: 0.125, low: 90, gain: 10 }],
    ['chess', 'horse-call', 'bigsoundbank-1541-horse-neighing-4.ogg', 0.95, { cuts: [[0.09, 1.04]], tail: 0.14, low: 120, gain: -10.5, kbps: 56 }],
    ['chess', 'elephant-step', 'impactSoft_heavy_000.ogg', 0.42, { cuts: [[0, 0.4]], layer: ['footstep_grass_001.ogg', 12], pitch: 0.85, filter: 'equalizer=f=190:t=q:w=1:g=8', low: 40, gain: -16, kbps: 64 }],
    ['chess', 'elephant-call', 'commons-elephant-voice-trumpeting.ogg', 0.98, { cuts: [[0.14, 1.12]], tail: 0.14, low: 150, gain: 0, kbps: 56 }],
    ['chess', 'king-fall', 'impactSoft_medium_001.ogg', 0.25]
];

const fixed = (value) => Number(value.toFixed(3));

/** The ffmpeg arguments that make one take of a shape, from its inputs to the filtered mono mix. */
function shaped(source, most, shape)
{
    const tail = shape.tail ?? 0.02;
    const inputs = ['-i', join(SOURCE, source), ...(shape.layer === undefined ? [] : ['-i', join(SOURCE, shape.layer[0])])];
    const cuts = shape.cuts.map(([from, to], index) =>
        `[0:a]aformat=channel_layouts=mono,atrim=${ from }:${ to },asetpts=PTS-STARTPTS,afade=t=in:d=0.004,afade=t=out:st=${ fixed(to - from - tail) }:d=${ tail },adelay=${ Math.round(index * (shape.apart ?? 0) * 1000) }[c${ index }]`);
    const layer = shape.layer === undefined ? [] : [`[1:a]aformat=channel_layouts=mono,volume=${ shape.layer[1] }dB[l]`];
    const names = [...shape.cuts.map((_, index) => `[c${ index }]`), ...(shape.layer === undefined ? [] : ['[l]'])];
    const after = [
        'aresample=44100',
        ...(shape.pitch === undefined ? [] : [`asetrate=${ Math.round(44100 * shape.pitch) }`, 'aresample=44100']),
        ...(shape.filter === undefined ? [] : [shape.filter]),
        ...(shape.low === undefined ? [] : [`highpass=f=${ shape.low }`]),
        `volume=${ shape.gain ?? 0 }dB`,
        `atrim=0:${ most }`,
        `afade=t=out:st=${ fixed(Math.max(0, most - 0.06)) }:d=0.06`
    ].join(',');
    const mix = names.length === 1 ? `${ names[0] }${ after }` : `${ names.join('') }amix=inputs=${ names.length }:duration=longest:normalize=0,${ after }`;

    return [...inputs, '-filter_complex', [...cuts, ...layer, mix].join(';')];
}

/** The ffmpeg arguments for a take as recorded: from its first sound, the most of it, faded out at the end. */
function plain(source, most)
{
    const fade = Math.max(0, most - 0.06).toFixed(3);

    return ['-i', join(SOURCE, source), '-af', `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002,atrim=0:${ most },afade=t=out:st=${ fade }:d=0.06`];
}

const scratch = mkdtempSync(join(tmpdir(), 'nura-sound-'));
const packs = new Map();
let made = 0;

for (const [pack, cue, source, most, shape] of SOUNDS)
{
    const target = join(scratch, `${ made }.mp3`);

    made += 1;

    execFileSync(FFMPEG, [
        '-y', '-v', 'error',
        ...(shape === undefined ? plain(source, most) : shaped(source, most, shape)),
        '-ac', '1', '-ar', '44100',
        '-c:a', 'libmp3lame', '-b:a', `${ shape?.kbps ?? 96 }k`,
        target
    ]);

    const body = readFileSync(target);
    const held = packs.get(pack) ?? { index: {}, bodies: [], offset: 0 };

    held.index[cue] = [...(held.index[cue] ?? []), [held.offset, body.length]];
    held.bodies.push(body);
    held.offset += body.length;
    packs.set(pack, held);
}

rmSync(scratch, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [pack, { index, bodies, offset }] of packs)
{
    const header = Buffer.from(JSON.stringify(index), 'utf8');
    const lead = Buffer.alloc(8);

    lead.write('NCUE', 0, 'ascii');
    lead.writeUInt32LE(header.length, 4);
    writeFileSync(join(OUT, `${ pack }.cues`), Buffer.concat([lead, header, ...bodies]));

    console.log(`sound ${ pack }.cues ${ 8 + header.length + offset } bytes, ${ bodies.length } takes of ${ Object.keys(index).length } cues`);
}
