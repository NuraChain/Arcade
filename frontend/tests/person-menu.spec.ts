import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { aboutPerson } from '../src/lib/person-menu.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';

const SHEET = '../src/components/social/person-actions.component.azeroth';

const said = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

beforeEach(() =>
{
    useLocale().setLocale('en');
    useOverlay().reset();
    useToasts().reset();
});

afterEach(() =>
{
    useOverlay().reset();
    useToasts().reset();
    useLocale().setLocale('en');
});

describe('the way to what can be done about a person', () =>
{
    it('is one sheet however often it is asked for, about the person asked for', async () =>
    {
        aboutPerson('omid.k');
        aboutPerson('omid.k');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(useOverlay().items().map((entry) => [entry.id, typeof entry.component, entry.label, entry.props.personId]))
            .toEqual([['person-menu', 'function', 'More', 'omid.k']]);
        expect(said()).toEqual([]);
    });

    it('is named in the language being read', async () =>
    {
        useLocale().setLocale('fa');
        aboutPerson('omid.k');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].label).toBe('بیشتر');
    });

    it('says so, once, when the sheet cannot be fetched, and opens nothing', async () =>
    {
        vi.doMock(SHEET, () =>
        {
            throw new Error('the sheet is not there to fetch');
        });

        try
        {
            aboutPerson('omid.k');

            await vi.waitFor(() => expect(said()).toEqual([['warning', 'That did not go through. Try again.']]), { timeout: 4000 });

            aboutPerson('omid.k');
            await new Promise((resolve) => setTimeout(resolve, 60));

            expect(said()).toHaveLength(1);
            expect(useOverlay().items()).toEqual([]);
        }
        finally
        {
            vi.doUnmock(SHEET);
        }
    });
});
