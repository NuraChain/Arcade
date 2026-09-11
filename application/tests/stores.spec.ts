import { describe, it, expect, beforeEach } from 'vitest';

import { isPast, resolveDirection } from '../src/stores/scroll.store.ts';
import { LOCALE_DIR, useLocale } from '../src/stores/locale.store.ts';
import { useTheme } from '../src/stores/theme.store.ts';

beforeEach(() =>
{
    useLocale().setLocale('en');
    useTheme().setTheme('dark');
});

describe('scroll direction', () =>
{
    it('reads a real move in the direction it went', () =>
    {
        expect(resolveDirection('up', 100, 400).direction).toBe('down');
        expect(resolveDirection('down', 400, 100).direction).toBe('up');
    });

    it('HOLDS the previous direction through sub-pixel jitter', () =>
    {
        expect(resolveDirection('down', 400, 402).direction).toBe('down');
        expect(resolveDirection('up', 400, 398).direction).toBe('up');
    });

    it('does not move the anchor while jittering, so small moves cannot accumulate unseen', () =>
    {
        expect(resolveDirection('up', 400, 402).anchor).toBe(400);
        expect(resolveDirection('up', 400, 460).anchor).toBe(460);
    });

    it('keeps the header down only once it would cover content', () =>
    {
        expect(isPast(0)).toBe(false);
        expect(isPast(119)).toBe(false);
        expect(isPast(400)).toBe(true);
    });
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

describe('theme store', () =>
{
    it('stamps the attribute the palette keys on', () =>
    {
        useTheme().setTheme('light');
        expect(document.documentElement.dataset.theme).toBe('light');
        useTheme().setTheme('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('survives storage being blocked', () =>
    {
        const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get()
            {
                throw new Error('site data blocked');
            }
        });

        expect(() => useTheme().setTheme('light')).not.toThrow();
        expect(document.documentElement.dataset.theme).toBe('light');

        if (original !== undefined)
        {
            Object.defineProperty(window, 'localStorage', original);
        }
    });
});
