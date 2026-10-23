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

const CLOCK = 'bigsoundbank-1372-tic-tac-mechanical-alarm-clock-1.ogg';

const DICE = 'bigsoundbank-0581-two-dice-on-wooden-table.ogg';

const KNOCKS = 'bigsoundbank-0095-door-knock.ogg';

/** Knuckles on a table under felt: a door's boom thinned, and the knuckle brought forward to where a phone plays. */
const KNUCKLE = 'highpass=f=180,equalizer=f=1000:t=q:w=1.2:g=8,lowpass=f=3500';

/** A leather cup takes the top off the rattle of the dice inside it and rings a little low. */
const CUP = 'lowpass=f=2400,lowpass=f=2400,equalizer=f=180:t=q:w=1:g=4';

/**
 * A take is its pack, its cue, its source and the most of it kept, in seconds, taken from the source's first
 * sound. Each pack is written to a file of its own, which only the tables that play it fetch.
 * A take with a shape is made rather than cut: `cuts` are the stretches of the source it keeps, each `apart`
 * seconds after the one before (two hooves of a trot), each faded out over `tail`; `layer` is a second source
 * mixed under them at a level in decibels; `pitch` plays the whole slower and lower; `filter` is an ffmpeg
 * filter on the mix; `low` takes away what is under that many hertz; `gain` is in decibels; and `kbps` spends
 * fewer bits on a long voice than the 96 a knock needs. The levels were set by measuring each take beside the
 * chess click: a hoof as loud as the click, a step 4 dB under it on a phone's speaker, a call 6 dB under it.
 * Kenney's card recordings open on the room's own noise, which a plain take mistakes for the sound and keeps
 * instead of the card, so each is cut round its card: a slide 5 dB under the click, a card laid 3.5 under it.
 */
export const SOUNDS = [
    ['common', 'win', 'jingles_PIZZI02.ogg', 0.96, { kbps: 64 }],
    ['common', 'lose', 'jingles_PIZZI14.ogg', 0.92, { kbps: 64 }],
    ['common', 'draw', 'jingles_PIZZI13.ogg', 0.88, { kbps: 64 }],
    ['common', 'hand-won', 'jingles_PIZZI16.ogg', 0.46, { kbps: 64 }],
    ['common', 'turn', 'jingles_STEEL08.ogg', 0.8, { kbps: 64 }],
    ['common', 'pass', 'jingles_STEEL09.ogg', 0.59, { kbps: 64 }],
    ['common', 'chime', 'glass_001.ogg', 0.28, { kbps: 64, gain: -3 }],
    ['common', 'tick', CLOCK, 0.09, { cuts: [[0.542, 0.612]], tail: 0.03, gain: 4 }],
    ['common', 'tick-hi', CLOCK, 0.09, { cuts: [[3.518, 3.588]], pitch: 1.12, tail: 0.03, gain: 5 }],
    ['common', 'deny', 'impactWood_light_001.ogg', 0.22, { cuts: [[0, 0.09], [0, 0.09]], apart: 0.1, tail: 0.04, gain: 4 }],
    ['cards', 'card-slide', 'card-slide-1.ogg', 0.2, { cuts: [[0.12, 0.32]], tail: 0.05, gain: -2.9 }],
    ['cards', 'card-slide', 'card-slide-3.ogg', 0.2, { cuts: [[0.05, 0.25]], tail: 0.05, gain: -2.4 }],
    ['cards', 'card-slide', 'card-slide-4.ogg', 0.22, { cuts: [[0.03, 0.25]], tail: 0.05 }],
    ['cards', 'card-slide', 'card-slide-7.ogg', 0.2, { cuts: [[0.25, 0.45]], tail: 0.05, gain: 1.4 }],
    ['cards', 'card-slide', 'card-slide-8.ogg', 0.2, { cuts: [[0.21, 0.41]], tail: 0.05, gain: -1.6 }],
    ['cards', 'card-place', 'card-place-1.ogg', 0.2, { cuts: [[0.13, 0.33]], tail: 0.05 }],
    ['cards', 'card-place', 'card-place-2.ogg', 0.2, { cuts: [[0.16, 0.36]], tail: 0.05, gain: 2.2 }],
    ['cards', 'card-place', 'card-place-3.ogg', 0.2, { cuts: [[0.43, 0.63]], tail: 0.05, gain: 1.1 }],
    ['cards', 'card-place', 'card-place-4.ogg', 0.2, { cuts: [[0.3, 0.5]], tail: 0.05, gain: 2.4 }],
    ['cards', 'card-gather', 'card-shove-1.ogg', 0.42, { cuts: [[0.1, 0.52]], tail: 0.12, gain: 2, kbps: 64 }],
    ['cards', 'card-gather', 'card-shove-2.ogg', 0.39, { cuts: [[0.19, 0.58]], tail: 0.12, kbps: 64 }],
    ['cards', 'card-gather', 'card-shove-4.ogg', 0.39, { cuts: [[0.19, 0.58]], tail: 0.12, gain: 2.3, kbps: 64 }],
    ['cards', 'card-shuffle', 'card-shuffle.ogg', 0.6, { cuts: [[0.1, 0.7]], tail: 0.08, gain: 2.1, kbps: 64 }],
    ['cards', 'card-shuffle', 'card-shuffle.ogg', 0.66, { cuts: [[1.8, 2.46]], tail: 0.08, gain: 7, kbps: 64 }],
    ['cards', 'card-fan', 'card-fan-1.ogg', 0.5, { cuts: [[0.13, 0.63]], tail: 0.08, gain: 5.8, kbps: 64 }],
    ['cards', 'card-fan', 'card-fan-2.ogg', 0.32, { cuts: [[0.79, 1.11]], tail: 0.06, gain: 3.9, kbps: 64 }],
    ['hokm', 'trump', 'card-place-1.ogg', 0.32, { cuts: [[0.145, 0.45]], tail: 0.05, layer: ['impactPunch_medium_001.ogg', -8], gain: 2.7 }],
    ['hokm', 'trick', 'bookPlace1.ogg', 0.22, { cuts: [[0, 0.22]], tail: 0.05, pitch: 1.15, low: 150, gain: -5.9 }],
    ['hokm', 'trick', 'bookPlace3.ogg', 0.22, { cuts: [[0, 0.22]], tail: 0.05, pitch: 1.15, low: 150, gain: -8.5 }],
    ['ludo', 'die-land', 'die-throw-1.ogg', 0.14, { cuts: [[0.15, 0.29]], tail: 0.05, gain: 1 }],
    ['ludo', 'die-land', 'die-throw-2.ogg', 0.14, { cuts: [[0.07, 0.21]], tail: 0.05, gain: 2 }],
    ['ludo', 'die-land', 'die-throw-3.ogg', 0.14, { cuts: [[0.068, 0.208]], tail: 0.05, gain: 3.5 }],
    ['ludo', 'die-land', 'die-throw-4.ogg', 0.14, { cuts: [[0.115, 0.255]], tail: 0.05, gain: 2 }],
    ['ludo', 'die-shake', 'dice-shake-1.ogg', 1.0, { gain: 5 }],
    ['ludo', 'die-shake', 'dice-shake-2.ogg', 1.0],
    ['ludo', 'die-shake', 'dice-shake-3.ogg', 1.0, { gain: 4 }],
    ['ludo', 'pawn-step', 'drop_002.ogg', 0.12, { gain: -7 }],
    ['ludo', 'pawn-step', 'drop_003.ogg', 0.12, { gain: -7 }],
    ['ludo', 'pawn-hit', 'impactPlate_light_002.ogg', 0.16, { gain: 2 }],
    ['ludo', 'pawn-hit', 'impactPlate_light_003.ogg', 0.16, { gain: 2 }],
    ['ludo', 'pawn-yard', 'drop_004.ogg', 0.26, { cuts: [[0, 0.24]], pitch: 0.82, tail: 0.08, gain: -3 }],
    ['ludo', 'six', 'jingles_HIT16.ogg', 0.29, { gain: 4, kbps: 64 }],
    ['ludo', 'home', 'jingles_HIT01.ogg', 0.5, { gain: 4, kbps: 64 }],
    ['backgammon', 'dice-wood', DICE, 0.095, { cuts: [[0.096, 0.191]], tail: 0.04, gain: 4.1 }],
    ['backgammon', 'dice-wood', DICE, 0.095, { cuts: [[7.288, 7.383]], tail: 0.04, gain: 6.6 }],
    ['backgammon', 'dice-wood', DICE, 0.095, { cuts: [[15.25, 15.345]], tail: 0.04, gain: 4.6 }],
    ['backgammon', 'dice-wood', DICE, 0.095, { cuts: [[24.142, 24.237]], tail: 0.04, gain: 6.1 }],
    ['backgammon', 'cup-shake', 'dice-shake-2.ogg', 0.8, { cuts: [[0, 0.8]], tail: 0.12, filter: CUP, gain: 13.2, kbps: 64 }],
    ['backgammon', 'cup-shake', 'dice-shake-3.ogg', 0.8, { cuts: [[0, 0.8]], tail: 0.12, filter: CUP, gain: 13.9, kbps: 64 }],
    ['backgammon', 'checker', 'impactWood_light_000.ogg', 0.15, { cuts: [[0, 0.15]], tail: 0.05, gain: 0.7 }],
    ['backgammon', 'checker', 'impactWood_light_002.ogg', 0.15, { cuts: [[0, 0.15]], tail: 0.05, gain: 1.2 }],
    ['backgammon', 'checker', 'impactWood_light_004.ogg', 0.15, { cuts: [[0, 0.15]], tail: 0.05, gain: 3.2 }],
    ['backgammon', 'checker-hit', 'impactWood_medium_002.ogg', 0.26, { cuts: [[0, 0.26]], tail: 0.05, low: 120, gain: 6.5 }],
    ['backgammon', 'checker-hit', 'impactWood_medium_003.ogg', 0.26, { cuts: [[0, 0.26]], tail: 0.05, low: 120, gain: 8.1 }],
    ['backgammon', 'checker-bar', 'impactPlank_medium_004.ogg', 0.3, { cuts: [[0, 0.3]], tail: 0.1, low: 100, gain: 2.8 }],
    ['backgammon', 'checker-off', 'impactPlank_medium_001.ogg', 0.3, { cuts: [[0, 0.3]], tail: 0.1, low: 100, gain: 3.2 }],
    ['backgammon', 'checker-off', 'impactPlank_medium_002.ogg', 0.3, { cuts: [[0, 0.3]], tail: 0.1, low: 100, gain: 4.5 }],
    ['backgammon', 'cube', 'impactWood_medium_000.ogg', 0.26, { cuts: [[0, 0.26]], tail: 0.05, low: 100, gain: 6.5 }],
    ['backgammon', 'cube', 'impactWood_medium_004.ogg', 0.26, { cuts: [[0, 0.26]], tail: 0.05, low: 100, gain: 5.4 }],
    ['poker', 'chip-lay', 'bigsoundbank-0942-poker-chips.ogg', 0.32, { cuts: [[0.075, 0.4]], tail: 0.08 }],
    ['poker', 'chip-lay', 'bigsoundbank-0944-poker-chips-3.ogg', 0.33, { cuts: [[0.215, 0.55]], tail: 0.08, gain: 0.8 }],
    ['poker', 'chip-lay', 'bigsoundbank-0945-poker-chips-4.ogg', 0.31, { cuts: [[0.11, 0.42]], tail: 0.08, gain: 0.4 }],
    ['poker', 'chip-lay', 'chip-lay-3.ogg', 0.26, { cuts: [[0, 0.26]], tail: 0.08, gain: 2.5 }],
    ['poker', 'chips-stack', 'bigsoundbank-0943-poker-chips-2.ogg', 0.3, { cuts: [[0.9, 1.2]], tail: 0.08 }],
    ['poker', 'chips-stack', 'bigsoundbank-0943-poker-chips-2.ogg', 0.27, { cuts: [[0.37, 0.64]], tail: 0.08, gain: 4 }],
    ['poker', 'chips-stack', 'chips-handle-5.ogg', 0.8, { cuts: [[0, 0.8]], tail: 0.15, gain: 0.9, kbps: 64 }],
    ['poker', 'chips-gather', 'chips-handle-4.ogg', 0.36, { cuts: [[0, 0.36]], tail: 0.08, gain: 3 }],
    ['poker', 'knock', KNOCKS, 0.3, { cuts: [[0.155, 0.255], [0.522, 0.622]], apart: 0.16, tail: 0.05, filter: KNUCKLE }],
    ['poker', 'knock', KNOCKS, 0.3, { cuts: [[2.222, 2.322], [2.666, 2.766]], apart: 0.17, tail: 0.05, filter: KNUCKLE, gain: 1.1 }],
    ['poker', 'knock', KNOCKS, 0.3, { cuts: [[7.636, 7.736], [7.952, 8.052]], apart: 0.16, tail: 0.05, filter: KNUCKLE, gain: -1 }],
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

/** The ffmpeg arguments for a take as recorded: from its first sound, the most of it, faded out at the end, at its gain. */
function plain(source, most, gain = 0)
{
    const fade = Math.max(0, most - 0.06).toFixed(3);

    return ['-i', join(SOURCE, source), '-af', `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002,atrim=0:${ most },afade=t=out:st=${ fade }:d=0.06,volume=${ gain }dB`];
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
        ...(shape?.cuts === undefined ? plain(source, most, shape?.gain) : shaped(source, most, shape)),
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
