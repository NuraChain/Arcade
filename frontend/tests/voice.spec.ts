import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { ClientFrame } from '../../backend/src/realtime/frames.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import type { LineFacts, VoiceCall, VoiceCallDeps, VoiceSignal } from '../src/services/voice.rtc.ts';
import { keyName } from '../src/lib/talk-key.ts';
import { IDLE_MS, SOUND_BACKLOG, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { LINES_MS, LOUDEST, SPEAKING_HOLD_MS, UNREACHED_MS, setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { setDenoiseKit } from '../src/services/voice.denoise.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

const TABLE = 'table-1';

interface FakeCall
{
    deps: VoiceCallDeps;
    synced: { mine: string; peers: { who: string; join: string }[] }[];
    received: { join: string; signal: VoiceSignal }[];
    sounds: { join: string; codec: string; at: number; data: string }[];
    muted: boolean[];
    mic: (MediaStream | null)[];
    volumes: Record<string, number>;
    sinks: string[];
    qualities: number[];
    lines: Record<string, LineFacts>;
    asked: number;
    closed: boolean;
}

let calls: FakeCall[] = [];

const fakeCall = (deps: VoiceCallDeps): VoiceCall =>
{
    const call: FakeCall = { deps, synced: [], received: [], sounds: [], muted: [], mic: [], volumes: {}, sinks: [], qualities: [], lines: {}, asked: 0, closed: false };
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
        sync: (mine, peers) =>
        {
            call.synced.push({ mine, peers: [...peers] });
        },
        receive: async (join, signal) =>
        {
            call.received.push({ join, signal });
        },
        heard: (join, codec, at, data) =>
        {
            call.sounds.push({ join, codec, at, data });
        },
        setVolume: (who, volume) =>
        {
            call.volumes[who] = volume;
        },
        setSink: (id) =>
        {
            call.sinks.push(id);
        },
        setQuality: (bitrate) =>
        {
            call.qualities.push(bitrate);
        },
        facts: async () =>
        {
            call.asked += 1;

            return { ...call.lines };
        },
        close: () =>
        {
            call.closed = true;
        }
    };
};

const track = { stop: () => undefined } as unknown as MediaStreamTrack;

const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;

const media = (outcome: 'grant' | 'deny' | 'none') => ({
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

const settle = async () =>
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
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex', bio: '', hue: 210, isMinor: false });
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
    it('joins with the microphone open by default, and says so to the server', async () =>
    {
        await useVoice().join(TABLE);

        expect(useVoice().table()).toBe(TABLE);
        expect(useVoice().mic()).toBe('live');
        expect(useVoice().muted(), 'the owner asked for the microphone to start open').toBe(false);
        expect(voiceFrames().at(-1)).toMatchObject({ t: 'voice', table: TABLE, on: true, muted: false });
    });

    it('joins muted when the reader asked to start that way', async () =>
    {
        useSettings().update({ voiceStartMuted: true });

        await useVoice().join(TABLE);

        expect(useVoice().muted()).toBe(true);
        expect(voiceFrames().at(-1)).toMatchObject({ on: true, muted: true });
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

        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex', muted: true, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: false },
            { who: 'mina', muted: false, talk: false, join: 'j3', opus: false }
        ] });
        await settle();

        expect(calls[0].synced.at(-1)).toEqual({ mine: 'j1', peers: [{ who: 'sara.k', join: 'j2', opus: false }] });
        expect(useVoice().people().map((person) => [person.who, person.me, person.talk])).toEqual([
            ['alex', true, true],
            ['sara.k', false, true],
            ['mina', false, false]
        ]);
    });

    it('knows its own row by the joining, so a handle it has not heard of yet does not make it a stranger', async () =>
    {
        await useVoice().join(TABLE);

        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex.renamed', muted: true, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: false }
        ] });
        await settle();

        expect(calls[0].synced.at(-1)).toEqual({ mine: 'j1', peers: [{ who: 'sara.k', join: 'j2', opus: false }] });
        expect(useVoice().people().map((person) => [person.who, person.me, person.link])).toEqual([
            ['alex.renamed', true, 'connected'],
            ['sara.k', false, null]
        ]);
    });

    it('hands a signal for this table to the call, and ignores one for another', async () =>
    {
        await useVoice().join(TABLE);

        socket.deliver({ v: 1, t: 'signal', n: 4, table: TABLE, from: 'sara.k', join: 'j2', kind: 'offer', data: '{"sdp":"x"}' });
        socket.deliver({ v: 1, t: 'signal', n: 5, table: 'other', from: 'sara.k', join: 'j2', kind: 'offer', data: '{"sdp":"y"}' });
        await settle();

        expect(calls[0].received).toEqual([{ join: 'j2', signal: { kind: 'offer', data: '{"sdp":"x"}' } }]);
    });

    it('sends a signal to the joining the call names, and to nobody else of that name', async () =>
    {
        await useVoice().join(TABLE);

        calls[0].deps.send('sara.k', 'j2', { kind: 'offer', data: '{"sdp":"z"}' });

        expect(socket.sent.filter((frame) => frame.t === 'signal')).toEqual([{ t: 'signal', table: TABLE, to: 'sara.k', join: 'j2', kind: 'offer', data: '{"sdp":"z"}' }]);
    });

    it('unmutes and tells the room', async () =>
    {
        useSettings().update({ voiceStartMuted: true });
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
        socket.deliver({ v: 1, t: 'voice', n: 9, table: TABLE, joined: false, mine: '', peers: [] });
        await settle();

        expect(calls[1].closed).toBe(true);
        expect(useVoice().table()).toBeNull();
    });

    it('rejoins the room after the socket comes back, having hung up on everybody its last joining was talking to', async () =>
    {
        await useVoice().join(TABLE);

        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex', muted: false, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: false }
        ] });
        await settle();

        const before = voiceFrames().length;
        const synced = calls[0].synced.length;

        socket.drop();
        useRealtime().start();
        socket.accept();
        await settle();

        expect(voiceFrames().length).toBeGreaterThan(before);
        expect(voiceFrames().at(-1)).toMatchObject({ table: TABLE, on: true });
        expect(calls[0].synced.slice(synced)).toEqual([{ mine: '', peers: [] }]);
        expect(calls[0].closed).toBe(false);
    });

    it('announces a join that was pressed before the socket had opened, once it has', async () =>
    {
        useVoice().reset();
        useRealtime().reset();
        socket.reset();
        useRealtime().start();
        useVoice().start();

        await useVoice().join(TABLE);

        expect(useVoice().table()).toBe(TABLE);
        expect(voiceFrames()).toEqual([]);

        socket.accept();
        await settle();

        expect(voiceFrames()).toEqual([{ t: 'voice', table: TABLE, on: true, muted: false, opus: false }]);
    });

    const room = async () =>
    {
        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex', muted: false, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: false }
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

    it('keeps a person\'s volume on this device for the next call, and writes nothing for somebody at full', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        useVoice().setLevel('sara.k', 0.4);
        useVoice().setLevel('mina', 1);

        expect(useSettings().settings().voiceLevels).toEqual({ 'sara.k': 0.4 });

        useVoice().leave();
        await useVoice().join(TABLE);
        await room();
        calls.at(-1)!.deps.onLink('sara.k', 'connected');

        expect(calls.at(-1)!.volumes['sara.k'], 'the next call played her at full again').toBeCloseTo(0.4);
        expect(useVoice().volumeOf('sara.k')).toBeCloseTo(0.4);
    });

    it('hears a person again at the volume they had before they were silenced', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        useVoice().setLevel('sara.k', 0.6);
        useVoice().silence('sara.k');

        expect(useVoice().volumeOf('sara.k')).toBe(0);
        expect(calls[0].volumes['sara.k']).toBe(0);

        useVoice().silence('sara.k');

        expect(useVoice().volumeOf('sara.k'), 'unmuting her put her back at full').toBeCloseTo(0.6);
        expect(calls[0].volumes['sara.k']).toBeCloseTo(0.6);
    });

    it('holds a volume between nothing and the loudest there is', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        useVoice().setLevel('sara.k', -3);
        expect(useVoice().volumeOf('sara.k')).toBe(0);

        useVoice().setLevel('sara.k', 40);
        expect(useVoice().volumeOf('sara.k')).toBe(LOUDEST);
    });

    it('plays everybody up to twice as loud by the reader’s own volume, with each person’s on top of it', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        useSettings().update({ voiceVolume: 1.5 });
        useVoice().applyVolume();

        expect(calls[0].volumes['sara.k'], 'the reader’s own volume stopped at full').toBeCloseTo(1.5);

        useVoice().setLevel('sara.k', 2);

        expect(calls[0].volumes['sara.k']).toBeCloseTo(3);

        useSettings().update({ voiceVolume: 9 });
        useVoice().applyVolume();

        expect(calls[0].volumes['sara.k']).toBeCloseTo(LOUDEST * LOUDEST);
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

    it('keeps somebody marked as speaking through the gap between two words, and lets go once they have stopped', async () =>
    {
        const clock = manualClock(900_000);
        setRuntime({ clock, seed: 9 });

        await useVoice().join(TABLE);
        socket.deliver({
            v: 1,
            t: 'voice',
            n: 31,
            table: TABLE,
            joined: true,
            mine: 'join-alex',
            peers: [
                { who: 'alex', muted: true, talk: true, join: 'join-alex', opus: false },
                { who: 'sara.k', muted: false, talk: true, join: 'join-sara', opus: false }
            ]
        });
        await settle();

        calls[0].deps.onLevel('sara.k', 0.5);
        expect(useVoice().speaking('sara.k')).toBe(true);

        calls[0].deps.onLevel('sara.k', 0);
        clock.advance(SPEAKING_HOLD_MS - 50);
        expect(useVoice().speaking('sara.k'), 'the ring went out in the breath between two words').toBe(true);

        calls[0].deps.onLevel('sara.k', 0.5);
        clock.advance(SPEAKING_HOLD_MS);
        expect(useVoice().speaking('sara.k'), 'a silence that ended was still counted against her').toBe(true);

        calls[0].deps.onLevel('sara.k', 0);
        clock.advance(SPEAKING_HOLD_MS);
        expect(useVoice().speaking('sara.k')).toBe(false);
    });

    it('wakes the audio it measures voices by once the microphone is given, and at the next press while it still sleeps', async () =>
    {
        const asked: string[] = [];

        class Asleep
        {
            public state = 'suspended';

            public async resume()
            {
                asked.push('resume');
            }

            public async close()
            {
                asked.push('close');
            }
        }

        vi.stubGlobal('AudioContext', Asleep);

        try
        {
            await useVoice().join(TABLE);
            expect(asked, 'the meters were left on a context nobody woke: nobody is ever seen to speak').toEqual(['resume']);

            window.dispatchEvent(new Event('pointerdown'));
            expect(asked).toEqual(['resume', 'resume']);

            window.dispatchEvent(new Event('keydown'));
            expect(asked).toEqual(['resume', 'resume', 'resume']);

            useVoice().leave();
            window.dispatchEvent(new Event('pointerdown'));
            expect(asked, 'a call that is over went on listening for presses').toEqual(['resume', 'resume', 'resume', 'close']);
        }
        finally
        {
            vi.unstubAllGlobals();
        }
    });

    it('leaves a context that is awake alone', async () =>
    {
        const asked: string[] = [];

        class Awake
        {
            public state = 'running';

            public async resume()
            {
                asked.push('resume');
            }

            public async close()
            {
                asked.push('close');
            }
        }

        vi.stubGlobal('AudioContext', Awake);

        try
        {
            await useVoice().join(TABLE);
            window.dispatchEvent(new Event('pointerdown'));

            expect(asked).toEqual([]);
        }
        finally
        {
            vi.unstubAllGlobals();
        }
    });

    it('names somebody the call has not reached once that has gone on, however often the line is tried again', async () =>
    {
        const clock = manualClock(900_000);
        setRuntime({ clock, seed: 9 });

        await useVoice().join(TABLE);
        socket.deliver({
            v: 1,
            t: 'voice',
            n: 51,
            table: TABLE,
            joined: true,
            mine: 'join-alex',
            peers: [
                { who: 'alex', muted: true, talk: true, join: 'join-alex', opus: false },
                { who: 'sara.k', muted: false, talk: true, join: 'join-sara', opus: false }
            ]
        });
        await settle();

        const sara = () => useVoice().people().find((person) => person.who === 'sara.k')?.link;

        calls[0].deps.onLink('sara.k', 'connecting');
        clock.advance(UNREACHED_MS - 1000);
        expect(useVoice().unreached(), 'a call still being placed was called one that cannot be made').toEqual([]);
        expect(sara()).toBe('connecting');

        calls[0].deps.onLink('sara.k', 'failed');
        calls[0].deps.onLink('sara.k', 'connecting');
        clock.advance(1000);
        expect(useVoice().unreached(), 'a line that fails and is tried again never counted as not reached').toEqual(['sara.k']);
        expect(sara(), 'the row went back to Connecting with every new try').toBe('failed');

        calls[0].deps.onLink('sara.k', 'failed');
        calls[0].deps.onLink('sara.k', 'connecting');
        clock.advance(UNREACHED_MS * 3);
        expect(useVoice().unreached()).toEqual(['sara.k']);

        calls[0].deps.onLink('sara.k', 'connected');
        expect(useVoice().unreached()).toEqual([]);
        expect(sara()).toBe('connected');
    });

    it('never names a line that connects in time, or somebody who has gone, and forgets everybody when the call is over', async () =>
    {
        const clock = manualClock(900_000);
        setRuntime({ clock, seed: 9 });

        await useVoice().join(TABLE);

        calls[0].deps.onLink('sara.k', 'connecting');
        clock.advance(UNREACHED_MS - 1);
        calls[0].deps.onLink('sara.k', 'connected');
        clock.advance(UNREACHED_MS);
        expect(useVoice().unreached()).toEqual([]);

        calls[0].deps.onLink('reza.t', 'connecting');
        calls[0].deps.onLink('reza.t', null);
        clock.advance(UNREACHED_MS * 2);
        expect(useVoice().unreached(), 'somebody who left the call was named as not reached').toEqual([]);

        calls[0].deps.onLink('sara.k', 'connecting');
        clock.advance(UNREACHED_MS);
        expect(useVoice().unreached(), 'a line that was good and has dropped is given the same wait').toEqual(['sara.k']);

        calls[0].deps.onLink('omid', 'failed');
        useVoice().leave();
        expect(useVoice().unreached()).toEqual([]);

        clock.advance(UNREACHED_MS * 2);
        expect(useVoice().unreached(), 'a wait outlived the call it was for').toEqual([]);
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

describe('what the reader is told about each line', () =>
{
    const DIRECT: LineFacts = { path: 'direct', trip: 24, jitter: 3, buffer: 40, lost: 0, kbps: 62 };

    const room = async () =>
    {
        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex', muted: false, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: false }
        ] });
        await settle();
    };

    const later = async (ms: number) =>
    {
        (runtime().clock as ManualClock).advance(ms);
        await settle();
    };

    it('asks the call about its lines once a second while anybody looks, and stops when nobody does', async () =>
    {
        await useVoice().join(TABLE);
        await room();
        calls[0].lines = { 'sara.k': DIRECT };

        const first = useVoice().watchLines();

        await settle();

        expect(calls[0].asked).toBe(1);
        expect(useVoice().lines()['sara.k']).toEqual(DIRECT);

        calls[0].lines = { 'sara.k': { ...DIRECT, trip: 31 } };
        await later(LINES_MS);

        expect(calls[0].asked).toBe(2);
        expect(useVoice().lines()['sara.k'].trip).toBe(31);

        const second = useVoice().watchLines();

        await later(LINES_MS);

        expect(calls[0].asked, 'two lookers asked twice as often').toBe(3);

        second();
        await later(LINES_MS);

        expect(calls[0].asked).toBe(4);

        first();

        expect(useVoice().lines()).toEqual({});

        await later(LINES_MS * 3);

        expect(calls[0].asked, 'the lines were asked about with nobody looking').toBe(4);
    });

    it('forgets every line when the call ends, and asks nothing of a call that is gone', async () =>
    {
        await useVoice().join(TABLE);
        await room();
        calls[0].lines = { 'sara.k': DIRECT };

        const stop = useVoice().watchLines();

        await settle();
        useVoice().leave();

        expect(useVoice().lines()).toEqual({});

        await later(LINES_MS * 2);

        expect(calls[0].asked).toBe(1);
        expect(useVoice().lines()).toEqual({});

        stop();
    });

    it('drops an answer that comes back after the call it was about has ended', async () =>
    {
        await useVoice().join(TABLE);
        await room();

        let answer: (found: Record<string, LineFacts>) => void = () => undefined;

        const slow = vi.fn(() => new Promise<Record<string, LineFacts>>((resolve) =>
        {
            answer = resolve;
        }));
        const made = useVoice();

        setVoiceCall((deps) => ({ ...fakeCall(deps), facts: slow }));
        made.leave();
        await made.join(TABLE);
        await room();

        const stop = made.watchLines();

        made.leave();
        answer({ 'sara.k': DIRECT });
        await settle();

        expect(made.lines(), 'a call that had ended was still described').toEqual({});

        stop();
    });
});

describe('a call the server carries', () =>
{
    const soundFrames = () => socket.sent.filter((frame) => frame.t === 'sound');

    const hearing = (yes: boolean) => ({ isConfigSupported: async () => ({ supported: yes }) });

    it('says whether this browser can hear Opus when it joins, when it mutes and when it comes back', async () =>
    {
        vi.stubGlobal('AudioEncoder', hearing(true));
        vi.stubGlobal('AudioDecoder', hearing(true));

        try
        {
            await useVoice().join(TABLE);

            expect(voiceFrames().at(-1)).toMatchObject({ on: true, opus: true });
            expect(calls[0].deps.opus).toBe(true);

            useVoice().toggleMute();
            expect(voiceFrames().at(-1)).toMatchObject({ muted: true, opus: true });

            socket.drop();
            useRealtime().start();
            socket.accept();
            await settle();

            expect(voiceFrames().at(-1)).toMatchObject({ on: true, opus: true });
        }
        finally
        {
            vi.unstubAllGlobals();
        }
    });

    it('says it cannot hear Opus where the browser cannot read it', async () =>
    {
        vi.stubGlobal('AudioEncoder', hearing(true));
        vi.stubGlobal('AudioDecoder', hearing(false));

        try
        {
            await useVoice().join(TABLE);

            expect(voiceFrames().at(-1)).toMatchObject({ on: true, opus: false });
            expect(calls[0].deps.opus).toBe(false);
        }
        finally
        {
            vi.unstubAllGlobals();
        }
    });

    it('tells the call who among the people it may talk with can hear Opus', async () =>
    {
        await useVoice().join(TABLE);

        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex', muted: true, talk: true, join: 'j1', opus: false },
            { who: 'sara.k', muted: false, talk: true, join: 'j2', opus: true },
            { who: 'mina', muted: false, talk: true, join: 'j3', opus: false }
        ] });
        await settle();

        expect(calls[0].synced.at(-1)).toEqual({ mine: 'j1', peers: [{ who: 'sara.k', join: 'j2', opus: true }, { who: 'mina', join: 'j3', opus: false }] });
    });

    it('hands the call the sound carried for this table, and lets sound for another fall', async () =>
    {
        await useVoice().join(TABLE);

        socket.deliver({ v: 1, t: 'sound', n: 4, table: TABLE, join: 'j2', codec: 'law', at: 3, data: 'AQID' });
        socket.deliver({ v: 1, t: 'sound', n: 5, table: 'other', join: 'j2', codec: 'opus', at: 4, data: 'BAUG' });
        await settle();

        expect(calls[0].sounds).toEqual([{ join: 'j2', codec: 'law', at: 3, data: 'AQID' }]);
    });

    it('sends what the call carries to the server for the joinings it names, and drops it rather than queue it behind a socket that has fallen behind', async () =>
    {
        await useVoice().join(TABLE);

        calls[0].deps.relay!(['j2', 'j3'], 'opus', 7, 'AQID');

        expect(soundFrames()).toEqual([{ t: 'sound', table: TABLE, to: ['j2', 'j3'], codec: 'opus', at: 7, data: 'AQID' }]);

        socket.backlog = SOUND_BACKLOG + 1;
        calls[0].deps.relay!(['j2'], 'opus', 8, 'BAUG');

        expect(soundFrames(), 'sound was queued behind a socket that could not keep up').toHaveLength(1);

        socket.backlog = 0;
        calls[0].deps.relay!(['j2'], 'opus', 9, 'BwgJ');

        expect(soundFrames().map((frame) => (frame.t === 'sound' ? frame.at : -1))).toEqual([7, 9]);
    });

    it('asks the call for the quality the settings name, and again when it is changed', async () =>
    {
        await useVoice().join(TABLE);

        expect(calls[0].qualities.at(-1)).toBe(64_000);

        useSettings().update({ voiceQuality: 'best' });
        useVoice().tune();

        expect(calls[0].qualities.at(-1)).toBe(96_000);

        useSettings().update({ voiceQuality: 'standard' });
        useVoice().tune();

        expect(calls[0].qualities.at(-1)).toBe(32_000);
    });

    it('gives the call the round trip this browser has measured to the server', async () =>
    {
        await useVoice().join(TABLE);

        expect(calls[0].deps.rtt!()).toBe(useRealtime().rtt());
    });

    it('waits for a line on the product clock', async () =>
    {
        const clock = manualClock(900_000);
        setRuntime({ clock, seed: 9 });
        const ran = vi.fn();

        await useVoice().join(TABLE);

        calls[0].deps.after!(1000, ran);

        clock.advance(999);
        expect(ran).not.toHaveBeenCalled();
        clock.advance(1);
        expect(ran).toHaveBeenCalledTimes(1);

        calls[0].deps.after!(1000, ran)();
        clock.advance(2000);
        expect(ran, 'a wait that was called off ran anyway').toHaveBeenCalledTimes(1);
    });
});

describe('the microphone, prepared before anybody hears it', () =>
{
    interface Gated
    {
        told: Record<string, unknown>[];
        off: boolean;
        port: { onmessage: ((event: { data: unknown }) => void) | null };
    }

    let gates: Gated[] = [];
    let contexts: { state: string; allowed: boolean; closed: boolean }[] = [];
    let asked: MediaStreamConstraints[] = [];
    const processed = { processed: true, getAudioTracks: () => [{ contentHint: '' }], getTracks: () => [] } as unknown as MediaStream;

    const sound = (allowed: boolean, rate = 48_000) =>
    {
        gates = [];
        contexts = [];
        asked = [];

        vi.stubGlobal('AudioWorkletNode', class
        {
            public told: Record<string, unknown>[] = [];
            public off = false;
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
                this.off = true;
            }
        });
        vi.stubGlobal('AudioContext', class
        {
            public state = 'suspended';
            public sampleRate = rate;
            public allowed = allowed;
            public closed = false;
            public currentTime = 0;
            public onstatechange: (() => void) | null = null;
            public audioWorklet = { addModule: async () => undefined };

            constructor()
            {
                contexts.push(this);
            }

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
                if (this.allowed && this.state !== 'running')
                {
                    this.state = 'running';
                    this.onstatechange?.();
                }
            }

            public async close()
            {
                this.closed = true;
            }
        });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gate');
        vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
        setVoiceMedia(() => ({
            getUserMedia: async (constraints: MediaStreamConstraints) =>
            {
                asked.push(constraints);
                return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
            }
        }) as unknown as MediaDevices);
    };

    afterEach(() =>
    {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        setDenoiseKit(null);
    });

    const suppressor = (works = true) =>
    {
        const made: unknown[] = [];

        setDenoiseKit(async () =>
        {
            if (!works)
            {
                throw new Error('offline');
            }

            return {
                worklet: 'blob:suppressor',
                make: () =>
                {
                    const node = { connect: (next: unknown) => next, disconnect: () => undefined, destroy: () => undefined };

                    made.push(node);
                    return node as unknown as AudioNode & { destroy(): void };
                }
            };
        });

        return made;
    };

    const sameSource = () =>
    {
        const opened: { settings: MediaTrackConstraints; live: boolean }[] = [];

        setVoiceMedia(() => ({
            getUserMedia: async (constraints: MediaStreamConstraints) =>
            {
                asked.push(constraints);

                const open = opened.find((one) => one.live);
                const one = { settings: open?.settings ?? (constraints.audio as MediaTrackConstraints), live: true };
                const made = { kind: 'audio', contentHint: '', stop: () => (one.live = false), getSettings: () => one.settings };

                opened.push(one);
                return { getTracks: () => [made], getAudioTracks: () => [made] } as unknown as MediaStream;
            }
        }) as unknown as MediaDevices);

        return () => opened.filter((one) => one.live).map((one) => one.settings);
    };

    it('turns the browser’s own suppression off for strong suppression, which takes its place', async () =>
    {
        sound(true);

        const made = suppressor();

        useSettings().update({ voiceNoise: 'strong' });
        await useVoice().join(TABLE);
        await settle();

        expect(asked.at(-1)!.audio).toMatchObject({ noiseSuppression: false });
        expect(made).toHaveLength(1);
        expect(useVoice().suppression()).toBe('strong');
    });

    it('keeps the browser’s suppression where strong suppression cannot run', async () =>
    {
        sound(true, 44_100);
        suppressor();
        useSettings().update({ voiceNoise: 'strong' });

        await useVoice().join(TABLE);
        await settle();

        expect(asked).toHaveLength(1);
        expect(asked.at(-1)!.audio).toMatchObject({ noiseSuppression: true });
        expect(useVoice().suppression()).toBe('standard');
    });

    it('asks for the microphone again with the browser’s suppression when strong suppression will not load', async () =>
    {
        sound(true);
        suppressor(false);
        useSettings().update({ voiceNoise: 'strong' });

        await useVoice().join(TABLE);
        await settle();

        expect(asked.map((one) => (one.audio as MediaTrackConstraints).noiseSuppression)).toEqual([false, true]);
        expect(useVoice().suppression()).toBe('standard');
    });

    it('lets the first microphone go before it asks again, so the browser’s suppression is really on when strong suppression will not load', async () =>
    {
        sound(true);
        suppressor(false);

        const live = sameSource();

        useSettings().update({ voiceNoise: 'strong' });
        await useVoice().join(TABLE);
        await settle();

        expect(live(), 'asked again while the first was open, the browser handed back the first, with no suppression').toEqual([expect.objectContaining({ noiseSuppression: true })]);
        expect(useVoice().suppression()).toBe('standard');
    });

    it('tries strong suppression again in the next call when it would not load in the last one', async () =>
    {
        sound(true);
        suppressor(false);
        useSettings().update({ voiceNoise: 'strong' });

        await useVoice().join(TABLE);
        await settle();

        expect(useVoice().suppression()).toBe('standard');

        useVoice().leave();

        const made = suppressor();

        await useVoice().join(TABLE);
        await settle();

        expect(made, 'a model that failed once was never asked for again').toHaveLength(1);
        expect(useVoice().suppression()).toBe('strong');
        expect(asked.at(-1)!.audio).toMatchObject({ noiseSuppression: false });
    });

    it('says when nothing suppresses the noise because the reader turned it off', async () =>
    {
        sound(true);
        useSettings().update({ voiceNoise: 'off' });

        await useVoice().join(TABLE);
        await settle();

        expect(useVoice().suppression()).toBe('off');
    });

    it('asks the browser for the microphone the way the settings say', async () =>
    {
        sound(true);
        useSettings().update({ voiceEcho: false, voiceAgc: false, voiceNoise: 'off' });

        await useVoice().join(TABLE);

        expect(asked.at(-1)!.audio).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });

        useVoice().leave();
        useSettings().update({ voiceEcho: true, voiceAgc: true, voiceNoise: 'standard' });
        await useVoice().join(TABLE);

        expect(asked.at(-1)!.audio).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });
    });

    it('sends the prepared voice once the call\'s sound can run, and the microphone itself until then', async () =>
    {
        sound(false);

        await useVoice().join(TABLE);
        await settle();

        expect(calls[0].mic.at(-1), 'a voice that cannot run yet was sent, and would have been silence').not.toBe(processed);
        expect(calls[0].mic.at(-1)).not.toBeNull();

        contexts[0].allowed = true;
        window.dispatchEvent(new Event('pointerdown'));
        await settle();

        expect(calls[0].mic.at(-1)).toBe(processed);
    });

    it('holds the talk key in the gate, so the voice fades in and out instead of the microphone cutting', async () =>
    {
        sound(true);
        useSettings().update({ voicePushToTalk: true, voiceRelease: 250 });

        await useVoice().join(TABLE);
        await settle();

        expect(calls[0].muted.at(-1), 'the microphone itself was cut while the gate holds the key').toBe(false);
        expect(gates[0].told.at(-1)).toMatchObject({ push: true, pressed: false, linger: 250 });

        useVoice().press();

        expect(gates[0].told.at(-1)).toMatchObject({ push: true, pressed: true });

        useVoice().release();

        expect(gates[0].told.at(-1)).toMatchObject({ push: true, pressed: false });
        expect(calls[0].muted.at(-1)).toBe(false);
    });

    it('still cuts the microphone itself for the talk key where nothing can prepare the voice', async () =>
    {
        useSettings().update({ voicePushToTalk: true });

        await useVoice().join(TABLE);

        expect(calls[0].muted.at(-1)).toBe(true);

        useVoice().press();

        expect(calls[0].muted.at(-1)).toBe(false);
    });

    it('turns the voice up or moves the bar without asking for the microphone again', async () =>
    {
        sound(true);

        await useVoice().join(TABLE);
        await settle();

        useSettings().update({ voiceInput: 1.4, voiceAuto: false, voiceThreshold: -38 });
        useVoice().tune();

        expect(gates[0].told.at(-1)).toMatchObject({ auto: false, threshold: -38 });
        expect(asked).toHaveLength(1);
    });

    it('asks for the microphone again when what the browser does to it changes, and lets go of the old one', async () =>
    {
        sound(true);
        const stopped = vi.fn();
        const before = track.stop;

        track.stop = stopped;

        try
        {
            await useVoice().join(TABLE);
            await settle();

            useSettings().update({ voiceEcho: false });
            await useVoice().reprocess();
            await settle();
        }
        finally
        {
            track.stop = before;
        }

        expect(asked).toHaveLength(2);
        expect(asked.at(-1)!.audio).toMatchObject({ echoCancellation: false });
        expect(stopped).toHaveBeenCalled();
        expect(gates[0].off, 'the old voice was left running').toBe(true);
        expect(gates).toHaveLength(2);
        expect(calls[0].mic.at(-1)).toBe(processed);
    });

    it('lets the microphone go before it asks again in a call, so what the browser does to it really changes', async () =>
    {
        sound(true);

        const live = sameSource();

        await useVoice().join(TABLE);
        await settle();

        useSettings().update({ voiceEcho: false });
        await useVoice().reprocess();
        await settle();

        expect(live(), 'asked again while the old one was open, the change never reached the microphone').toEqual([expect.objectContaining({ echoCancellation: false })]);
        expect(calls[0].mic.at(-1)).toBe(processed);
    });

    it('says how loud the microphone is and where the bar stands, and nothing once the call is over', async () =>
    {
        sound(true);

        await useVoice().join(TABLE);
        await settle();

        gates[0].port.onmessage!({ data: { level: -31, open: true, threshold: -47 } });

        expect(useVoice().reading()).toEqual({ level: -31, open: true, threshold: -47 });

        useVoice().leave();

        expect(useVoice().reading()).toBeNull();
        expect(gates[0].off).toBe(true);
    });

    describe('a test of the microphone, away from any table', () =>
    {
        const played = () => [...document.body.querySelectorAll('audio')];

        beforeEach(() =>
        {
            const sources = new WeakMap<HTMLMediaElement, unknown>();

            vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(function (this: HTMLMediaElement, value: unknown)
            {
                sources.set(this, value);
            });
            vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'get').mockImplementation(function (this: HTMLMediaElement)
            {
                return (sources.get(this) ?? null) as MediaStream | null;
            });
        });

        afterEach(() =>
        {
            useVoice().stopTest();

            for (const one of played())
            {
                one.remove();
            }
        });

        it('plays the prepared voice back on the speaker the reader chose, and says how loud it is', async () =>
        {
            sound(true);
            useSettings().update({ voiceEcho: false, voiceAgc: true, voiceNoise: 'standard', voiceMic: 'usb-1', voiceSpeaker: 'headset-2' });

            await useVoice().startTest();

            expect(useVoice().testing()).toBe(true);
            expect(asked).toEqual([{ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1, deviceId: { ideal: 'usb-1' } } }]);
            expect(played()).toHaveLength(1);
            expect(played()[0].srcObject, 'what is played back is not the prepared voice').toBe(processed);
            expect(played()[0].sinkId).toBe('headset-2');
            expect(played()[0].hidden).toBe(true);
            expect(contexts[0].state, 'the test made no sound: its sound never ran').toBe('running');
            expect(useVoice().suppression()).toBe('standard');

            gates[0].port.onmessage!({ data: { level: -24, open: true, threshold: -52 } });

            expect(useVoice().reading()).toEqual({ level: -24, open: true, threshold: -52 });
        });

        it('lets the voice through in either input mode, and takes a change of level without asking for the microphone again', async () =>
        {
            sound(true);
            useSettings().update({ voicePushToTalk: true, voiceRelease: 300 });

            await useVoice().startTest();

            expect(gates[0].told.at(-1), 'the test waited for a talk key that only works at a table').toMatchObject({ push: false });

            useSettings().update({ voiceInput: 1.7, voiceAuto: false, voiceThreshold: -41 });
            useVoice().tune();

            expect(gates[0].told.at(-1)).toMatchObject({ push: false, auto: false, threshold: -41 });
            expect(asked).toHaveLength(1);
        });

        it('lets go of the microphone, the sound and the meter when it stops', async () =>
        {
            sound(true);
            const stopped = vi.fn();
            const before = track.stop;

            track.stop = stopped;

            try
            {
                await useVoice().startTest();
                gates[0].port.onmessage!({ data: { level: -30, open: true, threshold: -50 } });
                useVoice().stopTest();
            }
            finally
            {
                track.stop = before;
            }

            expect(useVoice().testing()).toBe(false);
            expect(stopped, 'the microphone was left open').toHaveBeenCalled();
            expect(gates[0].off).toBe(true);
            expect(played()).toHaveLength(0);
            expect(contexts[0].closed).toBe(true);
            expect(useVoice().reading()).toBeNull();
            expect(useVoice().suppression()).toBeNull();
        });

        it('says the browser would not give it the microphone, or that there is none, until the next test', async () =>
        {
            sound(true);
            setVoiceMedia(() => media('deny'));

            await useVoice().startTest();

            expect(useVoice().testing()).toBe(false);
            expect(useVoice().testFault()).toBe('denied');
            expect(contexts[0].closed).toBe(true);
            expect(played()).toHaveLength(0);

            setVoiceMedia(() => media('none'));
            await useVoice().startTest();

            expect(useVoice().testFault()).toBe('absent');

            setVoiceMedia(() => media('grant'));
            await useVoice().startTest();

            expect(useVoice().testFault(), 'a test that worked still said the last one could not start').toBeNull();
            expect(useVoice().testing()).toBe(true);

            setVoiceMedia(() => media('deny'));
            await useVoice().startTest();
            useVoice().stopTest();

            expect(useVoice().testFault(), 'a test the reader put away still said why it failed').toBeNull();
        });

        it('says the test could not start where the voice cannot be prepared, and lets go of the microphone', async () =>
        {
            sound(true);
            const stopped = vi.fn();
            const before = track.stop;

            vi.stubGlobal('AudioWorkletNode', class
            {
                constructor()
                {
                    throw new Error('no worklets here');
                }
            });
            track.stop = stopped;

            try
            {
                await useVoice().startTest();
            }
            finally
            {
                track.stop = before;
            }

            expect(useVoice().testFault()).toBe('failed');
            expect(useVoice().testing()).toBe(false);
            expect(stopped).toHaveBeenCalled();
            expect(contexts[0].closed).toBe(true);
        });

        it('runs strong suppression where it can, with the browser’s own off', async () =>
        {
            sound(true);

            const made = suppressor();

            useSettings().update({ voiceNoise: 'strong' });
            await useVoice().startTest();

            expect(asked.at(-1)!.audio).toMatchObject({ noiseSuppression: false });
            expect(made).toHaveLength(1);
            expect(useVoice().suppression()).toBe('strong');
        });

        it('asks for the microphone again with the browser’s suppression when strong suppression will not load', async () =>
        {
            sound(true);
            suppressor(false);
            useSettings().update({ voiceNoise: 'strong' });

            await useVoice().startTest();

            expect(asked.map((one) => (one.audio as MediaTrackConstraints).noiseSuppression), 'the test ran with no suppression at all').toEqual([false, true]);
            expect(useVoice().suppression()).toBe('standard');
            expect(played()).toHaveLength(1);
        });

        it('lets the first microphone go before it asks again, so a test whose strong suppression will not load has the browser’s', async () =>
        {
            sound(true);
            suppressor(false);

            const live = sameSource();

            useSettings().update({ voiceNoise: 'strong' });
            await useVoice().startTest();

            expect(live(), 'the test was handed the first microphone back, with no suppression').toEqual([expect.objectContaining({ noiseSuppression: true })]);
            expect(played()).toHaveLength(1);
        });

        it('stops a microphone that arrives after the test was put away, and plays nothing', async () =>
        {
            sound(true);

            const answers: ((value: MediaStream) => void)[] = [];
            const granted = { stopped: false };

            setVoiceMedia(() => ({
                getUserMedia: () => new Promise<MediaStream>((resolve) => answers.push(resolve))
            }) as unknown as MediaDevices);

            const going = useVoice().startTest();

            expect(useVoice().testing()).toBe(true);

            useVoice().stopTest();
            answers[0]({ getTracks: () => [{ stop: () => (granted.stopped = true) }], getAudioTracks: () => [] } as unknown as MediaStream);
            await going;

            expect(granted.stopped, 'a microphone granted after the test stopped was left open').toBe(true);
            expect(played()).toHaveLength(0);
            expect(useVoice().testing()).toBe(false);
            expect(contexts[0].closed).toBe(true);
        });

        it('keeps one test going when it is started twice', async () =>
        {
            sound(true);

            await useVoice().startTest();
            await useVoice().startTest();

            expect(played()).toHaveLength(1);
            expect(contexts.map((one) => one.closed)).toEqual([true, false]);
            expect(gates[0].off).toBe(true);
        });

        it('starts again when what the browser does to the microphone changes', async () =>
        {
            sound(true);

            await useVoice().startTest();
            useSettings().update({ voiceAgc: false });
            await useVoice().reprocess();

            expect(asked).toHaveLength(2);
            expect(asked.at(-1)!.audio).toMatchObject({ autoGainControl: false });
            expect(played()).toHaveLength(1);
            expect(useVoice().testing()).toBe(true);
        });

        it('tests the microphone the reader picks while it runs, and plays on the speaker they pick', async () =>
        {
            sound(true);

            await useVoice().startTest();
            await useVoice().useMic('usb-9');

            expect(asked.at(-1)!.audio).toMatchObject({ deviceId: { ideal: 'usb-9' } });
            expect(played()).toHaveLength(1);

            useVoice().useSpeaker('desk-3');
            await settle();

            expect(played()[0].sinkId).toBe('desk-3');
        });

        it('ends when the reader joins a call, and does not start during one', async () =>
        {
            sound(true);

            await useVoice().startTest();
            await useVoice().join(TABLE);
            await settle();

            expect(useVoice().testing()).toBe(false);
            expect(contexts[0].closed, 'the test kept its microphone open beside the call').toBe(true);
            expect(played()).toHaveLength(0);

            await useVoice().startTest();

            expect(useVoice().testing()).toBe(false);
            expect(asked, 'a test asked for a microphone in the middle of a call').toHaveLength(2);
        });
    });
});
