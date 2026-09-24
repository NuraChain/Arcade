export type PeerLink = 'connecting' | 'connected' | 'failed';

export type SignalKind = 'offer' | 'answer' | 'ice';

export interface VoiceSignal
{
    kind: SignalKind;
    data: string;
}

export interface VoiceCallDeps
{
    me: string;
    iceServers: RTCIceServer[];
    send(to: string, signal: VoiceSignal): void;
    onLink(who: string, link: PeerLink | null): void;
    onLevel(who: string, level: number): void;
    connect?(config: RTCConfiguration): RTCPeerConnection;
    context?(): AudioContext | null;
}

export interface VoiceCall
{
    setMic(stream: MediaStream | null): Promise<void>;
    setMuted(muted: boolean): void;
    sync(peers: readonly string[]): void;
    receive(from: string, signal: VoiceSignal): Promise<void>;
    setVolume(who: string, volume: number): void;
    setSink(id: string): void;
    close(): void;
}

interface Peer
{
    connection: RTCPeerConnection;
    sender: RTCRtpSender;
    audio: HTMLAudioElement | null;
    meter: (() => void) | null;
    making: boolean;
    ignoring: boolean;
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
    let track: MediaStreamTrack | null = null;
    let muted = true;
    let localMeter: (() => void) | null = null;
    let closed = false;
    let sink = '';

    const route = (audio: HTMLAudioElement): void =>
    {
        const output = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

        if (typeof output.setSinkId === 'function')
        {
            void output.setSinkId(sink).catch(() => undefined);
        }
    };

    const connect = deps.connect ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));

    const drop = (who: string): void =>
    {
        const peer = peers.get(who);
        if (peer === undefined)
        {
            return;
        }
        peers.delete(who);
        peer.meter?.();
        if (peer.audio !== null)
        {
            peer.audio.srcObject = null;
            peer.audio.remove();
        }
        peer.connection.close();
        deps.onLink(who, null);
    };

    const open = (who: string): Peer =>
    {
        const connection = connect({ iceServers: deps.iceServers });
        const transceiver = connection.addTransceiver('audio', { direction: 'sendrecv' });

        const peer: Peer = {
            connection,
            sender: transceiver.sender,
            audio: null,
            meter: null,
            making: false,
            ignoring: false,
            polite: deps.me > who,
            volume: 1
        };

        peers.set(who, peer);
        deps.onLink(who, 'connecting');

        if (track !== null)
        {
            void peer.sender.replaceTrack(track);
        }

        connection.onnegotiationneeded = async () =>
        {
            try
            {
                peer.making = true;
                await connection.setLocalDescription();
                if (connection.localDescription !== null)
                {
                    deps.send(who, { kind: connection.localDescription.type === 'answer' ? 'answer' : 'offer', data: JSON.stringify(connection.localDescription) });
                }
            }
            catch
            {
                deps.onLink(who, 'failed');
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
                deps.send(who, { kind: 'ice', data: JSON.stringify(event.candidate) });
            }
        };

        connection.onconnectionstatechange = () =>
        {
            const state = connection.connectionState;

            if (state === 'connected')
            {
                deps.onLink(who, 'connected');
            }
            else if (state === 'failed')
            {
                deps.onLink(who, 'failed');
                connection.restartIce();
            }
            else if (state === 'disconnected' || state === 'connecting' || state === 'new')
            {
                deps.onLink(who, 'connecting');
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
            peer.meter = context === null ? null : measure(context, stream, (level) => deps.onLevel(who, level));
        };

        return peer;
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
                    localMeter = measure(context, stream, (level) => deps.onLevel(deps.me, muted ? 0 : level));
                }
            }

            await Promise.all([...peers.values()].map((peer) => peer.sender.replaceTrack(track)));
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
                deps.onLevel(deps.me, 0);
            }
        },

        sync(wanted)
        {
            if (closed)
            {
                return;
            }

            const keep = new Set(wanted.filter((who) => who !== deps.me));

            for (const who of [...peers.keys()])
            {
                if (!keep.has(who))
                {
                    drop(who);
                }
            }

            for (const who of keep)
            {
                if (!peers.has(who))
                {
                    open(who);
                }
            }
        },

        async receive(from, signal)
        {
            if (closed || from === deps.me)
            {
                return;
            }

            const peer = peers.get(from) ?? open(from);

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
                const collision = description.type === 'offer' && (peer.making || connection.signalingState !== 'stable');

                peer.ignoring = !peer.polite && collision;

                if (peer.ignoring)
                {
                    return;
                }

                await connection.setRemoteDescription(description);

                if (description.type === 'offer')
                {
                    await connection.setLocalDescription();
                    if (connection.localDescription !== null)
                    {
                        deps.send(from, { kind: 'answer', data: JSON.stringify(connection.localDescription) });
                    }
                }
            }
            catch
            {
                deps.onLink(from, 'failed');
            }
        },

        setVolume(who, volume)
        {
            const peer = peers.get(who);
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
            for (const who of [...peers.keys()])
            {
                drop(who);
            }
        }
    };
}
