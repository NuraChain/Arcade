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
    const connections: ReturnType<typeof fakeConnection>[] = [];
    const sent: { to: string; join: string; signal: VoiceSignal }[] = [];
    const links: [string, PeerLink | null][] = [];

    const call = createVoiceCall({
        me,
        iceServers: [],
        send: (to, join, signal) => sent.push({ to, join, signal }),
        onLink: (who, link) => links.push([who, link]),
        onLevel: () => undefined,
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

        get connection()
        {
            return connections[connections.length - 1];
        }
    };
}

const MINA = { who: 'mina', join: 'm1' };

const DANA = { who: 'dana', join: 'd1' };

describe('a call between two players', () =>
{
    it('is placed by one of them: the handle that sorts first asks, and the other brings nothing until it is asked', async () =>
    {
        const asks = side('dana');
        const waits = side('mina');

        asks.call.sync([MINA]);
        waits.call.sync([DANA]);

        expect(asks.connection.lines.map((one) => one.direction)).toEqual(['sendrecv']);
        expect(waits.connection.lines).toEqual([]);

        await asks.connection.onnegotiationneeded?.();

        expect(asks.sent.map((one) => [one.to, one.join, one.signal.kind])).toEqual([['mina', 'm1', 'offer']]);
        expect(waits.sent).toEqual([]);
    });

    it('is answered on the line that was offered, with the answering microphone already on it', async () =>
    {
        const waits = side('mina');

        await waits.call.setMic(stream);
        waits.call.sync([DANA]);
        await waits.call.receive('dana', 'd1', said('offer'));

        expect(waits.connection.lines.map((one) => [one.mid, one.direction, one.sender.track])).toEqual([['0', 'sendrecv', microphone]]);
        expect(waits.sent.map((one) => [one.to, one.join, one.signal.kind, JSON.parse(one.signal.data).type])).toEqual([['dana', 'd1', 'answer', 'answer']]);
    });

    it('opens the peer on its first signal, when an offer beats the roster', async () =>
    {
        const waits = side('mina');

        await waits.call.receive('dana', 'd1', said('offer'));
        waits.call.sync([DANA]);

        expect(waits.connections.length).toBe(1);
        expect(waits.links).toEqual([['dana', 'connecting']]);
        expect(waits.connection.lines.map((one) => one.direction)).toEqual(['sendrecv']);
        expect(waits.sent.map((one) => one.signal.kind)).toEqual(['answer']);
    });

    it('puts a microphone that is granted later on the line each side already holds', async () =>
    {
        const asks = side('dana');
        const waits = side('mina');

        asks.call.sync([MINA]);
        await waits.call.receive('dana', 'd1', said('offer'));

        await asks.call.setMic(stream);
        await waits.call.setMic(stream);

        expect(asks.connection.lines[0].sender.track).toBe(microphone);
        expect(waits.connection.lines[0].sender.track).toBe(microphone);
    });

    it('takes an offer that arrives while the answer before it is still being applied', async () =>
    {
        const asks = side('dana');

        asks.call.sync([MINA]);
        await asks.connection.onnegotiationneeded?.();

        asks.connection.hold();

        const answered = asks.call.receive('mina', 'm1', said('answer'));
        const offered = asks.call.receive('mina', 'm1', said('offer'));

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

        asks.call.sync([MINA]);
        await asks.connection.onnegotiationneeded?.();
        await asks.call.receive('mina', 'm1', said('offer'));

        expect(asks.connection.applied).toEqual([]);
        expect(asks.sent.map((one) => one.signal.kind)).toEqual(['offer']);

        await waits.call.receive('dana', 'd1', said('offer'));
        await waits.connection.onnegotiationneeded?.();
        await waits.call.receive('dana', 'd1', said('offer', 'their-second-offer'));

        expect(waits.connection.applied.map((one) => one.sdp)).toEqual(['their-offer', 'their-second-offer']);
        expect(waits.sent.map((one) => one.signal.kind)).toEqual(['answer', 'offer', 'answer']);
    });

    it('hangs up on somebody who is no longer in the room, and says the link is gone', () =>
    {
        const asks = side('dana');

        asks.call.sync([MINA]);
        asks.call.sync([]);

        expect(asks.connection.closed).toBe(true);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null]]);
    });

    it('calls somebody again when they come back as a new joining, and keeps the line to somebody who never left', async () =>
    {
        const asks = side('dana');

        asks.call.sync([MINA]);
        asks.call.sync([MINA]);

        expect(asks.connections.length).toBe(1);

        asks.call.sync([{ who: 'mina', join: 'm2' }]);

        expect(asks.connections.map((one) => one.closed)).toEqual([true, false]);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null], ['mina', 'connecting']]);

        await asks.connection.onnegotiationneeded?.();

        expect(asks.sent.map((one) => [one.to, one.join, one.signal.kind])).toEqual([['mina', 'm2', 'offer']]);
    });

    it('waits again for somebody who comes back, on a line of its own', async () =>
    {
        const waits = side('mina');

        waits.call.sync([DANA]);
        await waits.call.receive('dana', 'd1', said('offer'));
        waits.call.sync([{ who: 'dana', join: 'd2' }]);

        expect(waits.connections.map((one) => [one.closed, one.lines.length])).toEqual([[true, 1], [false, 0]]);

        await waits.call.receive('dana', 'd2', said('offer'));

        expect(waits.connection.lines.map((one) => one.direction)).toEqual(['sendrecv']);
        expect(waits.sent.map((one) => [one.join, one.signal.kind])).toEqual([['d1', 'answer'], ['d2', 'answer']]);
    });

    it('does not let a connection it has hung up speak for the one that replaced it', async () =>
    {
        const asks = side('dana');

        asks.call.sync([MINA]);
        await asks.connection.onnegotiationneeded?.();

        const first = asks.connection;

        first.hold();

        const answered = asks.call.receive('mina', 'm1', said('answer'));

        asks.call.sync([{ who: 'mina', join: 'm2' }]);
        first.release();
        await answered;

        expect(asks.connections.map((one) => one.closed)).toEqual([true, false]);
        expect(asks.links).toEqual([['mina', 'connecting'], ['mina', null], ['mina', 'connecting']]);
    });

    it('lets a signal from a joining it has hung up on fall', async () =>
    {
        const waits = side('mina');

        waits.call.sync([{ who: 'dana', join: 'd2' }]);
        await waits.call.receive('dana', 'd1', said('offer'));

        expect(waits.connections.length).toBe(1);
        expect(waits.connection.applied).toEqual([]);
        expect(waits.sent).toEqual([]);
    });
});
