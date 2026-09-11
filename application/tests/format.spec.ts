import { describe, it, expect, beforeEach } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { interpolate, relativeUnit, resolveMessage, selectForm } from '../src/locales/format.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('interpolation', () =>
{
    const plain = (value: number): string => String(value);

    it('fills named placeholders and leaves unknown ones as written', () =>
    {
        expect(interpolate('Hi {name}, {missing}', { name: 'Sara' }, plain)).toBe('Hi Sara, {missing}');
    });

    it('formats numbers through the supplied formatter', () =>
    {
        expect(interpolate('{count} seats', { count: 4 }, (value) => `«${ value }»`)).toBe('«4» seats');
    });

    it('returns the template untouched without variables', () =>
    {
        expect(interpolate('{name}', undefined, plain)).toBe('{name}');
    });
});

describe('plural forms', () =>
{
    const english = new Intl.PluralRules('en-US');
    const persian = new Intl.PluralRules('fa-IR');

    it('selects one and other in English', () =>
    {
        const forms = { one: 'one seat', other: 'many seats' };
        expect(selectForm(forms, 1, english)).toBe('one seat');
        expect(selectForm(forms, 3, english)).toBe('many seats');
        expect(selectForm(forms, 0, english)).toBe('many seats');
    });

    it('falls back to other when a form is not spelled out', () =>
    {
        expect(selectForm({ other: 'x' }, 1, persian)).toBe('x');
    });

    it('resolves a plural message from its count variable', () =>
    {
        expect(resolveMessage({ one: 'a', other: 'b' }, { count: 1 }, english)).toBe('a');
        expect(resolveMessage('plain', { count: 1 }, english)).toBe('plain');
    });
});

describe('relative time units', () =>
{
    it('picks the unit a person would say', () =>
    {
        expect(relativeUnit(-30 * 1000)).toEqual({ unit: 'second', value: -30 });
        expect(relativeUnit(-5 * MINUTE)).toEqual({ unit: 'minute', value: -5 });
        expect(relativeUnit(-3 * HOUR)).toEqual({ unit: 'hour', value: -3 });
        expect(relativeUnit(-2 * DAY)).toEqual({ unit: 'day', value: -2 });
        expect(relativeUnit(2 * 7 * DAY)).toEqual({ unit: 'week', value: 2 });
        expect(relativeUnit(-40 * DAY)).toEqual({ unit: 'month', value: -1 });
        expect(relativeUnit(-400 * DAY)).toEqual({ unit: 'year', value: -1 });
    });
});

describe('locale store formatting', () =>
{
    beforeEach(() =>
    {
        resetRuntime();
        useLocale().setLocale('en');
    });

    it('interpolates in the reader’s digits', () =>
    {
        const locale = useLocale();
        expect(locale.t('signIn.continue', { name: 'Sara' })).toBe('Sit down as Sara');
        expect(locale.plural('common.players', 1)).toBe('1 player');
        expect(locale.plural('common.players', 4)).toBe('4 players');
        locale.setLocale('fa');
        expect(locale.plural('common.players', 4)).toBe('۴ بازیکن');
    });

    it('speaks relative time from the runtime clock', () =>
    {
        setRuntime({ clock: manualClock(10 * MINUTE) });
        const locale = useLocale();
        expect(locale.relative(5 * MINUTE)).toBe('5 minutes ago');
        expect(locale.relative(10 * MINUTE + DAY)).toBe('tomorrow');
        locale.setLocale('fa');
        expect(locale.relative(5 * MINUTE)).toContain('۵');
    });

    it('formats lists and dates for the active locale', () =>
    {
        const locale = useLocale();
        expect(locale.list(['Sara', 'Reza', 'Mina'])).toBe('Sara, Reza, and Mina');
        expect(locale.date(Date.UTC(2026, 8, 1), { month: 'long', timeZone: 'UTC' })).toBe('September');
        locale.setLocale('fa');
        expect(locale.list(['سارا', 'رضا'])).toContain('سارا');
    });

    it('picks localised text by the active script', () =>
    {
        const locale = useLocale();
        expect(locale.text({ en: 'Sara', fa: 'سارا' })).toBe('Sara');
        locale.setLocale('fa');
        expect(locale.text({ en: 'Sara', fa: 'سارا' })).toBe('سارا');
    });
});
