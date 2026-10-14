import { describe, it, expect, afterEach, vi } from 'vitest';

import {
    FRAME_MS,
    JITTER_MS,
    LAG_MOST_MS,
    LAW_RATE,
    base64Of,
    bytesOf,
    createRelayKit,
    hearsOpus,
    lawOf,
    resample,
    silent,
    unlaw
} from '../src/services/voice.relay.ts';

afterEach(() =>
{
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const flush = async () =>
{
    for (let index = 0; index < 6; index += 1)
    {
        await Promise.resolve();
    }
};

describe('the sound the server carries, in bytes', () =>
{
    it('writes silence, the loudest and the quietest sample as the telephone does', () =>
    {
        expect([...lawOf(new Float32Array([0, 1, -1]))]).toEqual([0xff, 0x80, 0x00]);
    });

    it('reads back every sample within a step of its own size', () =>
    {
        const samples = Float32Array.from({ length: 4001 }, (_, index) => (index - 2000) / 2000);
        const back = unlaw(lawOf(samples));

        for (let index = 0; index < samples.length; index += 1)
        {
            expect(Math.abs(back[index] - samples[index]), `sample ${ samples[index] }`).toBeLessThanOrEqual(Math.abs(samples[index]) / 16 + 1 / 4096);
        }
    });

    it('turns every byte into base64 and back', () =>
    {
        const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);

        expect([...bytesOf(base64Of(bytes))]).toEqual([...bytes]);
    });

    it('brings a frame down to the telephone rate and up again without moving a steady sound', () =>
    {
        const down = resample(new Float32Array(2880).fill(0.3), 48_000, LAW_RATE);
        const up = resample(new Float32Array(960).fill(-0.2), LAW_RATE, 48_000);

        expect(down.length).toBe(960);
        expect(up.length).toBe(2880);
        expect(down.every((sample) => Math.abs(sample - 0.3) < 1e-6)).toBe(true);
        expect(up.every((sample) => Math.abs(sample + 0.2) < 1e-6)).toBe(true);
    });

    it('averages the samples it brings a frame down over', () =>
    {
        const down = resample(Float32Array.from([0, 1, 2, 3, 4, 5]), 3, 1);

        expect([...down]).toEqual([1, 4]);
    });

    it('draws a line between two samples when it brings a frame up', () =>
    {
        const up = resample(Float32Array.from([0, 1]), 1, 2);

        expect([...up]).toEqual([0, 0.5, 1, 1]);
    });

    it('calls a frame silent only when nothing in it is louder than the smallest step', () =>
    {
        expect(silent(new Float32Array(960))).toBe(true);
        expect(silent(Float32Array.from([0, 0, 0.0001, 0]))).toBe(false);
    });
});

describe('whether a browser can speak Opus', () =>
{
    it('cannot without the codecs', async () =>
    {
        vi.stubGlobal('AudioEncoder', undefined);
        vi.stubGlobal('AudioDecoder', undefined);

        expect(await hearsOpus()).toBe(false);
    });

    it('can when it both writes and reads it, and not when either says no or throws', async () =>
    {
        const answers = { encode: true, decode: true, throws: false };
        const answer = (yes: () => boolean) => ({
            isConfigSupported: async () =>
            {
                if (answers.throws)
                {
                    throw new Error('no');
                }

                return { supported: yes() };
            }
        });

        vi.stubGlobal('AudioEncoder', answer(() => answers.encode));
        vi.stubGlobal('AudioDecoder', answer(() => answers.decode));

        expect(await hearsOpus()).toBe(true);

        answers.encode = false;
        expect(await hearsOpus()).toBe(false);

        answers.encode = true;
        answers.decode = false;
        expect(await hearsOpus()).toBe(false);

        answers.decode = true;
        answers.throws = true;
        expect(await hearsOpus()).toBe(false);
    });
});

interface Played
{
    rate: number;
    length: number;
    samples: Float32Array;
    at: number;
    stopped: boolean;
    into: unknown[];
}

function listening()
{
    const played: Played[] = [];
    const out = {
        stream: { carried: true },
        off: false,
        disconnect: () =>
        {
            out.off = true;
        }
    };
    const context = {
        currentTime: 10,
        sampleRate: 48_000,
        createMediaStreamDestination: () => out,
        createBuffer: (_channels: number, length: number, rate: number) =>
        {
            const samples = new Float32Array(length);

            return {
                duration: length / rate,
                rate,
                length,
                samples,
                copyToChannel: (from: Float32Array) => samples.set(from)
            };
        },
        createBufferSource: () =>
        {
            const node = {
                buffer: null as { rate: number; length: number; samples: Float32Array } | null,
                onended: null as (() => void) | null,
                at: null as number | null,
                into: [] as unknown[],
                connect: (next: unknown) => node.into.push(next),
                disconnect: () => undefined,
                start: (at: number) =>
                {
                    node.at = at;
                    played.push({ rate: node.buffer!.rate, length: node.buffer!.length, samples: node.buffer!.samples, at, stopped: false, into: node.into });
                },
                stop: () =>
                {
                    played.find((one) => one.at === node.at)!.stopped = true;
                }
            };

            return node;
        }
    };

    const inbound = createRelayKit(context as unknown as AudioContext).inbound();
    const frame = (value: number) => base64Of(lawOf(new Float32Array(LAW_RATE * FRAME_MS / 1000).fill(value)));

    return { context, played, out, inbound, frame };
}

describe('sound the server carries from somebody, as it is played', () =>
{
    it('plays the first frame a moment after it arrives and every frame after it straight after the one before', () =>
    {
        const one = listening();

        one.inbound.take('law', 0, one.frame(0.5));
        one.inbound.take('law', 1, one.frame(-0.5));

        expect(one.played.map((played) => [played.rate, played.length])).toEqual([[LAW_RATE, 960], [LAW_RATE, 960]]);
        expect(one.played[0].at).toBeCloseTo(10 + JITTER_MS / 1000);
        expect(one.played[1].at).toBeCloseTo(10 + JITTER_MS / 1000 + FRAME_MS / 1000);
        expect(one.played[0].samples[0]).toBeCloseTo(0.5, 1);
        expect(one.played.every((played) => played.into.includes(one.out)), 'a frame was not played into the stream the page hears').toBe(true);
        expect(one.inbound.stream).toBe(one.out.stream);
    });

    it('lets a frame fall rather than play it later than the most a call may lag', () =>
    {
        const one = listening();
        const most = Math.floor((LAG_MOST_MS - JITTER_MS) / FRAME_MS) + 1;

        for (let at = 0; at < most + 3; at += 1)
        {
            one.inbound.take('law', at, one.frame(0.1));
        }

        expect(one.played).toHaveLength(most);
        expect(Math.max(...one.played.map((played) => played.at!)) - 10).toBeLessThanOrEqual(LAG_MOST_MS / 1000);
    });

    it('starts again a moment ahead when the frames fell behind the clock', () =>
    {
        const one = listening();

        one.inbound.take('law', 0, one.frame(0.1));
        one.context.currentTime = 20;
        one.inbound.take('law', 1, one.frame(0.1));

        expect(one.played[1].at).toBeCloseTo(20 + JITTER_MS / 1000);
    });

    it('stops what it was playing and plays nothing more once it is closed', () =>
    {
        const one = listening();

        one.inbound.take('law', 0, one.frame(0.1));
        one.inbound.close();
        one.inbound.take('law', 1, one.frame(0.1));

        expect(one.played).toHaveLength(1);
        expect(one.played[0].stopped).toBe(true);
        expect(one.out.off).toBe(true);
    });

    it('hands Opus to the browser to read and plays what it reads', () =>
    {
        const decoded: { chunk: { type: string; timestamp: number; data: Uint8Array } }[] = [];

        vi.stubGlobal('EncodedAudioChunk', class
        {
            public init: { type: string; timestamp: number; data: Uint8Array };

            constructor(init: { type: string; timestamp: number; data: Uint8Array })
            {
                this.init = init;
            }
        });
        vi.stubGlobal('AudioDecoder', class
        {
            public state = 'unconfigured';
            public hooks: { output(data: unknown): void };

            constructor(hooks: { output(data: unknown): void })
            {
                this.hooks = hooks;
            }

            public configure()
            {
                this.state = 'configured';
            }

            public decode(chunk: { init: { type: string; timestamp: number; data: Uint8Array } })
            {
                decoded.push({ chunk: chunk.init });
                this.hooks.output({
                    numberOfFrames: 2880,
                    sampleRate: 48_000,
                    copyTo: (into: Float32Array) => into.fill(0.25),
                    close: () => undefined
                });
            }

            public close()
            {
                this.state = 'closed';
            }
        });

        const one = listening();

        one.inbound.take('opus', 4, 'AQID');

        expect(decoded.map((sent) => [sent.chunk.type, sent.chunk.timestamp, [...sent.chunk.data]])).toEqual([['key', 4 * FRAME_MS * 1000, [1, 2, 3]]]);
        expect(one.played.map((played) => [played.rate, played.length, played.samples[0]])).toEqual([[48_000, 2880, 0.25]]);
    });
});

function speaking(rate = 48_000)
{
    const taps: { port: { onmessage: ((event: { data: Float32Array }) => void) | null; closed: boolean; close(): void }; off: boolean; into: unknown[]; options: unknown }[] = [];
    const sent: { to: string[]; codec: string; at: number; data: string }[] = [];
    const sources: { tracks: unknown[]; off: boolean; into: unknown[] }[] = [];
    const modules: string[] = [];
    const destination = { name: 'speakers' };

    vi.stubGlobal('MediaStream', class
    {
        public tracks: unknown[];

        constructor(tracks: unknown[])
        {
            this.tracks = tracks;
        }
    });
    vi.stubGlobal('AudioWorkletNode', class
    {
        public port = {
            onmessage: null,
            closed: false,
            close: () =>
            {
                this.port.closed = true;
            }
        };
        public off = false;
        public into: unknown[] = [];
        public options: unknown;

        constructor(_context: unknown, _name: string, options: unknown)
        {
            this.options = options;
            taps.push(this as never);
        }

        public connect(next: unknown)
        {
            this.into.push(next);
        }

        public disconnect()
        {
            this.off = true;
        }
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tap');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    const context = {
        sampleRate: rate,
        destination,
        audioWorklet: {
            addModule: async (url: string) =>
            {
                modules.push(url);
            }
        },
        createMediaStreamSource: (stream: { tracks: unknown[] }) =>
        {
            const source = {
                tracks: stream.tracks,
                off: false,
                into: [] as unknown[],
                connect: (next: unknown) => source.into.push(next),
                disconnect: () =>
                {
                    source.off = true;
                }
            };

            sources.push(source);
            return source;
        }
    };

    const track = { kind: 'audio' } as unknown as MediaStreamTrack;
    const outbound = (opus = false) => createRelayKit(context as unknown as AudioContext).outbound((to, codec, at, data) => sent.push({ to, codec, at, data }), opus);
    const say = (value: number, length = rate * FRAME_MS / 1000) => taps.at(-1)!.port.onmessage!({ data: new Float32Array(length).fill(value) });

    return { taps, sent, sources, modules, destination, track, outbound, say };
}

describe('the microphone, as the server carries it', () =>
{
    it('taps the microphone once somebody needs it and sends each frame to every joining it carries for', async () =>
    {
        const one = speaking();
        const out = one.outbound();

        out.setMuted(false);
        out.setTrack(one.track);

        expect(one.taps, 'the microphone was tapped with nobody to carry it to').toHaveLength(0);

        out.to([{ join: 'm1', opus: false }, { join: 's1', opus: true }]);
        await flush();

        expect(one.modules).toEqual(['blob:tap']);
        expect(one.sources[0].tracks).toEqual([one.track]);
        expect(one.sources[0].into).toContain(one.taps[0]);
        expect(one.taps[0].into).toContain(one.destination);

        one.say(0.25);
        one.say(-0.25);

        expect(one.sent.map((frame) => [frame.to, frame.codec, frame.at])).toEqual([[['m1', 's1'], 'law', 0], [['m1', 's1'], 'law', 1]]);
        expect(bytesOf(one.sent[0].data)).toEqual(lawOf(new Float32Array(960).fill(0.25)));
    });

    it('sends nothing while muted, nothing for a frame of silence, and lets go of the microphone when nobody needs it', async () =>
    {
        const one = speaking();
        const out = one.outbound();

        out.setTrack(one.track);
        out.to([{ join: 'm1', opus: false }]);
        await flush();

        one.say(0.25);
        out.setMuted(false);
        one.say(0);

        expect(one.sent).toEqual([]);

        out.to([]);

        expect(one.taps[0].off).toBe(true);
        expect(one.taps[0].port.closed).toBe(true);
        expect(one.sources[0].off).toBe(true);
    });

    it('taps the new microphone when it changes, and nothing at all once it is closed', async () =>
    {
        const one = speaking();
        const out = one.outbound();
        const other = { kind: 'audio', other: true } as unknown as MediaStreamTrack;

        out.setTrack(one.track);
        out.to([{ join: 'm1', opus: false }]);
        await flush();
        out.setTrack(other);
        await flush();

        expect(one.taps).toHaveLength(2);
        expect(one.taps[0].off).toBe(true);
        expect(one.sources[1].tracks).toEqual([other]);

        out.close();
        out.to([{ join: 'm1', opus: false }]);
        await flush();

        expect(one.taps).toHaveLength(2);
        expect(one.taps[1].off).toBe(true);
    });

    it('speaks Opus when everybody it carries for hears it, the telephone code when anybody does not, and the telephone code for good once Opus fails', async () =>
    {
        const encoded: { timestamp: number; numberOfFrames: number; sampleRate: number }[] = [];
        const coders: { fail(): void; state: string }[] = [];

        vi.stubGlobal('AudioData', class
        {
            public init: { timestamp: number; numberOfFrames: number; sampleRate: number };

            constructor(init: { timestamp: number; numberOfFrames: number; sampleRate: number })
            {
                this.init = init;
            }
        });
        vi.stubGlobal('AudioEncoder', class
        {
            public state = 'unconfigured';
            public hooks: { output(chunk: unknown): void; error(): void };

            constructor(hooks: { output(chunk: unknown): void; error(): void })
            {
                this.hooks = hooks;
                coders.push(this);
            }

            public configure()
            {
                this.state = 'configured';
            }

            public encode(data: { init: { timestamp: number; numberOfFrames: number; sampleRate: number } })
            {
                encoded.push(data.init);
                this.hooks.output({ byteLength: 3, copyTo: (into: Uint8Array) => into.set([1, 2, 3]) });
            }

            public close()
            {
                this.state = 'closed';
            }

            public fail()
            {
                this.state = 'closed';
                this.hooks.error();
            }
        });

        const one = speaking(44_100);
        const out = one.outbound(true);

        out.setMuted(false);
        out.setTrack(one.track);
        out.to([{ join: 'm1', opus: true }]);
        await flush();

        one.say(0.25);

        expect(one.sent.map((frame) => [frame.codec, frame.data])).toEqual([['opus', 'AQID']]);
        expect(encoded.map((frame) => [frame.timestamp, frame.numberOfFrames, frame.sampleRate])).toEqual([[0, 2880, 48_000]]);

        out.to([{ join: 'm1', opus: true }, { join: 's1', opus: false }]);
        one.say(0.25);

        expect(one.sent.at(-1)!.codec).toBe('law');

        out.to([{ join: 'm1', opus: true }]);
        coders[0].fail();
        one.say(0.25);

        expect(one.sent.at(-1)!.codec, 'a browser whose Opus failed went on trying to speak it').toBe('law');
        expect(one.sent.map((frame) => frame.at)).toEqual([0, 1, 2]);
    });
});
