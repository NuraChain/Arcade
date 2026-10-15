import { Framer } from './voice.framer.ts';
import { Playout, type PlayoutStats } from './voice.playout.ts';
import { createResampler, type Resampler } from './voice.resample.ts';

export type Codec = 'opus' | 'law';

export interface Target
{
    join: string;
    opus: boolean;
}

export interface Outbound
{
    to(targets: readonly Target[]): void;
    setTrack(track: MediaStreamTrack | null): void;
    setMuted(muted: boolean): void;
    setBitrate(target: number): void;
    bitrate(): number;
    close(): void;
}

export interface Heard
{
    bytes: number;
    playout: PlayoutStats | null;
}

export interface Inbound
{
    readonly stream: MediaStream;
    take(codec: Codec, at: number, data: string): void;
    heard(): Heard;
    close(): void;
}

export type Send = (to: string[], codec: Codec, at: number, data: string) => boolean;

export interface RelayKit
{
    outbound(send: Send, opus: boolean): Outbound;
    inbound(): Inbound;
}

export const FRAME_MS = 60;

export const OPUS_RATE = 48_000;

export const LAW_RATE = 16_000;

export const RELAY_MOST = 64_000;

export const RELAY_STEPS = [16_000, 24_000, 32_000, 48_000, 64_000];

export const STRAIN_S = 1;

export const EASE_S = 10;

export const WAITING_MOST = 50;

export const STATS_EVERY = 188;

const BIAS = 0x84;

const CLIP = 32_635;

const SILENT = 1 / 32_768;

const TAP = 'nura-voice-tap';

const PLAY = 'nura-voice-play';

const WORKLET_SOURCE = `
const Kept = (${ Playout.toString() });

const Framed = (${ Framer.toString() });

class Tap extends AudioWorkletProcessor
{
    constructor()
    {
        super();
        this.framer = new Framed(Math.round(sampleRate * ${ FRAME_MS } / 1000));
    }

    process(inputs, outputs)
    {
        const channel = inputs[0] && inputs[0][0];
        const length = channel !== undefined ? channel.length : (outputs[0] && outputs[0][0] ? outputs[0][0].length : 128);

        for (const frame of this.framer.push(channel, length))
        {
            this.port.postMessage(frame, [frame.buffer]);
        }

        return true;
    }
}

class Play extends AudioWorkletProcessor
{
    constructor()
    {
        super();
        this.playout = new Kept(sampleRate, ${ FRAME_MS });
        this.count = 0;
        this.port.onmessage = (event) => this.playout.take(event.data.at, event.data.samples, currentFrame);
    }

    process(inputs, outputs)
    {
        const channel = outputs[0] && outputs[0][0];

        if (channel !== undefined)
        {
            this.playout.fill(channel, currentFrame);
        }

        this.count += 1;

        if (this.count % ${ STATS_EVERY } === 0)
        {
            this.port.postMessage(this.playout.stats());
        }

        return true;
    }
}

registerProcessor('${ TAP }', Tap);
registerProcessor('${ PLAY }', Play);
`;

const OPUS = { codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 1 };

const ENCODE = (bitrate: number) => ({ ...OPUS, bitrate, opus: { frameDuration: FRAME_MS * 1000, complexity: 10, signal: 'voice', application: 'voip' } });

export function lawOf(samples: Float32Array)
{
    const out = new Uint8Array(samples.length);

    for (let index = 0; index < samples.length; index += 1)
    {
        let pcm = Math.round(Math.max(-1, Math.min(1, samples[index])) * 32_767);
        const sign = pcm < 0 ? 0x80 : 0;

        pcm = Math.min(Math.abs(pcm), CLIP) + BIAS;

        let exponent = 7;

        for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1)
        {
            exponent -= 1;
        }

        out[index] = ~(sign | (exponent << 4) | ((pcm >> (exponent + 3)) & 0x0f)) & 0xff;
    }

    return out;
}

export function unlaw(bytes: Uint8Array)
{
    const out = new Float32Array(bytes.length);

    for (let index = 0; index < bytes.length; index += 1)
    {
        const value = ~bytes[index] & 0xff;
        const exponent = (value >> 4) & 0x07;
        const pcm = ((((value & 0x0f) << 3) + BIAS) << exponent) - BIAS;

        out[index] = ((value & 0x80) === 0 ? pcm : -pcm) / 32_768;
    }

    return out;
}

export function silent(samples: Float32Array)
{
    return samples.every((sample) => Math.abs(sample) < SILENT);
}

export function base64Of(bytes: Uint8Array)
{
    let text = '';

    for (const byte of bytes)
    {
        text += String.fromCharCode(byte);
    }

    return btoa(text);
}

export function bytesOf(text: string)
{
    const raw = atob(text);
    const out = new Uint8Array(raw.length);

    for (let index = 0; index < raw.length; index += 1)
    {
        out[index] = raw.charCodeAt(index);
    }

    return out;
}

export function framed(length: number)
{
    let carried = new Float32Array(0);

    return (samples: Float32Array) =>
    {
        const joined = new Float32Array(carried.length + samples.length);

        joined.set(carried);
        joined.set(samples, carried.length);

        const out = new Float32Array(length);

        out.set(joined.subarray(0, length));

        if (joined.length < length)
        {
            out.fill(joined.length === 0 ? 0 : joined[joined.length - 1], joined.length);
        }

        carried = joined.slice(Math.min(joined.length, length));

        return out;
    };
}

export async function hearsOpus()
{
    if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined')
    {
        return false;
    }

    try
    {
        const [encode, decode] = await Promise.all([AudioEncoder.isConfigSupported(ENCODE(RELAY_MOST)), AudioDecoder.isConfigSupported(OPUS)]);

        return encode.supported === true && decode.supported === true;
    }
    catch
    {
        return false;
    }
}

const shut = (coder: AudioEncoder | AudioDecoder | null) =>
{
    if (coder !== null && coder.state !== 'closed')
    {
        coder.close();
    }
};

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

const worklets = (context: AudioContext) =>
{
    let found = loaded.get(context);

    if (found === undefined)
    {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));

        found = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
        loaded.set(context, found);
    }

    return found;
};

export function createRelayKit(context: AudioContext): RelayKit
{
    return {
        outbound(send, opus)
        {
            let targets: readonly Target[] = [];
            let track: MediaStreamTrack | null = null;
            let muted = true;
            let closed = false;
            let wiring = 0;
            let clock = 0;
            let source: MediaStreamAudioSourceNode | null = null;
            let tap: AudioWorkletNode | null = null;
            let encoder: AudioEncoder | null = null;
            let speaks = opus;
            let toLaw: Resampler | null = null;
            const spoken: number[] = [];
            let target = RELAY_MOST;
            let current = RELAY_MOST;
            let changed = -Infinity;
            let strained = -Infinity;
            let toOpus: ((samples: Float32Array) => Float32Array<ArrayBuffer>) | null = null;

            const codec = (): Codec => (speaks && targets.every((one) => one.opus) ? 'opus' : 'law');

            const rebuild = (next: number) =>
            {
                if (next === current)
                {
                    return;
                }

                current = next;
                changed = context.currentTime;
                shut(encoder);
                encoder = null;
                spoken.length = 0;
            };

            const ship = (how: Codec, index: number, bytes: Uint8Array) =>
            {
                const to = targets.map((one) => one.join);

                if (to.length === 0)
                {
                    return;
                }

                const sent = send(to, how, index, base64Of(bytes));
                const now = context.currentTime;

                if (how !== 'opus')
                {
                    return;
                }

                if (!sent)
                {
                    strained = now;

                    if (now - changed >= STRAIN_S)
                    {
                        rebuild(RELAY_STEPS.filter((one) => one < current).at(-1) ?? RELAY_STEPS[0]);
                    }

                    return;
                }

                if (current < target && now - strained >= EASE_S && now - changed >= EASE_S)
                {
                    rebuild(RELAY_STEPS.find((one) => one > current && one <= target) ?? target);
                }
            };

            const coder = () =>
            {
                if (encoder !== null)
                {
                    return encoder;
                }

                const made = new AudioEncoder({
                    output: (chunk) =>
                    {
                        const bytes = new Uint8Array(chunk.byteLength);

                        chunk.copyTo(bytes);

                        const index = spoken.shift();

                        if (index !== undefined && codec() === 'opus')
                        {
                            ship('opus', index, bytes);
                        }
                    },
                    error: () =>
                    {
                        speaks = false;
                        encoder = null;
                        spoken.length = 0;
                    }
                });

                made.configure(ENCODE(current));
                encoder = made;

                return made;
            };

            const opusOf = (samples: Float32Array<ArrayBuffer>) =>
            {
                if (context.sampleRate === OPUS_RATE)
                {
                    return samples;
                }

                if (toOpus === null)
                {
                    const resampler = createResampler(context.sampleRate, OPUS_RATE);
                    const frame = framed(OPUS_RATE * FRAME_MS / 1000);

                    toOpus = (input) => frame(resampler.push(input));
                }

                return toOpus(samples);
            };

            const heard = (samples: Float32Array<ArrayBuffer>) =>
            {
                const index = clock;

                clock += 1;

                if (muted || targets.length === 0 || silent(samples))
                {
                    return;
                }

                if (codec() === 'law')
                {
                    toLaw ??= createResampler(context.sampleRate, LAW_RATE);
                    ship('law', index, lawOf(toLaw.push(samples)));
                    return;
                }

                const sound = opusOf(samples);

                try
                {
                    const writing = coder();

                    spoken.push(index);
                    writing.encode(new AudioData({
                        format: 'f32-planar',
                        sampleRate: OPUS_RATE,
                        numberOfFrames: sound.length,
                        numberOfChannels: 1,
                        timestamp: index * FRAME_MS * 1000,
                        data: sound
                    }));
                }
                catch
                {
                    speaks = false;
                    encoder = null;
                    spoken.length = 0;
                }
            };

            const unwire = () =>
            {
                if (tap !== null)
                {
                    tap.port.onmessage = null;
                    tap.port.close();
                    tap.disconnect();
                }

                source?.disconnect();
                tap = null;
                source = null;
            };

            const wire = async () =>
            {
                const round = ++wiring;

                unwire();

                if (track === null || targets.length === 0)
                {
                    return;
                }

                await worklets(context);

                if (round !== wiring || closed || track === null)
                {
                    return;
                }

                source = context.createMediaStreamSource(new MediaStream([track]));
                tap = new AudioWorkletNode(context, TAP, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
                tap.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => heard(event.data);
                source.connect(tap);
                tap.connect(context.destination);
            };

            const quiet = () =>
            {
                wiring += 1;
                unwire();
                shut(encoder);
                encoder = null;
                spoken.length = 0;
            };

            return {
                to(next)
                {
                    const was = targets.length > 0;

                    targets = next;

                    if (targets.length === 0)
                    {
                        quiet();
                    }
                    else if (!was)
                    {
                        void wire().catch(() => undefined);
                    }
                },

                setTrack(next)
                {
                    if (next === track)
                    {
                        return;
                    }

                    track = next;

                    if (targets.length > 0)
                    {
                        void wire().catch(() => undefined);
                    }
                },

                setMuted(next)
                {
                    muted = next;
                },

                setBitrate(next)
                {
                    target = Math.min(next, RELAY_MOST);

                    if (current > target || context.currentTime - strained >= EASE_S)
                    {
                        rebuild(target);
                    }
                },

                bitrate: () => current,

                close()
                {
                    closed = true;
                    targets = [];
                    quiet();
                }
            };
        },

        inbound()
        {
            const out = context.createMediaStreamDestination();
            const waiting: { at: number; samples: Float32Array }[] = [];
            const length = Math.round(context.sampleRate * FRAME_MS / 1000);
            const lawResampler = createResampler(LAW_RATE, context.sampleRate);
            const opusResampler = createResampler(OPUS_RATE, context.sampleRate);
            const lawFrame = framed(length);
            const opusFrame = framed(length);
            let player: AudioWorkletNode | null = null;
            let decoder: AudioDecoder | null = null;
            const heardAt: number[] = [];
            let closed = false;
            let received = 0;
            let playout: PlayoutStats | null = null;

            const hand = (at: number, samples: Float32Array) =>
            {
                if (closed || samples.length === 0)
                {
                    return;
                }

                if (player === null)
                {
                    waiting.push({ at, samples });
                    waiting.splice(0, Math.max(0, waiting.length - WAITING_MOST));
                    return;
                }

                player.port.postMessage({ at, samples }, [samples.buffer]);
            };

            void worklets(context).then(() =>
            {
                if (closed)
                {
                    return;
                }

                player = new AudioWorkletNode(context, PLAY, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
                player.port.onmessage = (event: MessageEvent<PlayoutStats>) =>
                {
                    playout = event.data;
                };
                player.connect(out);

                for (const one of waiting.splice(0))
                {
                    hand(one.at, one.samples);
                }
            }).catch(() => undefined);

            const opus = () =>
            {
                if (decoder !== null)
                {
                    return decoder;
                }

                const made = new AudioDecoder({
                    output: (data) =>
                    {
                        const samples = new Float32Array(data.numberOfFrames);

                        data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });

                        const at = heardAt.shift();

                        if (at !== undefined)
                        {
                            hand(at, context.sampleRate === data.sampleRate ? samples : opusFrame(opusResampler.push(samples)));
                        }

                        data.close();
                    },
                    error: () =>
                    {
                        decoder = null;
                        heardAt.length = 0;
                    }
                });

                made.configure(OPUS);
                decoder = made;

                return made;
            };

            return {
                stream: out.stream,

                take(codec, at, data)
                {
                    if (closed)
                    {
                        return;
                    }

                    const bytes = bytesOf(data);

                    received += bytes.length;

                    if (codec === 'law')
                    {
                        hand(at, lawFrame(lawResampler.push(unlaw(bytes))));
                        return;
                    }

                    if (typeof AudioDecoder === 'undefined')
                    {
                        return;
                    }

                    try
                    {
                        const reading = opus();

                        heardAt.push(at);
                        reading.decode(new EncodedAudioChunk({ type: 'key', timestamp: at * FRAME_MS * 1000, data: bytes }));
                    }
                    catch
                    {
                        decoder = null;
                        heardAt.length = 0;
                    }
                },

                heard: () => ({ bytes: received, playout }),

                close()
                {
                    closed = true;
                    waiting.length = 0;

                    if (player !== null)
                    {
                        player.port.onmessage = null;
                        player.port.close();
                        player.disconnect();
                        player = null;
                    }

                    shut(decoder);
                    decoder = null;
                    out.disconnect();
                }
            };
        }
    };
}
