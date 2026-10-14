import { createRelayKit, type Codec, type Inbound, type Outbound, type RelayKit } from './voice.relay.ts';

export type PeerLink = 'connecting' | 'connected' | 'failed';

export type SignalKind = 'offer' | 'answer' | 'ice';

export interface VoiceSignal
{
    kind: SignalKind;
    data: string;
}

export interface VoiceJoin
{
    who: string;
    join: string;
    opus: boolean;
}

export interface VoiceCallDeps
{
    me(): string;
    iceServers: RTCIceServer[];
    send(to: string, join: string, signal: VoiceSignal): void;
    onLink(who: string, link: PeerLink | null): void;
    onLevel(who: string, level: number): void;
    connect?(config: RTCConfiguration): RTCPeerConnection;
    context?(): AudioContext | null;
    relay?(to: string[], codec: Codec, at: number, data: string): void;
    opus?: boolean;
    kit?(context: AudioContext): RelayKit;
    after?(ms: number, run: () => void): () => void;
}

export interface VoiceCall
{
    setMic(stream: MediaStream | null): Promise<void>;
    setMuted(muted: boolean): void;
    sync(mine: string, peers: readonly VoiceJoin[]): void;
    receive(join: string, signal: VoiceSignal): Promise<void>;
    heard(join: string, codec: Codec, at: number, data: string): void;
    setVolume(who: string, volume: number): void;
    setSink(id: string): void;
    close(): void;
}

export const RELAY_AFTER_MS = 3000;

interface Peer
{
    who: string;
    join: string;
    opus: boolean;
    link: PeerLink;
    connection: RTCPeerConnection;
    sender: RTCRtpSender | null;
    audio: HTMLAudioElement | null;
    direct: MediaStream | null;
    inbound: Inbound | null;
    stream: MediaStream | null;
    boost: Boost | null;
    meter: (() => void) | null;
    making: boolean;
    ignoring: boolean;
    settling: boolean;
    polite: boolean;
    volume: number;
    relaying: boolean;
    waiting: (() => void) | null;
}

interface Boost
{
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    out: MediaStreamAudioDestinationNode;
    hold: HTMLAudioElement;
}

const LEVEL_MS = 120;

function measure(context: AudioContext, stream: MediaStream, report: (level: number) => void): () => void
{
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);

    const timer = setInterval(() =>
    {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples)
        {
            sum += sample * sample;
        }
        report(Math.min(1, Math.sqrt(sum / samples.length) * 4));
    }, LEVEL_MS);

    return () =>
    {
        clearInterval(timer);
        source.disconnect();
        analyser.disconnect();
    };
}

export function createVoiceCall(deps: VoiceCallDeps): VoiceCall
{
    const peers = new Map<string, Peer>();
    let own = '';
    let track: MediaStreamTrack | null = null;
    let muted = true;
    let localMeter: (() => void) | null = null;
    let closed = false;
    let sink = '';
    let kit: RelayKit | null = null;
    let outbound: Outbound | null = null;

    const after = deps.after ?? ((ms: number, run: () => void) =>
    {
        const timer = setTimeout(run, ms);

        return () => clearTimeout(timer);
    });

    const route = (audio: HTMLAudioElement) =>
    {
        const output = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

        if (typeof output.setSinkId === 'function')
        {
            void output.setSinkId(sink).catch(() => undefined);
        }
    };

    const connect = deps.connect ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));

    const wake = () =>
    {
        for (const peer of peers.values())
        {
            if (peer.audio !== null && peer.audio.paused)
            {
                void peer.audio.play().catch(() => undefined);
            }
        }
    };

    if (typeof window !== 'undefined')
    {
        window.addEventListener('pointerdown', wake);
        window.addEventListener('keydown', wake);
    }

    const mark = (peer: Peer, link: PeerLink) =>
    {
        if (peers.get(peer.join) === peer)
        {
            peer.link = link;
            deps.onLink(peer.who, link);
        }
    };

    const relays = () =>
    {
        if (kit === null && deps.relay !== undefined)
        {
            const context = deps.context?.() ?? null;

            if (context !== null)
            {
                kit = (deps.kit ?? createRelayKit)(context);
            }
        }

        return kit;
    };

    const retarget = () =>
    {
        const targets = [...peers.values()].filter((peer) => peer.relaying).map((peer) => ({ join: peer.join, opus: peer.opus }));

        if (outbound === null && targets.length > 0)
        {
            const made = relays();

            if (made === null)
            {
                return;
            }

            outbound = made.outbound((to, codec, at, data) => deps.relay?.(to, codec, at, data), deps.opus === true);
            outbound.setMuted(muted);
            outbound.setTrack(track);
        }

        outbound?.to(targets);
    };

    const unboost = (peer: Peer) =>
    {
        if (peer.boost === null)
        {
            return;
        }

        peer.boost.source.disconnect();
        peer.boost.gain.disconnect();
        peer.boost.hold.srcObject = null;
        peer.boost.hold.remove();
        peer.boost = null;
    };

    const play = (peer: Peer) =>
    {
        if (peer.audio === null || peer.stream === null)
        {
            return;
        }

        const context = deps.context?.() ?? null;
        const loud = peer.volume > 1 && context !== null;

        if (loud && peer.boost === null)
        {
            const hold = document.createElement('audio');
            const source = context.createMediaStreamSource(peer.stream);
            const gain = context.createGain();
            const out = context.createMediaStreamDestination();

            hold.muted = true;
            hold.autoplay = true;
            hold.hidden = true;
            hold.srcObject = peer.stream;
            document.body.append(hold);
            void hold.play().catch(() => undefined);
            source.connect(gain).connect(out);
            peer.boost = { source, gain, out, hold };
            peer.audio.srcObject = out.stream;
            void peer.audio.play().catch(() => undefined);
        }
        else if (!loud && peer.boost !== null)
        {
            unboost(peer);
            peer.audio.srcObject = peer.stream;
            void peer.audio.play().catch(() => undefined);
        }

        if (peer.boost === null)
        {
            peer.audio.volume = Math.min(Math.max(peer.volume, 0), 1);
        }
        else
        {
            peer.boost.gain.gain.value = peer.volume;
            peer.audio.volume = 1;
        }
    };

    const hear = (peer: Peer) =>
    {
        const stream = peer.inbound?.stream ?? peer.direct;

        if (stream === null || stream === peer.stream)
        {
            return;
        }

        if (peer.audio === null)
        {
            const audio = document.createElement('audio');
            audio.autoplay = true;
            audio.hidden = true;
            document.body.append(audio);
            peer.audio = audio;

            if (sink !== '')
            {
                route(audio);
            }
        }

        unboost(peer);
        peer.stream = stream;
        peer.audio.srcObject = stream;
        void peer.audio.play().catch(() => undefined);
        play(peer);

        const context = deps.context?.() ?? null;
        peer.meter?.();
        peer.meter = context === null ? null : measure(context, stream, (level) => deps.onLevel(peer.who, level));
    };

    const settle = (peer: Peer) =>
    {
        peer.waiting?.();
        peer.waiting = null;
    };

    const relayTo = (peer: Peer) =>
    {
        settle(peer);

        if (peer.relaying || peers.get(peer.join) !== peer || relays() === null)
        {
            return;
        }

        peer.relaying = true;
        peer.connection.close();
        retarget();
        mark(peer, 'connected');
    };

    const wait = (peer: Peer) =>
    {
        if (peer.waiting === null && !peer.relaying)
        {
            peer.waiting = after(RELAY_AFTER_MS, () =>
            {
                peer.waiting = null;
                relayTo(peer);
            });
        }
    };

    const drop = (join: string) =>
    {
        const peer = peers.get(join);
        if (peer === undefined)
        {
            return;
        }
        peers.delete(join);
        settle(peer);
        peer.meter?.();
        unboost(peer);
        peer.inbound?.close();
        peer.inbound = null;
        if (peer.audio !== null)
        {
            peer.audio.srcObject = null;
            peer.audio.remove();
        }
        peer.connection.close();
        if (peer.relaying)
        {
            peer.relaying = false;
            retarget();
        }
        deps.onLink(peer.who, null);
    };

    const carry = (peer: Peer, line: RTCRtpTransceiver) =>
    {
        line.direction = 'sendrecv';
        peer.sender = line.sender;

        if (track !== null)
        {
            void peer.sender.replaceTrack(track);
        }
    };

    const open = (join: string, who: string, opus: boolean) =>
    {
        const connection = connect({ iceServers: deps.iceServers });

        const peer: Peer = {
            who,
            join,
            opus,
            link: 'connecting',
            connection,
            sender: null,
            audio: null,
            direct: null,
            inbound: null,
            stream: null,
            boost: null,
            meter: null,
            making: false,
            ignoring: false,
            settling: false,
            polite: own > join,
            volume: 1,
            relaying: false,
            waiting: null
        };

        peers.set(join, peer);
        deps.onLink(who, 'connecting');
        wait(peer);

        if (!peer.polite)
        {
            carry(peer, connection.addTransceiver('audio', { direction: 'sendrecv' }));
        }

        connection.onnegotiationneeded = async () =>
        {
            try
            {
                peer.making = true;
                await connection.setLocalDescription();
                if (connection.localDescription !== null)
                {
                    deps.send(peer.who, join, { kind: connection.localDescription.type === 'answer' ? 'answer' : 'offer', data: JSON.stringify(connection.localDescription) });
                }
            }
            catch
            {
                if (!peer.relaying)
                {
                    mark(peer, 'failed');
                }
            }
            finally
            {
                peer.making = false;
            }
        };

        connection.onicecandidate = (event) =>
        {
            if (event.candidate !== null)
            {
                deps.send(peer.who, join, { kind: 'ice', data: JSON.stringify(event.candidate) });
            }
        };

        connection.onconnectionstatechange = () =>
        {
            const state = connection.connectionState;

            if (state === 'connected')
            {
                settle(peer);
                mark(peer, 'connected');
            }
            else if (state === 'failed')
            {
                relayTo(peer);

                if (!peer.relaying)
                {
                    mark(peer, 'failed');

                    if (!peer.polite)
                    {
                        connection.restartIce();
                    }
                }
            }
            else if ((state === 'disconnected' || state === 'connecting' || state === 'new') && !peer.relaying)
            {
                mark(peer, 'connecting');
                wait(peer);
            }
        };

        connection.ontrack = (event) =>
        {
            peer.direct = event.streams[0] ?? new MediaStream([event.track]);
            hear(peer);
        };
    };

    return {
        async setMic(stream)
        {
            localMeter?.();
            localMeter = null;

            track = stream?.getAudioTracks()[0] ?? null;

            if (track !== null)
            {
                track.enabled = !muted;
                const context = deps.context?.() ?? null;
                if (context !== null && stream !== null)
                {
                    localMeter = measure(context, stream, (level) => deps.onLevel(deps.me(), muted ? 0 : level));
                }
            }

            outbound?.setTrack(track);

            await Promise.all([...peers.values()].map((peer) => peer.sender?.replaceTrack(track)));
        },

        setMuted(next)
        {
            muted = next;
            if (track !== null)
            {
                track.enabled = !next;
            }
            outbound?.setMuted(next);
            if (next)
            {
                deps.onLevel(deps.me(), 0);
            }
        },

        sync(mine, wanted)
        {
            if (closed)
            {
                return;
            }

            if (mine !== own)
            {
                for (const join of [...peers.keys()])
                {
                    drop(join);
                }

                own = mine;
            }

            const keep = new Map(wanted.filter((one) => one.join !== mine).map((one) => [one.join, one]));
            let moved = false;

            for (const [join, peer] of [...peers])
            {
                const one = keep.get(join);

                if (one === undefined)
                {
                    drop(join);
                    continue;
                }

                if (one.who !== peer.who)
                {
                    deps.onLink(peer.who, null);
                    peer.who = one.who;
                    deps.onLink(one.who, peer.link);
                }

                if (one.opus !== peer.opus)
                {
                    peer.opus = one.opus;
                    moved = moved || peer.relaying;
                }
            }

            for (const [join, one] of keep)
            {
                if (!peers.has(join))
                {
                    open(join, one.who, one.opus);
                }
            }

            if (moved)
            {
                retarget();
            }
        },

        async receive(join, signal)
        {
            const peer = peers.get(join);

            if (closed || peer === undefined)
            {
                return;
            }

            const connection = peer.connection;

            try
            {
                if (signal.kind === 'ice')
                {
                    try
                    {
                        await connection.addIceCandidate(JSON.parse(signal.data) as RTCIceCandidateInit);
                    }
                    catch (error)
                    {
                        if (!peer.ignoring)
                        {
                            throw error;
                        }
                    }
                    return;
                }

                const description = JSON.parse(signal.data) as RTCSessionDescriptionInit;
                const free = !peer.making && (connection.signalingState === 'stable' || peer.settling);
                const collision = description.type === 'offer' && !free;

                peer.ignoring = !peer.polite && collision;

                if (peer.ignoring)
                {
                    return;
                }

                if (description.type === 'answer')
                {
                    peer.settling = true;
                }

                try
                {
                    await connection.setRemoteDescription(description);
                }
                finally
                {
                    if (description.type === 'answer')
                    {
                        peer.settling = false;
                    }
                }

                if (description.type === 'offer')
                {
                    const offered = peer.sender === null ? connection.getTransceivers().find((line) => line.receiver.track.kind === 'audio') : undefined;

                    if (offered !== undefined)
                    {
                        carry(peer, offered);
                    }

                    await connection.setLocalDescription();
                    if (connection.localDescription !== null)
                    {
                        deps.send(peer.who, join, { kind: 'answer', data: JSON.stringify(connection.localDescription) });
                    }
                }
            }
            catch
            {
                if (!peer.relaying)
                {
                    mark(peer, 'failed');
                }
            }
        },

        heard(join, codec, at, data)
        {
            const peer = peers.get(join);

            if (closed || peer === undefined)
            {
                return;
            }

            if (peer.inbound === null)
            {
                const made = relays();

                if (made === null)
                {
                    return;
                }

                peer.inbound = made.inbound();
                hear(peer);
            }

            peer.inbound.take(codec, at, data);
            relayTo(peer);
        },

        setVolume(who, volume)
        {
            const peer = [...peers.values()].find((one) => one.who === who);
            if (peer !== undefined)
            {
                peer.volume = volume;
                play(peer);
            }
        },

        setSink(id)
        {
            sink = id;

            for (const peer of peers.values())
            {
                if (peer.audio !== null)
                {
                    route(peer.audio);
                }
            }
        },

        close()
        {
            closed = true;

            if (typeof window !== 'undefined')
            {
                window.removeEventListener('pointerdown', wake);
                window.removeEventListener('keydown', wake);
            }

            localMeter?.();
            localMeter = null;
            for (const join of [...peers.keys()])
            {
                drop(join);
            }

            outbound?.close();
            outbound = null;
        }
    };
}
