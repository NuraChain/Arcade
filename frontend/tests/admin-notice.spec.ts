import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import ReasonSheet from '../src/components/admin/reason-sheet.component.azeroth';
import ConfirmSheet from '../src/components/app/confirm-sheet.component.azeroth';
import NoticePage from '../src/pages/admin/notice.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T18:00:00.000Z');

const HOUR = 3_600_000;

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'owner' as const };

const EN = 'Nura restarts at 22:00 for about ten minutes.';

const FA = 'نورا ساعت ۲۲ حدود ده دقیقه ری‌استارت می‌شه.';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const opened = async () =>
{
    const routes: Route[] = [{ path: '/admin/notice', component: () => NoticePage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory('/admin/notice'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const standing = (id = 'notice-7', by = 'sara.k') =>
{
    server.notice = { id, en: EN, fa: FA, until: new Date(NOW + (6 * HOUR)).toISOString(), at: new Date(NOW - (2 * HOUR)).toISOString(), by };
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const facts = (root: ParentNode) => [...root.querySelectorAll('[data-facts] > span:not([hidden])')].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());

const button = (root: ParentNode, words: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === words) ?? null;

const field = (root: ParentNode, id: string) => root.querySelector<HTMLTextAreaElement>(`#${ id }`)!;

const typeInto = (box: HTMLTextAreaElement, value: string) =>
{
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
};

const errors = (root: ParentNode) => [...root.querySelectorAll('[role="alert"]')].map((one) => [one.id, one.textContent?.trim()]);

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const answered = async (answer: unknown) =>
{
    useOverlay().close(asked().id, answer);
    await settle();
};

const toasts = () => useToasts().items().map((one) => one.text);

const sentOf = (prefix: string) => server.calls.filter((call) => call.startsWith(prefix));

const filled = (root: ParentNode, en = EN, fa = FA, why = 'Maintenance tonight') =>
{
    typeInto(field(root, 'admin-notice-en'), en);
    typeInto(field(root, 'admin-notice-fa'), fa);
    typeInto(field(root, 'admin-notice-why'), why);
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish(ALEX);
    useToasts().dismissAll();
    useOverlay().reset();
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    useSession().reset();
    useLocale().setLocale('en');
    vi.restoreAllMocks();
});

describe('the announcement, as the staff see it', () =>
{
    it('shows the announcement standing as everybody sees it, both lines, when it ends and who put it up', async () =>
    {
        standing();
        const container = await opened();

        expect(container.querySelector('#admin-notice-now')?.textContent).toBe('Showing now');
        expect(said(container, '#admin-notice-now + *')).toBe('Live');
        expect(said(container, '[data-preview]')).toBe(EN);
        expect(said(container, '[data-english]')).toBe(EN);
        expect(container.querySelector('[data-english]')?.getAttribute('dir')).toBe('ltr');
        expect(said(container, '[data-persian]')).toBe(FA);
        expect(container.querySelector('[data-persian]')?.getAttribute('dir')).toBe('rtl');
        expect(facts(container)).toEqual(['Ends in 6 hours', 'Put up by sara.k', '2 hours ago']);
        expect([...container.querySelectorAll('[data-facts] time')].map((one) => one.getAttribute('datetime'))).toEqual([server.notice!.until, server.notice!.at]);
        expect(button(container, 'Take it down')).not.toBeNull();
        expect(button(container, 'Put it up instead')).not.toBeNull();

        useLocale().setLocale('fa');
        await settle();

        expect(said(container, '[data-preview]')).toBe(FA);
        expect(container.querySelector('#admin-notice-now')?.textContent).toBe('الان این نشون داده می‌شه');
        expect(button(container, 'برش دار')).not.toBeNull();
    });

    it('says nothing is announced when nothing stands, and leads to every announcement in the log', async () =>
    {
        const container = await opened();

        expect(container.querySelector('#admin-notice-now')).toBeNull();
        expect(said(container, '[data-empty] p')).toBe('Nothing is announced right now.');
        expect(container.querySelector('.empty-art')).toBeNull();
        expect(button(container, 'Put it up')).not.toBeNull();
        expect(container.querySelector('[data-history]')?.getAttribute('href')).toBe('/admin/log?kind=notice');

        const split = container.querySelector<HTMLElement>('[data-split]')!;

        expect(split.classList.contains('@4xl:grid-cols-2')).toBe(true);
        expect(split.closest('.\\@container')).not.toBeNull();
        expect([...split.children].map((one) => one.querySelector('[data-empty]') !== null || one.hasAttribute('data-form'))).toEqual([true, true]);
        expect(split.querySelector('[data-form]')?.classList.contains('@4xl:sticky')).toBe(true);
        expect(split.querySelector('[data-form] #admin-notice-new')).not.toBeNull();
    });

    it('leaves out who put it up when their account is gone, and shows nothing once it has run out', async () =>
    {
        standing();
        delete server.notice!.by;

        const container = await opened();

        expect(facts(container)).toEqual(['Ends in 6 hours', '2 hours ago']);

        cleanup();
        server.notice = { ...server.notice!, until: new Date(NOW - HOUR).toISOString() };

        const later = await opened();

        expect(later.querySelector('#admin-notice-now')).toBeNull();
        expect(said(later, '[data-empty] p')).toBe('Nothing is announced right now.');
    });

    it('says the announcement could not be read when it could not', async () =>
    {
        vi.spyOn(client.admin, 'notice').mockRejectedValue(new ApiError(500, 'internal', 'Down.', undefined));

        const container = await opened();

        expect(container.textContent).toContain('The announcement could not be read.');
        expect(button(container, 'Put it up')).toBeNull();
    });
});

describe('putting an announcement up', () =>
{
    it('refuses a line under three letters, either line missing and a short reason, and says which', async () =>
    {
        const container = await opened();

        filled(container, 'no', '   ', 'ok');
        button(container, 'Put it up')!.click();
        await settle();

        expect(errors(container)).toEqual([
            ['admin-notice-en-error', 'Write at least 3 characters.'],
            ['admin-notice-fa-error', 'Write at least 3 characters.'],
            ['admin-notice-why-error', 'Say why, in three characters or more.']
        ]);
        expect(sentOf('admin.putNotice')).toEqual([]);

        typeInto(field(container, 'admin-notice-en'), EN);
        await settle();

        expect(errors(container).map(([id]) => id)).toEqual(['admin-notice-fa-error', 'admin-notice-why-error']);
    });

    it('puts it up at the press with each line folded to one, for the time chosen, and says so once the server has', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'putNotice');

        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.putNotice(request);
        });

        const container = await opened();

        filled(container, '  Nura restarts\n at 22:00   for about ten minutes.  ', ` ${ FA } `, 'Maintenance tonight');
        button(container, 'A day')!.click();
        await settle();
        button(container, 'Put it up')!.click();
        await settle();

        expect(sent).toHaveBeenCalledWith({ input: { en: EN, fa: FA, hours: 24, reason: 'Maintenance tonight' } });
        expect(said(container, '[data-preview]')).toBe(EN);
        expect(said(container, '[data-facts]')).toContain('Ends tomorrow');
        expect(said(container, '[data-facts]')).toContain('Put up by alex');
        expect(button(container, 'Take it down'), 'nothing to take down until the server has said what it put up').toBeNull();
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['The announcement is up.']);
        expect(button(container, 'Take it down')).not.toBeNull();
        expect([field(container, 'admin-notice-en').value, field(container, 'admin-notice-fa').value, field(container, 'admin-notice-why').value]).toEqual(['', '', '']);
        expect(server.notice?.en).toBe(EN);
    });

    it('takes back an announcement that did not go up, keeps what was typed, and says so', async () =>
    {
        vi.spyOn(client.admin, 'putNotice').mockRejectedValueOnce(new ApiError(503, 'internal', 'Down.', undefined));

        const container = await opened();

        filled(container);
        button(container, 'Put it up')!.click();
        await settle();

        expect(container.querySelector('#admin-notice-now')).toBeNull();
        expect(said(container, '[data-empty] p')).toBe('Nothing is announced right now.');
        expect(toasts()).toEqual(['That did not go through. Try again.']);
        expect(field(container, 'admin-notice-en').value).toBe(EN);
        expect(field(container, 'admin-notice-why').value).toBe('Maintenance tonight');
    });

    it('asks before it replaces the announcement standing, and sends nothing when the question is put away', async () =>
    {
        standing();
        const container = await opened();

        filled(container, 'Back in five minutes.', 'پنج دقیقه دیگه برمی‌گردیم.');
        button(container, 'Put it up instead')!.click();
        await settle();

        expect(asked().component).toBe(ConfirmSheet);
        expect(asked().props).toMatchObject({
            title: 'Replace the announcement?',
            lead: 'The one showing now comes down, and this one goes up in its place for everybody.',
            confirm: 'Replace it'
        });

        await answered(false);

        expect(sentOf('admin.putNotice')).toEqual([]);
        expect(said(container, '[data-preview]')).toBe(EN);

        button(container, 'Put it up instead')!.click();
        await settle();
        await answered(true);

        expect(sentOf('admin.putNotice')).toEqual(['admin.putNotice 6 Maintenance tonight']);
        expect(said(container, '[data-preview]')).toBe('Back in five minutes.');
    });
});

describe('taking an announcement down', () =>
{
    it('asks why, takes it down at the press naming the one shown, and says so once the server has', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'endNotice');

        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.endNotice(request);
        });

        standing('notice-7');
        const container = await opened();

        button(container, 'Take it down')!.click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'Take the announcement down?',
            lead: 'Everybody stops seeing it at once. You can put up another whenever you like.',
            confirm: 'Take it down'
        });

        await answered('The restart is done');

        expect(sent).toHaveBeenCalledWith({ input: { id: 'notice-7', reason: 'The restart is done' } });
        expect(container.querySelector('#admin-notice-now')).toBeNull();
        expect(said(container, '[data-empty] p')).toBe('Nothing is announced right now.');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['The announcement is down.']);
        expect(server.notice).toBeNull();
    });

    it('sends nothing when the question is put away', async () =>
    {
        standing();
        const container = await opened();

        button(container, 'Take it down')!.click();
        await settle();
        await answered(undefined);

        expect(sentOf('admin.endNotice')).toEqual([]);
        expect(said(container, '[data-preview]')).toBe(EN);
    });

    it('says in the reader\'s words that the announcement was no longer up, and shows the one that is', async () =>
    {
        standing('notice-7');
        const container = await opened();

        standing('notice-8', 'mina');
        server.notice!.en = 'Back in five minutes.';
        button(container, 'Take it down')!.click();
        await settle();
        await answered('The restart is done');

        expect(toasts()).toEqual(['That announcement is no longer up.']);
        expect(said(container, '[data-preview]')).toBe('Back in five minutes.');
        expect(said(container, '[data-facts]')).toContain('Put up by mina');
    });
});
