import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import VoiceManager from '../src/components/voice/voice-manager.component.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { LineFacts, VoiceCall, VoiceCallDeps } from '../src/services/voice.rtc.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { LINES_MS, LOUDEST, setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

const TABLE = 'table-1';

const DIRECT: LineFacts = { path: 'direct', trip: 24, jitter: 3, buffer: 40, lost: 0.012, kbps: 62 };

const CARRIED: LineFacts = { path: 'carried', trip: 120, jitter: 18, buffer: 80, lost: 0, kbps: 30 };

let clock: ManualClock;
let lines: Record<string, LineFacts> = {};
let asked = 0;
let waiting = false;
let stop: () => void = () => undefined;

const settle = async () =>
{
    for (let index = 0; index < 10; index += 1)
    {
        await Promise.resolve();
    }
};

const later = async (ms: number) =>
{
    clock.advance(ms);
    await settle();
};

const track = { stop: () => undefined } as unknown as MediaStreamTrack;

const fakeCall = (deps: VoiceCallDeps): VoiceCall => ({
    setMic: async () => undefined,
    setMuted: () => undefined,
    sync: (_mine, peers) =>
    {
        for (const peer of peers)
        {
            deps.onLink(peer.who, peer.who === 'sara.k' && waiting ? 'connecting' : 'connected');
        }
    },
    receive: async () => undefined,
    heard: () => undefined,
    setVolume: () => undefined,
    setSink: () => undefined,
    setQuality: () => undefined,
    facts: async () =>
    {
        asked += 1;

        return { ...lines };
    },
    close: () => undefined
});

const room = async (peers = [
    { who: 'alex', muted: false, talk: true, join: 'j1', opus: false },
    { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: false },
    { who: 'mina', muted: true, talk: true, join: 'j3', opus: false }
]) =>
{
    socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers });
    await settle();
};

let closed = 0;

const sheet = async () =>
{
    const { container } = renderTest(() => VoiceManager({ table: TABLE, overlayId: 'voice-manager', close: () => (closed += 1) }) as Rendered);

    await settle();
    return container;
};

const buttonNamed = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === name || one.getAttribute('aria-label') === name);

const rowOf = (container: HTMLElement, who: string) => container.querySelector<HTMLElement>(`li.voice-peer[data-who="${ who }"]`);

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(900_000);
    setRuntime({ clock, seed: 9 });
    lines = {};
    asked = 0;
    waiting = false;
    setVoiceCall(fakeCall);
    setVoiceMedia(() => ({ getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) }) as unknown as MediaDevices);
    useLocale().setLocale('en');
    useSettings().reset();
    useRealtime().reset();
    socket.reset();
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex', bio: '', hue: 210, isMinor: false });
    useVoice().reset();
    useRealtime().start();
    stop = useVoice().start();
    socket.accept();
});

afterEach(() =>
{
    cleanup();
    stop();
    useVoice().reset();
    useRealtime().reset();
    setVoiceCall(null);
    setVoiceMedia(null);
    resetRuntime();
});

describe('the voice manager at a table', () =>
{
    it('offers the call to somebody who is not in it, with the microphone and what they hear to set up first', async () =>
    {
        const container = await sheet();

        expect(container.querySelector('h2')?.textContent).toBe(useLocale().t('voice.manager.open'));

        closed = 0;
        fire(buttonNamed(container, useLocale().t('common.close'))!, 'click');

        expect(closed, 'the sheet could not be closed from its own header').toBe(1);
        expect(container.textContent).toContain(useLocale().t('voice.manager.out'));
        expect(container.querySelector('[role="meter"]'), 'the microphone cannot be set up before the call').not.toBeNull();
        expect(container.querySelector(`[role="slider"][aria-label="${ useLocale().t('voice.volume') }"]`)).not.toBeNull();

        fire(buttonNamed(container, useLocale().t('voice.join'))!, 'click');
        await settle();
        await settle();

        expect(useVoice().table()).toBe(TABLE);
        expect(container.textContent).not.toContain(useLocale().t('voice.manager.out'));
    });

    it('gives the call its own controls once the reader is in it', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        const container = await sheet();

        fire(buttonNamed(container, useLocale().t('voice.mute'))!, 'click');
        await settle();

        expect(useVoice().muted()).toBe(true);
        expect(buttonNamed(container, useLocale().t('voice.unmute'))).toBeDefined();

        fire(buttonNamed(container, useLocale().t('voice.deafen'))!, 'click');
        await settle();

        expect(useVoice().deaf()).toBe(true);

        fire(buttonNamed(container, useLocale().t('voice.leave'))!, 'click');
        await settle();

        expect(useVoice().table()).toBeNull();
        expect(container.textContent, 'the sheet still showed the call after the reader left it').toContain(useLocale().t('voice.manager.out'));
    });

    it('lists everybody else in the call and says, line by line, what was measured', async () =>
    {
        await useVoice().join(TABLE);
        await room();
        lines = { 'sara.k': DIRECT, mina: CARRIED };

        const container = await sheet();

        expect(asked, 'the lines were not asked about when the sheet opened').toBe(1);

        await settle();

        const sara = rowOf(container, 'sara.k')!;
        const mina = rowOf(container, 'mina')!;

        expect(rowOf(container, 'alex'), 'the reader was listed among the others').toBeNull();
        expect(sara.textContent).toContain('Direct');
        expect(sara.textContent).toContain('Round trip 24 ms');
        expect(sara.textContent).toContain('Jitter 3 ms');
        expect(sara.textContent).toContain('Lost 1.2%');
        expect(sara.textContent).toContain('62 kbps');
        expect(mina.textContent).toContain('Through the server');
        expect(mina.textContent, 'a carried voice claimed a round trip to its speaker').toContain('To the server 120 ms');
        expect(mina.textContent).toContain('Lost 0%');
    });

    it('measures again every second, and keeps each row while it does', async () =>
    {
        await useVoice().join(TABLE);
        await room();
        lines = { 'sara.k': DIRECT };

        const container = await sheet();

        await settle();

        const kept = [...container.querySelectorAll('li.voice-peer, li.voice-peer *')];

        lines = { 'sara.k': { ...DIRECT, trip: 31, jitter: 5 } };
        await later(LINES_MS);

        expect(asked).toBe(2);
        expect(rowOf(container, 'sara.k')!.textContent).toContain('Round trip 31 ms');

        useVoice().people();
        await room([
            { who: 'alex', muted: false, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: true, talk: true, join: 'j2', opus: false },
            { who: 'mina', muted: true, talk: true, join: 'j3', opus: false }
        ]);

        expect(kept.filter((node) => !node.isConnected).map((node) => `${ node.tagName } ${ node.className }`), 'a row was drawn again').toEqual([]);
    });

    it('says what it knows of a line it has not measured, and why somebody cannot be heard', async () =>
    {
        waiting = true;
        await useVoice().join(TABLE);
        await room([
            { who: 'alex', muted: false, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: false },
            { who: 'mina', muted: false, talk: true, join: 'j3', opus: false },
            { who: 'omid.k', muted: false, talk: false, join: 'j4', opus: false }
        ]);

        const container = await sheet();

        await settle();

        expect(rowOf(container, 'sara.k')!.textContent).toContain(useLocale().t('voice.connecting'));
        expect(rowOf(container, 'mina')!.textContent, 'a line with nothing measured yet claimed numbers').toContain(useLocale().t('voice.line.measuring'));
        expect(rowOf(container, 'omid.k')!.textContent).toContain(useLocale().t('voice.apart'));
        expect(rowOf(container, 'omid.k')!.querySelector('[role="slider"]'), 'somebody who cannot talk with the reader was offered a volume').toBeNull();
    });

    it('turns one person up to twice or silences them, for this reader only', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        const container = await sheet();
        const slider = rowOf(container, 'sara.k')!.querySelector<HTMLElement>('[role="slider"]')!;

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        await settle();

        expect(useVoice().volumeOf('sara.k')).toBe(LOUDEST);
        expect(useVoice().volumeOf('mina')).toBe(1);

        fire(buttonNamed(rowOf(container, 'sara.k')!, useLocale().t('voice.silence', { name: 'sara.k' }))!, 'click');
        await settle();

        expect(useVoice().volumeOf('sara.k')).toBe(0);
    });

    it('says nobody else is there when the reader is alone in the call', async () =>
    {
        await useVoice().join(TABLE);
        await room([{ who: 'alex', muted: false, talk: true, join: 'j1', opus: false }]);

        const container = await sheet();

        expect(container.textContent).toContain(useLocale().t('voice.manager.alone'));
    });

    it('stops measuring when it is put away', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        await sheet();
        await later(LINES_MS);

        const before = asked;

        cleanup();
        await later(LINES_MS * 3);

        expect(asked, 'the lines were measured for a sheet that was gone').toBe(before);
        expect(useVoice().lines()).toEqual({});
    });

    it('says what was measured in Persian too', async () =>
    {
        useLocale().setLocale('fa');
        await useVoice().join(TABLE);
        await room();
        lines = { 'sara.k': DIRECT };

        const container = await sheet();

        await settle();

        const sara = rowOf(container, 'sara.k')!.textContent ?? '';

        expect(sara).toContain(useLocale().t('voice.line.direct'));
        expect(sara).toContain('۲۴');
        expect(sara).not.toContain('24');
    });
});
