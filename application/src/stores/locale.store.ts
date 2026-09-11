import { createStore, createSignal, type Getter } from 'azerothjs';

import { remember } from '../lib/storage.ts';

import { en, type Dictionary, type MessageKey } from '../locales/en.ts';
import { fa } from '../locales/fa.ts';

export type Locale = 'en' | 'fa';

export const LOCALES: Locale[] = ['en', 'fa'];

export const LOCALE_LABEL: Record<Locale, string> = {
    en: 'English',
    fa: 'فارسی'
};

export const LOCALE_DIR: Record<Locale, 'ltr' | 'rtl'> = {
    en: 'ltr',
    fa: 'rtl'
};

export const LOCALE_TAG: Record<Locale, string> = {
    en: 'en-US',
    fa: 'fa-IR'
};

const CATALOG: Record<Locale, Dictionary> = { en, fa };

const STORAGE_KEY = 'nura-games.locale';

function isLocale(value: string | null | undefined): value is Locale
{
    return value !== undefined && value !== null && (LOCALES as string[]).includes(value);
}

function initial(): Locale
{
    if (typeof document === 'undefined')
    {
        return 'en';
    }
    const stamped = document.documentElement.lang;
    return isLocale(stamped) ? stamped : 'en';
}

export interface LocaleApi
{
    locale: Getter<Locale>;
    dir: Getter<'ltr' | 'rtl'>;
    setLocale(next: Locale): void;

    t(key: MessageKey): string;

    n(value: number): string;
}

export const useLocale = createStore((): LocaleApi =>
{
    const [locale, setSignal] = createSignal<Locale>(initial());

    const apply = (next: Locale): void =>
    {
        if (typeof document === 'undefined')
        {
            return;
        }
        const root = document.documentElement;
        root.lang = next;
        root.dir = LOCALE_DIR[next];
        remember(STORAGE_KEY, next);
    };

    return {
        locale,
        dir: () => LOCALE_DIR[locale()],
        setLocale: (next) =>
        {
            setSignal(next);
            apply(next);
        },
        t: (key) => CATALOG[locale()][key],
        n: (value) => new Intl.NumberFormat(LOCALE_TAG[locale()]).format(value)
    };
});
