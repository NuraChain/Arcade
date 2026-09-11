import type { Locale } from '../stores/locale.store.ts';

export type LocalizedText = Record<Locale, string>;

export function pickText(text: LocalizedText | string, locale: Locale): string
{
    return typeof text === 'string' ? text : text[locale];
}

export function isLocalizedText(value: unknown): value is LocalizedText
{
    return typeof value === 'object' && value !== null
        && typeof (value as Record<string, unknown>).en === 'string'
        && typeof (value as Record<string, unknown>).fa === 'string';
}
