import { describe, it, expect, vi } from 'vitest';

import type { Codec, RelayKit } from '../src/services/voice.relay.ts';
import { WATCH_MS, createVoiceCall, patienceFor, type PeerLink, type VoiceJoin, type VoiceSignal } from '../src/services/voice.rtc.ts';

interface Line
{
    direction: string;
    mid: string | null;
    sender: { track: MediaStreamTrack | null; replaceTrack(track: MediaStreamTrack | null): Promise<void> };
    receiver: { track: { kind: string } };
}

const microphone = { enabled: true } as unknown as MediaStreamTrack;

const stream = { getAudioTracks: () => [microphone] } as unknown as MediaStream;

const said = (type: 'offer' | 'answer', sdp = `their-${ type }`): VoiceSignal => ({ kind: type, data: JSON.stringify({ type, sdp }) });

function fakeConnection()
{
    const lines: Line[] = [];
    const applied: RTCSessionDescriptionInit[] = [];
    let local: RTCSessionDescriptionInit | null = null;
    let made = 0;
    let gate: Promise<void> | null = null;
    let open: (() => void) | null = null;

    const line = (direction: string) =>
    {
        const sender: Line['sender'] = {
            track: null,
            replaceTrack: async (track) =>
            {
                sender.track = track;
            }
        };
        const one: Line = { direction, mid: null, sender, receiver: { track: { kind: 'audio' } } };

        lines.push(one);

        return one;
    };

    const stats: Record<string, unknown>[] = [];

    const connection = {
        signalingState: 'stable',
        connectionState: 'new',
        closed: false,
        restarts: 0,
        lines,
        applied,
        stats,

        getStats: async () => new Map(stats.map((one, index) => [String(index), one])),
        onnegotiationneeded: null as (() => Promise<void>) | null,
        onicecandidate: null as ((event: { candidate: unknown }) => void) | null,
        onconnectionstatechange: null as (() => void) | null,
        ontrack: null,

        get localDescription()
        {
            return local;
        },

        addTransceiver: (_kind: string, init: { direction: string }) => line(init.direction),

        getTransceivers: () => lines,

        async setLocalDescription()
        {
            if (connection.closed)
            {
                throw new Error('closed');
            }

            made += 1;
            local = connection.signalingState === 'have-remote-offer'
                ? { type: 'answer', sdp: `answer-${ made }` }
                : { type: 'offer', sdp: `offer-${ made }` };
            connection.signalingState = local.type === 'answer' ? 'stable' : 'have-local-offer';

            for (const one of lines)
            {
                one.mid ??= String(lines.filter((other) => other.mid !== null).length);
            }
        },

        async setRemoteDescription(description: RTCSessionDescriptionInit)
        {
            if (gate !== null)
            {
                await gate;
            }

            if (connection.closed)
            {
                throw new Error('closed');
            }

            applied.push(description);

            if (description.type === 'answer')
            {
                connection.signalingState = 'stable';
                return;
            }

            if (!lines.some((one) => one.mid === '0'))
            {
                line('recvonly').mid = '0';
            }

            connection.signalingState = 'have-remote-offer';
        },

        iced: [] as unknown[],

        addIceCandidate: async (candidate: unknown) =>
        {
            connection.iced.push(candidate);
        },

        restartIce()
        {
            connection.restarts += 1;
        },

        close()
        {
            connection.closed = true;
        },

        hold()
        {
            gate = new Promise<void>((resolve) =>
            {
                open = resolve;
            });
        },

        release()
        {
            open?.();
            gate = null;
        },

        becomes(state: string)
        {
            connection.connectionState = state;
            connection.onconnectionstatechange?.();
        }
    };

    return connection;
}

function side(handle: string, own: string, context?: AudioContext)
{
    const connections: ReturnType<typeof fakeConnection>[] = [];
    const sent: { to: string; join: string; signal: VoiceSignal }[] = [];
    const links: [string, PeerLink | null][] = [];
    const levels: [string, number][] = [];
    const named = { handle };

    const call = createVoiceCall({
        me: () => named.handle,
        iceServers: [],
        send: (to, join, signal) => sent.push({ to, join, signal }),
        onLink: (who, link) => links.push([who, link]),
        onLevel: (who, level) => levels.push([who, level]),
        ...(context === undefined ? {} : { context: () => context }),
        connect: () =>
        {
            const made = fakeConnection();

            connections.push(made);

            return made as unknown as RTCPeerConnection;
        }
    });

    return {
        call,
        connections,
        sent,
        links,
        levels,
        named,

        sees(...peers: VoiceJoin[])
        {
            call.sync(own, peers);
        },

        get connection()
        {
            return connections[connections.length - 1];
        }
    };
}

const MINA = { who: 'mina', join: 'm1', opus: false };

const DANA = { who: 'dana', join: 'd1', opus: false };

const asking = () => side('dana', 'd1');

const waiting = () => side('mina', 'm1');

interface Node
{
    kind: string;
    into: Node[];
    off: boolean;
    gain?: { value: number };
    stream?: unknown;
}

function fakeContext()
{
    const nodes: Node[] = [];
    const node = (kind: string, extra: Partial<Node> = {}) =>
    {
        const one: Node & { connect(next: Node): Node; disconnect(): void; getFloatTimeDomainData(): void; fftSize: number } = {
            kind,
            into: [],
            off: false,
            fftSize: 0,
            ...extra,
            connect(next)
            {
                one.into.push(next);
                return next;
            },
            disconnect()
            {
                one.off = true;
            },
            getFloatTimeDomainData: () => undefined
        };

        nodes.push(one);
        return one;
    };

    const context = {
        nodes,
        createMediaStreamSource: (stream: unknown) => node('source', { stream }),
        createGain: () => node('gain', { gain: { value: 1 } }),
        createMediaStreamDestination: () => node('out', { stream: { boosted: true } }),
        createAnalyser: () => node('analyser')
    };

    return context;
}

describe('how loud one person is heard', () =>
{
    const SOUND = { heard: 'mina' };

    const heard = (context?: ReturnType<typeof fakeContext>) =>
    {
        const asks = side('dana', 'd1', context as unknown as AudioContext | undefined);
        const sources = new Map<HTMLMediaElement, unknown>();
        const played = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
        const carried = vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(function (this: HTMLMediaElement, value: unknown)
        {
            sources.set(this, value);
        });

        asks.sees(MINA);

        const arrive = () => (asks.connection.ontrack as unknown as (event: { track: unknown; streams: unknown[] }) => void)({ track: {}, streams: [SOUND] });
        const players = () => [...document.body.querySelectorAll('audio')];

        return { asks, sources, arrive, players, done: () =>
        {
            asks.call.close();
            played.mockRestore();
            carried.mockRestore();
        } };
    };

    it('plays somebody at their volume on the element itself while they are no louder than full', () =>
    {
        const context = fakeContext();
        const one = heard(context);

        try
        {
            one.arrive();
            one.asks.call.setVolume('mina', 0.5);

            expect(one.players()).toHaveLength(1);
            expect(one.players()[0].volume).toBeCloseTo(0.5);
            expect(one.sources.get(one.players()[0])).toBe(SOUND);
            expect(context.nodes.filter((node) => node.kind === 'gain'), 'a gain was built for somebody turned down').toHaveLength(0);
        }
        finally
        {
            one.done();
        }
    });

    it('turns somebody above full through a gain, keeps the sound flowing beside it, and goes back to the element below it', () =>
    {
        const context = fakeContext();
        const one = heard(context);

        try
        {
            one.arrive();
            one.asks.call.setVolume('mina', 1.6);

            const gain = context.nodes.find((node) => node.kind === 'gain')!;
            const out = context.nodes.find((node) => node.kind === 'out')!;
            const [speaker, hold] = one.players();

            expect(gain.gain!.value).toBeCloseTo(1.6);
            expect(context.nodes.some((node) => node.kind === 'source' && node.stream === SOUND && node.into.includes(gain)), 'the gain is not fed her sound').toBe(true);
            expect(gain.into).toContain(out);
            expect(one.sources.get(speaker), 'what is heard is not the turned-up sound').toBe(out.stream);
            expect(speaker.volume).toBe(1);
            expect(hold.muted, 'the sound kept flowing for the gain was heard as well').toBe(true);
            expect(one.sources.get(hold)).toBe(SOUND);

            one.asks.call.setVolume('mina', 0.8);

            expect(one.players(), 'the element that kept the sound flowing was left behind').toHaveLength(1);
            expect(one.sources.get(one.players()[0])).toBe(SOUND);
            expect(one.players()[0].volume).toBeCloseTo(0.8);
            expect(gain.off).toBe(true);
        }
        finally
        {
            one.done();
        }
    });

    it('plays somebody turned above full before their sound arrived at that volume when it comes', () =>
    {
        const context = fakeContext();
        const one = heard(context);

        try
        {
            one.asks.call.setVolume('mina', 2);
            one.arrive();

            expect(context.nodes.find((node) => node.kind === 'gain')?.gain?.value).toBe(2);
            expect(one.sources.get(one.players()[0])).toBe(context.nodes.find((node) => node.kind === 'out')!.stream);
        }
        finally
        {
            one.done();
        }
    });

    it('leaves nothing playing when somebody turned above full hangs up', () =>
    {
        const context = fakeContext();
        const one = heard(context);

        try
        {
            one.arrive();
            one.asks.call.setVolume('mina', 1.5);
            one.asks.sees();

            expect(one.players()).toHaveLength(0);
            expect(context.nodes.filter((node) => node.kind !== 'analyser').every((node) => node.off || node.kind === 'out')).toBe(true);
        }
        finally
        {
            one.done();
        }
    });

    it('plays somebody at full, and no louder, where there is nothing to turn them up with', () =>
    {
        const one = heard();

        try
        {
            one.arrive();
            one.asks.call.setVolume('mina', 1.7);

            expect(one.players()).toHaveLength(1);
            expect(one.players()[0].volume).toBe(1);
            expect(one.sources.get(one.players()[0])).toBe(SOUND);
        }
        finally
        {
            one.done();
        }
    });
});

describe('a call between two players', () =>
{
    it('is placed by one of them: the joining whose name sorts first asks, and the other brings nothing until it is asked', async () =>
    {
        const asks = asking();
        const waits = waiting();

        asks.sees(MINA);
        waits.sees(DANA);

        expect(asks.connection.lines.map((one) => one.direction)).toEqual(['sendrecv']);
        expect(waits.connection.lines).toEqual([]);

        await asks.connection.onnegotiationneeded?.();

        expect(asks.sent.map((one) => [one.to, one.join, one.signal.kind])).toEqual([['mina', 'm1', 'offer']]);
        expect(waits.sent).toEqual([]);
    });

    it('decides who asks from the two joinings and not from the two handles', async () =>
    {
        const first = side('zed', 'a1');
        const second = side('abe', 'b1');

        first.sees({ who: 'abe', join: 'b1', opus: false });
        second.sees({ who: 'zed', join: 'a1', opus: false });

        expect(first.connection.lines.length).toBe(1);
        expect(second.connection.lines.length).toBe(0);
    });

    it('is answered on the line that was offered, with the answering microphone already on it', async () =>
    {
        const waits = waiting();

        await waits.call.setMic(stream);
        waits.sees(DANA);
        await waits.call.receive('d1', said('offer'));

        expect(waits.connection.lines.map((one) => [one.mid, one.direction, one.sender.track])).toEqual([['0', 'sendrecv', microphone]]);
        expect(waits.sent.map((one) => [one.to, one.join, one.signal.kind, JSON.parse(one.signal.data).type])).toEqual([['dana', 'd1', 'answer', 'answer']]);
    });

    it('lets a signal fall when the roster has not named the joining it comes from', async () =>
    {
        const waits = waiting();

        await waits.call.receive('d1', said('offer'));

        expect(waits.connections).toEqual([]);
        expect(waits.links).toEqual([]);
        expect(waits.sent).toEqual([]);
    });

    it('puts a microphone that is granted later on the line each side already holds', async () =>
    {
        const asks = asking();
        const waits = waiting();

        asks.sees(MINA);
        waits.sees(DANA);
        await waits.call.receive('d1', said('offer'));

        await asks.call.setMic(stream);
        await waits.call.setMic(stream);

        expect(asks.connection.lines[0].sender.track).toBe(microphone);
        expect(waits.connection.lines[0].sender.track).toBe(microphone);
    });

    it('takes an offer that arrives while the answer before it is still being applied', async () =>
    {
        const asks = asking();

        asks.sees(MINA);
        await asks.connection.onnegotiationneeded?.();

        asks.connection.hold();

        const answered = asks.call.receive('m1', said('answer'));
        const offered = asks.call.receive('m1', said('offer'));

        asks.connection.release();
        await Promise.all([answered, offered]);

        expect(asks.connection.applied.map((one) => one.type)).toEqual(['answer', 'offer']);
        expect(asks.sent.map((one) => one.signal.kind)).toEqual(['offer', 'answer']);
        expect(asks.links).toEqual([['mina', 'connecting']]);
    });

    it('lets the asking side keep its own offer when two cross, and the waiting side give its own up', async () =>
    {
        const asks = asking();
        const waits = waiting();

        asks.sees(MINA);
        await asks.connection.onnegotiationneeded?.();
        await asks.call.receive('m1', said('offer'));

        expect(asks.connection.applied).toEqual([]);
        expect(asks.sent.map((one) => one.signal.kind)).toEqual(['offer']);

        waits.sees(DANA);
        await waits.call.receive('d1', said('offer'));
        await waits.connection.onnegotiationneeded?.();
        await waits.call.receive('d1', said('offer', 'their-second-offer'));

        expect(waits.connection.applied.map((one) => one.sdp)).toEqual(['their-offer', 'their-second-offer']);
        expect(waits.sent.map((one) => one.signal.kind)).toEqual(['answer', 'offer', 'answer']);
    });

    it('leaves the restart of a failed connection to the side that called', async () =>
    {
        const asks = asking();
        const waits = waiting();

        asks.sees(MINA);
        waits.sees(DANA);
        asks.connection.becomes('failed');
        waits.connection.becomes('failed');

        expect([asks.connection.restarts, waits.connection.restarts]).toEqual([1, 0]);
        expect(asks.links.at(-1)).toEqual(['mina', 'failed']);
        expect(waits.links.at(-1)).toEqual(['dana', 'failed']);
    });

    it('sends each candidate to the joining it was gathered for', async () =>
    {
        const asks = asking();

        asks.sees(MINA);
        asks.connection.onicecandidate?.({ candidate: { candidate: 'first' } });
        asks.sees({ who: 'mina', join: 'm2', opus: false });
        asks.connection.onicecandidate?.({ candidate: { candidate: 'second' } });
        asks.connection.onicecandidate?.({ candidate: null });

        expect(asks.sent.map((one) => [one.to, one.join, one.signal.kind, JSON.parse(one.signal.data).candidate])).toEqual([
            ['mina', 'm1', 'ice', 'first'],
            ['mina', 'm2', 'ice', 'second']
        ]);
    });

    it('hangs up on somebody who is no longer in the room, and says the link is gone', () =>
    {
        const asks = asking();

        asks.sees(MINA);
        asks.sees();

        expect(asks.connection.closed).toBe(true);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null]]);
    });

    it('calls somebody again when they come back as a new joining, and keeps the line to somebody who never left', async () =>
    {
        const asks = asking();

        asks.sees(MINA);
        asks.sees(MINA);

        expect(asks.connections.length).toBe(1);

        asks.sees({ who: 'mina', join: 'm2', opus: false });

        expect(asks.connections.map((one) => one.closed)).toEqual([true, false]);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null], ['mina', 'connecting']]);

        await asks.connection.onnegotiationneeded?.();

        expect(asks.sent.map((one) => [one.to, one.join, one.signal.kind])).toEqual([['mina', 'm2', 'offer']]);
    });

    it('waits again for somebody who comes back, on a line of its own', async () =>
    {
        const waits = waiting();

        waits.sees(DANA);
        await waits.call.receive('d1', said('offer'));
        waits.sees({ who: 'dana', join: 'd2', opus: false });

        expect(waits.connections.map((one) => [one.closed, one.lines.length])).toEqual([[true, 1], [false, 0]]);

        await waits.call.receive('d2', said('offer'));

        expect(waits.connection.lines.map((one) => one.direction)).toEqual(['sendrecv']);
        expect(waits.sent.map((one) => [one.join, one.signal.kind])).toEqual([['d1', 'answer'], ['d2', 'answer']]);
    });

    it('hangs up on everybody and starts over when its own joining is a new one', async () =>
    {
        const asks = asking();

        asks.sees(MINA);
        asks.call.sync('d9', [MINA]);

        expect(asks.connections.map((one) => one.closed)).toEqual([true, false]);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null], ['mina', 'connecting']]);
    });

    it('keeps the line to somebody who changes their name, and says the link under the new one', async () =>
    {
        const asks = asking();

        asks.sees(MINA);
        asks.connection.becomes('connected');
        asks.sees({ who: 'nina', join: 'm1', opus: false });

        expect(asks.connections.map((one) => one.closed)).toEqual([false]);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', 'connected'], ['mina', null], ['nina', 'connected']]);

        asks.connection.onicecandidate?.({ candidate: { candidate: 'late' } });

        expect(asks.sent.map((one) => [one.to, one.join])).toEqual([['nina', 'm1']]);
    });

    it('says its own level under the handle it has now', () =>
    {
        const asks = asking();

        asks.call.setMuted(true);
        asks.named.handle = 'dana.again';
        asks.call.setMuted(true);

        expect(asks.levels).toEqual([['dana', 0], ['dana.again', 0]]);
    });

    it('does not let a connection it has hung up speak for the one that replaced it', async () =>
    {
        const asks = asking();

        asks.sees(MINA);
        await asks.connection.onnegotiationneeded?.();

        const first = asks.connection;

        first.hold();

        const answered = asks.call.receive('m1', said('answer'));

        asks.sees({ who: 'mina', join: 'm2', opus: false });
        first.release();
        await answered;

        expect(asks.connections.map((one) => one.closed)).toEqual([true, false]);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null], ['mina', 'connecting']]);
    });

    it('starts a voice the browser would not play by itself at the next press, and stops trying once the call is over', async () =>
    {
        const played = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () =>
        {
            throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
        });
        const carried = vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(() => undefined);

        try
        {
            const asks = asking();

            asks.sees(MINA);
            (asks.connection.ontrack as unknown as (event: { track: unknown; streams: unknown[] }) => void)({ track: {}, streams: [{}] });
            await Promise.resolve();

            expect(played).toHaveBeenCalledTimes(1);

            window.dispatchEvent(new Event('pointerdown'));
            expect(played, 'a voice the browser held back was left silent after a press').toHaveBeenCalledTimes(2);

            window.dispatchEvent(new Event('keydown'));
            expect(played).toHaveBeenCalledTimes(3);

            asks.call.close();
            window.dispatchEvent(new Event('pointerdown'));
            expect(played, 'a call that is over went on listening for presses').toHaveBeenCalledTimes(3);
        }
        finally
        {
            played.mockRestore();
            carried.mockRestore();
        }
    });

    it('lets a signal from a joining it has hung up on fall', async () =>
    {
        const waits = waiting();

        waits.sees({ who: 'dana', join: 'd2', opus: false });
        await waits.call.receive('d1', said('offer'));

        expect(waits.connections.length).toBe(1);
        expect(waits.connection.applied).toEqual([]);
        expect(waits.sent).toEqual([]);
    });
});

interface Carried
{
    stream: { carried: number };
    took: [Codec, number, string][];
    closed: boolean;
}

function carried(options: { relay?: boolean; context?: boolean; opus?: boolean } = {})
{
    const targets: { join: string; opus: boolean }[][] = [];
    const tracks: (MediaStreamTrack | null)[] = [];
    const mutes: boolean[] = [];
    const speaks: boolean[] = [];
    const inbound: Carried[] = [];
    const sounds: { to: string[]; codec: Codec; at: number; data: string }[] = [];
    const links: [string, PeerLink | null][] = [];
    const connections: ReturnType<typeof fakeConnection>[] = [];
    const timers: { ms: number; run: () => void; off: boolean }[] = [];
    const sources = new Map<HTMLMediaElement, unknown>();
    const context = fakeContext();
    let closed = 0;

    const kit = (): RelayKit => ({
        outbound(send, opus)
        {
            speaks.push(opus);
            send(['probe'], 'law', 0, 'AA==');

            return {
                to: (next) =>
                {
                    targets.push(next.map((one) => ({ ...one })));
                },
                setTrack: (track) =>
                {
                    tracks.push(track);
                },
                setMuted: (muted) =>
                {
                    mutes.push(muted);
                },
                close: () =>
                {
                    closed += 1;
                }
            };
        },
        inbound()
        {
            const one: Carried = { stream: { carried: inbound.length }, took: [], closed: false };

            inbound.push(one);

            return {
                stream: one.stream as unknown as MediaStream,
                take: (codec, at, data) =>
                {
                    one.took.push([codec, at, data]);
                },
                close: () =>
                {
                    one.closed = true;
                }
            };
        }
    });

    const played = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
    const carriedTo = vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(function (this: HTMLMediaElement, value: unknown)
    {
        sources.set(this, value);
    });

    const call = createVoiceCall({
        me: () => 'dana',
        iceServers: [],
        send: () => undefined,
        onLink: (who, link) => links.push([who, link]),
        onLevel: () => undefined,
        context: () => (options.context === false ? null : context as unknown as AudioContext),
        ...(options.relay === false ? {} : { relay: (to: string[], codec: Codec, at: number, data: string) => sounds.push({ to, codec, at, data }) }),
        opus: options.opus ?? true,
        kit,
        rtt: () => 120,
        after: (ms, run) =>
        {
            const timer = { ms, run, off: false };

            timers.push(timer);

            return () =>
            {
                timer.off = true;
            };
        },
        connect: () =>
        {
            const made = fakeConnection();

            connections.push(made);

            return made as unknown as RTCPeerConnection;
        }
    });

    return {
        call,
        targets,
        tracks,
        mutes,
        speaks,
        inbound,
        sounds,
        links,
        connections,
        timers,
        sources,
        closed: () => closed,

        sees(...peers: VoiceJoin[])
        {
            call.sync('d1', peers);
        },

        async lapse()
        {
            for (const timer of timers.splice(0))
            {
                if (!timer.off)
                {
                    timer.run();
                }
            }

            for (let index = 0; index < 6; index += 1)
            {
                await Promise.resolve();
            }
        },

        arrive(sound: unknown)
        {
            (connections.at(-1)!.ontrack as unknown as (event: { track: unknown; streams: unknown[] }) => void)({ track: {}, streams: [sound] });
        },

        heard: () => sources.get(document.body.querySelector('audio')!),

        done()
        {
            call.close();
            played.mockRestore();
            carriedTo.mockRestore();
        },

        get connection()
        {
            return connections[connections.length - 1];
        }
    };
}

const MINA_OPUS = { who: 'mina', join: 'm1', opus: true };

describe('a call the server carries from its first moment', () =>
{
    it('carries the call at once, counts it connected, and tries a line beside it for as long as the measured round trip says', async () =>
    {
        const one = carried();

        try
        {
            await one.call.setMic(stream);
            one.sees(MINA_OPUS);

            expect(one.targets.at(-1), 'the call waited for a line before it was carried').toEqual([{ join: 'm1', opus: true }]);
            expect(one.speaks).toEqual([true]);
            expect(one.tracks).toEqual([microphone]);
            expect(one.mutes).toEqual([true]);
            expect(one.sounds).toEqual([{ to: ['probe'], codec: 'law', at: 0, data: 'AA==' }]);
            expect(one.links).toEqual([['mina', 'connected']]);
            expect(one.connection.closed, 'the line was not tried beside the server').toBe(false);
            expect(one.timers.map((timer) => timer.ms)).toEqual([patienceFor(120)]);

            await one.lapse();

            expect(one.connection.closed, 'a line that never connected was left trying').toBe(true);
            expect(one.targets.at(-1)).toEqual([{ join: 'm1', opus: true }]);
            expect(one.links.at(-1)).toEqual(['mina', 'connected']);
        }
        finally
        {
            one.done();
        }
    });

    it('gives a line longer on a slower network, and a guess when nothing has been measured', async () =>
    {
        expect(patienceFor(null)).toBe(5000);
        expect(patienceFor(40)).toBe(3000);
        expect(patienceFor(300)).toBe(8000);
        expect(patienceFor(2000)).toBe(15_000);
    });

    it('moves to the line once its packets arrive, and stops carrying once the other end says it hears the line', async () =>
    {
        const one = carried();
        const LINE = { line: true };

        try
        {
            one.sees(MINA_OPUS);
            one.arrive(LINE);
            one.call.heard('m1', 'law', 0, 'AQID');

            expect(one.heard(), 'what the server carried was not what was heard').toBe(one.inbound[0].stream);

            one.connection.becomes('connected');
            await one.lapse();

            expect(one.heard(), 'the line was heard before anything came over it').toBe(one.inbound[0].stream);
            expect(one.timers.map((timer) => timer.ms)).toEqual([WATCH_MS]);

            one.connection.stats.push({ type: 'inbound-rtp', kind: 'audio', packetsReceived: 12 });
            await one.lapse();

            expect(one.heard(), 'the line was not heard once its packets came').toBe(LINE);
            expect(one.targets.at(-1), 'the server stopped carrying before the other end heard the line').toEqual([{ join: 'm1', opus: true }]);

            one.connection.stats.push({ type: 'remote-inbound-rtp', kind: 'audio' });
            await one.lapse();

            expect(one.targets.at(-1)).toEqual([]);
            expect(one.timers, 'the line was still watched once it carried the call both ways').toEqual([]);
            expect(one.connection.closed).toBe(false);
            expect(one.links.at(-1)).toEqual(['mina', 'connected']);
        }
        finally
        {
            one.done();
        }
    });

    it('goes back to the server at once when the line drops, and hangs the line up when it does not come back in time', async () =>
    {
        const one = carried();
        const LINE = { line: true };

        try
        {
            one.sees(MINA_OPUS);
            one.arrive(LINE);
            one.call.heard('m1', 'law', 0, 'AQID');
            one.connection.becomes('connected');
            one.connection.stats.push({ type: 'inbound-rtp', kind: 'audio', packetsReceived: 12 }, { type: 'remote-inbound-rtp', kind: 'audio' });
            await one.lapse();

            expect(one.heard()).toBe(LINE);
            expect(one.targets.at(-1)).toEqual([]);

            one.connection.becomes('disconnected');

            expect(one.targets.at(-1), 'the server did not carry the call the moment its line dropped').toEqual([{ join: 'm1', opus: true }]);
            expect(one.heard()).toBe(one.inbound[0].stream);
            expect(one.links.at(-1)).toEqual(['mina', 'connected']);

            await one.lapse();

            expect(one.connection.closed).toBe(true);
            expect(one.targets.at(-1)).toEqual([{ join: 'm1', opus: true }]);
        }
        finally
        {
            one.done();
        }
    });

    it('moves back to a line that comes back before it is hung up', async () =>
    {
        const one = carried();
        const LINE = { line: true };

        try
        {
            one.sees(MINA_OPUS);
            one.arrive(LINE);
            one.call.heard('m1', 'law', 0, 'AQID');
            one.connection.becomes('connected');
            one.connection.stats.push({ type: 'inbound-rtp', kind: 'audio', packetsReceived: 12 }, { type: 'remote-inbound-rtp', kind: 'audio' });
            await one.lapse();
            one.connection.becomes('disconnected');
            one.connection.becomes('connected');
            await one.lapse();

            expect(one.connection.closed).toBe(false);
            expect(one.heard()).toBe(LINE);
            expect(one.targets.at(-1)).toEqual([]);
        }
        finally
        {
            one.done();
        }
    });

    it('hangs up a line that fails and keeps the call carried, without trying the line again', async () =>
    {
        const one = carried();

        try
        {
            one.sees(MINA_OPUS);
            one.connection.becomes('failed');

            expect(one.targets.at(-1)).toEqual([{ join: 'm1', opus: true }]);
            expect(one.links.at(-1)).toEqual(['mina', 'connected']);
            expect(one.connection.restarts, 'a line the server carries for was tried again').toBe(0);
            expect(one.connection.closed).toBe(true);
            expect(one.timers.every((timer) => timer.off), 'the line was still given time after it failed').toBe(true);

            one.connection.becomes('connecting');

            expect(one.links.at(-1), 'a carried call read as connecting when its old line spoke').toEqual(['mina', 'connected']);
        }
        finally
        {
            one.done();
        }
    });

    it('lets sound fall from a joining it does not know', async () =>
    {
        const one = carried();

        try
        {
            one.sees(MINA_OPUS);
            one.call.heard('x9', 'law', 0, 'AQID');

            expect(one.inbound).toEqual([]);
            expect(one.targets.flat().map((target) => target.join)).not.toContain('x9');
        }
        finally
        {
            one.done();
        }
    });

    it('takes no signal for a line it has hung up, and calls nothing failed that the hanging up cut short', async () =>
    {
        const one = carried();

        try
        {
            one.sees(MINA_OPUS);
            one.connection.hold();

            const answered = one.call.receive('m1', said('answer'));

            await one.lapse();
            one.connection.release();
            await answered;
            await one.connection.onnegotiationneeded?.();
            await one.call.receive('m1', said('offer'));
            await one.call.receive('m1', { kind: 'ice', data: JSON.stringify({ candidate: 'late' }) });

            expect(one.connection.applied, 'a signal reached a line that was hung up').toEqual([]);
            expect(one.connection.iced, 'a candidate reached a line that was hung up').toEqual([]);
            expect(one.links.at(-1)).toEqual(['mina', 'connected']);
        }
        finally
        {
            one.done();
        }
    });

    it('speaks Opus to somebody only while the roster says they can hear it', async () =>
    {
        const one = carried();

        try
        {
            one.sees(MINA_OPUS);
            one.sees({ ...MINA_OPUS, opus: false });

            expect(one.targets.map((targets) => targets.map((target) => target.opus))).toEqual([[true], [false]]);
        }
        finally
        {
            one.done();
        }
    });

    it('hands what carries the call the microphone it has and whether it is muted', async () =>
    {
        const one = carried();

        try
        {
            one.sees(MINA_OPUS);
            one.call.setMuted(false);
            await one.call.setMic(stream);

            expect(one.mutes.at(-1)).toBe(false);
            expect(one.tracks.at(-1), 'a microphone granted during the call was not carried').toBe(microphone);

            await one.call.setMic(null);

            expect(one.tracks.at(-1)).toBeNull();
        }
        finally
        {
            one.done();
        }
    });

    it('stops carrying and hearing somebody who leaves, and closes what carried the call with the call', async () =>
    {
        const one = carried();

        try
        {
            one.sees(MINA_OPUS, { who: 'sara', join: 's1', opus: false });
            one.call.heard('m1', 'law', 0, 'AQID');

            expect(one.targets.at(-1)).toEqual([{ join: 'm1', opus: true }, { join: 's1', opus: false }]);

            one.sees({ who: 'sara', join: 's1', opus: false });

            expect(one.inbound[0].closed).toBe(true);
            expect(one.targets.at(-1)).toEqual([{ join: 's1', opus: false }]);

            one.call.close();

            expect(one.closed()).toBe(1);
        }
        finally
        {
            one.done();
        }
    });

    it('waits for the line as it always did where nothing can carry the call', async () =>
    {
        for (const options of [{ relay: false }, { context: false }])
        {
            const one = carried(options);

            try
            {
                one.sees(MINA_OPUS);
                await one.lapse();
                one.call.heard('m1', 'law', 0, 'AQID');

                expect(one.targets).toEqual([]);
                expect(one.inbound).toEqual([]);
                expect(one.links.at(-1)).toEqual(['mina', 'connecting']);
                expect(one.timers, 'a line that is the only way was given a time to give up').toEqual([]);

                one.connection.becomes('failed');

                expect(one.links.at(-1)).toEqual(['mina', 'failed']);
                expect(one.connection.restarts).toBe(1);
                expect(one.connection.closed).toBe(false);
            }
            finally
            {
                one.done();
            }
        }
    });
});
