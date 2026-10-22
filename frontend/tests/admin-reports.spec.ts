import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import { REPORTS_PAGE } from '../../backend/src/domains/admin/roles.ts';
import ReportsPage from '../src/pages/admin/reports.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useReports } from '../src/stores/reports.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { reportFiled, server, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'owner' as const };

const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const opened = async (at = '/admin/reports') =>
{
    const routes: Route[] = [
        { path: '/admin/reports', component: () => ReportsPage({}) as unknown as HTMLElement },
        { path: '/admin/reports/:id', component: () => document.createElement('div') }
    ];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return { router, container };
};

const rows = (root: ParentNode) => [...root.querySelectorAll('[data-reports] [data-report] [data-said]')].map((one) => one.textContent?.trim());

const isolated = (root: ParentNode, row: string) => [...root.querySelectorAll(`${ row } [data-said] [dir="ltr"]`)].map((one) => one.textContent);

const chip = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find((one) => one.textContent?.trim().startsWith(label))!;

const filed = () =>
{
    reportFiled({ at: hoursAgo(5), by: 'mina', about: 'reza.t', category: 'cheating' });
    reportFiled({ at: hoursAgo(3), by: 'sara.k', about: 'reza.t', message: '{"text":"You lost on purpose"}' });
    reportFiled({ at: hoursAgo(1), by: 'reza.t', about: 'sara.k', status: 'reviewed' });
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
    useReports().reset();
});

afterEach(() =>
{
    cleanup();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the reports', () =>
{
    it('lists the waiting reports newest first, each as who reported whom, what for, when, and whether a message came with it', async () =>
    {
        filed();
        const { container } = await opened();
        const first = '[data-reports] li:first-child';

        expect(rows(container)).toEqual(['sara.k reported reza.t', 'mina reported reza.t']);
        expect(isolated(container, first)).toEqual(['sara.k', 'reza.t']);
        expect(container.querySelector(`${ first } [data-category]`)?.textContent).toBe('Harassment or abuse');
        expect(container.querySelector('[data-reports] li:last-child [data-category]')?.textContent).toBe('Cheating');
        expect([...container.querySelectorAll<HTMLElement>('[data-reports] [data-disclosed]')].map((one) => one.hidden)).toEqual([false, true]);
        expect(container.querySelector(`${ first } [data-disclosed]`)?.textContent).toBe('With a message');
        expect(container.querySelector(`${ first } [data-status]`)?.getAttribute('data-status')).toBe('received');
        expect(container.querySelector(`${ first } [data-status]`)?.textContent?.trim()).toBe('Waiting');
        expect(container.querySelector(`${ first } [data-when]`)?.textContent).toBe('3 hours ago');
        expect(container.querySelector<HTMLAnchorElement>(`${ first } a`)?.getAttribute('href')).toBe('/admin/reports/report-2');
        expect(chip(container, 'Waiting').getAttribute('aria-pressed')).toBe('true');
        expect(chip(container, 'Waiting').textContent?.trim()).toBe('Waiting2');
        expect(useReports().waiting()).toBe(2);
    });

    it('keeps the list in the address: waiting, reviewed, acted on or all', async () =>
    {
        filed();
        const { router, container } = await opened();

        chip(container, 'Reviewed').click();
        await settle();

        expect(router.location().query.status).toBe('reviewed');
        expect(rows(container)).toEqual(['reza.t reported sara.k']);
        expect(container.querySelector('[data-reports] [data-status]')?.textContent?.trim()).toBe('Reviewed');

        chip(container, 'All').click();
        await settle();

        expect(router.location().query.status).toBe('all');
        expect(rows(container)).toEqual(['reza.t reported sara.k', 'sara.k reported reza.t', 'mina reported reza.t']);

        chip(container, 'Waiting').click();
        await settle();

        expect(router.location().query.status).toBeUndefined();
        expect(rows(container)).toHaveLength(2);
    });

    it('opens on the list the address names', async () =>
    {
        filed();
        const { container } = await opened('/admin/reports?status=reviewed');

        expect(chip(container, 'Reviewed').getAttribute('aria-pressed')).toBe('true');
        expect(rows(container)).toEqual(['reza.t reported sara.k']);
    });

    it('marks a report about somebody on the staff with their role', async () =>
    {
        server.staff.members.push(staffMember('mina', 'moderator'));
        reportFiled({ at: hoursAgo(2), by: 'sara.k', about: 'mina' });
        reportFiled({ at: hoursAgo(1), by: 'mina', about: 'reza.t' });
        const { container } = await opened();
        const marks = (row: string) => [...container.querySelectorAll(`[data-reports] li:${ row } [data-marks] > *`)].map((one) => one.textContent?.trim());

        expect(rows(container)).toEqual(['mina reported reza.t', 'sara.k reported mina']);
        expect(marks('first-child')).toEqual(['Waiting', 'Harassment or abuse']);
        expect(marks('last-child')).toEqual(['Waiting', 'Moderator', 'Harassment or abuse']);
    });

    it('shows older reports a page at a time, each once, and offers no more past the last', async () =>
    {
        for (let one = 0; one < REPORTS_PAGE + 3; one += 1)
        {
            reportFiled({ at: hoursAgo(REPORTS_PAGE + 3 - one), by: 'sara.k', about: 'reza.t' });
        }
        const { container } = await opened();
        const more = () => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Show older');
        const links = () => [...container.querySelectorAll<HTMLAnchorElement>('[data-reports] a')].map((one) => one.getAttribute('href'));

        expect(links()).toHaveLength(REPORTS_PAGE);
        expect(links()[0]).toBe(`/admin/reports/report-${ REPORTS_PAGE + 3 }`);

        more()!.click();
        await settle();

        expect(links()).toHaveLength(REPORTS_PAGE + 3);
        expect(new Set(links()).size).toBe(REPORTS_PAGE + 3);
        expect(links().at(-1)).toBe('/admin/reports/report-1');
        expect(more()).toBeUndefined();
    });

    it('says when nothing is waiting, when a list is empty, and when the reports could not be read', async () =>
    {
        const quiet = await opened();

        expect(quiet.container.textContent).toContain('Nothing is waiting.');
        expect(quiet.container.textContent).toContain('Every report has been looked at.');
        expect(chip(quiet.container, 'Waiting').textContent?.trim()).toBe('Waiting0');
        cleanup();

        const acted = await opened('/admin/reports?status=actioned');

        expect(acted.container.textContent).toContain('No reports here.');
        expect(acted.container.textContent).not.toContain('Every report has been looked at.');
        cleanup();

        server.staff.owner = 'sara.k';
        const refused = await opened();

        expect(refused.container.textContent).toContain('The reports could not be read.');
        expect(refused.container.textContent).not.toContain('Nothing is waiting.');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        filed();
        const { container } = await opened();
        const first = '[data-reports] li:first-child';

        expect(container.querySelector('h1')?.textContent).toBe('گزارش‌ها');
        expect(rows(container)).toEqual(['sara.k از reza.t گزارش داد', 'mina از reza.t گزارش داد']);
        expect(isolated(container, first)).toEqual(['sara.k', 'reza.t']);
        expect(container.querySelector(`${ first } [data-status]`)?.textContent?.trim()).toBe('منتظر بررسی');
        expect(container.querySelector(`${ first } [data-disclosed]`)?.textContent).toBe('با پیام');
        expect([...container.querySelectorAll('[aria-pressed]')].map((one) => one.textContent?.trim())).toEqual(['منتظر بررسی۲', 'بررسی شده', 'رسیدگی شده', 'همه']);
    });
});
