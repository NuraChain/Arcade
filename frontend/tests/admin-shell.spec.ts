import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Router } from 'azerothjs';

import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useReports } from '../src/stores/reports.store.ts';
import { reportFiled, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };

const settle = async () =>
{
    for (let round = 0; round < 4; round += 1)
    {
        for (let step = 0; step < 16; step += 1)
        {
            await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};

const arrived = async (router: Router, root: ParentNode, selector: string, text?: string) =>
{
    await vi.waitFor(() =>
    {
        const found = root.querySelector(selector);

        if (router.pending() || found === null || (text !== undefined && found.textContent !== text))
        {
            throw new Error(`waiting for ${ selector }`);
        }
    }, { timeout: 5_000, interval: 10 });
    await settle();
};

const signIn = (staff?: StaffRole) =>
{
    useSession().establish({ ...ALEX, ...(staff === undefined ? {} : { staff }) });
};

const opened = async (at: string) =>
{
    const router = createRouter({ routes: routes.filter((route) => route.path === '/admin'), history: createMemoryHistory(at), scroll: false });
    const lost = () =>
    {
        const page = document.createElement('p');
        page.dataset.lost = '';
        return page;
    };
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({ fallback: lost }) }) as HTMLElement);

    await arrived(router, container, '#admin-main h1, [data-lost]');
    return { router, container };
};

const hrefs = (root: ParentNode, selector: string) => [...root.querySelectorAll<HTMLAnchorElement>(selector)].map((link) => link.getAttribute('href'));

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(Date.parse('2026-10-22T09:00:00.000Z')), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useToasts().dismissAll();
    useReports().reset();
});

afterEach(() =>
{
    cleanup();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the admin', () =>
{
    it('answers anybody whose role opens no section of it as a page that is not there, at every address', async () =>
    {
        const refused: [StaffRole | undefined, string][] = [
            ...['/admin', '/admin/overview', '/admin/live', '/admin/people', '/admin/people/mina', '/admin/reports', '/admin/reports/report-1', '/admin/money', '/admin/staff', '/admin/log'].map((at) => [undefined, at] as [undefined, string]),
            ...['/admin/money', '/admin/staff', '/admin/log'].map((at) => ['moderator', at] as [StaffRole, string])
        ];

        for (const [staff, at] of refused)
        {
            signIn(staff);
            const { container } = await opened(at);

            expect(container.querySelector('[data-lost]'), `${ staff ?? 'a player' } at ${ at }`).not.toBeNull();
            expect(container.querySelector('#admin-shell')).toBeNull();
            cleanup();
        }
    });

    it('takes every role on the staff from /admin to the first section it opens, the overview', async () =>
    {
        for (const staff of ['moderator', 'admin', 'owner'] as const)
        {
            signIn(staff);
            const { router, container } = await opened('/admin');

            expect(router.location().pathname, staff).toBe('/admin/overview');
            expect(container.querySelector('#admin-shell')).not.toBeNull();
            expect(container.querySelector('#admin-main h1')?.textContent).toBe('Overview');
            cleanup();
        }
    });

    it('lists a moderator the four sections a moderator opens', async () =>
    {
        signIn('moderator');
        const { container } = await opened('/admin/people');

        expect(hrefs(container.querySelector('header nav')!, 'a')).toEqual(['/admin/overview', '/admin/live', '/admin/people', '/admin/reports']);
        expect(hrefs(container.querySelector('#admin-shell > div > nav')!, 'a')).toEqual(['/admin/overview', '/admin/live', '/admin/people', '/admin/reports']);
    });

    it('says on Reports how many are waiting, read when the admin opens, at every other section and when the tab is seen again', async () =>
    {
        reportFiled({ at: '2026-10-22T08:00:00.000Z', by: 'sara.k', about: 'reza.t' });
        reportFiled({ at: '2026-10-22T08:30:00.000Z', by: 'mina', about: 'reza.t' });
        reportFiled({ at: '2026-10-22T07:00:00.000Z', by: 'mina', about: 'sara.k', status: 'reviewed' });
        signIn('moderator');
        const { router, container } = await opened('/admin/people');
        const counts = () => [...container.querySelectorAll('nav a')].map((link) => [link.getAttribute('href'), link.querySelector('[role="status"]')?.textContent ?? null]);

        expect(counts()).toEqual([
            ['/admin/overview', null],
            ['/admin/live', null],
            ['/admin/people', null],
            ['/admin/reports', '2'],
            ['/admin/overview', null],
            ['/admin/live', null],
            ['/admin/people', null],
            ['/admin/reports', '2']
        ]);
        expect(container.querySelector('nav a[href="/admin/reports"] [role="status"]')?.getAttribute('aria-label')).toBe('2 reports waiting');

        reportFiled({ at: '2026-10-22T08:45:00.000Z', by: 'sara.k', about: 'mina' });
        await router.navigate('/admin/reports');
        await arrived(router, container, '#admin-main h1', 'Reports');

        expect(container.querySelector('nav a[href="/admin/reports"] [role="status"]')?.textContent).toBe('3');
        expect(hrefs(container, '[aria-current="page"]')).toEqual(['/admin/reports', '/admin/reports']);

        reportFiled({ at: '2026-10-22T08:50:00.000Z', by: 'sara.k', about: 'mina' });
        await router.navigate('/admin/people');
        await arrived(router, container, '#admin-main h1', 'People');

        expect(container.querySelector('nav a[href="/admin/reports"] [role="status"]')?.textContent).toBe('4');

        reportFiled({ at: '2026-10-22T08:55:00.000Z', by: 'reza.t', about: 'mina' });
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();

        expect(container.querySelector('nav a[href="/admin/reports"] [role="status"]')?.textContent).toBe('5');
        expect(server.calls.filter((call) => call === 'admin.reportsWaiting').length).toBeGreaterThanOrEqual(2);
    });

    it('lists the sections the role opens, on a phone as a rail and on a wide screen down the side, and marks the one on screen', async () =>
    {
        signIn('owner');
        const { router, container } = await opened('/admin/staff');
        const rail = container.querySelector('header nav')!;
        const side = container.querySelector('#admin-shell > div > nav')!;

        expect(rail.className).toContain('lg:hidden');
        expect(side.className).toContain('lg:block');
        expect(hrefs(rail, 'a')).toEqual(['/admin/overview', '/admin/live', '/admin/people', '/admin/reports', '/admin/play', '/admin/money', '/admin/staff', '/admin/log']);
        expect(hrefs(side, 'a')).toEqual(['/admin/overview', '/admin/live', '/admin/people', '/admin/reports', '/admin/play', '/admin/money', '/admin/staff', '/admin/log']);
        expect(hrefs(container, '[aria-current="page"]')).toEqual(['/admin/staff', '/admin/staff']);
        expect(rail.getAttribute('aria-label')).toBe('The admin');

        await router.navigate('/admin/log');
        await arrived(router, container, '#admin-main h1', 'Log');

        expect(hrefs(container, '[aria-current="page"]')).toEqual(['/admin/log', '/admin/log']);
        expect(container.querySelector('#admin-main h1')?.textContent).toBe('Log');
    });

    it('says whose admin it is: the role, the handle, and the way back to the app', async () =>
    {
        signIn('admin');
        const { container } = await opened('/admin/money');
        const header = container.querySelector('header')!;

        expect(header.querySelector('h1')?.textContent).toBe('Admin');
        expect(header.querySelector('[data-staff-handle]')?.textContent).toBe('@alex');
        expect(header.querySelector('[data-staff]')?.textContent).toBe('@alexAdmin');
        expect(header.querySelector('a[aria-label="Back to Baziche"]')?.getAttribute('href')).toBe('/app');

        cleanup();
        signIn('owner');
        const owned = await opened('/admin/money');

        expect(owned.container.querySelector('[data-staff]')?.textContent).toBe('@alexOwner');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        signIn('owner');
        const { container } = await opened('/admin/money');
        const header = container.querySelector('header')!;

        expect(header.querySelector('h1')?.textContent).toBe('مدیریت');
        expect(header.textContent).toContain('مالک');
        expect([...header.querySelectorAll('nav a')].map((link) => link.textContent?.trim())).toEqual(['نمای کلی', 'آنلاین‌ها', 'کاربرها', 'گزارش‌ها', 'بازی‌ها', 'پول', 'تیم', 'تاریخچه']);
        expect(container.querySelector('#admin-main h1')?.textContent).toBe('پول');
    });
});
