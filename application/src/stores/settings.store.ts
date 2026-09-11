import { createStore, createSignal, type Getter } from 'azerothjs';

import { forget, recallJson, rememberJson } from '../lib/storage.ts';

export type NotificationCategory = 'invites' | 'requests' | 'results' | 'messages' | 'achievements';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ['invites', 'requests', 'results', 'messages', 'achievements'];

/**
 * What this DEVICE prefers. Nothing here is privacy and nothing here is social.
 *
 * Mutes moved to `social.store.ts` and the privacy switches moved to the server, because both
 * belong to the account rather than the browser: a mute that only exists in one browser's
 * localStorage is a mute the other device keeps notifying you through, and a privacy switch the
 * client holds is a privacy switch the client can turn off.
 */
export interface Settings
{
    sound: boolean;
    haptics: boolean;
    railWidth: number;
    railOpen: boolean;
    notifications: Record<NotificationCategory, boolean>;
}

const STORAGE_KEY = 'nura-games.settings';

export function defaultSettings(): Settings
{
    return {
        sound: false,
        haptics: true,
        railWidth: 0.3,
        railOpen: true,
        notifications: { invites: true, requests: true, results: true, messages: true, achievements: true }
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

    const write = (next: Settings): void =>
    {
        setSettings(next);
        rememberJson(STORAGE_KEY, next);
    };

    return {
        settings,
        update: (patch) => write({ ...settings(), ...patch }),
        reset: () =>
        {
            setSettings(defaultSettings());
            forget(STORAGE_KEY);
        }
    };
});
