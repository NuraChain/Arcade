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
}

export interface VoiceCall
{
    setMic(stream: MediaStream | null): Promise<void>;
    setMuted(muted: boolean): void;
    sync(mine: string, peers: readonly VoiceJoin[]): void;
    receive(join: string, signal: VoiceSignal): Promise<void>;
    setVolume(who: string, volume: number): void;
    setSink(id: string): void;
    close(): void;
}

interface Peer
{
    who: string;
    join: string;
    link: PeerLink;
    connection: RTCPeerConnection;
    sender: RTCRtpSender | null;
    audio: HTMLAudioElement | null;
    meter: (() => void) | null;
    making: boolean;
    ignoring: boolean;
    settling: boolean;
    polite: boolean;
    volume: number;
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

    const route = (audio: HTMLAudioElement) =>
    {
        const output = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

        if (typeof output.setSinkId === 'function')
        {
            void output.setSinkId(sink).catch(() => undefined);
        }
    };

    const connect = deps.connect ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));

    const mark = (peer: Peer, link: PeerLink) =>
    {
        if (peers.get(peer.join) === peer)
        {
            peer.link = link;
            deps.onLink(peer.who, link);
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
        peer.meter?.();
        if (peer.audio !== null)
        {
            peer.audio.srcObject = null;
            peer.audio.remove();
        }
        peer.connection.close();
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

    const open = (join: string, who: string) =>
    {
        const connection = connect({ iceServers: deps.iceServers });

        const peer: Peer = {
            who,
            join,
            link: 'connecting',
            connection,
            sender: null,
            audio: null,
            meter: null,
            making: false,
            ignoring: false,
            settling: false,
            polite: own > join,
            volume: 1
        };

        peers.set(join, peer);
        deps.onLink(who, 'connecting');

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
                mark(peer, 'failed');
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
                mark(peer, 'connected');
            }
            else if (state === 'failed')
            {
                mark(peer, 'failed');

                if (!peer.polite)
                {
                    connection.restartIce();
                }
            }
            else if (state === 'disconnected' || state === 'connecting' || state === 'new')
            {
                mark(peer, 'connecting');
            }
        };

        connection.ontrack = (event) =>
        {
            const stream = event.streams[0] ?? new MediaStream([event.track]);

            if (peer.audio === null)
            {
                const audio = document.createElement('audio');
                audio.autoplay = true;
                audio.hidden = true;
                audio.volume = peer.volume;
                document.body.append(audio);
                peer.audio = audio;

                if (sink !== '')
                {
                    route(audio);
                }
            }

            peer.audio.srcObject = stream;
            void peer.audio.play().catch(() => undefined);

            const context = deps.context?.() ?? null;
            peer.meter?.();
            peer.meter = context === null ? null : measure(context, stream, (level) => deps.onLevel(peer.who, level));
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

            await Promise.all([...peers.values()].map((peer) => peer.sender?.replaceTrack(track)));
        },

        setMuted(next)
        {
            muted = next;
            if (track !== null)
            {
                track.enabled = !next;
            }
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

            const keep = new Map(wanted.filter((one) => one.join !== mine).map((one) => [one.join, one.who]));

            for (const [join, peer] of [...peers])
            {
                const who = keep.get(join);

                if (who === undefined)
                {
                    drop(join);
                }
                else if (who !== peer.who)
                {
                    deps.onLink(peer.who, null);
                    peer.who = who;
                    deps.onLink(who, peer.link);
                }
            }

            for (const [join, who] of keep)
            {
                if (!peers.has(join))
                {
                    open(join, who);
                }
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
                mark(peer, 'failed');
            }
        },

        setVolume(who, volume)
        {
            const peer = [...peers.values()].find((one) => one.who === who);
            if (peer !== undefined)
            {
                peer.volume = volume;
                if (peer.audio !== null)
                {
                    peer.audio.volume = volume;
                }
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
            localMeter?.();
            localMeter = null;
            for (const join of [...peers.keys()])
            {
                drop(join);
            }
        }
    };
}
