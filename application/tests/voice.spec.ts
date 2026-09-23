import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { ClientFrame } from '../../server/src/realtime/frames.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { VoiceCall, VoiceCallDeps, VoiceSignal } from '../src/services/voice.rtc.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
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
    closed: boolean;
}

let calls: FakeCall[] = [];

const fakeCall = (deps: VoiceCallDeps): VoiceCall =>
{
    const call: FakeCall = { deps, synced: [], received: [], muted: [], mic: [], closed: false };
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
        setVolume: () => undefined,
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
});
