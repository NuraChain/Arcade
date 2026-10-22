import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Router } from 'azerothjs';

import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import AdminMore from '../src/components/admin/admin-more.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
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
    useOverlay().reset();
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

    it('lists a moderator the four sections a moderator opens: a rail, two groups down the side and four tabs with no More', async () =>
    {
        signIn('moderator');
        const { container } = await opened('/admin/people');
        const four = ['/admin/overview', '/admin/live', '/admin/people', '/admin/reports'];

        expect(hrefs(container.querySelector('[data-rail]')!, 'a')).toEqual(four);
        expect(hrefs(container.querySelector('[data-groups]')!, 'a')).toEqual(four);
        expect([...container.querySelectorAll('[data-group]')].map((group) => group.getAttribute('data-group'))).toEqual(['now', 'moderation']);
        expect(hrefs(container.querySelector('[data-tabs]')!, 'a')).toEqual(four);
        expect(container.querySelector('[data-tabs] ul')?.className).toContain('grid-cols-4');
        expect(container.querySelector('[data-more-tab]')).toBeNull();
    });

    it('says on Reports how many are waiting, wherever Reports is drawn, read when the admin opens, at every other section and when the tab is seen again', async () =>
    {
        reportFiled({ at: '2026-10-22T08:00:00.000Z', by: 'sara.k', about: 'reza.t' });
        reportFiled({ at: '2026-10-22T08:30:00.000Z', by: 'mina', about: 'reza.t' });
        reportFiled({ at: '2026-10-22T07:00:00.000Z', by: 'mina', about: 'sara.k', status: 'reviewed' });
        signIn('moderator');
        const { router, container } = await opened('/admin/people');
        const counts = () => [...container.querySelectorAll('a[href="/admin/reports"] [role="status"]')].map((count) => count.textContent);
        const unmarked = () => [...container.querySelectorAll('nav a:not([href="/admin/reports"]) [role="status"]')].length;

        expect(counts()).toEqual(['2', '2', '2']);
        expect(unmarked()).toBe(0);
        expect(container.querySelector('[data-groups] a[href="/admin/reports"] [role="status"]')?.getAttribute('aria-label')).toBe('2 reports waiting');

        reportFiled({ at: '2026-10-22T08:45:00.000Z', by: 'sara.k', about: 'mina' });
        await router.navigate('/admin/reports');
        await arrived(router, container, '#admin-main h1', 'Reports');

        expect(counts()).toEqual(['3', '3', '3']);
        expect(hrefs(container, '[aria-current="page"]')).toEqual(['/admin/reports', '/admin/reports', '/admin/reports']);

        reportFiled({ at: '2026-10-22T08:50:00.000Z', by: 'sara.k', about: 'mina' });
        await router.navigate('/admin/people');
        await arrived(router, container, '#admin-main h1', 'People');

        expect(counts()).toEqual(['4', '4', '4']);

        reportFiled({ at: '2026-10-22T08:55:00.000Z', by: 'reza.t', about: 'mina' });
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();

        expect(counts()).toEqual(['5', '5', '5']);
        expect(server.calls.filter((call) => call === 'admin.reportsWaiting').length).toBeGreaterThanOrEqual(2);
    });

    it('lists the owner every section: a rail from a tablet, four groups down the side from a desktop, and on a phone four tabs and More for the rest', async () =>
    {
        signIn('owner');
        const { router, container } = await opened('/admin/overview');
        const all = ['/admin/overview', '/admin/live', '/admin/people', '/admin/reports', '/admin/play', '/admin/notice', '/admin/money', '/admin/staff', '/admin/log'];
        const side = container.querySelector('[data-side]')!;

        expect(side.className).toContain('md:block');
        expect(container.querySelector('[data-rail]')?.className).toContain('lg:hidden');
        expect(container.querySelector('[data-groups]')?.className).toContain('lg:flex');
        expect(container.querySelector('[data-tabs]')?.className).toContain('md:hidden');
        expect(container.querySelector('[data-top]')?.className).toContain('md:hidden');
        expect(hrefs(container.querySelector('[data-rail]')!, 'a')).toEqual(all);
        expect(hrefs(container.querySelector('[data-groups]')!, 'a')).toEqual(all);
        expect([...container.querySelectorAll('[data-group]')].map((group) => [group.getAttribute('data-group'), group.querySelector('p')?.textContent, hrefs(group, 'a')])).toEqual([
            ['now', 'Now', ['/admin/overview', '/admin/live']],
            ['moderation', 'Moderation', ['/admin/people', '/admin/reports']],
            ['platform', 'Platform', ['/admin/play', '/admin/notice', '/admin/money']],
            ['team', 'Team', ['/admin/staff', '/admin/log']]
        ]);
        expect(hrefs(container.querySelector('[data-tabs]')!, 'a')).toEqual(['/admin/overview', '/admin/people', '/admin/reports', '/admin/play']);
        expect(container.querySelector('[data-tabs] ul')?.className).toContain('grid-cols-5');
        expect(container.querySelector('[data-rail] a[href="/admin/staff"]')?.getAttribute('aria-label')).toBe('Staff');
        expect(container.querySelector('[data-side] nav')?.getAttribute('aria-label')).toBe('The admin');
        expect(container.querySelector('[data-tabs]')?.getAttribute('aria-label')).toBe('The admin');

        const more = container.querySelector<HTMLButtonElement>('[data-more-tab]')!;

        expect(more.textContent?.trim()).toBe('More');
        expect(more.getAttribute('aria-haspopup')).toBe('dialog');
        expect(more.hasAttribute('data-current')).toBe(false);

        await router.navigate('/admin/staff');
        await arrived(router, container, '#admin-main h1', 'Staff');

        expect(hrefs(container, '[aria-current="page"]')).toEqual(['/admin/staff', '/admin/staff']);
        expect(more.hasAttribute('data-current')).toBe(true);

        more.click();
        await settle();

        const sheet = useOverlay().items().at(-1)!;

        expect(sheet.props).toMatchObject({ here: 'staff' });
        expect((sheet.props as unknown as { items: { to: string; label: string }[] }).items.map((item) => [item.to, item.label])).toEqual([
            ['/admin/live', 'Online now'],
            ['/admin/notice', 'Announcement'],
            ['/admin/money', 'Money'],
            ['/admin/staff', 'Staff'],
            ['/admin/log', 'Log']
        ]);

        await router.navigate('/admin/play');
        await arrived(router, container, '#admin-main h1', 'Play');

        expect(hrefs(container, '[aria-current="page"]')).toEqual(['/admin/play', '/admin/play', '/admin/play']);
        expect(more.hasAttribute('data-current')).toBe(false);
    });

    it('lists the rest in the More sheet, marks the open one, and closes as one is pressed', async () =>
    {
        const close = vi.fn();
        const items = [
            { section: 'live', to: '/admin/live', icon: 'signal' as const, label: 'Online now' },
            { section: 'log', to: '/admin/log', icon: 'history' as const, label: 'Log' }
        ];
        const router = createRouter({
            routes: [
                { path: '/', component: (): HTMLElement => AdminMore({ overlayId: 'more', close, items, here: 'log' }) as HTMLElement },
                { path: '/admin/live', component: (): HTMLElement => document.createElement('div') }
            ],
            history: createMemoryHistory('/'),
            scroll: false
        });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await settle();

        expect(container.querySelector('h2')?.textContent).toBe('More');
        expect([...container.querySelectorAll('[data-more] li a')].map((link) => [link.getAttribute('href'), link.textContent?.trim(), link.getAttribute('aria-current')])).toEqual([
            ['/admin/live', 'Online now', null],
            ['/admin/log', 'Log', 'page']
        ]);

        container.querySelector<HTMLAnchorElement>('[data-more] li a[href="/admin/live"]')!.click();
        await settle();

        expect(close).toHaveBeenCalled();
        expect(router.location().pathname).toBe('/admin/live');
    });

    it('says whose admin it is, on a phone at the top and from a tablet at the foot of the side, with the way back to the app', async () =>
    {
        signIn('admin');
        const { container } = await opened('/admin/money');
        const top = container.querySelector('[data-top]')!;
        const foot = container.querySelector('[data-staff]')!;

        expect(top.querySelector('span.title')?.textContent).toBe('Admin');
        expect(top.textContent).toContain('@alex');
        expect([...top.querySelectorAll('span')].some((one) => one.textContent === 'Admin' && !one.classList.contains('title'))).toBe(true);
        expect(top.querySelector('a[aria-label="Back to Baziche"]')?.getAttribute('href')).toBe('/app');
        expect(top.querySelector('h1')).toBeNull();
        expect(container.querySelectorAll('h1')).toHaveLength(1);
        expect(foot.querySelector('[data-staff-handle]')?.textContent).toBe('@alex');
        expect(foot.querySelector('[data-staff-role]')?.textContent).toBe('Admin');
        expect(foot.querySelector('a[aria-label="Back to Baziche"]')?.getAttribute('href')).toBe('/app');
        expect(foot.querySelector('[data-leave]')?.getAttribute('href')).toBe('/app');
        expect(foot.querySelector('[data-leave]')?.textContent?.trim()).toBe('Back to Baziche');

        cleanup();
        signIn('owner');
        const owned = await opened('/admin/money');

        expect(owned.container.querySelector('[data-staff-role]')?.textContent).toBe('Owner');
    });

    it('heads a section with its title, one sentence and, folded, how it works', async () =>
    {
        signIn('owner');
        const { router, container } = await opened('/admin/play');
        const head = container.querySelector('#admin-main [data-admin-head]')!;

        expect(head.querySelector('h1')?.textContent).toBe('Play');
        expect(head.querySelector('[data-lead]')?.textContent).toBe('Pause a game, end one that cannot go on, or close a table that waits.');

        const how = head.querySelector<HTMLDetailsElement>('[data-how]')!;

        expect(how.open).toBe(false);
        expect(how.querySelector('summary')?.textContent?.trim()).toBe('How this works');
        expect(how.querySelector('p')?.textContent).toContain('While a game is paused nobody can open a table of it');

        await router.navigate('/admin/staff');
        await arrived(router, container, '#admin-main h1', 'Staff');

        expect(container.querySelector('#admin-main [data-how]')).toBeNull();
        expect(container.querySelector('#admin-main [data-lead]')?.textContent).toBe('The people who run Baziche, and what each of them may do.');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        signIn('owner');
        const { container } = await opened('/admin/money');

        expect(container.querySelector('[data-top]')?.textContent).toContain('مدیریت');
        expect(container.querySelector('[data-staff-role]')?.textContent).toBe('مالک');
        expect([...container.querySelectorAll('[data-groups] a')].map((link) => link.textContent?.trim())).toEqual(['نمای کلی', 'آنلاین‌ها', 'کاربرها', 'گزارش‌ها', 'بازی‌ها', 'اطلاعیه', 'پول', 'تیم', 'تاریخچه']);
        expect([...container.querySelectorAll('[data-group] p')].map((label) => label.textContent)).toEqual(['الان', 'رسیدگی', 'پلتفرم', 'همکارها']);
        expect(container.querySelector('[data-more-tab]')?.textContent?.trim()).toBe('بیشتر');
        expect(container.querySelector('#admin-main h1')?.textContent).toBe('پول');
    });
});
