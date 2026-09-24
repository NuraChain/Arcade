import { describe, it, expect, beforeEach } from 'vitest';

import { LOCALE_DIR, useLocale } from '../src/stores/locale.store.ts';

beforeEach(() =>
{
    useLocale().setLocale('en');
});

describe('locale store', () =>
{
    it('stamps lang and dir together', () =>
    {
        useLocale().setLocale('fa');
        expect(document.documentElement.lang).toBe('fa');
        expect(document.documentElement.dir).toBe('rtl');

        useLocale().setLocale('en');
        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('agrees with its own direction table', () =>
    {
        useLocale().setLocale('fa');
        expect(useLocale().dir()).toBe(LOCALE_DIR.fa);
    });

    it('translates through the active catalogue', () =>
    {
        const locale = useLocale();
        expect(locale.t('games.hokm.name')).toBe('Hokm');
        locale.setLocale('fa');
        expect(locale.t('games.hokm.name')).toBe('حکم');
    });

    it('prints numbers in the reader’s own digits', () =>
    {
        const locale = useLocale();
        expect(locale.n(4)).toBe('4');
        locale.setLocale('fa');
        expect(locale.n(4)).toBe('۴');
    });
});

describe('storage', () =>
{
    it('lets the locale change when site data is blocked', () =>
    {
        const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get()
            {
                throw new Error('site data blocked');
            }
        });

        try
        {
            expect(() => useLocale().setLocale('fa')).not.toThrow();
            expect(document.documentElement.lang).toBe('fa');
        }
        finally
        {
            if (original !== undefined)
            {
                Object.defineProperty(window, 'localStorage', original);
            }
            useLocale().setLocale('en');
        }
    });
});
