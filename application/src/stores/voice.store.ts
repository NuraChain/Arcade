import { createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import { createVoiceCall, type PeerLink, type VoiceCall, type VoiceCallDeps } from '../services/voice.rtc.ts';
import { useAccount } from './account.store.ts';
import { onBack, useRealtime, type SignalFrame, type VoiceFrame } from './realtime.store.ts';
import { useSettings } from './settings.store.ts';

export type MicState = 'off' | 'live' | 'denied' | 'absent';

export interface VoicePerson
{
    who: string;
    me: boolean;
    muted: boolean;
    talk: boolean;
    link: PeerLink | null;
    speaking: boolean;
    silenced: boolean;
}

export interface VoiceApi
{
    table: Getter<string | null>;
    joining: Getter<boolean>;
    muted: Getter<boolean>;
    mic: Getter<MicState>;
    people: Getter<VoicePerson[]>;
    speaking(who: string): boolean;
    join(table: string): Promise<void>;
    leave(): void;
    toggleMute(): void;
    silence(who: string): void;
    applyVolume(): void;
    start(): () => void;
    reset(): void;
}

const SPEAKING = 0.08;

const QUIET = 0.04;

let media: () => MediaDevices | null = () => (typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null);

export function setVoiceMedia(next: (() => MediaDevices | null) | null): void
{
    media = next ?? (() => (typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null));
}

let makeCall: (deps: VoiceCallDeps) => VoiceCall = createVoiceCall;

export function setVoiceCall(next: ((deps: VoiceCallDeps) => VoiceCall) | null): void
{
    makeCall = next ?? createVoiceCall;
}

export const useVoice = createStore((): VoiceApi =>
{
    const realtime = useRealtime();
    const settings = useSettings();
    const account = useAccount();

    const [table, setTable] = createSignal<string | null>(null);
    const [joining, setJoining] = createSignal(false);
    const [muted, setMuted] = createSignal(true);
    const [mic, setMic] = createSignal<MicState>('off');
    const [roster, setRoster] = createSignal<VoiceFrame['peers']>([]);
    const [links, setLinks] = createSignal<Record<string, PeerLink>>({});
    const [loud, setLoud] = createSignal<ReadonlySet<string>>(new Set());
    const [silenced, setSilenced] = createSignal<ReadonlySet<string>>(new Set());

    let call: VoiceCall | null = null;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    const me = (): string => untrack(account.user)?.id ?? '';

    const volume = (): number => Math.min(Math.max(untrack(settings.settings).voiceVolume, 0), 1);

    const level = (who: string, value: number): void =>
    {
        setLoud((current) =>
        {
            const on = current.has(who);

            if (!on && value >= SPEAKING)
            {
                return new Set([...current, who]);
            }

            if (on && value < QUIET)
            {
                return new Set([...current].filter((one) => one !== who));
            }

            return current;
        });
    };

    const teardown = (): void =>
    {
        call?.close();
        call = null;

        for (const track of stream?.getTracks() ?? [])
        {
            track.stop();
        }
        stream = null;

        void context?.close().catch(() => undefined);
        context = null;

        setTable(null);
        setJoining(false);
        setRoster([]);
        setLinks({});
        setLoud(new Set<string>());
        setMic('off');
        setMuted(true);
    };

    const heard = (frame: VoiceFrame): void =>
    {
        if (frame.table !== untrack(table))
        {
            return;
        }

        if (!frame.joined)
        {
            teardown();
            return;
        }

        setRoster(frame.peers);

        const self = me();

        call?.sync(frame.peers.filter((peer) => peer.talk && peer.who !== self).map((peer) => peer.who));
    };

    const signalled = (frame: SignalFrame): void =>
    {
        if (frame.table === untrack(table))
        {
            void call?.receive(frame.from, { kind: frame.kind, data: frame.data });
        }
    };

    const microphone = async (): Promise<MediaStream | null> =>
    {
        const devices = media();

        if (devices === null || typeof devices.getUserMedia !== 'function')
        {
            setMic('absent');
            return null;
        }

        try
        {
            const got = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            setMic('live');
            return got;
        }
        catch (error)
        {
            setMic((error as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'absent');
            return null;
        }
    };

    return {
        table,
        joining,
        muted,
        mic,

        people: () =>
        {
            const self = account.user()?.id ?? '';
            const state = links();
            const speaking = loud();
            const quiet = silenced();

            return roster().map((peer) => ({
                who: peer.who,
                me: peer.who === self,
                muted: peer.muted,
                talk: peer.talk,
                link: peer.who === self ? 'connected' : (state[peer.who] ?? null),
                speaking: speaking.has(peer.who) && !peer.muted,
                silenced: quiet.has(peer.who)
            }));
        },

        speaking: (who) => loud().has(who) && roster().some((peer) => peer.who === who && !peer.muted),

        async join(next)
        {
            if (untrack(table) === next)
            {
                return;
            }

            if (untrack(table) !== null)
            {
                realtime.voice(untrack(table)!, false, true);
                teardown();
            }

            setTable(next);
            setJoining(true);

            const ice = await client.voice.ice().catch(() => ({ servers: [] }));

            if (untrack(table) !== next)
            {
                return;
            }

            const Context = typeof AudioContext === 'undefined' ? null : AudioContext;
            context = Context === null ? null : new Context();

            call = makeCall({
                me: me(),
                iceServers: ice.servers.map((server) => ({
                    urls: server.urls,
                    ...(server.username === undefined ? {} : { username: server.username }),
                    ...(server.credential === undefined ? {} : { credential: server.credential })
                })),
                send: (to, signal) => realtime.signal(next, to, signal.kind, signal.data),
                onLink: (who, link) =>
                {
                    setLinks((current) =>
                    {
                        const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== who));
                        return link === null ? rest : { ...rest, [who]: link };
                    });

                    if (link === 'connected')
                    {
                        call?.setVolume(who, untrack(silenced).has(who) ? 0 : volume());
                    }
                },
                onLevel: level,
                context: () => context
            });

            stream = await microphone();

            if (untrack(table) !== next)
            {
                for (const track of stream?.getTracks() ?? [])
                {
                    track.stop();
                }
                return;
            }

            const quiet = stream === null || untrack(settings.settings).voiceStartMuted;

            setMuted(quiet);
            call.setMuted(quiet);
            await call.setMic(stream);

            realtime.voice(next, true, quiet);
            setJoining(false);
        },

        leave()
        {
            const current = untrack(table);

            if (current !== null)
            {
                realtime.voice(current, false, true);
            }

            teardown();
        },

        toggleMute()
        {
            const current = untrack(table);

            if (current === null || untrack(mic) !== 'live')
            {
                return;
            }

            const next = !untrack(muted);
            setMuted(next);
            call?.setMuted(next);
            realtime.voice(current, true, next);
        },

        silence(who)
        {
            const next = new Set(untrack(silenced));

            if (next.has(who))
            {
                next.delete(who);
            }
            else
            {
                next.add(who);
            }

            setSilenced(next);
            call?.setVolume(who, next.has(who) ? 0 : volume());
        },

        applyVolume()
        {
            const quiet = untrack(silenced);

            for (const peer of untrack(roster))
            {
                call?.setVolume(peer.who, quiet.has(peer.who) ? 0 : volume());
            }
        },

        start()
        {
            const stops = [
                realtime.onVoice(heard),
                realtime.onSignal(signalled),
                onBack(realtime, () =>
                {
                    const current = untrack(table);

                    if (current !== null && !untrack(joining))
                    {
                        realtime.voice(current, true, untrack(muted));
                    }
                })
            ];

            return () =>
            {
                for (const stop of stops)
                {
                    stop();
                }
            };
        },

        reset()
        {
            teardown();
            setSilenced(new Set<string>());
        }
    };
});
