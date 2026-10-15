import { createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import { runtime } from '../lib/runtime.ts';
import type { GateReading } from '../services/voice.gate.ts';
import { canDenoise, createDenoiser } from '../services/voice.denoise.ts';
import { createVoiceInput, type InputOptions, type VoiceInput } from '../services/voice.input.ts';
import { hearsOpus } from '../services/voice.relay.ts';
import { createVoiceCall, type PeerLink, type VoiceCall, type VoiceCallDeps } from '../services/voice.rtc.ts';
import { useAccount } from './account.store.ts';
import { useRealtime, type SignalFrame, type SoundFrame, type VoiceFrame } from './realtime.store.ts';
import { useSettings, type VoiceNoise } from './settings.store.ts';

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
    reading: Getter<GateReading | null>;
    suppression: Getter<VoiceNoise | null>;
    canPickSpeaker(): boolean;
    speaking(who: string): boolean;
    unreached: Getter<readonly string[]>;
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
    tune(): void;
    reprocess(): Promise<void>;
    survey(): Promise<void>;
    useMic(id: string): Promise<void>;
    useSpeaker(id: string): void;
    start(): () => void;
    reset(): void;
}

const SPEAKING = 0.08;

export const SPEAKING_HOLD_MS = 400;

export const UNREACHED_MS = 10_000;

const QUIET = 0.04;

export const TALK_KEY = 'KeyV';

export const LOUDEST = 2;

let media: () => MediaDevices | null = () => (typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null);

export function setVoiceMedia(next: (() => MediaDevices | null) | null)
{
    media = next ?? (() => (typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null));
}

let makeCall: (deps: VoiceCallDeps) => VoiceCall = createVoiceCall;

export function setVoiceCall(next: ((deps: VoiceCallDeps) => VoiceCall) | null)
{
    makeCall = next ?? createVoiceCall;
}

const typing = (target: EventTarget | null) =>
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
    const [mine, setMine] = createSignal('');
    const [links, setLinks] = createSignal<Record<string, PeerLink>>({});
    const [loud, setLoud] = createSignal<ReadonlySet<string>>(new Set());
    const [unreached, setUnreached] = createSignal<readonly string[]>([]);
    const waits = new Map<string, () => void>();

    const reached = (who: string) =>
    {
        waits.get(who)?.();
        waits.delete(who);
        setUnreached((held) => held.includes(who) ? held.filter((one) => one !== who) : held);
    };

    const awaited = (who: string) =>
    {
        if (!waits.has(who) && !untrack(unreached).includes(who))
        {
            waits.set(who, runtime().clock.after(UNREACHED_MS, () =>
            {
                waits.delete(who);
                setUnreached((held) => held.includes(who) ? held : [...held, who]);
            }));
        }
    };
    const before = new Map<string, number>();
    const [inputs, setInputs] = createSignal<MediaChoice[]>([]);
    const [outputs, setOutputs] = createSignal<MediaChoice[]>([]);
    const [reading, setReading] = createSignal<GateReading | null>(null);
    const [suppression, setSuppression] = createSignal<VoiceNoise | null>(null);
    let refused = false;

    let call: VoiceCall | null = null;
    let stream: MediaStream | null = null;
    let input: VoiceInput | null = null;
    let unread: (() => void) | null = null;
    let context: AudioContext | null = null;
    let unstir: (() => void) | null = null;
    let mutedBeforeDeaf = true;
    let unhold: (() => void) | null = null;
    let opus = false;

    const me = () => untrack(account.user)?.id ?? '';

    const master = () => Math.min(Math.max(untrack(settings.settings).voiceVolume, 0), 1);

    const own = (who: string) => untrack(settings.settings).voiceLevels[who] ?? 1;

    const heard = (who: string) => (untrack(deaf) ? 0 : master() * own(who));

    const pushToTalk = () => untrack(settings.settings).voicePushToTalk;

    const talkKey = () => untrack(settings.settings).voiceTalkKey || TALK_KEY;

    const options = (): InputOptions =>
    {
        const current = untrack(settings.settings);

        return {
            volume: current.voiceInput,
            push: current.voicePushToTalk,
            pressed: untrack(talking),
            linger: current.voiceRelease,
            auto: current.voiceAuto,
            threshold: current.voiceThreshold
        };
    };

    const gate = () =>
    {
        call?.setMuted(untrack(muted) || untrack(deaf) || (pushToTalk() && !untrack(talking) && !processed()));
        input?.set(options());
    };

    const processed = () => input !== null && context?.state === 'running';

    const sending = () => (processed() ? input!.stream : stream);

    const strong = () => untrack(settings.settings).voiceNoise === 'strong' && canDenoise(context) && !refused;

    const unprocess = () =>
    {
        unread?.();
        unread = null;
        input?.close();
        input = null;
        setReading(null);
        setSuppression(null);
    };

    const process = async (raw: MediaStream | null) =>
    {
        unprocess();

        if (raw === null || context === null)
        {
            return;
        }

        const wanted = untrack(settings.settings).voiceNoise;

        try
        {
            const denoiser = strong() ? await createDenoiser(context) : null;

            if (strong() && denoiser === null)
            {
                refused = true;
            }

            const made = await createVoiceInput(context, raw, options(), denoiser);

            if (stream !== raw)
            {
                made.close();
                return;
            }

            input = made;
            unread = made.onReading((next) => setReading(next));
            setSuppression(denoiser !== null ? 'strong' : (wanted === 'off' ? 'off' : 'standard'));
        }
        catch
        {
            input = null;
        }
    };

    const fading = new Map<string, () => void>();

    const hush = (who: string) =>
    {
        fading.get(who)?.();
        fading.delete(who);
    };

    const level = (who: string, value: number) =>
    {
        if (value >= SPEAKING)
        {
            hush(who);
            setLoud((current) => current.has(who) ? current : new Set([...current, who]));
            return;
        }

        if (value < QUIET && untrack(loud).has(who) && !fading.has(who))
        {
            fading.set(who, runtime().clock.after(SPEAKING_HOLD_MS, () =>
            {
                fading.delete(who);
                setLoud((current) => new Set([...current].filter((one) => one !== who)));
            }));
        }
    };

    const stopTracks = (held: MediaStream | null) =>
    {
        for (const track of held?.getTracks() ?? [])
        {
            track.stop();
        }
    };

    const stopStream = () =>
    {
        stopTracks(stream);
        stream = null;
    };

    let joins = 0;

    const stir = () =>
    {
        if (context !== null && context.state === 'suspended')
        {
            void context.resume().catch(() => undefined);
        }
    };

    const teardown = () =>
    {
        joins += 1;
        unhold?.();
        unhold = null;
        unstir?.();
        unstir = null;
        call?.close();
        call = null;
        unprocess();
        stopStream();

        void context?.close().catch(() => undefined);
        context = null;

        for (const cancel of waits.values())
        {
            cancel();
        }

        waits.clear();
        setUnreached([]);

        setTable(null);
        setJoining(false);
        setRoster([]);
        setMine('');
        setLinks({});

        for (const who of [...fading.keys()])
        {
            hush(who);
        }

        setLoud(new Set<string>());
        setMic('off');
        setMuted(true);
        setDeaf(false);
        setTalking(false);
    };

    const onVoice = (frame: VoiceFrame) =>
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
        setMine(frame.mine);

        call?.sync(frame.mine, frame.peers.filter((peer) => peer.talk && peer.join !== frame.mine).map((peer) => ({ who: peer.who, join: peer.join, opus: peer.opus })));
    };

    const sounded = (frame: SoundFrame) =>
    {
        if (frame.table === untrack(table))
        {
            call?.heard(frame.join, frame.codec, frame.at, frame.data);
        }
    };

    const signalled = (frame: SignalFrame) =>
    {
        if (frame.table === untrack(table))
        {
            void call?.receive(frame.join, { kind: frame.kind, data: frame.data });
        }
    };

    const survey = async () =>
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

        const current = untrack(settings.settings);

        try
        {
            const got = await devices.getUserMedia({
                audio: {
                    echoCancellation: current.voiceEcho,
                    noiseSuppression: current.voiceNoise === 'standard' || (current.voiceNoise === 'strong' && !strong()),
                    autoGainControl: current.voiceAgc,
                    channelCount: 1,
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
        const self = mine();
        const state = links();
        const speaking = loud();
        const own = settings.settings().voiceLevels;
        const lost = unreached();

        return roster().map((peer) => ({
            who: peer.who,
            me: peer.join === self,
            muted: peer.muted,
            talk: peer.talk,
            link: peer.join === self ? 'connected' : (lost.includes(peer.who) ? 'failed' : (state[peer.who] ?? null)),
            speaking: speaking.has(peer.who) && !peer.muted,
            silenced: (own[peer.who] ?? 1) === 0,
            volume: own[peer.who] ?? 1
        }));
    };

    const applyVolume = () =>
    {
        for (const peer of untrack(roster))
        {
            call?.setVolume(peer.who, heard(peer.who));
        }
    };

    const setLevel = (who: string, value: number) =>
    {
        const level = Math.min(Math.max(value, 0), LOUDEST);
        const others = Object.entries(untrack(settings.settings).voiceLevels).filter(([one]) => one !== who);

        settings.update({ voiceLevels: Object.fromEntries(level === 1 ? others : [...others, [who, level]]) });
        call?.setVolume(who, heard(who));
    };

    const press = () =>
    {
        if (untrack(table) === null || untrack(talking))
        {
            return;
        }

        setTalking(true);
        gate();
    };

    const letGo = () =>
    {
        if (!untrack(talking))
        {
            return;
        }

        setTalking(false);
        gate();
    };

    const announce = () =>
    {
        const current = untrack(table);

        if (current !== null)
        {
            realtime.voice(current, true, untrack(muted), opus);
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
        reading,
        suppression,

        canPickSpeaker: () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,

        speaking: (who) => loud().has(who) && roster().some((peer) => peer.who === who && !peer.muted),

        unreached,

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

        volumeOf: (who) => settings.settings().voiceLevels[who] ?? 1,

        async join(next)
        {
            if (untrack(table) === next)
            {
                return;
            }

            if (untrack(table) !== null)
            {
                realtime.voice(untrack(table)!, false, true, opus);
                teardown();
            }

            setTable(next);
            setJoining(true);
            unhold?.();
            unhold = realtime.hold();

            const round = ++joins;
            const [ice, hears] = await Promise.all([client.voice.ice().catch(() => ({ servers: [] })), hearsOpus()]);

            if (round !== joins || untrack(table) !== next)
            {
                return;
            }

            opus = hears;

            const Context = typeof AudioContext === 'undefined' ? null : AudioContext;
            const made = Context === null ? null : new Context({ latencyHint: 'interactive' });

            context = made;

            if (made !== null)
            {
                made.onstatechange = () =>
                {
                    if (context === made && made.state === 'running')
                    {
                        void call?.setMic(sending());
                        gate();
                    }
                };
            }

            if (typeof window !== 'undefined')
            {
                window.addEventListener('pointerdown', stir);
                window.addEventListener('keydown', stir);
                unstir = () =>
                {
                    window.removeEventListener('pointerdown', stir);
                    window.removeEventListener('keydown', stir);
                };
            }

            call = makeCall({
                me,
                iceServers: ice.servers.map((server) => ({
                    urls: server.urls,
                    ...(server.username === undefined ? {} : { username: server.username }),
                    ...(server.credential === undefined ? {} : { credential: server.credential })
                })),
                send: (to, join, signal) => realtime.signal(next, to, join, signal.kind, signal.data),
                relay: (to, codec, at, data) => realtime.sound(next, to, codec, at, data),
                opus,
                after: (ms, run) => runtime().clock.after(ms, run),
                rtt: () => untrack(realtime.rtt),
                onLink: (who, link) =>
                {
                    if (link === 'connected' || link === null)
                    {
                        reached(who);
                    }
                    else
                    {
                        awaited(who);
                    }

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
            stir();
            await process(got);

            if (round !== joins || untrack(table) !== next)
            {
                return;
            }

            if (refused && got !== null && untrack(settings.settings).voiceNoise === 'strong')
            {
                const again = await microphone();

                if (round !== joins || untrack(table) !== next)
                {
                    stopTracks(again);
                    return;
                }

                if (again !== null)
                {
                    stopStream();
                    stream = again;
                    await process(again);
                }
            }

            const quiet = stream === null || (!pushToTalk() && untrack(settings.settings).voiceStartMuted);

            setMuted(quiet);
            gate();
            await call.setMic(sending());

            realtime.voice(next, true, quiet, opus);
            setJoining(false);
        },

        leave()
        {
            const current = untrack(table);

            if (current !== null)
            {
                realtime.voice(current, false, true, opus);
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
            if (own(who) === 0)
            {
                setLevel(who, before.get(who) ?? 1);
                before.delete(who);
                return;
            }

            before.set(who, own(who));
            setLevel(who, 0);
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
            await process(next);

            if (round !== joins || call === null)
            {
                return;
            }

            await call.setMic(sending());
            gate();
        },

        tune()
        {
            input?.set(options());
            gate();
        },

        async reprocess()
        {
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
            await process(next);

            if (round !== joins || call === null)
            {
                return;
            }

            await call.setMic(sending());
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

            const down = (event: KeyboardEvent) =>
            {
                if (event.code === talkKey() && !event.repeat && pushToTalk() && untrack(table) !== null && !typing(event.target))
                {
                    event.preventDefault();
                    press();
                }
            };

            const up = (event: KeyboardEvent) =>
            {
                if (event.code === talkKey())
                {
                    letGo();
                }
            };

            const blur = () => letGo();

            if (typeof window !== 'undefined')
            {
                window.addEventListener('keydown', down);
                window.addEventListener('keyup', up);
                window.addEventListener('blur', blur);
            }

            const stops = [
                realtime.onVoice(onVoice),
                realtime.onSignal(signalled),
                realtime.onSound(sounded),
                realtime.onStatus((status) =>
                {
                    const current = untrack(table);

                    if (status === 'connected' && current !== null && !untrack(joining))
                    {
                        call?.sync('', []);
                        realtime.voice(current, true, untrack(muted), opus);
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
            before.clear();
            setInputs([]);
            setOutputs([]);
        }
    };
});
