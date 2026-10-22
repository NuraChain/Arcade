import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import SuspendSheet, { type SuspendAsk } from '../src/components/admin/suspend-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const shown = (close = vi.fn(), guest = false, initial?: SuspendAsk) =>
    renderTest(() => SuspendSheet({ overlayId: 'suspend', close, name: 'Sara Kamali', guest, ...(initial === undefined ? {} : { initial }) }) as HTMLElement).container;

const button = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label)!;

const typeInto = (root: ParentNode, value: string) =>
{
    const field = root.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!;

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const choose = async (root: ParentNode, label: string) =>
{
    root.querySelector<HTMLButtonElement>('[data-category] button[aria-haspopup="listbox"]')!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) => one.textContent?.trim() === label)!.click();
    await settle();
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

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

describe('the sheet that suspends an account', () =>
{
    it('asks the question for the term chosen, says what it costs, and closes with how long, what for and why', async () =>
    {
        const close = vi.fn();
        const container = shown(close);

        expect(said(container, '[data-ask]')).toBe('Suspend Sara Kamali for a day?');
        expect(said(container, '[data-lead]')).toBe('Every game they are playing is lost and they are signed out everywhere. Lifting it later gives none of that back.');

        fire(button(container, 'A week'), 'click');

        expect(said(container, '[data-ask]')).toBe('Suspend Sara Kamali for a week?');

        await choose(container, 'Cheating');
        typeInto(container, '  Played two seats at one table.  ');
        fire(button(container, 'Suspend them'), 'click');

        expect(close.mock.calls).toEqual([[{ days: 7, category: 'cheating', reason: 'Played two seats at one table.' }]]);
    });

    it('suspends for good with no end, and tells the staff a guest cannot come back', async () =>
    {
        const close = vi.fn();
        const container = shown(close, true);

        expect(said(container, '[data-lead]')).toBe('Every game they are playing is lost and they are signed out everywhere. They are a guest, so they cannot sign back in, even once it is lifted.');

        fire(button(container, 'For good'), 'click');

        expect(said(container, '[data-ask]')).toBe('Suspend Sara Kamali for good?');

        await choose(container, 'Something else');
        typeInto(container, 'Asked to be kept away.');
        fire(button(container, 'Suspend them'), 'click');

        expect(close.mock.calls).toEqual([[{ days: null, category: 'other', reason: 'Asked to be kept away.' }]]);
    });

    it('asks what it is for and why before it closes, each said where it is chosen', async () =>
    {
        const close = vi.fn();
        const container = shown(close);

        typeInto(container, ' ok ');
        fire(button(container, 'Suspend them'), 'click');

        expect(close).not.toHaveBeenCalled();
        expect(said(container, '[data-category] [role="alert"]')).toBe('Choose what it is for.');
        expect(said(container, '#admin-suspend-why-error')).toBe('Say why, in three characters or more.');

        await choose(container, 'Cheating');

        expect(container.querySelector('[data-category] [role="alert"]')).toBeNull();
    });

    it('opens on what it was handed, so a refused suspension is asked again as it was', () =>
    {
        const close = vi.fn();
        const container = shown(close, false, { days: 30, category: 'spam', reason: 'Sold seats in the chat.' });

        expect(said(container, '[data-ask]')).toBe('Suspend Sara Kamali for 30 days?');
        expect(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')?.value).toBe('Sold seats in the chat.');

        fire(button(container, 'Suspend them'), 'click');

        expect(close.mock.calls).toEqual([[{ days: 30, category: 'spam', reason: 'Sold seats in the chat.' }]]);
    });

    it('closes with nothing when it is put away', () =>
    {
        const close = vi.fn();
        const container = shown(close);

        typeInto(container, 'Never sent.');
        fire(button(container, 'Cancel'), 'click');

        expect(close.mock.calls).toEqual([[null]]);
    });

    it('says it in Persian', () =>
    {
        useLocale().setLocale('fa');
        const container = shown(vi.fn());

        fire(button(container, 'یه هفته'), 'click');

        expect(said(container, '[data-ask]')).toBe('Sara Kamali برای یه هفته معلق بشه؟');
        expect(button(container, 'تعلیقش کن')).toBeDefined();
    });
});
