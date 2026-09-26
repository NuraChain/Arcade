import { PACK, SAMPLED, unpack, type Sampled } from './sound-files.ts';

export type Tone =
    | 'turn'
    | 'tick'
    | 'tick-hi'
    | 'trump'
    | 'trick'
    | 'bonus'
    | 'pass'
    | 'deny'
    | 'home'
    | 'die-land'
    | 'token-step'
    | 'token-capture'
    | 'win';

export type Cue = Tone | Sampled;

export interface PlayOptions
{
    pan?: number;
    rate?: number;
    gain?: number;
    urgent?: boolean;
}

export interface SoundHandle
{
    play(cue: Cue, options?: PlayOptions): void;

    setEnabled(on: boolean): void;

    dispose(): void;
}

interface Voice
{
    wave: OscillatorType;
    from: number;
    to: number;
    hold: number;
    gain: number;
    delay: number;
}

type Bus = 'foley' | 'ui' | 'jingle';

interface Take
{
    buffer: AudioBuffer;
    offset: number;
}

interface Engine
{
    context: AudioContext | null;
    buses: Record<Bus, GainNode> | null;
    takes: Map<Sampled, Take[]>;
    loading: boolean;
    handles: number;
    listening: number;
    resuming: boolean;
    parked: boolean;
    armed: boolean;
    turn: Map<Cue, number>;
    voices: Map<Cue, { active: number; last: number }>;
}

const TONES: Record<Tone, readonly Voice[]> = {
    'turn': [
        { wave: 'sine', from: 784, to: 784, hold: 0.09, gain: 0.14, delay: 0 },
        { wave: 'sine', from: 1175, to: 1175, hold: 0.16, gain: 0.12, delay: 0.08 }
    ],
    'tick': [{ wave: 'sine', from: 1000, to: 1000, hold: 0.025, gain: 0.06, delay: 0 }],
    'tick-hi': [{ wave: 'sine', from: 1250, to: 1250, hold: 0.025, gain: 0.06, delay: 0 }],
    'trump': [
        { wave: 'triangle', from: 392, to: 392, hold: 0.22, gain: 0.16, delay: 0 },
        { wave: 'triangle', from: 587, to: 587, hold: 0.22, gain: 0.12, delay: 0 }
    ],
    'trick': [
        { wave: 'triangle', from: 659, to: 659, hold: 0.08, gain: 0.12, delay: 0 },
        { wave: 'triangle', from: 988, to: 988, hold: 0.14, gain: 0.12, delay: 0.07 }
    ],
    'bonus': [{ wave: 'triangle', from: 880, to: 1320, hold: 0.1, gain: 0.12, delay: 0 }],
    'pass': [{ wave: 'sine', from: 330, to: 220, hold: 0.16, gain: 0.1, delay: 0 }],
    'deny': [
        { wave: 'square', from: 180, to: 150, hold: 0.08, gain: 0.06, delay: 0 },
        { wave: 'square', from: 180, to: 150, hold: 0.08, gain: 0.06, delay: 0.1 }
    ],
    'home': [
        { wave: 'sine', from: 520, to: 780, hold: 0.14, gain: 0.24, delay: 0 },
        { wave: 'sine', from: 780, to: 1040, hold: 0.2, gain: 0.18, delay: 0.1 }
    ],
    'die-land': [
        { wave: 'triangle', from: 220, to: 140, hold: 0.09, gain: 0.3, delay: 0 },
        { wave: 'triangle', from: 300, to: 190, hold: 0.07, gain: 0.22, delay: 0.05 },
        { wave: 'sine', from: 180, to: 120, hold: 0.12, gain: 0.26, delay: 0.11 }
    ],
    'token-step': [{ wave: 'sine', from: 760, to: 700, hold: 0.05, gain: 0.14, delay: 0 }],
    'token-capture': [
        { wave: 'sawtooth', from: 420, to: 90, hold: 0.24, gain: 0.26, delay: 0 },
        { wave: 'square', from: 210, to: 70, hold: 0.18, gain: 0.12, delay: 0.02 }
    ],
    'win': [
        { wave: 'triangle', from: 392, to: 392, hold: 0.16, gain: 0.26, delay: 0 },
        { wave: 'triangle', from: 523, to: 523, hold: 0.16, gain: 0.26, delay: 0.13 },
        { wave: 'triangle', from: 659, to: 659, hold: 0.18, gain: 0.26, delay: 0.26 },
        { wave: 'triangle', from: 784, to: 784, hold: 0.42, gain: 0.3, delay: 0.39 }
    ]
};

const JINGLES: ReadonlySet<Cue> = new Set<Cue>(['win', 'hand-won']);

const LEVELS: Record<Bus, number> = { foley: 0.9, ui: 0.45, jingle: 0.6 };

const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

const MASTER = 0.7;

const MOST_AT_ONCE = 3;

const APART = 0.035;

const STALL_MS = 300;

const LOUD = 0.004;

type ContextMaker = typeof AudioContext;

const fresh = (): Engine => ({
    context: null,
    buses: null,
    takes: new Map(),
    loading: false,
    handles: 0,
    listening: 0,
    resuming: false,
    parked: false,
    armed: false,
    turn: new Map(),
    voices: new Map()
});

let engine = fresh();

function maker(): ContextMaker | null
{
    const scope = globalThis as unknown as { AudioContext?: ContextMaker; webkitAudioContext?: ContextMaker };

    return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function busOf(cue: Cue): Bus
{
    if (JINGLES.has(cue))
    {
        return 'jingle';
    }

    return (SAMPLED as readonly Cue[]).includes(cue) ? 'foley' : 'ui';
}

export function offsetOf(samples: Float32Array, rate: number): number
{
    const limit = Math.min(samples.length, Math.round(rate * 0.3));

    for (let index = 0; index < limit; index += 1)
    {
        if (Math.abs(samples[index]) > LOUD)
        {
            return index / rate;
        }
    }

    return 0;
}

function arm(): void
{
    if (engine.armed || typeof window === 'undefined')
    {
        return;
    }

    engine.armed = true;

    for (const name of GESTURES)
    {
        window.addEventListener(name, unlock, { capture: true, passive: true });
    }
}

function disarm(): void
{
    if (!engine.armed || typeof window === 'undefined')
    {
        return;
    }

    engine.armed = false;

    for (const name of GESTURES)
    {
        window.removeEventListener(name, unlock, { capture: true });
    }
}

function build(): AudioContext | null
{
    const Maker = maker();

    if (Maker === null)
    {
        return null;
    }

    try
    {
        const context = new Maker();
        const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;

        if (session !== undefined)
        {
            session.type = 'ambient';
        }

        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 6;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        limiter.connect(context.destination);

        const master = context.createGain();
        master.gain.value = MASTER;
        master.connect(limiter);

        const bus = (level: number): GainNode =>
        {
            const node = context.createGain();
            node.gain.value = level;
            node.connect(master);
            return node;
        };

        engine.buses = { foley: bus(LEVELS.foley), ui: bus(LEVELS.ui), jingle: bus(LEVELS.jingle) };
        context.addEventListener?.('statechange', () => settle(context));

        return context;
    }
    catch
    {
        engine.buses = null;
        return null;
    }
}

function settle(context: AudioContext): void
{
    if (context !== engine.context)
    {
        return;
    }

    if (context.state === 'running')
    {
        engine.resuming = false;
        disarm();
        return;
    }

    if (context.state !== 'closed' && !engine.parked && engine.handles > 0)
    {
        arm();
    }
}

function unlock(): void
{
    if (engine.handles === 0)
    {
        disarm();
        return;
    }

    if (engine.context === null || engine.context.state === 'closed')
    {
        engine.context = build();
    }

    const context = engine.context;

    if (context === null)
    {
        disarm();
        return;
    }

    engine.parked = false;

    if (context.state === 'running')
    {
        disarm();
    }
    else
    {
        engine.resuming = true;
        void context.resume?.().catch(() => undefined);

        setTimeout(() =>
        {
            if (engine.context !== context || context.state === 'running' || context.state === 'closed' || engine.parked || engine.handles === 0)
            {
                return;
            }

            void context.close?.().catch(() => undefined);
            engine.context = build();
            engine.resuming = false;
            arm();
        }, STALL_MS);
    }

    load();
}

function load(): void
{
    const context = engine.context;

    if (context === null || engine.loading || engine.listening === 0 || typeof fetch !== 'function')
    {
        return;
    }

    engine.loading = true;

    void fetch(PACK)
        .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
        .then((bytes) =>
        {
            for (const [cue, takes] of unpack(bytes))
            {
                for (const take of takes)
                {
                    void context.decodeAudioData(take)
                        .then((buffer) =>
                        {
                            const held = engine.takes.get(cue) ?? [];
                            held.push({ buffer, offset: offsetOf(buffer.getChannelData(0), buffer.sampleRate) });
                            engine.takes.set(cue, held);
                        })
                        .catch(() => undefined);
                }
            }
        })
        .catch(() =>
        {
            engine.loading = false;
        });
}

function route(context: AudioContext, into: AudioNode, pan: number | undefined): AudioNode
{
    if (pan === undefined || typeof context.createStereoPanner !== 'function')
    {
        return into;
    }

    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(into);

    return panner;
}

function sample(context: AudioContext, cue: Sampled, takes: Take[], into: AudioNode, options: PlayOptions, done: () => void): void
{
    const turn = engine.turn.get(cue) ?? 0;
    const take = takes[turn % takes.length];

    engine.turn.set(cue, turn + 1);

    const source = context.createBufferSource();
    const level = context.createGain();

    source.buffer = take.buffer;
    source.playbackRate.value = (options.rate ?? 1) * (0.96 + Math.random() * 0.1);
    level.gain.value = (options.gain ?? 1) * Math.pow(10, (Math.random() * 3 - 1.5) / 20);

    source.connect(level);
    level.connect(route(context, into, options.pan));
    source.onended = done;
    source.start(context.currentTime, take.offset);
}

function synth(context: AudioContext, voices: readonly Voice[], into: AudioNode, options: PlayOptions, done: () => void): void
{
    const at = context.currentTime;
    const out = route(context, into, options.pan);
    const rate = options.rate ?? 1;
    const scale = options.gain ?? 1;
    let last: OscillatorNode | null = null;
    let end = -1;

    for (const voice of voices)
    {
        const source = context.createOscillator();
        const level = context.createGain();
        const stop = at + voice.delay + voice.hold + 0.02;

        source.type = voice.wave;
        source.frequency.setValueAtTime(voice.from * rate, at + voice.delay);
        source.frequency.exponentialRampToValueAtTime(Math.max(1, voice.to * rate), at + voice.delay + voice.hold);

        level.gain.setValueAtTime(0.0001, at + voice.delay);
        level.gain.exponentialRampToValueAtTime(Math.max(0.0002, voice.gain * scale), at + voice.delay + 0.012);
        level.gain.exponentialRampToValueAtTime(0.0001, at + voice.delay + voice.hold);

        source.connect(level);
        level.connect(out);

        source.start(at + voice.delay);
        source.stop(stop);

        if (stop > end)
        {
            end = stop;
            last = source;
        }
    }

    if (last === null)
    {
        done();
        return;
    }

    last.onended = done;
}

function play(cue: Cue, options: PlayOptions): void
{
    const context = engine.context;
    const buses = engine.buses;

    if (context === null || buses === null)
    {
        return;
    }

    if (context.state !== 'running' && !engine.resuming)
    {
        return;
    }

    if (options.urgent !== true && typeof document !== 'undefined' && document.visibilityState === 'hidden')
    {
        return;
    }

    const count = engine.voices.get(cue) ?? { active: 0, last: -1 };
    const now = context.currentTime;

    if (count.active >= MOST_AT_ONCE || (count.last >= 0 && now - count.last < APART))
    {
        return;
    }

    count.active += 1;
    count.last = now;
    engine.voices.set(cue, count);

    const done = (): void =>
    {
        count.active = Math.max(0, count.active - 1);
    };

    const into = buses[busOf(cue)];
    const takes = engine.takes.get(cue as Sampled);

    try
    {
        if (takes !== undefined && takes.length > 0)
        {
            sample(context, cue as Sampled, takes, into, options, done);
            return;
        }

        const voices = TONES[cue as Tone];

        if (voices === undefined)
        {
            done();
            return;
        }

        synth(context, voices, into, options, done);
    }
    catch
    {
        done();
    }
}

export function createSound(enabled: boolean): SoundHandle
{
    let on = enabled;
    let live = true;

    engine.handles += 1;

    if (on)
    {
        engine.listening += 1;
    }

    const context = engine.context;

    if (context === null || context.state !== 'running')
    {
        arm();
    }

    if (context !== null && engine.parked)
    {
        engine.parked = false;
        void context.resume?.().catch(() => undefined);
    }

    return {
        play: (cue, options = {}) =>
        {
            if (live && on)
            {
                play(cue, options);
            }
        },

        setEnabled: (next) =>
        {
            if (!live || next === on)
            {
                return;
            }

            on = next;
            engine.listening += next ? 1 : -1;

            if (next)
            {
                load();
            }
        },

        dispose: () =>
        {
            if (!live)
            {
                return;
            }

            live = false;
            engine.handles -= 1;

            if (on)
            {
                engine.listening -= 1;
            }

            if (engine.handles > 0)
            {
                return;
            }

            disarm();
            engine.parked = true;
            engine.resuming = false;
            void engine.context?.suspend?.().catch(() => undefined);
        }
    };
}

export function resetSound(): void
{
    disarm();
    void engine.context?.close?.().catch(() => undefined);
    engine = fresh();
}
