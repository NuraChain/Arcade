import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import ReasonSheet from '../src/components/admin/reason-sheet.component.azeroth';
import { firstTabbable } from '../src/lib/focus.ts';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const shown = (close = vi.fn(), destructive?: boolean) =>
    renderTest(() => ReasonSheet({ overlayId: 'reason', close, title: 'Pause Ludo?', lead: 'Nobody can open a table of it.', confirm: 'Pause it', destructive }) as HTMLElement).container;

const button = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label)!;

const typeInto = (root: ParentNode, value: string) =>
{
    const field = root.querySelector<HTMLTextAreaElement>('#admin-reason')!;

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const error = (root: ParentNode) => root.querySelector('#admin-reason-error')?.textContent?.trim() ?? null;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

describe('the question that asks the staff why', () =>
{
    it('says what it asks, puts the keyboard on the reason, and closes with the reason as written, trimmed', () =>
    {
        const close = vi.fn();
        const container = shown(close);

        expect(container.querySelector('h2')?.textContent).toBe('Pause Ludo?');
        expect(container.textContent).toContain('Nobody can open a table of it.');
        expect(firstTabbable(container)).toBe(container.querySelector('#admin-reason'));
        expect(container.querySelector('label[for="admin-reason"]')?.textContent?.trim()).toBe('Why');

        typeInto(container, '  A bug in the dice  ');
        fire(button(container, 'Pause it'), 'click');

        expect(close.mock.calls).toEqual([['A bug in the dice']]);
    });

    it('refuses a reason under three characters and says so, until something is typed again', () =>
    {
        const close = vi.fn();
        const container = shown(close);

        typeInto(container, ' ab ');
        fire(button(container, 'Pause it'), 'click');

        expect(close).not.toHaveBeenCalled();
        expect(error(container)).toBe('Say why, in three characters or more.');
        expect(container.querySelector('#admin-reason')?.getAttribute('aria-describedby')).toBe('admin-reason-error');

        typeInto(container, ' abc');

        expect(error(container)).toBeNull();

        fire(button(container, 'Pause it'), 'click');

        expect(close.mock.calls).toEqual([['abc']]);
    });

    it('closes with nothing when it is put away', () =>
    {
        const close = vi.fn();
        const container = shown(close);

        typeInto(container, 'A reason that is never sent');
        fire(button(container, 'Cancel'), 'click');

        expect(close.mock.calls).toEqual([[null]]);
    });

    it('draws its answer as destructive only when it is asked to', () =>
    {
        const quiet = shown(vi.fn());
        const quietClass = button(quiet, 'Pause it').className;

        cleanup();

        const loud = shown(vi.fn(), true);

        expect(button(loud, 'Pause it').className).not.toBe(quietClass);
    });

    it('says it all in Persian', () =>
    {
        useLocale().setLocale('fa');

        const container = shown(vi.fn());

        typeInto(container, 'ab');
        fire(button(container, 'Pause it'), 'click');

        expect(container.querySelector('label[for="admin-reason"]')?.textContent?.trim()).toBe('دلیل');
        expect(error(container)).toBe('دلیلش رو بنویس، حداقل سه حرف.');
        expect(button(container, useLocale().t('common.cancel'))).toBeDefined();
    });
});
