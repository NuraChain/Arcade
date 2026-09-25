import { createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import { createVoiceCall, type PeerLink, type VoiceCall, type VoiceCallDeps } from '../services/voice.rtc.ts';
import { useAccount } from './account.store.ts';
import { onBack, useRealtime, type SignalFrame, type VoiceFrame } from './realtime.store.ts';
import { useSettings } from './settings.store.ts';

export type MicState = 'off' | 'live' | 'denied' | 'absent';

export type VoiceMark = 'speaking' | 'live' | 'muted';

export interface VoicePerson
{
    who: string;
    me: boolean;
    muted: boolean;
    talk: boolean;
    link: PeerLink | null;
    speaking: boolean;
    silenced: boolean;
    volume: number;
}

export interface MediaChoice
{
    id: string;
    label: string;
}

export interface VoiceApi
{
    table: Getter<string | null>;
    joining: Getter<boolean>;
    muted: Getter<boolean>;
    deaf: Getter<boolean>;
    talking: Getter<boolean>;
    mic: Getter<MicState>;
    people: Getter<VoicePerson[]>;
    inputs: Getter<MediaChoice[]>;
    outputs: Getter<MediaChoice[]>;
    canPickSpeaker(): boolean;
    speaking(who: string): boolean;
    mark(who: string): VoiceMark | null;
    volumeOf(who: string): number;
    join(table: string): Promise<void>;
    leave(): void;
    toggleMute(): void;
    toggleDeafen(): void;
    press(): void;
    release(): void;
    silence(who: string): void;
    setLevel(who: string, volume: number): void;
    applyVolume(): void;
    survey(): Promise<void>;
    useMic(id: string): Promise<void>;
    useSpeaker(id: string): void;
    start(): () => void;
    reset(): void;
}

const SPEAKING = 0.08;

const QUIET = 0.04;

export const TALK_KEY = 'KeyV';

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

const typing = (target: EventTarget | null): boolean =>
{
    const element = target as HTMLElement | null;

    return element !== null && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? ''));
};

export const useVoice = createStore((): VoiceApi =>
{
    const realtime = useRealtime();
    const settings = useSettings();
    const account = useAccount();

    const [table, setTable] = createSignal<string | null>(null);
    const [joining, setJoining] = createSignal(false);
    const [muted, setMuted] = createSignal(true);
    const [deaf, setDeaf] = createSignal(false);
    const [talking, setTalking] = createSignal(false);
    const [mic, setMic] = createSignal<MicState>('off');
    const [roster, setRoster] = createSignal<VoiceFrame['peers']>([]);
    const [links, setLinks] = createSignal<Record<string, PeerLink>>({});
    const [loud, setLoud] = createSignal<ReadonlySet<string>>(new Set());
    const [volumes, setVolumes] = createSignal<Readonly<Record<string, number>>>({});
    const [inputs, setInputs] = createSignal<MediaChoice[]>([]);
    const [outputs, setOutputs] = createSignal<MediaChoice[]>([]);

    let call: VoiceCall | null = null;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let mutedBeforeDeaf = true;
    let unhold: (() => void) | null = null;

    const me = (): string => untrack(account.user)?.id ?? '';

    const master = (): number => Math.min(Math.max(untrack(settings.settings).voiceVolume, 0), 1);

    const own = (who: string): number => untrack(volumes)[who] ?? 1;

    const heard = (who: string): number => (untrack(deaf) ? 0 : master() * own(who));

    const pushToTalk = (): boolean => untrack(settings.settings).voicePushToTalk;

    const talkKey = (): string => untrack(settings.settings).voiceTalkKey || TALK_KEY;

    const gate = (): void =>
    {
        call?.setMuted(untrack(muted) || untrack(deaf) || (pushToTalk() && !untrack(talking)));
    };

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

    const stopTracks = (held: MediaStream | null): void =>
    {
        for (const track of held?.getTracks() ?? [])
        {
            track.stop();
        }
    };

    const stopStream = (): void =>
    {
        stopTracks(stream);
        stream = null;
    };

    let joins = 0;

    const teardown = (): void =>
    {
        joins += 1;
        unhold?.();
        unhold = null;
        call?.close();
        call = null;
        stopStream();

        void context?.close().catch(() => undefined);
        context = null;

        setTable(null);
        setJoining(false);
        setRoster([]);
        setLinks({});
        setLoud(new Set<string>());
        setMic('off');
        setMuted(true);
        setDeaf(false);
        setTalking(false);
    };

    const onVoice = (frame: VoiceFrame): void =>
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

    const survey = async (): Promise<void> =>
    {
        const devices = media();

        if (devices === null || typeof devices.enumerateDevices !== 'function')
        {
            return;
        }

        const found = await devices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
        const choices = (kind: MediaDeviceKind): MediaChoice[] => found
            .filter((device) => device.kind === kind && device.deviceId !== '' && device.deviceId !== 'default')
            .map((device) => ({ id: device.deviceId, label: device.label }));

        setInputs(choices('audioinput'));
        setOutputs(choices('audiooutput'));
    };

    const microphone = async (): Promise<MediaStream | null> =>
    {
        const devices = media();

        if (devices === null || typeof devices.getUserMedia !== 'function')
        {
            setMic('absent');
            return null;
        }

        const wanted = untrack(settings.settings).voiceMic;

        try
        {
            const got = await devices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    ...(wanted === '' ? {} : { deviceId: { ideal: wanted } })
                }
            });
            setMic('live');
            void survey();
            return got;
        }
        catch (error)
        {
            setMic((error as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'absent');
            return null;
        }
    };

    const people = (): VoicePerson[] =>
    {
        const self = account.user()?.id ?? '';
        const state = links();
        const speaking = loud();
        const own = volumes();

        return roster().map((peer) => ({
            who: peer.who,
            me: peer.who === self,
            muted: peer.muted,
            talk: peer.talk,
            link: peer.who === self ? 'connected' : (state[peer.who] ?? null),
            speaking: speaking.has(peer.who) && !peer.muted,
            silenced: (own[peer.who] ?? 1) === 0,
            volume: own[peer.who] ?? 1
        }));
    };

    const applyVolume = (): void =>
    {
        for (const peer of untrack(roster))
        {
            call?.setVolume(peer.who, heard(peer.who));
        }
    };

    const setLevel = (who: string, value: number): void =>
    {
        setVolumes((current) => ({ ...current, [who]: Math.min(Math.max(value, 0), 1) }));
        call?.setVolume(who, heard(who));
    };

    const press = (): void =>
    {
        if (untrack(table) === null || untrack(talking))
        {
            return;
        }

        setTalking(true);
        gate();
    };

    const letGo = (): void =>
    {
        if (!untrack(talking))
        {
            return;
        }

        setTalking(false);
        gate();
    };

    const announce = (): void =>
    {
        const current = untrack(table);

        if (current !== null)
        {
            realtime.voice(current, true, untrack(muted));
        }
    };

    return {
        table,
        joining,
        muted,
        deaf,
        talking,
        mic,
        people,
        inputs,
        outputs,

        canPickSpeaker: () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,

        speaking: (who) => loud().has(who) && roster().some((peer) => peer.who === who && !peer.muted),

        mark(who)
        {
            const person = people().find((one) => one.who === who);

            if (person === undefined)
            {
                return null;
            }

            if (person.speaking)
            {
                return 'speaking';
            }

            return person.muted ? 'muted' : 'live';
        },

        volumeOf: (who) => volumes()[who] ?? 1,

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
            unhold?.();
            unhold = realtime.hold();

            const round = ++joins;
            const ice = await client.voice.ice().catch(() => ({ servers: [] }));

            if (round !== joins || untrack(table) !== next)
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
                        call?.setVolume(who, heard(who));
                    }
                },
                onLevel: level,
                context: () => context
            });

            const speaker = untrack(settings.settings).voiceSpeaker;

            if (speaker !== '')
            {
                call.setSink(speaker);
            }

            const got = await microphone();

            if (round !== joins || untrack(table) !== next)
            {
                stopTracks(got);
                return;
            }

            stream = got;

            const quiet = stream === null || (!pushToTalk() && untrack(settings.settings).voiceStartMuted);

            setMuted(quiet);
            gate();
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
            if (untrack(table) === null || untrack(mic) !== 'live')
            {
                return;
            }

            setMuted(!untrack(muted));

            if (!untrack(muted))
            {
                setDeaf(false);
                applyVolume();
            }

            gate();
            announce();
        },

        toggleDeafen()
        {
            if (untrack(table) === null)
            {
                return;
            }

            if (untrack(deaf))
            {
                setDeaf(false);
                setMuted(untrack(mic) !== 'live' || mutedBeforeDeaf);
            }
            else
            {
                mutedBeforeDeaf = untrack(muted);
                setDeaf(true);
                setMuted(true);
            }

            applyVolume();
            gate();
            announce();
        },

        press,

        release: letGo,

        silence(who)
        {
            setLevel(who, own(who) === 0 ? 1 : 0);
        },

        setLevel,

        applyVolume,

        survey,

        async useMic(id)
        {
            settings.update({ voiceMic: id });

            if (untrack(table) === null || call === null || untrack(mic) !== 'live')
            {
                return;
            }

            const round = joins;
            const next = await microphone();

            if (next === null || call === null || round !== joins)
            {
                stopTracks(next);
                return;
            }

            stopStream();
            stream = next;
            await call.setMic(next);
            gate();
        },

        useSpeaker(id)
        {
            settings.update({ voiceSpeaker: id });
            call?.setSink(id);
        },

        start()
        {
            const devices = media();
            const changed = (): void => void survey();

            devices?.addEventListener?.('devicechange', changed);

            const down = (event: KeyboardEvent): void =>
            {
                if (event.code === talkKey() && !event.repeat && pushToTalk() && untrack(table) !== null && !typing(event.target))
                {
                    event.preventDefault();
                    press();
                }
            };

            const up = (event: KeyboardEvent): void =>
            {
                if (event.code === talkKey())
                {
                    letGo();
                }
            };

            const blur = (): void => letGo();

            if (typeof window !== 'undefined')
            {
                window.addEventListener('keydown', down);
                window.addEventListener('keyup', up);
                window.addEventListener('blur', blur);
            }

            const stops = [
                realtime.onVoice(onVoice),
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
                devices?.removeEventListener?.('devicechange', changed);

                if (typeof window !== 'undefined')
                {
                    window.removeEventListener('keydown', down);
                    window.removeEventListener('keyup', up);
                    window.removeEventListener('blur', blur);
                }

                for (const stop of stops)
                {
                    stop();
                }
            };
        },

        reset()
        {
            teardown();
            setVolumes({});
            setInputs([]);
            setOutputs([]);
        }
    };
});
