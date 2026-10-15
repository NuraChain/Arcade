import { describe, it, expect, afterEach, vi } from 'vitest';

import { DENOISE_RATE, createDenoiser, setDenoiseKit, type DenoiseKit } from '../src/services/voice.denoise.ts';

afterEach(() =>
{
    setDenoiseKit(null);
    vi.unstubAllGlobals();
});

function kit()
{
    const made: { destroyed: boolean; off: boolean }[] = [];
    let loads = 0;

    const loader = async (): Promise<DenoiseKit> =>
    {
        loads += 1;

        return {
            worklet: 'blob:suppressor',
            make: () =>
            {
                const node = {
                    destroyed: false,
                    off: false,
                    destroy: () =>
                    {
                        node.destroyed = true;
                    },
                    disconnect: () =>
                    {
                        node.off = true;
                    }
                };

                made.push(node);
                return node as unknown as AudioNode & { destroy(): void };
            }
        };
    };

    return { loader, made, loads: () => loads };
}

const call = (sampleRate = DENOISE_RATE) =>
{
    const added: string[] = [];

    return { added, context: { sampleRate, audioWorklet: { addModule: async (url: string) => void added.push(url) } } as unknown as AudioContext };
};

describe('strong noise suppression', () =>
{
    it('is not offered to a call that does not run at the rate it was trained at', async () =>
    {
        const one = kit();

        setDenoiseKit(one.loader);

        expect(await createDenoiser(call(44_100).context)).toBeNull();
        expect(one.loads(), 'the suppressor was downloaded for a call that cannot use it').toBe(0);
    });

    it('is downloaded once, added to a call once, and makes a node for each microphone', async () =>
    {
        const one = kit();
        const room = call();

        setDenoiseKit(one.loader);

        const first = await createDenoiser(room.context);
        const second = await createDenoiser(room.context);

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(one.loads()).toBe(1);
        expect(room.added).toEqual(['blob:suppressor']);
        expect(one.made).toHaveLength(2);
    });

    it('answers nothing when it cannot be loaded, and tries again the next time it is asked', async () =>
    {
        const one = kit();
        let fail = true;

        setDenoiseKit(async () =>
        {
            if (fail)
            {
                throw new Error('offline');
            }

            return one.loader();
        });

        expect(await createDenoiser(call().context)).toBeNull();

        fail = false;

        expect(await createDenoiser(call().context)).not.toBeNull();
    });

    it('mixes the microphone to one channel before it, so a stereo microphone is not heard at half its level', async () =>
    {
        const made: { options: { processorOptions?: { maxChannels: number } }; channelCount: number; channelCountMode: string }[] = [];
        const fetched: string[] = [];

        vi.stubGlobal('AudioWorkletNode', class
        {
            public channelCount = 2;
            public channelCountMode = 'max';
            public options: { processorOptions?: { maxChannels: number } };

            constructor(_context: unknown, _name: string, options: { processorOptions?: { maxChannels: number } })
            {
                this.options = options;
                made.push(this);
            }
        });
        vi.stubGlobal('fetch', async (url: string) =>
        {
            fetched.push(url);
            return { arrayBuffer: async () => new ArrayBuffer(8) };
        });

        const room = call();
        const denoiser = await createDenoiser(room.context);

        expect(denoiser).not.toBeNull();
        expect(fetched, 'the model was not fetched').toHaveLength(1);
        expect(room.added).toHaveLength(1);
        expect(made).toHaveLength(1);
        expect(made[0].options.processorOptions?.maxChannels).toBe(1);
        expect([made[0].channelCount, made[0].channelCountMode]).toEqual([1, 'explicit']);
    });

    it('lets go of its node when it is closed', async () =>
    {
        const one = kit();

        setDenoiseKit(one.loader);

        const made = await createDenoiser(call().context);

        made!.close();

        expect(one.made[0]).toEqual({ destroyed: true, off: true, destroy: expect.any(Function), disconnect: expect.any(Function) });
    });
});

