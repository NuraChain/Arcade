import { describe, it, expect, afterEach, vi } from 'vitest';

import { INPUT_LOUDEST, createVoiceInput, type InputOptions } from '../src/services/voice.input.ts';

afterEach(() =>
{
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

interface Node
{
    kind: string;
    into: unknown[];
    off: boolean;
}

function room()
{
    const nodes: (Node & Record<string, unknown>)[] = [];
    const modules: string[] = [];
    const gates: { name: string; options: unknown; told: unknown[]; port: { onmessage: ((event: { data: unknown }) => void) | null; closed: boolean } & Record<string, unknown>; into: unknown[]; off: boolean }[] = [];
    const node = (kind: string, extra: Record<string, unknown> = {}) =>
    {
        const one: Node & Record<string, unknown> = {
            kind,
            into: [],
            off: false,
            ...extra,
            connect(next: unknown)
            {
                one.into.push(next);
                return next;
            },
            disconnect()
            {
                one.off = true;
            }
        };

        nodes.push(one);
        return one;
    };

    vi.stubGlobal('AudioWorkletNode', class
    {
        public told: unknown[] = [];
        public into: unknown[] = [];
        public off = false;
        public name: string;
        public options: unknown;
        public port = {
            onmessage: null as ((event: { data: unknown }) => void) | null,
            closed: false,
            postMessage: (message: unknown) => this.told.push(message),
            close: () =>
            {
                this.port.closed = true;
            }
        };

        constructor(_context: unknown, name: string, options: unknown)
        {
            this.name = name;
            this.options = options;
            gates.push(this as never);
        }

        public connect(next: unknown)
        {
            this.into.push(next);
            return next;
        }

        public disconnect()
        {
            this.off = true;
        }
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gate');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    const track = { kind: 'audio', contentHint: '' };
    const set: [number, number, number][] = [];

    const context = {
        currentTime: 4,
        audioWorklet: {
            addModule: async (url: string) =>
            {
                modules.push(url);
            }
        },
        createMediaStreamSource: (stream: unknown) => node('source', { stream }),
        createGain: () => node('gain', { gain: { setTargetAtTime: (value: number, at: number, constant: number) => set.push([value, at, constant]) } }),
        createMediaStreamDestination: () => node('out', { channelCount: 2, channelCountMode: 'max', stream: { processed: true, getAudioTracks: () => [track] } })
    };

    return { context, nodes, modules, gates, track, set };
}

const OPTIONS: InputOptions = { volume: 1.5, push: false, pressed: false, linger: 200, auto: true, threshold: -50 };

const raw = { raw: true } as unknown as MediaStream;

describe('the microphone, as it is prepared to be heard', () =>
{
    it('runs the microphone through its volume and the gate into one mono voice that says it is speech', async () =>
    {
        const one = room();
        const input = await createVoiceInput(one.context as unknown as AudioContext, raw, OPTIONS);
        const [source, gain, out] = ['source', 'gain', 'out'].map((kind) => one.nodes.find((node) => node.kind === kind)!);

        expect(one.modules).toEqual(['blob:gate']);
        expect(source.stream).toBe(raw);
        expect(source.into).toEqual([gain]);
        expect(gain.into).toEqual([one.gates[0]]);
        expect(one.gates[0].into).toEqual([out]);
        expect([out.channelCount, out.channelCountMode]).toEqual([1, 'explicit']);
        expect(one.track.contentHint).toBe('speech');
        expect(input.stream).toBe(out.stream);
    });

    it('runs the microphone through strong suppression before its volume, and lets the suppressor go with it', async () =>
    {
        const one = room();
        let closed = 0;
        const suppressor = { kind: 'suppressor', into: [] as unknown[], connect(next: unknown)
        {
            suppressor.into.push(next);
            return next;
        } };
        const input = await createVoiceInput(one.context as unknown as AudioContext, raw, OPTIONS, { node: suppressor as unknown as AudioNode, close: () => void (closed += 1) });
        const [source, gain] = ['source', 'gain'].map((kind) => one.nodes.find((node) => node.kind === kind)!);

        expect(source.into).toEqual([suppressor]);
        expect(suppressor.into).toEqual([gain]);

        input.close();

        expect(closed).toBe(1);
    });

    it('tells the gate how to listen and turns the volume smoothly, never past twice', async () =>
    {
        const one = room();
        const input = await createVoiceInput(one.context as unknown as AudioContext, raw, OPTIONS);

        expect(one.gates[0].told.at(-1)).toEqual({ push: false, pressed: false, linger: 200, auto: true, threshold: -50 });
        expect(one.set.at(-1)).toEqual([1.5, 4, 0.02]);

        input.set({ ...OPTIONS, volume: 9, push: true, pressed: true, auto: false, threshold: -35 });

        expect(one.gates[0].told.at(-1)).toEqual({ push: true, pressed: true, linger: 200, auto: false, threshold: -35 });
        expect(one.set.at(-1)![0]).toBe(INPUT_LOUDEST);
    });

    it('passes on what the gate hears to whoever listens, until they stop', async () =>
    {
        const one = room();
        const input = await createVoiceInput(one.context as unknown as AudioContext, raw, OPTIONS);
        const heard: unknown[] = [];
        const stop = input.onReading((reading) => heard.push(reading));

        one.gates[0].port.onmessage!({ data: { level: -30, open: true, threshold: -48 } });
        stop();
        one.gates[0].port.onmessage!({ data: { level: -60, open: false, threshold: -48 } });

        expect(heard).toEqual([{ level: -30, open: true, threshold: -48 }]);
    });

    it('lets go of everything it made when it is closed', async () =>
    {
        const one = room();
        const input = await createVoiceInput(one.context as unknown as AudioContext, raw, OPTIONS);

        input.close();

        expect(one.nodes.filter((node) => node.kind !== 'out').every((node) => node.off)).toBe(true);
        expect(one.gates[0].off).toBe(true);
        expect(one.gates[0].port.closed).toBe(true);
        expect(one.gates[0].port.onmessage).toBeNull();
    });

    it('loads the gate once for a call however often the microphone changes', async () =>
    {
        const one = room();

        await createVoiceInput(one.context as unknown as AudioContext, raw, OPTIONS);
        await createVoiceInput(one.context as unknown as AudioContext, raw, OPTIONS);

        expect(one.modules).toEqual(['blob:gate']);
        expect(one.gates).toHaveLength(2);
    });
});
