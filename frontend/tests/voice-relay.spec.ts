import { describe, it, expect, afterEach, vi } from 'vitest';

import {
    EASE_S,
    FRAME_MS,
    LAW_RATE,
    RELAY_MOST,
    STRAIN_S,
    WAITING_MOST,
    base64Of,
    bytesOf,
    createRelayKit,
    hearsOpus,
    lawOf,
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

interface Player
{
    name: string;
    options: unknown;
    told: { at: number; samples: Float32Array }[];
    into: unknown[];
    off: boolean;
    closed: boolean;
}

function listening(rate = 48_000)
{
    const players: Player[] = [];
    const modules: string[] = [];
    let ready: () => void = () => undefined;
    const loading = new Promise<void>((done) =>
    {
        ready = done;
    });
    const out = {
        stream: { carried: true },
        off: false,
        disconnect: () =>
        {
            out.off = true;
        }
    };

    vi.stubGlobal('AudioWorkletNode', class
    {
        public told: { at: number; samples: Float32Array }[] = [];
        public into: unknown[] = [];
        public off = false;
        public closed = false;
        public name: string;
        public options: unknown;
        public port = {
            postMessage: (message: { at: number; samples: Float32Array }) => this.told.push(message),
            close: () =>
            {
                this.closed = true;
            }
        };

        constructor(_context: unknown, name: string, options: unknown)
        {
            this.name = name;
            this.options = options;
            players.push(this as never);
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
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    const context = {
        sampleRate: rate,
        audioWorklet: {
            addModule: (url: string) =>
            {
                modules.push(url);
                return loading;
            }
        },
        createMediaStreamDestination: () => out
    };

    const inbound = createRelayKit(context as unknown as AudioContext).inbound();
    const frame = (value: number) => base64Of(lawOf(new Float32Array(LAW_RATE * FRAME_MS / 1000).fill(value)));
    const mean = (samples: Float32Array, from: number, to: number) => samples.slice(from, to).reduce((sum, one) => sum + one, 0) / (to - from);

    return { context, players, modules, out, inbound, frame, mean, ready: async () =>
    {
        ready();
        await flush();
    } };
}

describe('sound the server carries from somebody, as it is played', () =>
{
    it('hands each frame to a player in the audio thread with the moment it was spoken, at the call\'s own rate', async () =>
    {
        const one = listening();

        await one.ready();
        one.inbound.take('law', 0, one.frame(0.5));
        one.inbound.take('law', 3, one.frame(-0.5));

        const player = one.players[0];

        expect(one.modules).toEqual(['blob:voice']);
        expect(player.name).toBe('nura-voice-play');
        expect(player.told.map((told) => told.at)).toEqual([0, 3]);
        expect(player.told.map((told) => told.samples.length)).toEqual([2880, 2880]);
        expect(one.mean(player.told[0].samples, 200, 2600)).toBeCloseTo(0.5, 1);
        expect(one.mean(player.told[1].samples, 200, 2600)).toBeCloseTo(-0.5, 1);
        expect(player.into, 'the player does not play into the stream the page hears').toContain(one.out);
        expect(one.inbound.stream).toBe(one.out.stream);
    });

    it('keeps what arrives before the player is ready and hands it over in order, keeping no more than it may', async () =>
    {
        const one = listening();

        for (let at = 0; at < WAITING_MOST + 5; at += 1)
        {
            one.inbound.take('law', at, one.frame(0.1));
        }

        expect(one.players).toHaveLength(0);

        await one.ready();

        expect(one.players[0].told.map((told) => told.at)).toEqual(Array.from({ length: WAITING_MOST }, (_, index) => index + 5));
    });

    it('stops the player and hands it nothing more once it is closed', async () =>
    {
        const one = listening();

        await one.ready();
        one.inbound.take('law', 0, one.frame(0.1));
        one.inbound.close();
        one.inbound.take('law', 1, one.frame(0.1));

        expect(one.players[0].told).toHaveLength(1);
        expect(one.players[0].off).toBe(true);
        expect(one.players[0].closed).toBe(true);
        expect(one.out.off).toBe(true);
    });

    it('makes no player at all when it is closed before one could be made', async () =>
    {
        const one = listening();

        one.inbound.take('law', 0, one.frame(0.1));
        one.inbound.close();
        await one.ready();

        expect(one.players).toHaveLength(0);
    });

    it('hands Opus to the browser to read, and knows each frame by the moment it was spoken', async () =>
    {
        const decoded: { type: string; timestamp: number; data: Uint8Array }[] = [];

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

            public read = 0;

            public decode(chunk: { init: { type: string; timestamp: number; data: Uint8Array } })
            {
                decoded.push(chunk.init);
                this.hooks.output({
                    numberOfFrames: 2880,
                    sampleRate: 48_000,
                    timestamp: this.read++ * 60_000,
                    copyTo: (into: Float32Array) => into.fill(0.25),
                    close: () => undefined
                });
            }

            public close()
            {
                this.state = 'closed';
            }
        });

        const at48 = listening();

        await at48.ready();
        at48.inbound.take('opus', 4, 'AQID');

        expect(decoded.map((sent) => [sent.type, sent.timestamp, [...sent.data]])).toEqual([['key', 4 * FRAME_MS * 1000, [1, 2, 3]]]);
        expect(at48.players[0].told.map((told) => [told.at, told.samples.length, told.samples[0]])).toEqual([[4, 2880, 0.25]]);

        const at44 = listening(44_100);

        await at44.ready();
        at44.inbound.take('opus', 9, 'AQID');

        expect(at44.players[0].told.map((told) => told.at)).toEqual([9]);
        expect(at44.players[0].told[0].samples.length, 'Opus was not brought to the call\'s own rate').toBe(2646);
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
        currentTime: 0,
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
    const line = { open: true };
    const outbound = (opus = false) => createRelayKit(context as unknown as AudioContext).outbound((to, codec, at, data) =>
    {
        sent.push({ to, codec, at, data });
        return line.open;
    }, opus);
    const say = (value: number, length = rate * FRAME_MS / 1000) => taps.at(-1)!.port.onmessage!({ data: new Float32Array(length).fill(value) });

    return { taps, sent, sources, modules, destination, track, outbound, say, context, line };
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

        const heard = unlaw(bytesOf(one.sent[1].data));

        expect(one.sent.map((frame) => [frame.to, frame.codec, frame.at])).toEqual([[['m1', 's1'], 'law', 0], [['m1', 's1'], 'law', 1]]);
        expect(Math.abs(heard.length - 960)).toBeLessThanOrEqual(1);
        expect(heard.slice(100, 900).every((sample) => Math.abs(sample + 0.25) < 0.02)).toBe(true);
    });

    it('counts every frame the microphone gives, sent or not, so a pause is a gap in the count and not a shift in time', async () =>
    {
        const one = speaking();
        const out = one.outbound();

        out.setTrack(one.track);
        out.to([{ join: 'm1', opus: false }]);
        await flush();

        one.say(0.25);
        one.say(0.25);
        out.setMuted(false);
        one.say(0.25);
        one.say(0);
        one.say(0);
        one.say(0.25);

        expect(one.sent.map((frame) => frame.at)).toEqual([2, 5]);
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

    it('speaks Opus as well as it is asked, never above what the server carries, and lower while the socket falls behind until it has been calm', async () =>
    {
        const configured: number[] = [];

        vi.stubGlobal('AudioData', class
        {
            constructor(public init: unknown)
            {
            }
        });
        vi.stubGlobal('AudioEncoder', class
        {
            public state = 'unconfigured';
            public hooks: { output(chunk: unknown): void };

            constructor(hooks: { output(chunk: unknown): void })
            {
                this.hooks = hooks;
            }

            public configure(config: { bitrate: number })
            {
                configured.push(config.bitrate);
                this.state = 'configured';
            }

            public encode()
            {
                this.hooks.output({ byteLength: 1, copyTo: (into: Uint8Array) => into.set([1]) });
            }

            public close()
            {
                this.state = 'closed';
            }
        });

        const one = speaking();
        const out = one.outbound(true);

        out.setMuted(false);
        out.setTrack(one.track);
        out.to([{ join: 'm1', opus: true }]);
        await flush();

        out.setBitrate(96_000);
        one.say(0.25);

        expect(out.bitrate()).toBe(RELAY_MOST);
        expect(configured.at(-1)).toBe(RELAY_MOST);

        one.line.open = false;
        one.context.currentTime = STRAIN_S;
        one.say(0.25);

        expect(out.bitrate(), 'a socket that fell behind was sent as much as before').toBe(48_000);

        one.say(0.25);

        expect(out.bitrate(), 'it stepped down again before the last step had a chance').toBe(48_000);

        one.context.currentTime = STRAIN_S * 2.5;
        one.say(0.25);
        one.say(0.25);

        expect(out.bitrate()).toBe(32_000);
        expect(configured.at(-1)).toBe(32_000);

        one.line.open = true;
        one.context.currentTime += EASE_S / 2;
        one.say(0.25);

        expect(out.bitrate(), 'it went back up before the socket had been calm for long').toBe(32_000);

        one.context.currentTime += EASE_S;
        one.say(0.25);
        one.say(0.25);

        expect(out.bitrate()).toBe(48_000);
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
            public written = 0;
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
                this.hooks.output({ byteLength: 3, timestamp: this.written++ * 60_000, copyTo: (into: Uint8Array) => into.set([1, 2, 3]) });
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
        one.say(0);
        one.say(0.25);

        expect(one.sent.map((frame) => [frame.codec, frame.at, frame.data]), 'a pause went missing from the count, as the encoder numbers its output with no gaps').toEqual([['opus', 0, 'AQID'], ['opus', 2, 'AQID']]);
        expect(encoded.map((frame) => [frame.timestamp, frame.numberOfFrames, frame.sampleRate])).toEqual([[0, 2880, 48_000], [2 * FRAME_MS * 1000, 2880, 48_000]]);

        out.to([{ join: 'm1', opus: true }, { join: 's1', opus: false }]);
        one.say(0.25);

        expect(one.sent.at(-1)!.codec).toBe('law');

        out.to([{ join: 'm1', opus: true }]);
        coders[0].fail();
        one.say(0.25);

        expect(one.sent.at(-1)!.codec, 'a browser whose Opus failed went on trying to speak it').toBe('law');
        expect(one.sent.map((frame) => frame.at)).toEqual([0, 2, 3, 4]);
    });
});
