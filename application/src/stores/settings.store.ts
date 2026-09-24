import { createStore, createSignal, type Getter } from 'azerothjs';

import { forget, recallJson, rememberJson } from '../lib/storage.ts';

export interface Settings
{
    sound: boolean;
    haptics: boolean;
    railOpen: boolean;
    sidebarOpen: boolean;
    recentEmoji: string[];
    voiceStartMuted: boolean;
    voiceAutoJoin: boolean;
    voiceVolume: number;
    voiceTables: boolean;
    voicePushToTalk: boolean;
    voiceTalkKey: string;
    voiceMic: string;
    voiceSpeaker: string;
    hintMoves: boolean;
    hintOutcome: boolean;
    hintRules: boolean;
}

const STORAGE_KEY = 'nura-games.settings';

export function defaultSettings(): Settings
{
    return {
        sound: true,
        haptics: true,
        railOpen: false,
        sidebarOpen: true,
        recentEmoji: [],
        voiceStartMuted: true,
        voiceAutoJoin: false,
        voiceVolume: 1,
        voiceTables: false,
        voicePushToTalk: false,
        voiceTalkKey: 'KeyV',
        voiceMic: '',
        voiceSpeaker: '',
        hintMoves: true,
        hintOutcome: true,
        hintRules: true
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

    const same = (a: Settings, b: Settings): boolean =>
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
