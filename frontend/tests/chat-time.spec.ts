import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../src/locales/app-catalogue.ts';
import { seenOf, stampOf } from '../src/components/chat/chat-time.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const NOON = new Date(2026, 8, 23, 12, 0).getTime();

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

const say = (tag: string, at: number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, options).format(at);

const persian = async () =>
{
    useLocale().setLocale('fa');
    await vi.waitFor(() => expect(useLocale().t('chat.seen.now')).toBe('همین الان آنلاین بود'));
};

beforeEach(() =>
{
    useLocale().setLocale('en');
});

describe('when a room was last spoken in, as the list says it', () =>
{
    const today = new Date(2026, 8, 23, 9, 5).getTime();
    const week = new Date(2026, 8, 19, 9, 5).getTime();
    const month = new Date(2026, 7, 3, 9, 5).getTime();
    const old = new Date(2024, 7, 3, 9, 5).getTime();

    it('is the time, the weekday, the date, or the date and its year', () =>
    {
        const locale = useLocale();

        expect(stampOf(locale, today, NOON)).toBe(say('en-US', today, TIME));
        expect(stampOf(locale, week, NOON)).toBe(say('en-US', week, { weekday: 'short' }));
        expect(stampOf(locale, month, NOON)).toBe(say('en-US', month, { day: 'numeric', month: 'short' }));
        expect(stampOf(locale, old, NOON)).toBe(say('en-US', old, { day: 'numeric', month: 'short', year: 'numeric' }));
    });

    it('is the reader’s own calendar and digits', async () =>
    {
        await persian();

        const locale = useLocale();

        expect(stampOf(locale, today, NOON)).toBe(say('fa-IR', today, TIME));
        expect(stampOf(locale, week, NOON)).toBe(say('fa-IR', week, { weekday: 'short' }));
        expect(stampOf(locale, month, NOON)).toBe(say('fa-IR', month, { day: 'numeric', month: 'short' }));
        expect(stampOf(locale, old, NOON)).toBe(say('fa-IR', old, { day: 'numeric', month: 'short', year: 'numeric' }));
    });
});

describe('when somebody was last seen, as the head of a thread says it', () =>
{
    const yesterday = new Date(2026, 8, 22, 21, 40).getTime();
    const month = new Date(2026, 7, 3, 9, 5).getTime();
    const old = new Date(2024, 7, 3, 9, 5).getTime();

    it('says yesterday at a time, a date, or a date and its year', () =>
    {
        const locale = useLocale();

        expect(seenOf(locale, NOON - 30_000, NOON)).toBe('Last seen just now');
        expect(seenOf(locale, NOON - 61_000, NOON), 'whole minutes, never rounded up').toBe('Last seen 1 minute ago');
        expect(seenOf(locale, NOON - 59 * 60_000 - 59_000, NOON)).toBe('Last seen 59 minutes ago');
        expect(seenOf(locale, yesterday, NOON)).toBe(`Last seen yesterday at ${ say('en-US', yesterday, TIME) }`);
        expect(seenOf(locale, month, NOON)).toBe(`Last seen ${ say('en-US', month, { day: 'numeric', month: 'short' }) }`);
        expect(seenOf(locale, old, NOON)).toBe(`Last seen ${ say('en-US', old, { day: 'numeric', month: 'short', year: 'numeric' }) }`);
    });

    it('says it in Persian as people say it', async () =>
    {
        await persian();

        const locale = useLocale();

        expect(seenOf(locale, NOON - 2 * 60_000, NOON)).toBe('۲ دقیقه پیش آنلاین بود');
        expect(seenOf(locale, NOON - 3 * 3_600_000, NOON)).toBe(`امروز ساعت ${ say('fa-IR', NOON - 3 * 3_600_000, TIME) } آنلاین بود`);
        expect(seenOf(locale, yesterday, NOON)).toBe(`دیروز ساعت ${ say('fa-IR', yesterday, TIME) } آنلاین بود`);
        expect(seenOf(locale, month, NOON)).toBe(`${ say('fa-IR', month, { day: 'numeric', month: 'short' }) } آنلاین بود`);
    });
});
