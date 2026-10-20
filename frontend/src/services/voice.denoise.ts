export interface Denoiser
{
    readonly node: AudioNode;
    close(): void;
}

export const DENOISE_RATE = 48_000;

export interface DenoiseKit
{
    make(context: AudioContext): AudioNode & { destroy(): void };
    worklet: string;
}

const fetchKit = async (): Promise<DenoiseKit> =>
{
    const [kit, worklet, plain, simd] = await Promise.all([
        import('@sapphi-red/web-noise-suppressor'),
        import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
        import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
        import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url')
    ]);
    const wasmBinary = await kit.loadRnnoise({ url: plain.default, simdUrl: simd.default });

    return {
        make: (context) =>
        {
            const node = new kit.RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });

            node.channelCount = 1;
            node.channelCountMode = 'explicit';

            return node;
        },
        worklet: worklet.default
    };
};

let load: () => Promise<DenoiseKit> = fetchKit;

export function setDenoiseKit(next: (() => Promise<DenoiseKit>) | null)
{
    load = next ?? fetchKit;
    loading = null;
}

let loading: Promise<DenoiseKit> | null = null;

const added = new WeakMap<BaseAudioContext, Promise<void>>();

export const canDenoise = (context: AudioContext | null) => context !== null && context.sampleRate === DENOISE_RATE;

export async function createDenoiser(context: AudioContext): Promise<Denoiser | null>
{
    if (!canDenoise(context))
    {
        return null;
    }

    try
    {
        loading ??= load();

        const kit = await loading;
        let ready = added.get(context);

        if (ready === undefined)
        {
            ready = context.audioWorklet.addModule(kit.worklet);
            added.set(context, ready);
        }

        await ready;

        const node = kit.make(context);

        return {
            node,

            close()
            {
                node.destroy();
                node.disconnect();
            }
        };
    }
    catch
    {
        loading = null;
        added.delete(context);
        return null;
    }
}
