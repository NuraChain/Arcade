import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { ClientFrame } from '../../server/src/realtime/frames.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { VoiceCall, VoiceCallDeps, VoiceSignal } from '../src/services/voice.rtc.ts';
import { keyName } from '../src/lib/talk-key.ts';
import { IDLE_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

const TABLE = 'table-1';

interface FakeCall
{
    deps: VoiceCallDeps;
    synced: string[][];
    received: { from: string; signal: VoiceSignal }[];
    muted: boolean[];
    mic: (MediaStream | null)[];
    volumes: Record<string, number>;
    sinks: string[];
    closed: boolean;
}

let calls: FakeCall[] = [];

const fakeCall = (deps: VoiceCallDeps): VoiceCall =>
{
    const call: FakeCall = { deps, synced: [], received: [], muted: [], mic: [], volumes: {}, sinks: [], closed: false };
    calls.push(call);

    return {
        setMic: async (stream) =>
        {
            call.mic.push(stream);
        },
        setMuted: (muted) =>
        {
            call.muted.push(muted);
        },
        sync: (peers) =>
        {
            call.synced.push([...peers]);
        },
        receive: async (from, signal) =>
        {
            call.received.push({ from, signal });
        },
        setVolume: (who, volume) =>
        {
            call.volumes[who] = volume;
        },
        setSink: (id) =>
        {
            call.sinks.push(id);
        },
        close: () =>
        {
            call.closed = true;
        }
    };
};

const track = { stop: () => undefined } as unknown as MediaStreamTrack;

const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;

const media = (outcome: 'grant' | 'deny' | 'none'): MediaDevices => ({
    getUserMedia: async () =>
    {
        if (outcome === 'grant')
        {
            return stream;
        }
        throw Object.assign(new Error('no'), { name: outcome === 'deny' ? 'NotAllowedError' : 'NotFoundError' });
    }
}) as unknown as MediaDevices;

const voiceFrames = (): Extract<ClientFrame, { t: 'voice' }>[] =>
    socket.sent.filter((frame): frame is Extract<ClientFrame, { t: 'voice' }> => frame.t === 'voice');

const settle = async (): Promise<void> =>
{
    for (let i = 0; i < 6; i += 1)
    {
        await Promise.resolve();
    }
};

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(900_000), seed: 9 });
    calls = [];
    setVoiceCall(fakeCall);
    setVoiceMedia(() => media('grant'));
    useSettings().reset();
    useRealtime().reset();
    socket.reset();
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex', bio: '', hue: 210, kind: 'guest', isMinor: false });
    useVoice().reset();
    useRealtime().start();
    useVoice().start();
    socket.accept();
});

afterEach(() =>
{
    useVoice().reset();
    useRealtime().reset();
    setVoiceCall(null);
    setVoiceMedia(null);
});

describe('voice at a table', () =>
{
    it('joins muted by default, and says so to the server', async () =>
    {
        await useVoice().join(TABLE);

        expect(useVoice().table()).toBe(TABLE);
        expect(useVoice().mic()).toBe('live');
        expect(useVoice().muted()).toBe(true);
        expect(voiceFrames().at(-1)).toMatchObject({ t: 'voice', table: TABLE, on: true, muted: true });
    });

    it('joins listening only when the microphone is refused', async () =>
    {
        setVoiceMedia(() => media('deny'));

        await useVoice().join(TABLE);

        expect(useVoice().mic()).toBe('denied');
        expect(useVoice().muted()).toBe(true);

        useVoice().toggleMute();
        expect(useVoice().muted()).toBe(true);
    });

    it('connects to the people it may talk with, and nobody else', async () =>
    {
        await useVoice().join(TABLE);

        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, peers: [
            { who: 'alex', muted: true, talk: true },
            { who: 'sara.k', muted: false, talk: true },
            { who: 'mina', muted: false, talk: false }
        ] });
        await settle();

        expect(calls[0].synced.at(-1)).toEqual(['sara.k']);
        expect(useVoice().people().map((person) => [person.who, person.me, person.talk])).toEqual([
            ['alex', true, true],
            ['sara.k', false, true],
            ['mina', false, false]
        ]);
    });

    it('hands a signal for this table to the call, and ignores one for another', async () =>
    {
        await useVoice().join(TABLE);

        socket.deliver({ v: 1, t: 'signal', n: 4, table: TABLE, from: 'sara.k', kind: 'offer', data: '{"sdp":"x"}' });
        socket.deliver({ v: 1, t: 'signal', n: 5, table: 'other', from: 'sara.k', kind: 'offer', data: '{"sdp":"y"}' });
        await settle();

        expect(calls[0].received).toEqual([{ from: 'sara.k', signal: { kind: 'offer', data: '{"sdp":"x"}' } }]);
    });

    it('unmutes and tells the room', async () =>
    {
        await useVoice().join(TABLE);

        useVoice().toggleMute();

        expect(useVoice().muted()).toBe(false);
        expect(calls[0].muted.at(-1)).toBe(false);
        expect(voiceFrames().at(-1)).toMatchObject({ on: true, muted: false });
    });

    it('leaves cleanly, and tears everything down when the server takes it out of the room', async () =>
    {
        await useVoice().join(TABLE);
        useVoice().leave();

        expect(voiceFrames().at(-1)).toMatchObject({ on: false });
        expect(calls[0].closed).toBe(true);
        expect(useVoice().table()).toBeNull();

        await useVoice().join(TABLE);
        socket.deliver({ v: 1, t: 'voice', n: 9, table: TABLE, joined: false, peers: [] });
        await settle();

        expect(calls[1].closed).toBe(true);
        expect(useVoice().table()).toBeNull();
    });

    it('rejoins the room after the socket comes back', async () =>
    {
        await useVoice().join(TABLE);
        const before = voiceFrames().length;

        socket.drop();
        useRealtime().start();
        socket.accept();
        await settle();

        expect(voiceFrames().length).toBeGreaterThan(before);
        expect(voiceFrames().at(-1)).toMatchObject({ table: TABLE, on: true });
    });

    const room = async (): Promise<void> =>
    {
        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, peers: [
            { who: 'alex', muted: false, talk: true },
            { who: 'sara.k', muted: false, talk: true }
        ] });
        await settle();
    };

    it('opens the microphone only while the talk key is held, and tells the server nothing about it', async () =>
    {
        useSettings().update({ voicePushToTalk: true });
        await useVoice().join(TABLE);
        const sent = voiceFrames().length;

        expect(voiceFrames().at(-1)).toMatchObject({ muted: false });
        expect(calls[0].muted.at(-1), 'push to talk left the microphone open').toBe(true);

        useVoice().press();
        expect(calls[0].muted.at(-1)).toBe(false);

        useVoice().release();
        expect(calls[0].muted.at(-1)).toBe(true);
        expect(voiceFrames().length, 'holding the key spent voice frames').toBe(sent);
    });

    it('answers the talk key only at a table and never while somebody is typing', async () =>
    {
        useSettings().update({ voicePushToTalk: true });
        await useVoice().join(TABLE);

        const box = document.createElement('input');
        document.body.append(box);
        box.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', bubbles: true }));
        expect(useVoice().talking()).toBe(false);
        box.remove();

        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
        expect(useVoice().talking()).toBe(true);

        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV' }));
        expect(useVoice().talking()).toBe(false);
    });

    it('listens for the talk key the player chose, and names it the way a keyboard does', async () =>
    {
        useSettings().update({ voicePushToTalk: true, voiceTalkKey: 'KeyT' });
        await useVoice().join(TABLE);

        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
        expect(useVoice().talking()).toBe(false);

        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
        expect(useVoice().talking()).toBe(true);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyT' }));

        expect([keyName('KeyT'), keyName('Digit4'), keyName('Numpad2'), keyName('ShiftLeft'), keyName('Space')]).toEqual(['T', '4', 'Num 2', 'Shift Left', 'Space']);
    });

    it('deafens: nobody is heard and the microphone closes, and undeafening gives both back', async () =>
    {
        useSettings().update({ voiceStartMuted: false });
        await useVoice().join(TABLE);
        await room();

        useVoice().toggleDeafen();
        expect(useVoice().deaf()).toBe(true);
        expect(calls[0].volumes['sara.k']).toBe(0);
        expect(voiceFrames().at(-1)).toMatchObject({ muted: true });

        useVoice().toggleDeafen();
        expect(calls[0].volumes['sara.k']).toBe(1);
        expect(useVoice().muted()).toBe(false);
        expect(voiceFrames().at(-1)).toMatchObject({ muted: false });
    });

    it('sets one person\'s volume without touching anybody else\'s', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        useVoice().setLevel('sara.k', 0.4);

        expect(calls[0].volumes['sara.k']).toBeCloseTo(0.4);
        expect(useVoice().volumeOf('sara.k')).toBeCloseTo(0.4);
        expect(useVoice().volumeOf('mina')).toBe(1);
        expect(useVoice().people().find((person) => person.who === 'sara.k')?.volume).toBeCloseTo(0.4);
    });

    it('stops the microphone a superseded join was granted, rather than leaving it live with nothing holding it', async () =>
    {
        const granted: { stopped: boolean }[] = [];
        const answers: ((value: MediaStream) => void)[] = [];

        setVoiceMedia(() => ({
            getUserMedia: () => new Promise<MediaStream>((resolve) =>
            {
                const held = { stopped: false };
                const live = { stop: () =>
                {
                    held.stopped = true;
                } } as unknown as MediaStreamTrack;

                granted.push(held);
                answers.push(() => resolve({ getTracks: () => [live], getAudioTracks: () => [live] } as unknown as MediaStream));
            })
        }) as unknown as MediaDevices);

        const first = useVoice().join(TABLE);
        await settle();
        useVoice().leave();
        const second = useVoice().join(TABLE);
        await settle();

        answers.forEach((answer) => answer(stream));
        await Promise.all([first, second]);

        expect(granted.length).toBe(2);
        expect(granted[0].stopped, 'the first grant is live with nothing holding it').toBe(true);
        expect(granted[1].stopped).toBe(false);
        expect(useVoice().mic()).toBe('live');
    });

    it('asks for the chosen microphone as a preference, so one that has gone falls back to the default', async () =>
    {
        const asked: MediaStreamConstraints[] = [];
        setVoiceMedia(() => ({
            getUserMedia: async (constraints: MediaStreamConstraints) =>
            {
                asked.push(constraints);
                return stream;
            }
        }) as unknown as MediaDevices);
        useSettings().update({ voiceMic: 'unplugged' });

        await useVoice().join(TABLE);

        expect(asked[0].audio).toMatchObject({ deviceId: { ideal: 'unplugged' } });
        expect(useVoice().mic()).toBe('live');
    });

    it('plays the call through the chosen speaker, and moves it when the choice changes', async () =>
    {
        useSettings().update({ voiceSpeaker: 'desk' });
        await useVoice().join(TABLE);

        useVoice().useSpeaker('headset');

        expect(calls[0].sinks).toEqual(['desk', 'headset']);
        expect(useSettings().settings().voiceSpeaker).toBe('headset');
    });

    it('keeps the call on while the tab is hidden, and lets the socket sleep once it is over', async () =>
    {
        const clock = manualClock(900_000);
        setRuntime({ clock, seed: 9 });
        let visibility: DocumentVisibilityState = 'visible';
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

        try
        {
            await useVoice().join(TABLE);

            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
            clock.advance(IDLE_MS * 2);
            expect(socket.closed, 'a hidden tab hung up a voice call').toEqual([]);

            useVoice().leave();
            clock.advance(IDLE_MS + 1000);
            expect(socket.closed).toHaveLength(1);
        }
        finally
        {
            delete (document as { visibilityState?: unknown }).visibilityState;
        }
    });
});
