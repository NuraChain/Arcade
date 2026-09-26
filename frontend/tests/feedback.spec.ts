import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { attempt } from '../src/lib/attempt.ts';
import { copyText } from '../src/lib/clipboard.ts';
import { resetRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const withClipboard = (writeText: ((text: string) => Promise<void>) | null): void =>
{
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: writeText === null ? undefined : { writeText }
    });
};

beforeEach(() =>
{
    resetRuntime();
    useLocale().setLocale('en');
    useToasts().reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() =>
{
    vi.restoreAllMocks();
    if (original === undefined)
    {
        Reflect.deleteProperty(navigator, 'clipboard');
    }
    else
    {
        Object.defineProperty(navigator, 'clipboard', original);
    }
});

describe('an action that says how it went only once it has gone', () =>
{
    it('says nothing until the request has answered, then says it worked', async () =>
    {
        let finish = (): void => undefined;
        const work = new Promise<void>((resolve) =>
        {
            finish = resolve;
        });

        const told = attempt(work, 'Blocked.');
        await Promise.resolve();
        expect(useToasts().items()).toHaveLength(0);

        finish();
        expect(await told).toBe(true);
        expect(useToasts().items().map((toast) => [toast.kind, toast.text])).toEqual([['success', 'Blocked.']]);
    });

    it('says it did not go through when the request is refused, and never that it worked', async () =>
    {
        expect(await attempt(Promise.reject(new Error('offline')), 'Blocked.')).toBe(false);

        const shown = useToasts().items();
        expect(shown).toHaveLength(1);
        expect(shown[0].kind).toBe('warning');
        expect(shown[0].text).toBe(useLocale().t('common.actionFailed'));
    });
});

describe('copying', () =>
{
    it('says copied only when the browser really copied it', async () =>
    {
        const written: string[] = [];
        withClipboard(async (text) =>
        {
            written.push(text);
        });

        expect(await copyText('@mina', 'actions.handleCopied')).toBe(true);
        expect(written).toEqual(['@mina']);
        expect(useToasts().items()[0].text).toBe(useLocale().t('actions.handleCopied'));
    });

    it('hands the words back to be copied by hand when the browser refuses', async () =>
    {
        withClipboard(() => Promise.reject(new Error('denied')));

        expect(await copyText('ABCD-1234', 'play.dock.codeCopied')).toBe(false);
        const toast = useToasts().items()[0];
        expect(toast.kind).toBe('warning');
        expect(toast.text).toBe(useLocale().t('common.copyFailed'));
        expect(toast.detail).toBe('ABCD-1234');
    });

    it('says the same where there is no clipboard at all', async () =>
    {
        withClipboard(null);

        expect(await copyText('ABCD-1234', 'play.dock.codeCopied')).toBe(false);
        expect(useToasts().items()[0].text).toBe(useLocale().t('common.copyFailed'));
    });

    it('never puts a secret into a toast that a screen reader would read aloud', async () =>
    {
        withClipboard(() => Promise.reject(new Error('denied')));

        await copyText('0123456789ABCDEFGHJKMNPQ', 'recovery.copied', { secret: true });
        const toast = useToasts().items()[0];
        expect(toast.text).toBe(useLocale().t('common.copyFailed'));
        expect(toast.detail ?? null).toBeNull();
        expect(JSON.stringify(useToasts().items())).not.toContain('0123456789ABCDEFGHJKMNPQ');
    });
});
