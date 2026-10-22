import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import OverviewPage from '../src/pages/admin/overview.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { READ_EVERY_MS } from '../src/lib/while-seen.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useReports } from '../src/stores/reports.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import { ApiError, client, reportFiled, server, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };

let clock: ManualClock;

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
    server.staff.owner = staff === 'owner' ? 'alex' : 'reza.t';
    server.staff.members = staff === 'owner' ? [] : [staffMember('alex', staff, 'reza.t', '2026-10-20T09:00:00.000Z')];
    useSession().reset();
    useSession().establish({ ...ALEX, staff });
};

const opened = async () =>
{
    const routes: Route[] = [
        { path: '/admin/overview', component: () => OverviewPage({}) as unknown as HTMLElement },
        { path: '/admin/:other', component: () => document.createElement('div') }
    ];
    const router = createRouter({ routes, history: createMemoryHistory('/admin/overview'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const all = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());

const href = (root: ParentNode, selector: string) => root.querySelector(selector)?.getAttribute('href') ?? null;

const reads = () => server.calls.filter((call) => call === 'admin.overview').length;

const told = () =>
{
    server.lookout.overview = {
        at: '2026-10-22T08:59:30.000Z',
        people: { total: 1234, day: 12, week: 80, active: 300, suspended: 4, minors: 1 },
        online: 57,
        games: [
            { game: 'hokm', status: 'available', matches: 3, tables: 1 },
            { game: 'poker', status: 'disabled', matches: 0, tables: 0 },
            { game: 'backgammon', status: 'available', matches: 1, tables: 2 },
            { game: 'ludo', status: 'available', matches: 5, tables: 4 }
        ],
        stuck: 1,
        reports: 0,
        money: { playing: 2, inPlay: '45000000000000000000', stuck: 1 },
        health: {
            uptime: 93_780,
            rss: 180_000_000,
            heap: 64_000_000,
            loop: { busy: 0.0123, stall: 12.5 },
            pool: { total: 6, idle: 4, waiting: 0 },
            sockets: 61,
            requests: 4210,
            failed: 3,
            failures: [{ at: '2026-10-22T08:40:00.000Z', method: 'POST', path: '/api/tables/abc/start', status: 500 }]
        }
    };
    reportFiled({ at: '2026-10-22T08:00:00.000Z', by: 'sara.k', about: 'reza.t' });
    reportFiled({ at: '2026-10-22T08:30:00.000Z', by: 'mina', about: 'reza.t' });
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(NOW);
    setRuntime({ clock, seed: 5 });
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
    vi.restoreAllMocks();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the overview', () =>
{
    it('says first what needs the reader, then four counts, each leading to its section, then every game and the rest of the accounts', async () =>
    {
        told();
        const container = await opened();

        expect(said(container, 'h1')).toBe('Overview');
        expect(said(container, '[data-read-at]')).toBe(`Read at ${ useLocale().date(Date.parse('2026-10-22T08:59:30.000Z'), { timeStyle: 'medium' }) }`);
        expect(said(container, '#overview-needs')).toBe('Needs you');
        expect(all(container, '[data-needs] li')).toEqual(['2 reports waiting', '1 game stuck', '1 payment stuck on the way']);
        expect([href(container, '[data-reports]'), href(container, '[data-stuck]'), href(container, '[data-owed]')]).toEqual(['/admin/reports', '/admin/play?view=stuck', '/admin/money']);
        expect(container.querySelector('[data-calm]')).toBeNull();
        expect([...container.querySelectorAll('[data-tiles] > li a')].map((tile) => tile.getAttribute('aria-label'))).toEqual(['Accounts: 1,234, 12 joined in the last day', 'Online now: 57, 300 seen in the last day', '2 reports waiting', 'Games being played: 9, 7 tables waiting']);
        expect(all(container, '[data-tile-title]')).toEqual(['Accounts', 'Online now', 'Reports waiting', 'Games being played']);
        expect([said(container, '[data-joined]'), said(container, '[data-seen]'), said(container, '[data-playing]'), said(container, '[data-waiting-tables]')]).toEqual(['12 joined in the last day', '300 seen in the last day', '9', '7 tables waiting']);
        expect([...container.querySelectorAll('[data-tiles] > li a')].map((tile) => tile.getAttribute('href'))).toEqual(['/admin/people', '/admin/live', '/admin/reports', '/admin/play?view=matches']);
        expect(container.querySelector('[data-waiting]')?.className).toContain('text-gold');
        expect(all(container, '[data-facts] li')).toEqual(['80 joined in the last week', '4 suspended', '1 under 18']);
        expect([said(container, '[data-suspended]'), href(container, '[data-suspended]')]).toEqual(['4 suspended', '/admin/people?list=suspended']);
        expect([said(container, '[data-minors]'), href(container, '[data-minors]')]).toEqual(['1 under 18', '/admin/people?list=minors']);
        expect(all(container, '[data-game="ludo"] [data-matches], [data-game="ludo"] [data-tables]')).toEqual(['5 games being played', '4 tables waiting']);
        expect(all(container, '[data-game="hokm"] [data-matches], [data-game="hokm"] [data-tables]')).toEqual(['3 games being played', '1 table waiting']);
        expect(said(container, '[data-game="poker"]')).toContain('Paused');
        expect(said(container, '[data-game="ludo"]')).toContain('On');
        expect([container.querySelector('[data-game="poker"] .bg-gold'), container.querySelector('[data-game="ludo"] .bg-live')].every((dot) => dot !== null)).toBe(true);
        expect(container.querySelector('[data-game="poker"] .bg-live')).toBeNull();
        expect(href(container, '[data-open-play]')).toBe('/admin/play');
        expect([...container.querySelectorAll('.facts')].flatMap((one) => one.className.split(' ').filter((name) => /^(?:[a-z]+:)?(?:p|px|ps|pe)-/.test(name)))).toEqual([]);
    });

    it('says a payment stuck on the way needs the reader, though nothing else does', async () =>
    {
        server.lookout.overview = {
            at: '2026-10-22T08:59:30.000Z',
            people: { total: 3, day: 0, week: 1, active: 2, suspended: 0, minors: 0 },
            online: 1,
            games: [{ game: 'ludo', status: 'available', matches: 0, tables: 0 }],
            stuck: 0,
            reports: 0,
            money: { playing: 1, inPlay: '10000000000000000000', stuck: 1 }
        };
        const container = await opened();

        expect(all(container, '[data-needs] li')).toEqual(['1 payment stuck on the way']);
        expect(container.querySelector('[data-calm]')).toBeNull();
    });

    it('says nothing needs the reader when nothing does', async () =>
    {
        told();
        server.reset();
        as('owner');
        server.lookout.overview = {
            at: '2026-10-22T08:59:30.000Z',
            people: { total: 3, day: 0, week: 1, active: 2, suspended: 0, minors: 0 },
            online: 1,
            games: [{ game: 'ludo', status: 'available', matches: 0, tables: 0 }],
            stuck: 0,
            reports: 0,
            money: { playing: 0, inPlay: '0', stuck: 0 }
        };
        const container = await opened();

        expect(container.querySelector('[data-needs] ul')).toBeNull();
        expect(said(container, '[data-calm]')).toBe('Nothing needs you right now.');
        expect(container.querySelector('[data-waiting]')?.className).not.toContain('text-gold');
    });

    it('shows an admin the money in play and this server\'s health', async () =>
    {
        told();
        as('admin');
        const container = await opened();

        expect(all(container, '[data-money] li')).toEqual(['45 NURA locked in games', '2 games for NURA being played', '1 payment stuck on the way']);
        expect(container.querySelector('[data-paid-stuck]')?.className).toContain('text-danger');
        expect(said(container, '[data-uptime]')).toBe('Up for 1 day, 2 hours');
        expect(said(container, '[data-memory]')).toBe('180 MB in all · heap 64 MB');
        expect(said(container, '[data-loop]')).toBe('busy 1.2% of the time · the longest wait 12.5 ms');
        expect(said(container, '[data-pool]')).toBe('6 open · 4 idle · 0 waiting');
        expect(said(container, '[data-sockets]')).toBe('61');
        expect(said(container, '[data-hour]')).toBe('4,210 requests · 3 failed');
        expect(container.querySelector('[data-hour]')?.className).toContain('text-danger');
        expect(all(container, '[data-failures] li > span:not(.text-faint)')).toEqual(['500', 'POST /api/tables/abc/start']);
        expect(container.querySelector('[data-failures] time')?.getAttribute('datetime')).toBe('2026-10-22T08:40:00.000Z');
        expect(href(container, 'a[href="/admin/money"]')).toBe('/admin/money');
    });

    it('says a server up under a minute is, and one up under an hour in minutes alone', async () =>
    {
        told();
        as('admin');
        server.lookout.overview = { ...server.lookout.overview, health: { ...server.lookout.overview.health!, uptime: 40 } };
        const fresh = await opened();

        expect(said(fresh, '[data-uptime]')).toBe('Up for less than a minute');
        cleanup();

        server.lookout.overview = { ...server.lookout.overview, health: { ...server.lookout.overview.health!, uptime: 3_000 } };
        const young = await opened();

        expect(said(young, '[data-uptime]')).toBe('Up for 50 minutes');
        cleanup();

        server.lookout.overview = { ...server.lookout.overview, health: { ...server.lookout.overview.health!, uptime: 7_380 } };
        const older = await opened();

        expect(said(older, '[data-uptime]')).toBe('Up for 2 hours, 3 minutes');
    });

    it('shows a moderator neither the money nor the server, and no way to Play', async () =>
    {
        told();
        as('moderator');
        const container = await opened();

        expect(said(container, '[data-accounts]')).toBe('1,234');
        expect([container.querySelector('[data-money]'), container.querySelector('[data-health]'), container.querySelector('[data-open-play]')]).toEqual([null, null, null]);
        expect([container.querySelector('[data-stuck]'), container.querySelector('[data-owed]')]).toEqual([null, null]);
        expect(container.querySelector('[data-tiles] a[href^="/admin/play"]')).toBeNull();
        expect(all(container, '[data-needs] li')).toEqual(['2 reports waiting']);
    });

    it('says nothing is stuck by saying nothing, and that no request has failed', async () =>
    {
        told();
        server.lookout.overview = {
            ...server.lookout.overview,
            stuck: 0,
            money: { playing: 0, inPlay: '0', stuck: 0 },
            health: { ...server.lookout.overview.health!, failed: 0, failures: [] }
        };
        const container = await opened();

        expect([container.querySelector('[data-stuck]'), container.querySelector('[data-owed]')]).toEqual([null, null]);
        expect(all(container, '[data-needs] li')).toEqual(['2 reports waiting']);
        expect(container.querySelector('[data-paid-stuck]')?.className).not.toContain('text-danger');
        expect(said(container, '[data-failures="none"]')).toBe('No request has failed since this server started.');
    });

    it('reads again every fifteen seconds while the tab is seen, not while it is hidden, at once when it is seen again, and at a press', async () =>
    {
        told();
        const container = await opened();

        expect(reads()).toBe(1);

        server.lookout.overview = { ...server.lookout.overview, online: 58 };
        clock.advance(READ_EVERY_MS);
        await settle();

        expect([reads(), said(container, '[data-online]')]).toEqual([2, '58']);

        const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        clock.advance(READ_EVERY_MS);
        await settle();

        expect(reads()).toBe(2);

        hidden.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();

        expect(reads()).toBe(3);

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Read again')!.click();
        await settle();

        expect(reads()).toBe(4);

        cleanup();
        await settle();

        expect(clock.pending(), 'a page that has gone leaves no timer behind').toBe(0);
    });

    it('hands the count of reports waiting to the nav', async () =>
    {
        told();
        await opened();

        expect(useReports().waiting()).toBe(2);
    });

    it('says when the overview could not be read, and reads it at a press', async () =>
    {
        told();
        vi.spyOn(client.admin, 'overview').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down.', undefined));
        const container = await opened();

        expect(container.textContent).toContain('The overview could not be read.');
        expect(container.querySelector('[data-accounts]')).toBeNull();

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Try again')!.click();
        await settle();

        expect(said(container, '[data-accounts]')).toBe('1,234');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        told();
        const container = await opened();

        expect(said(container, 'h1')).toBe('نمای کلی');
        expect(said(container, '#overview-needs')).toBe('نیاز به رسیدگی');
        expect(said(container, '[data-accounts]')).toBe('۱٬۲۳۴');
        expect(said(container, '[data-joined]')).toBe('۱۲ نفر توی ۲۴ ساعت گذشته عضو شدن');
        expect(said(container, '[data-seen]')).toBe('۳۰۰ نفر توی ۲۴ ساعت گذشته سر زدن');
        expect(all(container, '[data-facts] li')).toEqual(['۸۰ نفر توی هفته‌ی گذشته عضو شدن', '۴ حساب تعلیق‌شده', '۱ نفر زیر ۱۸']);
        expect(said(container, '[data-minors]')).toBe('۱ نفر زیر ۱۸');
        expect(said(container, '[data-reports]')).toBe('۲ گزارش منتظر بررسی');
        expect(all(container, '[data-tile-title]')).toEqual(['حساب‌ها', 'آنلاین‌ها', 'گزارش‌های منتظر', 'بازی‌های در جریان']);
        expect(container.querySelector('[data-tiles] > li a')?.getAttribute('aria-label')).toBe('حساب‌ها: ۱٬۲۳۴، ۱۲ نفر توی ۲۴ ساعت گذشته عضو شدن');
        expect(said(container, '[data-money] [data-in-play]')).toBe('۴۵ NURA قفل‌شده توی بازی‌ها');
    });
});
