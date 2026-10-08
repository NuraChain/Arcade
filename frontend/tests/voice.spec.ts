import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { ClientFrame } from '../../backend/src/realtime/frames.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { VoiceCall, VoiceCallDeps, VoiceSignal } from '../src/services/voice.rtc.ts';
import { keyName } from '../src/lib/talk-key.ts';
import { IDLE_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { SPEAKING_HOLD_MS, UNREACHED_MS, setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

const TABLE = 'table-1';

interface FakeCall
{
    deps: VoiceCallDeps;
    synced: { mine: string; peers: { who: string; join: string }[] }[];
    received: { join: string; signal: VoiceSignal }[];
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
        sync: (mine, peers) =>
        {
            call.synced.push({ mine, peers: [...peers] });
        },
        receive: async (join, signal) =>
        {
            call.received.push({ join, signal });
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

        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex', muted: true, talk: true, join: 'j1' },
            { who: 'sara.k', muted: false, talk: true, join: 'j2' },
            { who: 'mina', muted: false, talk: false, join: 'j3' }
        ] });
        await settle();

        expect(calls[0].synced.at(-1)).toEqual({ mine: 'j1', peers: [{ who: 'sara.k', join: 'j2' }] });
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
            { who: 'alex.renamed', muted: true, talk: true, join: 'j1' },
            { who: 'sara.k', muted: false, talk: true, join: 'j2' }
        ] });
        await settle();

        expect(calls[0].synced.at(-1)).toEqual({ mine: 'j1', peers: [{ who: 'sara.k', join: 'j2' }] });
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
            { who: 'alex', muted: false, talk: true, join: 'j1' },
            { who: 'sara.k', muted: false, talk: true, join: 'j2' }
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

        expect(voiceFrames()).toEqual([{ t: 'voice', table: TABLE, on: true, muted: true }]);
    });

    const room = async () =>
    {
        socket.deliver({ v: 1, t: 'voice', n: 3, table: TABLE, joined: true, mine: 'j1', peers: [
            { who: 'alex', muted: false, talk: true, join: 'j1' },
            { who: 'sara.k', muted: false, talk: true, join: 'j2' }
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
                { who: 'alex', muted: true, talk: true, join: 'join-alex' },
                { who: 'sara.k', muted: false, talk: true, join: 'join-sara' }
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
                { who: 'alex', muted: true, talk: true, join: 'join-alex' },
                { who: 'sara.k', muted: false, talk: true, join: 'join-sara' }
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
