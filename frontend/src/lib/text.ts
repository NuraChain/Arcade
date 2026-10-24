import type { Locale } from '../stores/locale.store.ts';

/** What the server writes in two languages; every other reader is given the English. */
export interface LocalizedText
{
    en: string;
    fa: string;
}

export function pickText(text: LocalizedText | string, locale: Locale)
{
    if (typeof text === 'string')
    {
        return text;
    }
    return locale === 'fa' ? text.fa : text.en;
}
