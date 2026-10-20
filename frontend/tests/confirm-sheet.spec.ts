import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import ConfirmSheet from '../src/components/app/confirm-sheet.component.azeroth';
import { firstTabbable } from '../src/lib/focus.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

const shown = (destructive: boolean | undefined, close = vi.fn()) =>
    renderTest(() => ConfirmSheet({ overlayId: 'confirm', close, title: 'Leave the table?', lead: 'Your seat goes to somebody else.', confirm: 'Leave', destructive }) as Rendered).container;

const buttons = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('button')];

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('a question that is asked before something is done', () =>
{
    it('puts the keyboard on Cancel first when what it asks about cannot be undone, so a stray Enter does nothing', () =>
    {
        const container = shown(true);
        const [confirm, cancel] = buttons(container);

        expect([confirm.textContent?.trim(), cancel.textContent?.trim()]).toEqual(['Leave', useLocale().t('common.cancel')]);
        expect(cancel.hasAttribute('autofocus')).toBe(true);
        expect(confirm.hasAttribute('autofocus')).toBe(false);
        expect(firstTabbable(container), 'the overlay would put the keyboard on the destructive button').toBe(cancel);
    });

    it('leaves the keyboard on the answer it asks for when nothing is lost by it', () =>
    {
        for (const destructive of [false, undefined])
        {
            const container = shown(destructive);

            expect(buttons(container).some((one) => one.hasAttribute('autofocus'))).toBe(false);
            expect(buttons(container)[0].textContent?.trim(), 'the first thing the keyboard reaches is not the answer asked for').toBe('Leave');

            cleanup();
        }
    });

    it('answers yes and no as it did', () =>
    {
        const close = vi.fn();
        const [confirm, cancel] = buttons(shown(true, close));

        fire(cancel, 'click');
        fire(confirm, 'click');

        expect(close.mock.calls).toEqual([[false], [true]]);
    });
});
