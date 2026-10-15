import { createStore, createSignal, type Getter } from 'azerothjs';

import { forget, recallJson, rememberJson } from '../lib/storage.ts';

export interface Settings
{
    sound: boolean;
    haptics: boolean;
    railOpen: boolean;
    sidebarOpen: boolean;
    tableSidebarOpen: boolean;
    recentEmoji: string[];
    voiceStartMuted: boolean;
    voiceAutoJoin: boolean;
    voiceVolume: number;
    voiceTables: boolean;
    voiceTeam: boolean;
    voicePushToTalk: boolean;
    voiceTalkKey: string;
    voiceMic: string;
    voiceSpeaker: string;
    voiceLevels: Record<string, number>;
    voiceNoise: VoiceNoise;
    voiceEcho: boolean;
    voiceAgc: boolean;
    voiceInput: number;
    voiceAuto: boolean;
    voiceThreshold: number;
    voiceRelease: number;
    voiceQuality: VoiceQuality;
    hintMoves: boolean;
    hintOutcome: boolean;
    hintRules: boolean;
    quickAsks: Record<string, unknown>;
    notify: boolean;
}

export type VoiceNoise = 'off' | 'standard' | 'strong';

export type VoiceQuality = 'standard' | 'high' | 'best';

const STORAGE_KEY = 'nura-games.settings';

export function defaultSettings(): Settings
{
    return {
        sound: true,
        haptics: true,
        railOpen: false,
        sidebarOpen: true,
        tableSidebarOpen: false,
        recentEmoji: [],
        voiceStartMuted: false,
        voiceAutoJoin: true,
        voiceVolume: 1,
        voiceTables: false,
        voiceTeam: false,
        voicePushToTalk: false,
        voiceTalkKey: 'KeyV',
        voiceMic: '',
        voiceSpeaker: '',
        voiceLevels: {},
        voiceNoise: 'standard',
        voiceEcho: true,
        voiceAgc: true,
        voiceInput: 1,
        voiceAuto: true,
        voiceThreshold: -50,
        voiceRelease: 200,
        voiceQuality: 'high',
        hintMoves: true,
        hintOutcome: true,
        hintRules: true,
        quickAsks: {},
        notify: false
    };
}

function isSettings(value: unknown): value is Partial<Settings>
{
    return typeof value === 'object' && value !== null;
}

function initial(): Settings
{
    if (typeof window === 'undefined')
    {
        return defaultSettings();
    }
    const stored = recallJson(STORAGE_KEY, isSettings);
    return stored === null ? defaultSettings() : { ...defaultSettings(), ...stored };
}

export interface SettingsApi
{
    settings: Getter<Settings>;
    update(patch: Partial<Settings>): void;
    reset(): void;
}

export const useSettings = createStore((): SettingsApi =>
{
    const [settings, setSettings] = createSignal<Settings>(initial());

    const same = (a: Settings, b: Settings) =>
        (Object.keys(a) as (keyof Settings)[]).every((key) => a[key] === b[key]);

    return {
        settings,
        update: (patch) => setSettings((current) =>
        {
            const next = { ...current, ...patch };
            if (same(next, current))
            {
                return current;
            }
            rememberJson(STORAGE_KEY, next);
            return next;
        }),
        reset: () =>
        {
            setSettings(defaultSettings());
            forget(STORAGE_KEY);
        }
    };
});
