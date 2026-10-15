import type { Denoiser } from './voice.denoise.ts';
import { Gate, type GateReading } from './voice.gate.ts';

export interface InputOptions
{
    volume: number;
    push: boolean;
    pressed: boolean;
    linger: number;
    auto: boolean;
    threshold: number;
}

export interface VoiceInput
{
    readonly stream: MediaStream;
    set(options: InputOptions): void;
    onReading(listener: (reading: GateReading) => void): () => void;
    close(): void;
}

export const INPUT_LOUDEST = 2;

export const READ_EVERY = 16;

const GATE = 'nura-voice-gate';

const GATE_SOURCE = `
const Kept = (${ Gate.toString() });

class Gated extends AudioWorkletProcessor
{
    constructor()
    {
        super();
        this.gate = new Kept(sampleRate);
        this.count = 0;
        this.port.onmessage = (event) =>
        {
            const options = event.data;

            this.gate.set(options.push, options.pressed, options.linger, options.auto, options.threshold);
        };
    }

    process(inputs, outputs)
    {
        const input = inputs[0] && inputs[0][0];
        const output = outputs[0] && outputs[0][0];

        if (input !== undefined && output !== undefined)
        {
            this.gate.process(input, output);
            this.count += 1;

            if (this.count % ${ READ_EVERY } === 0)
            {
                this.port.postMessage(this.gate.reading());
            }
        }

        return true;
    }
}

registerProcessor('${ GATE }', Gated);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

const gated = (context: AudioContext) =>
{
    let found = loaded.get(context);

    if (found === undefined)
    {
        const url = URL.createObjectURL(new Blob([GATE_SOURCE], { type: 'text/javascript' }));

        found = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
        loaded.set(context, found);
    }

    return found;
};

export async function createVoiceInput(context: AudioContext, raw: MediaStream, options: InputOptions, denoiser: Denoiser | null = null): Promise<VoiceInput>
{
    await gated(context);

    const source = context.createMediaStreamSource(raw);
    const gain = context.createGain();
    const gate = new AudioWorkletNode(context, GATE, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const out = context.createMediaStreamDestination();
    const listeners = new Set<(reading: GateReading) => void>();

    out.channelCount = 1;
    out.channelCountMode = 'explicit';
    if (denoiser === null)
    {
        source.connect(gain);
    }
    else
    {
        source.connect(denoiser.node);
        denoiser.node.connect(gain);
    }

    gain.connect(gate);
    gate.connect(out);

    for (const track of out.stream.getAudioTracks())
    {
        track.contentHint = 'speech';
    }

    gate.port.onmessage = (event: MessageEvent<GateReading>) =>
    {
        for (const listener of listeners)
        {
            listener(event.data);
        }
    };

    const set = (next: InputOptions) =>
    {
        gain.gain.setTargetAtTime(Math.min(Math.max(next.volume, 0), INPUT_LOUDEST), context.currentTime, 0.02);
        gate.port.postMessage({ push: next.push, pressed: next.pressed, linger: next.linger, auto: next.auto, threshold: next.threshold });
    };

    set(options);

    return {
        stream: out.stream,
        set,

        onReading(listener)
        {
            listeners.add(listener);

            return () =>
            {
                listeners.delete(listener);
            };
        },

        close()
        {
            listeners.clear();
            gate.port.onmessage = null;
            gate.port.close();
            source.disconnect();
            denoiser?.close();
            gain.disconnect();
            gate.disconnect();
        }
    };
}
