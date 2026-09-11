import { createStore, createSignal, type Getter } from 'azerothjs';

import { remember } from '../lib/storage.ts';

import type { MessageKey } from '../locales/en.ts';

export type Theme = 'dark' | 'light';
export const THEMES: Theme[] = ['dark', 'light'];

const STORAGE_KEY = 'nura-games.theme';

export const THEME_LABEL: Record<Theme, MessageKey> = {
    dark: 'theme.dusk',
    light: 'theme.dawn'
};

function isTheme(value: string | null | undefined): value is Theme
{
    return value !== undefined && value !== null && (THEMES as string[]).includes(value);
}

function initial(): Theme
{
    if (typeof document === 'undefined')
    {
        return 'dark';
    }
    const stamped = document.documentElement.dataset.theme;
    return isTheme(stamped) ? stamped : 'dark';
}

export interface ThemeApi
{
    theme: Getter<Theme>;
    setTheme(next: Theme): void;
}

export const useTheme = createStore((): ThemeApi =>
{
    const [theme, setSignal] = createSignal<Theme>(initial());

    const apply = (next: Theme): void =>
    {
        if (typeof document === 'undefined')
        {
            return;
        }
        document.documentElement.dataset.theme = next;
        remember(STORAGE_KEY, next);
    };

    return {
        theme,
        setTheme: (next) =>
        {
            setSignal(next);
            apply(next);
        }
    };
});
