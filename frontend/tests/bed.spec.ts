import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
    listeners: new Set<(context: unknown, into: unknown) => void>(),
    handles: 0,
    disposed: 0
}));

vi.mock('../src/game/sound.ts', () => ({
    createSound: () =>
    {
        engine.handles += 1;
        return { play: () => undefined, setEnabled: () => undefined, dispose: () => engine.disposed += 1 };
    },
    onBed: (listener: (context: unknown, into: unknown) => void) =>
    {
        engine.listeners.add(listener);
        return () => engine.listeners.delete(listener);
    }
}));

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { CROSS, DUCK, FADE_IN, FADE_OUT, createBed, type Bed, type BedState } from '../src/game/bed.ts';

interface Step
{
    kind: 'cancel' | 'set' | 'ramp' | 'curve';
    at: number;
    value?: number;
    values?: Float32Array;
    length?: number;
}

class FakeParam
{
    public value = 0;

    public steps: Step[] = [];

    public cancelScheduledValues(at: number)
    {
        this.steps.push({ kind: 'cancel', at });
    }

    public setValueAtTime(value: number, at: number)
    {
        this.steps.push({ kind: 'set', value, at });
        this.value = value;
    }

    public linearRampToValueAtTime(value: number, at: number)
    {
        this.steps.push({ kind: 'ramp', value, at });
        this.value = value;
    }

    public setValueCurveAtTime(values: Float32Array, at: number, length: number)
    {
        this.steps.push({ kind: 'curve', at, values, length });
        this.value = values.at(-1) ?? this.value;
    }

    /** The last ramp asked for, which is where the param is going and by when. */
    public heading()
    {
        return this.steps.filter((step) => step.kind === 'ramp').at(-1) ?? null;
    }
}

class FakeGain
{
    public gain = new FakeParam();

    public to: unknown = null;

    public connect(to: unknown)
    {
        this.to = to;
    }

    public disconnect()
    {
        this.to = null;
    }
}

class FakeContext
{
    public currentTime = 10;

    public state = 'running';

    public gains: FakeGain[] = [];

    public sources = new Map<FakeAudio, FakeGain>();

    public createGain()
    {
        const gain = new FakeGain();

        this.gains.push(gain);
        return gain;
    }

    public createMediaElementSource(element: FakeAudio)
    {
        return { connect: (to: FakeGain) => this.sources.set(element, to) };
    }
}

class FakeAudio
{
    public static made: FakeAudio[] = [];

    public static refuse = false;

    public preload = '';

    public src = '';

    public currentTime = 0;

    public duration = 60;

    public paused = true;

    public plays = 0;

    constructor()
    {
        FakeAudio.made.push(this);
    }

    public play()
    {
        if (FakeAudio.refuse)
        {
            return Promise.reject(new Error('NotAllowedError'));
        }

        this.paused = false;
        this.plays += 1;
        return Promise.resolve();
    }

    public pause()
    {
        this.paused = true;
    }

    public removeAttribute(name: string)
    {
        if (name === 'src')
        {
            this.src = '';
        }
    }

    public addEventListener()
    {
        return undefined;
    }

    public removeEventListener()
    {
        return undefined;
    }
}

const RAIN = '/assets/rain-abc.bed';

let clock: ManualClock;
let bed: Bed;
let states: BedState[];
let revoked: string[];
let fetched: string[];

const flush = async () =>
{
    for (let turn = 0; turn < 8; turn += 1)
    {
        await Promise.resolve();
    }
};

const elapse = async (ms: number) =>
{
    clock.advance(ms);
    await flush();
};

const want = (over: Partial<{ volume: number; ducked: boolean; hidden: boolean; url: string }> = {}) => ({ url: RAIN, volume: 0.4, ducked: false, hidden: false, ...over });

const bus = new FakeGain();

/** The page's context starts running, as the engine says it does, and the bed is wired into it. */
const run = async (context = new FakeContext()) =>
{
    for (const listener of engine.listeners)
    {
        listener(context, bus);
    }

    await flush();
    return context;
};

const levelOf = (context: FakeContext) => context.gains.find((gain) => gain.to === bus)!;

const copyGain = (context: FakeContext, element: FakeAudio) => context.sources.get(element)!;

beforeEach(() =>
{
    clock = manualClock(0);
    setRuntime({ clock });
    states = [];
    revoked = [];
    fetched = [];
    FakeAudio.made = [];
    FakeAudio.refuse = false;
    engine.listeners.clear();
    engine.handles = 0;
    engine.disposed = 0;
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('fetch', (address: string) =>
    {
        fetched.push(address);
        return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['bed'])) });
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rain');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((address: string) => revoked.push(address));
    bed = createBed((state) => states.push(state));
});

afterEach(() =>
{
    bed.dispose();
    resetRuntime();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the bed behind a table', () =>
{
    it('waits, fetching nothing, until the page may play sound, and holds one sound handle meanwhile', async () =>
    {
        bed.set(want());
        await flush();

        expect(states).toEqual(['waiting']);
        expect(fetched, 'the bed was fetched before anything could play it').toEqual([]);
        expect(engine.handles).toBe(1);
        expect(FakeAudio.made).toEqual([]);
    });

    it('plays the first of two copies once the context runs, coming in over two seconds at the reader\'s volume', async () =>
    {
        bed.set(want());
        const context = await run();
        const [first, second] = FakeAudio.made;
        const level = levelOf(context);

        expect(fetched).toEqual([RAIN]);
        expect(FakeAudio.made).toHaveLength(2);
        expect(first.src).toBe('blob:rain');
        expect(second.src).toBe('blob:rain');
        expect(first.paused).toBe(false);
        expect(second.paused, 'both copies started at once').toBe(true);
        expect(copyGain(context, first).gain.value).toBe(1);
        expect(copyGain(context, second).gain.value).toBe(0);
        expect(level.gain.heading()).toEqual({ kind: 'ramp', value: 0.4, at: 10 + FADE_IN });
        expect(states.at(-1)).toBe('playing');
    });

    it('hands the loop to the other copy four seconds before the end, one rising as the other falls, and lets the first go once it has', async () =>
    {
        bed.set(want());
        const context = await run();
        const [first, second] = FakeAudio.made;

        await elapse((60 - CROSS) * 1000 - 1);

        expect(second.paused, 'the hand-over came early').toBe(true);

        await elapse(1);

        const falling = copyGain(context, first).gain.steps.find((step) => step.kind === 'curve')!;
        const rising = copyGain(context, second).gain.steps.find((step) => step.kind === 'curve')!;

        expect(second.paused).toBe(false);
        expect(second.currentTime).toBe(0);
        expect(falling.length).toBe(CROSS);
        expect(rising.length).toBe(CROSS);
        expect(falling.values![0]).toBe(1);
        expect(falling.values!.at(-1)).toBeCloseTo(0, 6);
        expect(rising.values![0]).toBe(0);
        expect(rising.values!.at(-1)).toBeCloseTo(1, 6);
        expect(rising.values![16] ** 2 + falling.values![16] ** 2, 'the two halves of the hand-over do not keep the power').toBeCloseTo(1, 6);
        expect(first.paused).toBe(false);

        second.currentTime = CROSS;
        await elapse(CROSS * 1000);

        expect(first.paused).toBe(true);

        await elapse((60 - CROSS - CROSS) * 1000);

        expect(first.paused, 'the loop was handed over only once').toBe(false);
        expect(first.currentTime).toBe(0);
    });

    it('sits 9 dB under a call at the table and comes back up after it, and follows a new volume', async () =>
    {
        bed.set(want());
        const context = await run();
        const level = levelOf(context);

        bed.set(want({ ducked: true }));

        expect(level.gain.heading()?.value).toBeCloseTo(0.4 * DUCK, 6);
        expect(DUCK).toBeCloseTo(10 ** (-9 / 20), 6);
        expect(states.at(-1)).toBe('ducked');

        bed.set(want());

        expect(level.gain.heading()?.value).toBe(0.4);
        expect(states.at(-1)).toBe('playing');

        bed.set(want({ volume: 0.8 }));

        expect(level.gain.heading()?.value).toBe(0.8);
    });

    it('stops both copies while the tab is hidden, hands nothing over meanwhile, and comes back in where it stopped', async () =>
    {
        bed.set(want());
        const context = await run();
        const [first, second] = FakeAudio.made;
        const level = levelOf(context);

        first.currentTime = 20;
        bed.set(want({ hidden: true }));

        expect(first.paused).toBe(true);
        expect(second.paused).toBe(true);
        expect(level.gain.value).toBe(0);
        expect(states.at(-1)).toBe('paused');

        await elapse(120_000);

        expect(second.plays, 'a hidden bed handed its loop over').toBe(0);

        context.currentTime = 50;
        bed.set(want());
        await flush();

        expect(first.paused).toBe(false);
        expect(first.currentTime, 'it started again from the beginning').toBe(20);
        expect(level.gain.heading()).toEqual({ kind: 'ramp', value: 0.4, at: 50 + FADE_IN });
        expect(states.at(-1)).toBe('playing');
    });

    it('fades out over a second when the page goes, and only then lets the copies, the file and the sound handle go', async () =>
    {
        bed.set(want());
        const context = await run();
        const [first] = FakeAudio.made;
        const level = levelOf(context);

        bed.set(null);

        expect(level.gain.heading()).toEqual({ kind: 'ramp', value: 0, at: 10 + FADE_OUT });
        expect(states.at(-1)).toBe('off');
        expect(first.paused, 'the bed stopped without fading').toBe(false);
        expect(revoked).toEqual([]);

        await elapse(FADE_OUT * 1000);

        expect(first.paused).toBe(true);
        expect(first.src).toBe('');
        expect(revoked).toEqual(['blob:rain']);
        expect(engine.disposed).toBe(1);
        expect(engine.listeners.size).toBe(0);
    });

    it('comes back up without starting again when it is wanted while it fades out', async () =>
    {
        bed.set(want());
        const context = await run();
        const [first] = FakeAudio.made;
        const level = levelOf(context);

        bed.set(null);
        await elapse(400);
        bed.set(want());
        await elapse(FADE_OUT * 1000);

        expect(revoked).toEqual([]);
        expect(engine.disposed).toBe(0);
        expect(first.plays).toBe(1);
        expect(level.gain.heading()?.value).toBe(0.4);
        expect(states.at(-1)).toBe('playing');

        await elapse((60 - CROSS) * 1000);

        expect(FakeAudio.made[1].paused, 'the loop stopped being handed over').toBe(false);
    });

    it('waits for the reader\'s next press when the browser will not let it play, and plays inside that press', async () =>
    {
        FakeAudio.refuse = true;
        bed.set(want());
        await run();

        expect(states.at(-1)).toBe('waiting');

        FakeAudio.refuse = false;
        window.dispatchEvent(new Event('pointerup'));
        await flush();

        expect(FakeAudio.made[0].paused).toBe(false);
        expect(states.at(-1)).toBe('playing');
    });

    it('plays nothing, and says so, when the bed cannot be fetched', async () =>
    {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
        bed.set(want());
        await run();

        expect(states.at(-1)).toBe('off');
        expect(FakeAudio.made).toEqual([]);

        bed.set(want({ volume: 0.6 }));

        expect(states.at(-1), 'it said it was waiting for a bed that will not come').toBe('off');
    });

    it('makes new copies for a context that took the place of a stalled one, from where the bed had got to', async () =>
    {
        bed.set(want());
        await run();
        const [first, second] = FakeAudio.made;

        first.currentTime = 30;

        const fresh = await run(new FakeContext());
        const [third, fourth] = FakeAudio.made.slice(2);

        expect(FakeAudio.made).toHaveLength(4);
        expect(first.paused).toBe(true);
        expect(second.paused).toBe(true);
        expect(third.currentTime).toBe(30);
        expect(third.paused).toBe(false);
        expect(fourth.paused).toBe(true);
        expect(levelOf(fresh).gain.heading()?.value).toBe(0.4);
    });
});
