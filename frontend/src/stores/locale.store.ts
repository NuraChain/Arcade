import { createStore, createSignal, setLocale as setDocumentLocale, useLocale as useDocumentLocale, type Getter } from 'azerothjs';

import { runtime } from '../lib/runtime.ts';
import { pickText, type LocalizedText } from '../lib/text.ts';

import type { MessageKey } from '../locales/en.ts';
import { landing as enLanding } from '../locales/en/landing.ts';
import { interpolate, relativeUnit, resolveMessage, type Message, type MessageVars } from '../locales/format.ts';

export type Locale = 'en' | 'fa' | 'ar' | 'es' | 'pt' | 'hi' | 'zh' | 'ru' | 'fr' | 'tr';

export const LOCALES: Locale[] = ['en', 'fa', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'];

export const LOCALE_LABEL: Record<Locale, string> = {
    en: 'English',
    fa: 'فارسی',
    ar: 'العربية',
    es: 'Español',
    pt: 'Português',
    hi: 'हिन्दी',
    zh: '中文',
    ru: 'Русский',
    fr: 'Français',
    tr: 'Türkçe'
};

export const LOCALE_DIR: Record<Locale, 'ltr' | 'rtl'> = {
    en: 'ltr',
    fa: 'rtl',
    ar: 'rtl',
    es: 'ltr',
    pt: 'ltr',
    hi: 'ltr',
    zh: 'ltr',
    ru: 'ltr',
    fr: 'ltr',
    tr: 'ltr'
};

export const LOCALE_TAG: Record<Locale, string> = {
    en: 'en-US',
    fa: 'fa-IR',
    // ar-SA formats dates in the Hijri calendar in Chromium; Egypt's tag keeps the Gregorian one.
    ar: 'ar-EG',
    es: 'es-ES',
    pt: 'pt-BR',
    hi: 'hi-IN',
    zh: 'zh-CN',
    ru: 'ru-RU',
    fr: 'fr-FR',
    tr: 'tr-TR'
};

type Catalogue = Partial<Record<MessageKey, Message>>;

const CATALOG = Object.fromEntries(LOCALES.map((locale) => [locale, locale === 'en' ? { ...enLanding } : {}])) as Record<Locale, Catalogue>;

const present = new Set<Locale>(['en']);

export function registerCatalogue(pages: Partial<Record<Locale, Catalogue>>)
{
    for (const [locale, catalogue] of Object.entries(pages) as Array<[Locale, Catalogue]>)
    {
        Object.assign(CATALOG[locale], catalogue);
        if (Object.keys(catalogue).length > 0)
        {
            present.add(locale);
        }
    }
}

// English and Persian ride the app's own catalogue chunks (frontend/CLAUDE.md, *The app catalogue
// is NOT split by language*); every other language is one chunk of its own, fetched by its reader.
const WHOLE: Partial<Record<Locale, () => Promise<Catalogue>>> = {
    ar: async () => (await import('../locales/ar/index.ts')).ar,
    es: async () => (await import('../locales/es/index.ts')).es,
    pt: async () => (await import('../locales/pt/index.ts')).pt,
    hi: async () => (await import('../locales/hi/index.ts')).hi,
    zh: async () => (await import('../locales/zh/index.ts')).zh,
    ru: async () => (await import('../locales/ru/index.ts')).ru,
    fr: async () => (await import('../locales/fr/index.ts')).fr,
    tr: async () => (await import('../locales/tr/index.ts')).tr
};

export async function loadCatalogue(locale: Locale)
{
    if (present.has(locale))
    {
        return;
    }
    const whole = WHOLE[locale];
    if (whole !== undefined)
    {
        registerCatalogue({ [locale]: await whole() });
        return;
    }
    const { landing } = await import('../locales/fa/landing.ts');
    registerCatalogue({ fa: landing });
}

export function messageOf(at: Locale, key: MessageKey)
{
    return CATALOG[at][key] ?? CATALOG.en[key] ?? key;
}

export function isLocale(value: string | null | undefined): value is Locale
{
    return value !== undefined && value !== null && (LOCALES as string[]).includes(value);
}

function initial()
{
    const pinned = useDocumentLocale()();
    return isLocale(pinned) ? pinned : 'en';
}

const formatters = new Map<string, unknown>();

function cached<T>(kind: string, tag: string, options: unknown, build: () => T)
{
    const key = `${ kind }|${ tag }|${ JSON.stringify(options ?? null) }`;
    const existing = formatters.get(key);
    if (existing !== undefined)
    {
        return existing as T;
    }
    const built = build();
    formatters.set(key, built);
    return built;
}

export interface LocaleApi
{
    locale: Getter<Locale>;
    dir: Getter<'ltr' | 'rtl'>;
    tag: Getter<string>;
    setLocale(next: Locale): void;

    t(key: MessageKey, vars?: MessageVars): string;
    plural(key: MessageKey, count: number, vars?: MessageVars): string;
    ordinal(key: MessageKey, count: number): string;

    n(value: number, options?: Intl.NumberFormatOptions): string;
    relative(at: number | Date, options?: { now?: number; style?: 'long' | 'short' }): string;
    date(at: number | Date, options?: Intl.DateTimeFormatOptions): string;
    list(items: readonly string[], options?: Intl.ListFormatOptions): string;
    text(value: LocalizedText | string): string;
}

export const useLocale = createStore((): LocaleApi =>
{
    const [locale, setSignal] = createSignal<Locale>(initial());

    const tag = () => LOCALE_TAG[locale()];

    const apply = (next: Locale) =>
    {
        setSignal(next);
        setDocumentLocale(next);
    };

    const numbers = (options?: Intl.NumberFormatOptions): Intl.NumberFormat =>
        cached('number', tag(), options, () => new Intl.NumberFormat(tag(), options));

    const rules = (): Intl.PluralRules =>
        cached('plural', tag(), null, () => new Intl.PluralRules(tag()));

    const ordinals = (): Intl.PluralRules =>
        cached('ordinal', tag(), null, () => new Intl.PluralRules(tag(), { type: 'ordinal' }));

    const n = (value: number, options?: Intl.NumberFormatOptions) => numbers(options).format(value);

    const say = (key: MessageKey, vars: MessageVars | undefined, by: Intl.PluralRules) =>
    {
        return interpolate(resolveMessage(messageOf(locale(), key), vars, by), vars, (value) => n(value));
    };

    const t = (key: MessageKey, vars?: MessageVars) => say(key, vars, rules());

    return {
        locale,
        dir: () => LOCALE_DIR[locale()],
        tag,
        setLocale: (next) =>
        {
            if (present.has(next))
            {
                apply(next);
                return;
            }
            void loadCatalogue(next).then(() => apply(next));
        },
        t,
        plural: (key, count, vars) => t(key, { ...vars, count }),
        ordinal: (key, count) => say(key, { count }, ordinals()),
        n,
        relative: (at, options = {}) =>
        {
            const stamp = at instanceof Date ? at.getTime() : at;
            const style = options.style ?? 'long';
            const { unit, value } = relativeUnit(stamp - (options.now ?? runtime().clock.now()));
            return cached('relative', tag(), { style }, () => new Intl.RelativeTimeFormat(tag(), { numeric: 'auto', style })).format(value, unit);
        },
        date: (at, options) =>
            cached('date', tag(), options, () => new Intl.DateTimeFormat(tag(), options)).format(at),
        list: (items, options) =>
            cached('list', tag(), options, () => new Intl.ListFormat(tag(), options)).format(items),
        text: (value) => pickText(value, locale())
    };
});
