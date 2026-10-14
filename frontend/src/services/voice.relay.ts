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
    close(): void;
}

export interface Inbound
{
    readonly stream: MediaStream;
    take(codec: Codec, at: number, data: string): void;
    close(): void;
}

export type Send = (to: string[], codec: Codec, at: number, data: string) => void;

export interface RelayKit
{
    outbound(send: Send, opus: boolean): Outbound;
    inbound(): Inbound;
}

export const FRAME_MS = 60;

export const OPUS_RATE = 48_000;

export const LAW_RATE = 16_000;

export const OPUS_BITRATE = 24_000;

export const JITTER_MS = 120;

export const LAG_MOST_MS = 400;

const BIAS = 0x84;

const CLIP = 32_635;

const SILENT = 1 / 32_768;

const TAP = 'nura-voice-tap';

const TAP_SOURCE = `
class Tap extends AudioWorkletProcessor
{
    constructor()
    {
        super();
        this.size = Math.round(sampleRate * ${ FRAME_MS } / 1000);
        this.held = new Float32Array(this.size);
        this.at = 0;
    }

    process(inputs)
    {
        const channel = inputs[0] && inputs[0][0];

        if (channel !== undefined)
        {
            for (let index = 0; index < channel.length; index += 1)
            {
                this.held[this.at] = channel[index];
                this.at += 1;

                if (this.at === this.size)
                {
                    this.port.postMessage(this.held, [this.held.buffer]);
                    this.held = new Float32Array(this.size);
                    this.at = 0;
                }
            }
        }

        return true;
    }
}

registerProcessor('${ TAP }', Tap);
`;

const OPUS = { codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 1 };

const ENCODE = { ...OPUS, bitrate: OPUS_BITRATE, opus: { frameDuration: FRAME_MS * 1000 } };

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

export function resample(samples: Float32Array, from: number, to: number)
{
    const length = Math.max(1, Math.round((samples.length * to) / from));
    const out = new Float32Array(length);
    const step = from / to;

    for (let index = 0; index < length; index += 1)
    {
        if (step > 1)
        {
            const start = Math.min(samples.length - 1, Math.floor(index * step));
            const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * step)));
            let sum = 0;

            for (let at = start; at < end; at += 1)
            {
                sum += samples[at];
            }

            out[index] = sum / (end - start);
        }
        else
        {
            const at = index * step;
            const left = Math.min(Math.floor(at), samples.length - 1);
            const right = Math.min(left + 1, samples.length - 1);
            const weight = at - Math.floor(at);

            out[index] = samples[left] * (1 - weight) + samples[right] * weight;
        }
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

export async function hearsOpus()
{
    if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined')
    {
        return false;
    }

    try
    {
        const [encode, decode] = await Promise.all([AudioEncoder.isConfigSupported(ENCODE), AudioDecoder.isConfigSupported(OPUS)]);

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

const tapped = (context: AudioContext) =>
{
    let found = loaded.get(context);

    if (found === undefined)
    {
        const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' }));

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
            let at = 0;
            let fed = 0;
            let source: MediaStreamAudioSourceNode | null = null;
            let tap: AudioWorkletNode | null = null;
            let encoder: AudioEncoder | null = null;
            let speaks = opus;

            const codec = (): Codec => (speaks && targets.every((one) => one.opus) ? 'opus' : 'law');

            const ship = (how: Codec, bytes: Uint8Array) =>
            {
                const to = targets.map((one) => one.join);

                if (to.length > 0)
                {
                    send(to, how, at, base64Of(bytes));
                    at += 1;
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

                        if (codec() === 'opus')
                        {
                            ship('opus', bytes);
                        }
                    },
                    error: () =>
                    {
                        speaks = false;
                        encoder = null;
                    }
                });

                made.configure(ENCODE);
                encoder = made;

                return made;
            };

            const heard = (samples: Float32Array<ArrayBuffer>) =>
            {
                if (muted || targets.length === 0 || silent(samples))
                {
                    return;
                }

                if (codec() === 'law')
                {
                    ship('law', lawOf(resample(samples, context.sampleRate, LAW_RATE)));
                    return;
                }

                const sound = context.sampleRate === OPUS_RATE ? samples : resample(samples, context.sampleRate, OPUS_RATE);

                try
                {
                    coder().encode(new AudioData({
                        format: 'f32-planar',
                        sampleRate: OPUS_RATE,
                        numberOfFrames: sound.length,
                        numberOfChannels: 1,
                        timestamp: fed * FRAME_MS * 1000,
                        data: sound
                    }));
                    fed += 1;
                }
                catch
                {
                    speaks = false;
                    encoder = null;
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

                await tapped(context);

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
            const playing = new Set<AudioBufferSourceNode>();
            let decoder: AudioDecoder | null = null;
            let next = 0;
            let closed = false;

            const play = (samples: Float32Array<ArrayBuffer>, rate: number) =>
            {
                if (closed || samples.length === 0)
                {
                    return;
                }

                const now = context.currentTime;

                if (next < now)
                {
                    next = now + JITTER_MS / 1000;
                }

                if (next - now > LAG_MOST_MS / 1000)
                {
                    return;
                }

                const buffer = context.createBuffer(1, samples.length, rate);
                const node = context.createBufferSource();

                buffer.copyToChannel(samples, 0);
                node.buffer = buffer;
                node.connect(out);
                node.onended = () =>
                {
                    playing.delete(node);
                    node.disconnect();
                };
                playing.add(node);
                node.start(next);
                next += buffer.duration;
            };

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
                        play(samples, data.sampleRate);
                        data.close();
                    },
                    error: () =>
                    {
                        decoder = null;
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

                    if (codec === 'law')
                    {
                        play(unlaw(bytes), LAW_RATE);
                        return;
                    }

                    if (typeof AudioDecoder === 'undefined')
                    {
                        return;
                    }

                    try
                    {
                        opus().decode(new EncodedAudioChunk({ type: 'key', timestamp: at * FRAME_MS * 1000, data: bytes }));
                    }
                    catch
                    {
                        decoder = null;
                    }
                },

                close()
                {
                    closed = true;

                    for (const node of playing)
                    {
                        node.onended = null;
                        node.stop();
                        node.disconnect();
                    }

                    playing.clear();
                    shut(decoder);
                    decoder = null;
                    out.disconnect();
                }
            };
        }
    };
}
