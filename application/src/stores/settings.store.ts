import { createStore, createSignal, type Getter } from 'azerothjs';

import type { GameId } from '../data/games.ts';
import { forget, recallJson, rememberJson } from '../lib/storage.ts';

export type NotificationCategory = 'invites' | 'requests' | 'results' | 'messages' | 'achievements';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ['invites', 'requests', 'results', 'messages', 'achievements'];

export interface Settings
{
    sound: boolean;
    haptics: boolean;
    railWidth: number;
    railOpen: boolean;
    notifications: Record<NotificationCategory, boolean>;
    mutedConversations: string[];
    mutedGames: GameId[];
    strangerMessages: boolean;
    showOnline: boolean;
}

const STORAGE_KEY = 'nura-games.settings';

export function defaultSettings(): Settings
{
    return {
        sound: false,
        haptics: true,
        railWidth: 0.3,
        railOpen: true,
        notifications: { invites: true, requests: true, results: true, messages: true, achievements: true },
        mutedConversations: [],
        mutedGames: [],
        strangerMessages: true,
        showOnline: true
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
    toggleMutedConversation(id: string): void;
    toggleMutedGame(game: GameId): void;
    isMuted(conversationId: string): boolean;
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

    const toggle = <T>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]);

    return {
        settings,
        update: (patch) => write({ ...settings(), ...patch }),
        toggleMutedConversation: (id) => write({ ...settings(), mutedConversations: toggle(settings().mutedConversations, id) }),
        toggleMutedGame: (game) => write({ ...settings(), mutedGames: toggle(settings().mutedGames, game) }),
        isMuted: (conversationId) => settings().mutedConversations.includes(conversationId),
        reset: () =>
        {
            setSettings(defaultSettings());
            forget(STORAGE_KEY);
        }
    };
});
