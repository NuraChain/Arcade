import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import VoiceInputSettings from '../src/components/voice/voice-input-settings.component.azeroth';
import VoiceMeter, { METER_FLOOR } from '../src/components/voice/voice-meter.component.azeroth';
import VoiceOutputSettings from '../src/components/voice/voice-output-settings.component.azeroth';
import type { GateReading } from '../src/services/voice.gate.ts';
import type { VoiceCall } from '../src/services/voice.rtc.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';

type Rendered = HTMLElement;

const settle = async () =>
{
    for (let i = 0; i < 10; i += 1)
    {
        await Promise.resolve();
    }
};

const processed = { processed: true, getAudioTracks: () => [{ contentHint: '' }], getTracks: () => [] } as unknown as MediaStream;

interface Gated
{
    told: Record<string, unknown>[];
    port: { onmessage: ((event: { data: unknown }) => void) | null };
}

let gates: Gated[] = [];
let asked: MediaStreamConstraints[] = [];
let stopped = 0;

const DEVICES = [
    { kind: 'audioinput', deviceId: 'usb-1', label: 'USB Microphone' },
    { kind: 'audioinput', deviceId: 'mic-2', label: '' },
    { kind: 'audiooutput', deviceId: 'desk-1', label: 'Desk Speakers' }
];

const sound = (options: { rate?: number; refuse?: string; devices?: typeof DEVICES } = {}) =>
{
    gates = [];
    asked = [];
    stopped = 0;

    vi.stubGlobal('AudioWorkletNode', class
    {
        public told: Record<string, unknown>[] = [];
        public port = {
            onmessage: null as ((event: { data: unknown }) => void) | null,
            postMessage: (message: Record<string, unknown>) => this.told.push(message),
            close: () => undefined
        };

        constructor()
        {
            gates.push(this);
        }

        public connect(next: unknown)
        {
            return next;
        }

        public disconnect()
        {
            return undefined;
        }
    });
    vi.stubGlobal('AudioContext', class
    {
        public state = 'suspended';
        public sampleRate = options.rate ?? 48_000;
        public currentTime = 0;
        public onstatechange: (() => void) | null = null;
        public audioWorklet = { addModule: async () => undefined };

        public createMediaStreamSource()
        {
            return { connect: (next: unknown) => next, disconnect: () => undefined };
        }

        public createGain()
        {
            return { gain: { setTargetAtTime: () => undefined }, connect: (next: unknown) => next, disconnect: () => undefined };
        }

        public createMediaStreamDestination()
        {
            return { stream: processed, channelCount: 2, channelCountMode: 'max', connect: (next: unknown) => next, disconnect: () => undefined };
        }

        public createAnalyser()
        {
            return { connect: (next: unknown) => next, disconnect: () => undefined, getFloatTimeDomainData: () => undefined, fftSize: 0 };
        }

        public async resume()
        {
            this.state = 'running';
        }

        public async close()
        {
            this.state = 'closed';
        }
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gate');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    const sources = new WeakMap<HTMLMediaElement, unknown>();

    vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(function (this: HTMLMediaElement, value: unknown)
    {
        sources.set(this, value);
    });
    vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'get').mockImplementation(function (this: HTMLMediaElement)
    {
        return (sources.get(this) ?? null) as MediaStream | null;
    });
    setVoiceMedia(() => ({
        getUserMedia: async (constraints: MediaStreamConstraints) =>
        {
            asked.push(constraints);

            if (options.refuse !== undefined)
            {
                throw Object.assign(new Error('no'), { name: options.refuse });
            }

            return { getTracks: () => [{ stop: () => (stopped += 1) }], getAudioTracks: () => [] } as unknown as MediaStream;
        },
        enumerateDevices: async () => options.devices ?? DEVICES
    }) as unknown as MediaDevices);
};

const quietCall: VoiceCall = {
    setMic: async () => undefined,
    setMuted: () => undefined,
    sync: () => undefined,
    receive: async () => undefined,
    heard: () => undefined,
    setVolume: () => undefined,
    setSink: () => undefined,
    setQuality: () => undefined,
    facts: async () => ({}),
    close: () => undefined
};

const played = () => [...document.body.querySelectorAll('audio')];

const switchNamed = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((one) => one.textContent?.includes(name))!;

const segmentIn = (container: HTMLElement, group: string, name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${ group }"] button`)].find((one) => one.textContent?.trim() === name)!;

const testButton = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => /Test the microphone|Stop the test/.test(one.textContent ?? ''));

const sliderNamed = (container: HTMLElement, name: string) =>
    container.querySelector<HTMLElement>(`[role="slider"][aria-label="${ name }"]`)!;

const key = (target: EventTarget, code: string, keyName = code) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, code, bubbles: true, cancelable: true }));

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    useSettings().reset();
    useVoice().reset();
    setVoiceCall(() => quietCall);
});

afterEach(() =>
{
    cleanup();
    useVoice().reset();
    useSettings().reset();
    setVoiceMedia(null);
    setVoiceCall(null);

    for (const one of played())
    {
        one.remove();
    }

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the meter of a microphone', () =>
{
    const meter = (first: GateReading | null) =>
    {
        const [reading, setReading] = createSignal<GateReading | null>(first);
        const { container } = renderTest(() => VoiceMeter({ get reading()
        {
            return reading();
        }, label: 'How loud', idle: 'Nothing yet' }) as Rendered);

        return {
            container,
            read: setReading,
            bar: () => container.querySelector<HTMLElement>('[role="meter"]')!,
            fill: () => container.querySelector<HTMLElement>('.voice-meter-fill')!,
            mark: () => container.querySelector<HTMLElement>('.voice-meter-bar')
        };
    };

    it('says what would show it, and draws nothing, until there is a reading', async () =>
    {
        const one = meter(null);

        await settle();

        expect(one.bar().getAttribute('aria-valuenow')).toBe(String(METER_FLOOR));
        expect(one.fill().getAttribute('style')).toContain('scaleX(0)');
        expect(one.mark(), 'a bar was drawn for a gate that has not said where it stands').toBeNull();
        expect(one.container.textContent).toContain('Nothing yet');
    });

    it('draws the level and the bar, and says whether the voice is being sent', async () =>
    {
        const one = meter({ level: -20, open: true, threshold: -50 });

        await settle();

        expect(one.bar().getAttribute('aria-valuenow')).toBe('-20');
        expect(one.bar().getAttribute('aria-valuetext')).toBe('-20 dB, sending');
        expect(one.bar().getAttribute('data-open')).toBe('true');
        expect(one.fill().getAttribute('style')).toContain('scaleX(0.75)');
        expect(one.fill().className).toContain('bg-live');
        expect(one.mark()!.getAttribute('style')).toContain('inset-inline-start: 37.5%');
        expect(one.container.textContent).not.toContain('Nothing yet');

        one.read({ level: -61, open: false, threshold: -50 });
        await settle();

        expect(one.bar().getAttribute('aria-valuetext')).toBe('-61 dB, quiet');
        expect(one.bar().hasAttribute('data-open')).toBe(false);
        expect(one.fill().className).toContain('bg-faint');
    });

    it('holds a level to its two ends', async () =>
    {
        const one = meter({ level: 6, open: true, threshold: -50 });

        await settle();

        expect(one.bar().getAttribute('aria-valuenow')).toBe('0');
        expect(one.fill().getAttribute('style')).toContain('scaleX(1)');

        one.read({ level: -140, open: false, threshold: -50 });
        await settle();

        expect(one.bar().getAttribute('aria-valuenow')).toBe(String(METER_FLOOR));
        expect(one.fill().getAttribute('style')).toContain('scaleX(0)');
    });

    it('moves the same nodes at twenty readings a second', async () =>
    {
        const one = meter({ level: -40, open: true, threshold: -50 });

        await settle();

        const kept = [one.bar(), one.fill(), one.mark()!];

        for (let level = -39; level < -20; level += 1)
        {
            one.read({ level, open: level > -30, threshold: -48 });
            await settle();
        }

        expect(kept.every((node) => node.isConnected), 'a reading drew the meter again').toBe(true);
        expect(one.bar()).toBe(kept[0]);
    });

    it('fills from the side a Persian page starts, and says the level in Persian', async () =>
    {
        useLocale().setLocale('fa');

        const one = meter({ level: -20, open: true, threshold: -50 });

        await settle();

        expect(one.fill().className).toContain('origin-right');
        expect(one.bar().getAttribute('aria-valuetext')).toContain('۲۰');
        expect(one.bar().getAttribute('aria-valuetext')).toContain('داره می‌فرسته');
        expect(one.bar().getAttribute('aria-valuetext')).toContain('دسی‌بل');

        useLocale().setLocale('en');
        await settle();

        expect(one.fill().className).toContain('origin-left');
    });
});

describe('the settings of a microphone', () =>
{
    const panel = async () =>
    {
        const { container } = renderTest(() => VoiceInputSettings() as Rendered);

        await settle();
        return container;
    };

    it('lists the microphones the browser named, the default first, and says why one has no name', async () =>
    {
        sound();
        await useVoice().survey();

        const container = await panel();
        const chooser = container.querySelector<HTMLElement>('[aria-haspopup="listbox"]')!;

        expect(chooser.textContent).toContain(useLocale().t('voice.deviceDefault'));
        expect(container.textContent).toContain(useLocale().t('voice.devicesHint'));

        useSettings().update({ voiceMic: 'usb-1' });
        await settle();

        expect(chooser.textContent).toContain('USB Microphone');
    });

    it('turns the microphone up to twice', async () =>
    {
        const container = await panel();
        const slider = sliderNamed(container, 'Input volume');

        expect(slider.getAttribute('aria-valuemax')).toBe('2');
        expect(slider.getAttribute('aria-valuetext')).toBe('100%');

        key(slider, 'End', 'End');
        await settle();

        expect(useSettings().settings().voiceInput).toBe(2);
        expect(slider.getAttribute('aria-valuetext')).toBe('200%');
    });

    it('offers voice activity or the talk key, with the controls each one needs', async () =>
    {
        const container = await panel();

        expect(segmentIn(container, 'Input mode', 'Voice activity').getAttribute('aria-pressed')).toBe('true');
        expect(switchNamed(container, 'Set the sensitivity automatically')).toBeDefined();
        expect(sliderNamed(container, 'Release delay')).toBeNull();

        fire(segmentIn(container, 'Input mode', 'Push to talk'), 'click');
        await settle();

        expect(useSettings().settings().voicePushToTalk).toBe(true);
        expect(switchNamed(container, 'Set the sensitivity automatically')).toBeUndefined();
        expect(sliderNamed(container, 'Input sensitivity')).toBeNull();
        expect(sliderNamed(container, 'Release delay').getAttribute('aria-valuetext')).toBe('200 ms');
        expect(container.querySelector('kbd')?.textContent).toBe('V');

        fire(segmentIn(container, 'Input mode', 'Voice activity'), 'click');
        await settle();

        expect(useSettings().settings().voicePushToTalk).toBe(false);
        expect(switchNamed(container, 'Set the sensitivity automatically')).toBeDefined();
    });

    it('draws the bar the gate chose on the meter while it is automatic, and lets the reader set it once it is not', async () =>
    {
        sound();
        useSettings().update({ voiceThreshold: -58 });

        const container = await panel();

        fire(testButton(container)!, 'click');
        await settle();
        gates[0].port.onmessage!({ data: { level: -30, open: true, threshold: -47 } });
        await settle();

        expect(sliderNamed(container, 'Input sensitivity'), 'a bar the reader cannot move was offered to be moved').toBeNull();
        expect(container.querySelector<HTMLElement>('.voice-meter-bar')!.getAttribute('style')).toContain('inset-inline-start: 41.3%');

        fire(switchNamed(container, 'Set the sensitivity automatically'), 'click');
        await settle();

        const slider = sliderNamed(container, 'Input sensitivity');

        expect(useSettings().settings().voiceAuto).toBe(false);
        expect(slider.getAttribute('aria-disabled')).toBe('false');
        expect(slider.getAttribute('aria-valuenow')).toBe('-58');
        expect(gates[0].told.at(-1), 'the running test was not told the bar is the reader’s now').toMatchObject({ auto: false, threshold: -58 });

        key(slider, 'ArrowRight', 'ArrowRight');
        await settle();

        expect(useSettings().settings().voiceThreshold).toBe(-57);
        expect(gates[0].told.at(-1)).toMatchObject({ threshold: -57 });
        expect(slider.getAttribute('aria-valuenow')).toBe('-57');
        expect(slider.getAttribute('aria-valuetext')).toBe('-57 dB');
        expect(slider.parentElement?.querySelector('.tally')?.textContent, 'the unit was drawn inside the left-to-right number').toBe('-57');

        fire(switchNamed(container, 'Set the sensitivity automatically'), 'click');
        await settle();

        expect(sliderNamed(container, 'Input sensitivity')).toBeNull();
        expect(gates[0].told.at(-1)).toMatchObject({ auto: true });
    });

    it('records a talk key, and keeps the keys the product uses for itself', async () =>
    {
        useSettings().update({ voicePushToTalk: true });

        const container = await panel();
        const change = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => /Change|Press a key/.test(one.textContent ?? ''))!;

        fire(change(), 'click');
        await settle();

        expect(change().textContent).toContain(useLocale().t('voice.talkKeyListening'));

        key(window, 'Enter', 'Enter');

        expect(key(window, 'Tab', 'Tab'), 'Tab was kept from moving the keyboard on while a key was being recorded').toBe(true);

        await settle();

        expect(useSettings().settings().voiceTalkKey, 'a key the product keeps was taken').not.toBe('Enter');
        expect(change().textContent, 'the key the product keeps ended the listening').toContain(useLocale().t('voice.talkKeyListening'));

        key(window, 'KeyB', 'b');
        await settle();

        expect(useSettings().settings().voiceTalkKey).toBe('KeyB');
        expect(container.querySelector('kbd')?.textContent).toBe('B');
        expect(change().textContent).toContain(useLocale().t('voice.talkKeyChange'));

        fire(change(), 'click');
        key(window, 'Escape', 'Escape');
        await settle();

        expect(useSettings().settings().voiceTalkKey).toBe('KeyB');
        expect(change().textContent).toContain(useLocale().t('voice.talkKeyChange'));
    });

    it('stops listening for a key when it leaves the page', async () =>
    {
        useSettings().update({ voicePushToTalk: true });

        const container = await panel();

        fire([...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.includes(useLocale().t('voice.talkKeyChange')))!, 'click');
        await settle();
        cleanup();
        key(window, 'KeyJ', 'j');

        expect(useSettings().settings().voiceTalkKey, 'a page that was gone still took the next key').not.toBe('KeyJ');
    });

    it('chooses how much noise is taken out, says what each choice does, and says when strong cannot run here', async () =>
    {
        sound({ rate: 44_100 });

        const container = await panel();
        const strong = () => segmentIn(container, 'Noise suppression', 'Strong');

        expect(segmentIn(container, 'Noise suppression', 'Standard').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain(useLocale().t('voice.noiseHint.standard'));

        fire(strong(), 'click');
        await settle();

        expect(useSettings().settings().voiceNoise).toBe('strong');
        expect(strong().getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain(useLocale().t('voice.noiseHint.strong'));
        expect(container.textContent).not.toContain(useLocale().t('voice.noiseFallback'));

        await useVoice().startTest();
        await settle();

        expect(container.textContent, 'the reader was not told their strong suppression is the standard one').toContain(useLocale().t('voice.noiseFallback'));

        fire(segmentIn(container, 'Noise suppression', 'Off'), 'click');
        await settle();

        expect(container.textContent).toContain(useLocale().t('voice.noiseHint.off'));
        expect(asked.at(-1)!.audio, 'a running test kept the old suppression').toMatchObject({ noiseSuppression: false });
    });

    it('turns echo cancellation and automatic gain off, and a running test asks for the microphone again', async () =>
    {
        sound();

        const container = await panel();

        await useVoice().startTest();
        await settle();

        fire(switchNamed(container, 'Echo cancellation'), 'click');
        await settle();

        expect(useSettings().settings().voiceEcho).toBe(false);
        expect(switchNamed(container, 'Echo cancellation').getAttribute('aria-checked')).toBe('false');
        expect(asked.at(-1)!.audio).toMatchObject({ echoCancellation: false });

        fire(switchNamed(container, 'Automatic gain control'), 'click');
        await settle();

        expect(useSettings().settings().voiceAgc).toBe(false);
        expect(asked.at(-1)!.audio).toMatchObject({ autoGainControl: false });
        expect(played(), 'two tests played at once').toHaveLength(1);
    });

    it('tests the microphone, moves the meter, and stops the test when the page goes', async () =>
    {
        sound();

        const container = await panel();
        const button = () => testButton(container)!;
        const first = button();

        expect(container.textContent).toContain(useLocale().t('voice.levelIdle'));

        fire(first, 'click');
        await settle();

        expect(useVoice().testing()).toBe(true);
        expect(button().textContent).toContain('Stop the test');
        expect(button(), 'the button was drawn again').toBe(first);
        expect(played()).toHaveLength(1);

        gates[0].port.onmessage!({ data: { level: -18, open: true, threshold: -50 } });
        await settle();

        expect(container.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('-18');
        expect(container.textContent).not.toContain(useLocale().t('voice.levelIdle'));

        cleanup();
        await settle();

        expect(useVoice().testing()).toBe(false);
        expect(played(), 'the test went on playing after the page had gone').toHaveLength(0);
        expect(stopped).toBeGreaterThan(0);
    });

    it('stops the test when its button is pressed again', async () =>
    {
        sound();

        const container = await panel();
        const button = () => testButton(container)!;

        fire(button(), 'click');
        await settle();
        fire(button(), 'click');
        await settle();

        expect(useVoice().testing()).toBe(false);
        expect(button().textContent).toContain('Test the microphone');
        expect(played()).toHaveLength(0);
    });

    it('says why a test could not start, in the reader’s language', async () =>
    {
        sound({ refuse: 'NotAllowedError' });

        const container = await panel();

        fire(testButton(container)!, 'click');
        await settle();

        const said = () => container.querySelector('[role="alert"]')?.textContent ?? '';

        expect(said()).toBe(useLocale().t('voice.testFault.denied'));

        useLocale().setLocale('fa');
        await settle();

        expect(said()).toBe(useLocale().t('voice.testFault.denied'));
        expect(said()).toContain('میکروفون');
    });

    it('offers no test in a call, and says the meter is the call’s', async () =>
    {
        sound();

        const container = await panel();

        void useVoice().join('table-1');
        await settle();

        expect(container.textContent).toContain(useLocale().t('voice.testInCall'));
        expect(testButton(container)).toBeUndefined();

        useVoice().leave();
        await settle();

        expect(testButton(container)).toBeDefined();
    });

    it('keeps every control while the meter moves', async () =>
    {
        sound();

        const container = await panel();

        await useVoice().startTest();
        await settle();
        gates[0].port.onmessage!({ data: { level: -60, open: false, threshold: -45 } });
        await settle();

        const kept = [...container.querySelectorAll('*')].filter((node) => !node.closest('[role="meter"]'));

        for (let level = -50; level < -20; level += 3)
        {
            gates[0].port.onmessage!({ data: { level, open: level > -40, threshold: -46 + (level % 2) } });
            await settle();
        }

        const left = kept.filter((node) => !node.isConnected);

        expect(left.map((node) => `${ node.tagName } ${ node.className }`), 'a reading drew a control again').toEqual([]);
    });
});

describe('the settings of what is heard', () =>
{
    const panel = async () =>
    {
        const { container } = renderTest(() => VoiceOutputSettings() as Rendered);

        await settle();
        return container;
    };

    it('picks the speaker where the browser can, with the default first', async () =>
    {
        sound();
        await useVoice().survey();

        const container = await panel();
        const chooser = container.querySelector<HTMLElement>('[aria-haspopup="listbox"]');

        expect(chooser?.textContent).toContain(useLocale().t('voice.deviceDefault'));

        useVoice().useSpeaker('desk-1');
        await settle();

        expect(chooser?.textContent).toContain('Desk Speakers');
        expect(useSettings().settings().voiceSpeaker).toBe('desk-1');
    });

    it('offers no speaker where the browser cannot choose one, or has none to choose', async () =>
    {
        sound({ devices: DEVICES.filter((one) => one.kind === 'audioinput') });
        await useVoice().survey();

        expect((await panel()).querySelector('[aria-haspopup="listbox"]')).toBeNull();

        cleanup();
        sound();
        await useVoice().survey();

        const kept = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'setSinkId')!;

        Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');

        try
        {
            expect((await panel()).querySelector('[aria-haspopup="listbox"]')).toBeNull();
        }
        finally
        {
            Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', kept);
        }
    });

    it('turns everybody up to twice as loud', async () =>
    {
        const applied = vi.spyOn(useVoice(), 'applyVolume');
        const container = await panel();
        const slider = sliderNamed(container, useLocale().t('voice.volume'));

        expect(slider.getAttribute('aria-valuemax')).toBe('2');

        key(slider, 'End', 'End');
        await settle();

        expect(useSettings().settings().voiceVolume).toBe(2);
        expect(slider.getAttribute('aria-valuetext')).toBe('200%');
        expect(applied).toHaveBeenCalled();
    });

    it('chooses the quality, and says how fast the voice is sent', async () =>
    {
        const tuned = vi.spyOn(useVoice(), 'tune');
        const container = await panel();
        const quality = useLocale().t('voice.quality');

        expect(segmentIn(container, quality, 'High').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('64 kbps');

        fire(segmentIn(container, quality, 'Best'), 'click');
        await settle();

        expect(useSettings().settings().voiceQuality).toBe('best');
        expect(segmentIn(container, quality, 'Best').getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('96 kbps');
        expect(tuned).toHaveBeenCalled();

        useLocale().setLocale('fa');
        await settle();

        expect(container.textContent).toContain('۹۶');
    });
});
