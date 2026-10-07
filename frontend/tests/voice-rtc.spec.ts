import { describe, it, expect } from 'vitest';

import { createVoiceCall, type PeerLink, type VoiceSignal } from '../src/services/voice.rtc.ts';

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

    const connection = {
        signalingState: 'stable',
        connectionState: 'new',
        closed: false,
        restarts: 0,
        lines,
        applied,
        onnegotiationneeded: null as (() => Promise<void>) | null,
        onicecandidate: null,
        onconnectionstatechange: null,
        ontrack: null,

        get localDescription()
        {
            return local;
        },

        addTransceiver: (_kind: string, init: { direction: string }) => line(init.direction),

        getTransceivers: () => lines,

        async setLocalDescription()
        {
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

        addIceCandidate: async () => undefined,

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
        }
    };

    return connection;
}

function side(me: string)
{
    const connection = fakeConnection();
    const sent: { to: string; signal: VoiceSignal }[] = [];
    const links: [string, PeerLink | null][] = [];

    const call = createVoiceCall({
        me,
        iceServers: [],
        send: (to, signal) => sent.push({ to, signal }),
        onLink: (who, link) => links.push([who, link]),
        onLevel: () => undefined,
        connect: () => connection as unknown as RTCPeerConnection
    });

    return { call, connection, sent, links };
}

describe('a call between two players', () =>
{
    it('is placed by one of them: the handle that sorts first asks, and the other brings nothing until it is asked', async () =>
    {
        const asks = side('dana');
        const waits = side('mina');

        asks.call.sync(['mina']);
        waits.call.sync(['dana']);

        expect(asks.connection.lines.map((one) => one.direction)).toEqual(['sendrecv']);
        expect(waits.connection.lines).toEqual([]);

        await asks.connection.onnegotiationneeded?.();

        expect(asks.sent.map((one) => [one.to, one.signal.kind])).toEqual([['mina', 'offer']]);
        expect(waits.sent).toEqual([]);
    });

    it('is answered on the line that was offered, with the answering microphone already on it', async () =>
    {
        const waits = side('mina');

        await waits.call.setMic(stream);
        waits.call.sync(['dana']);
        await waits.call.receive('dana', said('offer'));

        expect(waits.connection.lines.map((one) => [one.mid, one.direction, one.sender.track])).toEqual([['0', 'sendrecv', microphone]]);
        expect(waits.sent.map((one) => [one.to, one.signal.kind, JSON.parse(one.signal.data).type])).toEqual([['dana', 'answer', 'answer']]);
    });

    it('opens the peer on its first signal, when an offer beats the roster', async () =>
    {
        const waits = side('mina');

        await waits.call.receive('dana', said('offer'));

        expect(waits.links).toEqual([['dana', 'connecting']]);
        expect(waits.connection.lines.map((one) => one.direction)).toEqual(['sendrecv']);
        expect(waits.sent.map((one) => one.signal.kind)).toEqual(['answer']);
    });

    it('puts a microphone that is granted later on the line each side already holds', async () =>
    {
        const asks = side('dana');
        const waits = side('mina');

        asks.call.sync(['mina']);
        await waits.call.receive('dana', said('offer'));

        await asks.call.setMic(stream);
        await waits.call.setMic(stream);

        expect(asks.connection.lines[0].sender.track).toBe(microphone);
        expect(waits.connection.lines[0].sender.track).toBe(microphone);
    });

    it('takes an offer that arrives while the answer before it is still being applied', async () =>
    {
        const asks = side('dana');

        asks.call.sync(['mina']);
        await asks.connection.onnegotiationneeded?.();

        asks.connection.hold();

        const answered = asks.call.receive('mina', said('answer'));
        const offered = asks.call.receive('mina', said('offer'));

        asks.connection.release();
        await Promise.all([answered, offered]);

        expect(asks.connection.applied.map((one) => one.type)).toEqual(['answer', 'offer']);
        expect(asks.sent.map((one) => one.signal.kind)).toEqual(['offer', 'answer']);
        expect(asks.links).toEqual([['mina', 'connecting']]);
    });

    it('lets the asking side keep its own offer when two cross, and the waiting side give its own up', async () =>
    {
        const asks = side('dana');
        const waits = side('mina');

        asks.call.sync(['mina']);
        await asks.connection.onnegotiationneeded?.();
        await asks.call.receive('mina', said('offer'));

        expect(asks.connection.applied).toEqual([]);
        expect(asks.sent.map((one) => one.signal.kind)).toEqual(['offer']);

        await waits.call.receive('dana', said('offer'));
        await waits.connection.onnegotiationneeded?.();
        await waits.call.receive('dana', said('offer', 'their-second-offer'));

        expect(waits.connection.applied.map((one) => one.sdp)).toEqual(['their-offer', 'their-second-offer']);
        expect(waits.sent.map((one) => one.signal.kind)).toEqual(['answer', 'offer', 'answer']);
    });

    it('hangs up on somebody who is no longer in the room, and says the link is gone', () =>
    {
        const asks = side('dana');

        asks.call.sync(['mina']);
        asks.call.sync([]);

        expect(asks.connection.closed).toBe(true);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null]]);
    });
});
