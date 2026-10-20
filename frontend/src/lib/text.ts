import type { Locale } from '../stores/locale.store.ts';

export type LocalizedText = Record<Locale, string>;

export function pickText(text: LocalizedText | string, locale: Locale)
{
    return typeof text === 'string' ? text : text[locale];
}
