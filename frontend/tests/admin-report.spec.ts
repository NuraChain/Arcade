import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import ReportPage from '../src/pages/admin/report.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useReports } from '../src/stores/reports.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, reportFiled, server, staffLogged, staffMember } from './fake-api.ts';
import { halfwayOut } from './leaving.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };

const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const as = (staff: StaffRole) =>
{
    useSession().establish({ ...ALEX, staff });
};

const opened = async (id: string) =>
{
    const routes: Route[] = [
        { path: '/admin/reports', component: () => document.createElement('div') },
        { path: '/admin/reports/:id', component: () => ReportPage({}) as unknown as HTMLElement }
    ];
    const router = createRouter({ routes, history: createMemoryHistory(`/admin/reports/${ id }`), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const all = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());

const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

const typeInto = (field: HTMLTextAreaElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const toasts = () => useToasts().items().map((one) => one.text);

const why = (root: ParentNode) => root.querySelector<HTMLTextAreaElement>('#admin-report-why')!;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useToasts().dismissAll();
    useReports().reset();
    as('owner');
});

afterEach(() =>
{
    cleanup();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('one report', () =>
{
    it('keeps the report it was built for while the page is being left', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });

        const container = await halfwayOut(
            [{ path: '/admin/reports/:id', component: () => ReportPage({}) as unknown as HTMLElement }],
            `/admin/reports/${ id }`,
            (root) => said(root, '[data-said]') === 'sara.k reported reza.t'
        );

        expect(said(container, '[data-said]')).toBe('sara.k reported reza.t');
    });

    it('reads what it is for, who reported whom, its status and when, both people, the message, their games together and what the staff did', async () =>
    {
        const id = reportFiled({
            at: hoursAgo(3),
            by: 'sara.k',
            about: 'reza.t',
            status: 'reviewed',
            message: '{"text":"Quit or I keep stalling"}',
            together: [
                { id: 'm2', game: 'hokm', at: hoursAgo(1), live: true },
                { id: 'm1', game: 'ludo', at: hoursAgo(4), live: false, by: 'lost', about: 'won' }
            ]
        });

        staffLogged({ at: hoursAgo(2), staff: 'mina', staffRole: 'moderator', kind: 'report', person: 'reza.t', reason: 'Nothing rude in the chat.', details: { report: id, outcome: 'reviewed', reporter: 'sara.k' } });
        const container = await opened(id);

        expect(said(container, 'h1')).toBe('Harassment or abuse');
        expect(said(container, '[data-said]')).toBe('sara.k reported reza.t');
        expect([...container.querySelectorAll('[data-said] [dir="ltr"]')].map((one) => one.textContent)).toEqual(['sara.k', 'reza.t']);
        expect(said(container, 'header [data-status]')).toBe('Reviewed');
        expect(said(container, 'header [data-when]')).toBe('Filed 3 hours ago');
        expect(container.querySelector('[data-side="about"]')?.getAttribute('href')).toBe('/admin/people/reza.t');
        expect(all(container, '[data-side="about"] .flex-col > span')).toEqual(['About', 'Reza Tehrani', '@reza.t']);
        expect(container.querySelector('[data-side="by"]')?.getAttribute('href')).toBe('/admin/people/sara.k');
        expect(all(container, '[data-side="by"] .flex-col > span')).toEqual(['Filed by', 'Sara Kamali', '@sara.k']);
        expect(said(container, '[data-message]')).toBe('Quit or I keep stalling');
        expect(container.querySelector<HTMLElement>('[data-forwarded]')?.hidden).toBe(true);
        expect(all(container, '[data-together] [data-game] [data-name]')).toEqual(['Hokm', 'Ludo']);
        expect(container.querySelector<HTMLElement>('[data-game="m2"] [data-live]')?.hidden).toBe(false);
        expect(container.querySelector<HTMLElement>('[data-game="m1"] [data-live]')?.hidden).toBe(true);
        expect(all(container, '[data-game="m1"] [data-seat]')).toEqual(['sara.k: Lost', 'reza.t: Won']);
        expect([...container.querySelectorAll<HTMLElement>('[data-game="m2"] [data-seat]')].map((one) => one.hidden)).toEqual([true, true]);
        expect(all(container, '[data-history] [data-line]')).toEqual(['mina reviewed sara.k’s report about reza.t: nothing to do.']);
        expect(container.querySelector('[data-history] [data-open-report]')).toBeNull();
        expect(button(container, 'Reviewed, nothing to do')).toBeUndefined();
        expect(button(container, 'Acted on it')).toBeDefined();
    });

    it('opens on a summary card and keeps the close beside the report once there is room, held in view, and after it on a phone', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });
        const container = await opened(id);
        const layout = container.querySelector<HTMLElement>('[data-layout]')!;
        const [main, aside] = [...layout.children] as HTMLElement[];

        expect(container.querySelector('header[data-summary] h1')?.textContent).toBe('Harassment or abuse');
        expect(container.querySelector('header[data-summary] [data-status]')).not.toBeNull();
        expect(layout.classList.contains('@4xl:grid-cols-[minmax(0,1fr)_20rem]')).toBe(true);
        expect(layout.closest('.\\@container')).not.toBeNull();
        expect(layout.children).toHaveLength(2);
        expect(main?.querySelector('[data-side="about"]')).not.toBeNull();
        expect(main?.querySelector('[data-history], [data-history="none"]')).not.toBeNull();
        expect(aside?.tagName).toBe('ASIDE');
        expect(aside?.getAttribute('aria-label')).toBe('Close the report');
        expect(aside?.classList.contains('@4xl:sticky')).toBe(true);
        expect(aside?.querySelector('[data-outcomes]')).not.toBeNull();
    });

    it('says a message that was forwarded, one that could not be read, and a report that came with none', async () =>
    {
        const forwarded = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t', message: '{"text":"Pass it on","fwd":true}' });
        const broken = reportFiled({ at: hoursAgo(2), by: 'sara.k', about: 'reza.t', message: 'not a message' });
        const bare = reportFiled({ at: hoursAgo(1), by: 'sara.k', about: 'reza.t' });

        const first = await opened(forwarded);

        expect(said(first, '[data-message]')).toBe('Pass it on');
        expect(first.querySelector<HTMLElement>('[data-forwarded]')?.hidden).toBe(false);
        expect(said(first, '[data-forwarded]')).toBe('Forwarded');
        cleanup();

        const second = await opened(broken);

        expect(second.querySelector('[data-message]:not([data-message="none"])')).toBeNull();
        expect(said(second, '[data-message="none"]')).toBe('The message that came with it could not be read.');
        cleanup();

        const third = await opened(bare);

        expect(said(third, '[data-message="none"]')).toBe('No message came with this report.');
        expect(said(third, '[data-together="none"]')).toBe('They have not played together lately.');
        expect(said(third, '[data-history="none"]')).toBe('Nothing yet.');
    });

    it('closes a report at the press: the status, the row and the count of waiting reports, said once the server has', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'review');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.review(request);
        });

        useReports().told(3);
        const container = await opened(id);

        expect(said(container, 'header [data-status]')).toBe('Waiting');

        typeInto(why(container), '  Read the chat, nothing rude.  ');
        button(container, 'Reviewed, nothing to do')!.click();
        await settle();

        expect(sent).toHaveBeenCalledWith({ params: { id }, input: { outcome: 'reviewed', reason: 'Read the chat, nothing rude.' } });
        expect(said(container, 'header [data-status]')).toBe('Reviewed');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex reviewed sara.k’s report about reza.t: nothing to do.']);
        expect(button(container, 'Reviewed, nothing to do')).toBeUndefined();
        expect(useReports().waiting()).toBe(2);
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['The report is marked reviewed.']);
        expect(why(container).value).toBe('');
        expect(useReports().waiting()).toBe(0);
        expect(all(container, '[data-history] [data-reason]')).toEqual(['Read the chat, nothing rude.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.person } ${ row.details.outcome } ${ row.details.reporter }`)).toEqual(['report reza.t reviewed sara.k']);

        typeInto(why(container), 'Suspended them for a week.');
        button(container, 'Acted on it')!.click();
        await settle();

        expect(said(container, 'header [data-status]')).toBe('Acted on');
        expect(button(container, 'Reviewed, nothing to do')).toBeDefined();
        expect(button(container, 'Acted on it')).toBeUndefined();
        expect(useReports().waiting()).toBe(0);
    });

    it('takes a refused close back and says why in the reader\'s words, keeping what was typed', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });

        vi.spyOn(client.admin, 'review').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        useReports().told(1);
        const container = await opened(id);

        typeInto(why(container), 'Read the chat, nothing rude.');
        button(container, 'Acted on it')!.click();
        await settle();

        expect(said(container, 'header [data-status]')).toBe('Waiting');
        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(toasts()).toEqual(['That is above what your role may do.']);
        expect(why(container).value).toBe('Read the chat, nothing rude.');
        expect(useReports().waiting()).toBe(1);
    });

    it('asks for a reason before it closes anything', async () =>
    {
        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });
        const container = await opened(id);

        typeInto(why(container), ' a ');
        button(container, 'Acted on it')!.click();
        await settle();

        expect(server.calls.filter((call) => call.startsWith('admin.review'))).toEqual([]);
        expect(said(container, '#admin-report-why-error')).toBe('Say why, in three characters or more.');
        expect(said(container, 'header [data-status]')).toBe('Waiting');
    });

    it('offers no close on a report about the reader or about somebody at or above them, and says why', async () =>
    {
        server.staff.owner = 'sara.k';
        server.staff.members.push(staffMember('alex', 'moderator'), staffMember('mina', 'admin'));
        as('moderator');

        const cases: [string, string | null][] = [
            [reportFiled({ at: hoursAgo(4), by: 'reza.t', about: 'alex' }), 'This report is about you, so somebody else on the staff closes it.'],
            [reportFiled({ at: hoursAgo(3), by: 'reza.t', about: 'mina' }), 'They are an admin, and only somebody above them may close it.'],
            [reportFiled({ at: hoursAgo(2), by: 'reza.t', about: 'sara.k' }), 'It is about the owner, and nobody on the staff is above them.'],
            [reportFiled({ at: hoursAgo(1), by: 'mina', about: 'reza.t' }), null]
        ];

        for (const [id, sentence] of cases)
        {
            const container = await opened(id);

            expect(said(container, '[data-why-not]'), id).toBe(sentence);
            expect(container.querySelector('[data-outcomes]') !== null, id).toBe(sentence === null);
            cleanup();
        }
    });

    it('answers a report that is not there as missing, and one that could not be read with a way to try again', async () =>
    {
        const gone = await opened('report-404');

        expect(gone.textContent).toContain('No such report.');
        expect(gone.textContent).toContain('It may have gone with the account it was about.');
        cleanup();

        const id = reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t' });

        vi.spyOn(client.admin, 'report').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));
        const failed = await opened(id);

        expect(failed.textContent).toContain('This report could not be read.');
        expect(failed.textContent).not.toContain('No such report.');

        button(failed, 'Try again')!.click();
        await settle();

        expect(said(failed, 'h1')).toBe('Harassment or abuse');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const id = reportFiled({
            at: hoursAgo(3),
            by: 'sara.k',
            about: 'reza.t',
            category: 'cheating',
            message: '{"text":"Quit or I keep stalling"}',
            together: [{ id: 'm1', game: 'ludo', at: hoursAgo(4), live: false, by: 'lost', about: 'won' }]
        });
        const container = await opened(id);

        expect(said(container, 'h1')).toBe('تقلب');
        expect(said(container, '[data-said]')).toBe('sara.k از reza.t گزارش داد');
        expect(said(container, 'header [data-status]')).toBe('منتظر بررسی');
        expect(all(container, '[data-side="about"] .flex-col > span')).toEqual(['درباره‌ی', 'Reza Tehrani', '@reza.t']);
        expect(all(container, '[data-side="by"] .flex-col > span')).toEqual(['گزارش‌دهنده', 'Sara Kamali', '@sara.k']);
        expect(all(container, '[data-game="m1"] [data-seat]')).toEqual(['sara.k: باخت', 'reza.t: برد']);
        expect(button(container, 'بررسی شد، کاری لازم نیست')).toBeDefined();
        expect(button(container, 'رسیدگی کردم')).toBeDefined();
        expect(said(container, '#report-close')).toBe('بستن گزارش');
    });
});
