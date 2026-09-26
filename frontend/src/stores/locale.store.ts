import { createStore, createSignal, setLocale as setDocumentLocale, useLocale as useDocumentLocale, type Getter } from 'azerothjs';

import { runtime } from '../lib/runtime.ts';
import { pickText, type LocalizedText } from '../lib/text.ts';

import type { MessageKey } from '../locales/en.ts';
import { landing as enLanding } from '../locales/en/landing.ts';
import { interpolate, relativeUnit, resolveMessage, type Message, type MessageVars } from '../locales/format.ts';

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

type Catalogue = Partial<Record<MessageKey, Message>>;

const CATALOG: Record<Locale, Catalogue> = { en: { ...enLanding }, fa: {} };

const present = new Set<Locale>(['en']);

export function registerCatalogue(pages: Record<Locale, Catalogue>): void
{
    for (const locale of LOCALES)
    {
        Object.assign(CATALOG[locale], pages[locale]);
        if (Object.keys(pages[locale]).length > 0)
        {
            present.add(locale);
        }
    }
}

export async function loadCatalogue(locale: Locale): Promise<void>
{
    if (present.has(locale))
    {
        return;
    }
    const { landing } = await import('../locales/fa/landing.ts');
    registerCatalogue({ en: {}, fa: landing });
}

function isLocale(value: string | null | undefined): value is Locale
{
    return value !== undefined && value !== null && (LOCALES as string[]).includes(value);
}

function initial(): Locale
{
    const pinned = useDocumentLocale()();
    return isLocale(pinned) ? pinned : 'en';
}

const formatters = new Map<string, unknown>();

function cached<T>(kind: string, tag: string, options: unknown, build: () => T): T
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

    n(value: number, options?: Intl.NumberFormatOptions): string;
    relative(at: number | Date, now?: number): string;
    date(at: number | Date, options?: Intl.DateTimeFormatOptions): string;
    list(items: readonly string[], options?: Intl.ListFormatOptions): string;
    text(value: LocalizedText | string): string;
}

export const useLocale = createStore((): LocaleApi =>
{
    const [locale, setSignal] = createSignal<Locale>(initial());

    const tag = (): string => LOCALE_TAG[locale()];

    const apply = (next: Locale): void =>
    {
        setSignal(next);
        setDocumentLocale(next);
    };

    const numbers = (options?: Intl.NumberFormatOptions): Intl.NumberFormat =>
        cached('number', tag(), options, () => new Intl.NumberFormat(tag(), options));

    const rules = (): Intl.PluralRules =>
        cached('plural', tag(), null, () => new Intl.PluralRules(tag()));

    const n = (value: number, options?: Intl.NumberFormatOptions): string => numbers(options).format(value);

    const t = (key: MessageKey, vars?: MessageVars): string =>
    {
        const message = CATALOG[locale()][key] ?? CATALOG.en[key] ?? key;
        return interpolate(resolveMessage(message, vars, rules()), vars, (value) => n(value));
    };

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
        n,
        relative: (at, now) =>
        {
            const stamp = at instanceof Date ? at.getTime() : at;
            const { unit, value } = relativeUnit(stamp - (now ?? runtime().clock.now()));
            return cached('relative', tag(), null, () => new Intl.RelativeTimeFormat(tag(), { numeric: 'auto' })).format(value, unit);
        },
        date: (at, options) =>
            cached('date', tag(), options, () => new Intl.DateTimeFormat(tag(), options)).format(at),
        list: (items, options) =>
            cached('list', tag(), options, () => new Intl.ListFormat(tag(), options)).format(items),
        text: (value) => pickText(value, locale())
    };
});
