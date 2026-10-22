import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import { LOG_PAGE } from '../../backend/src/domains/admin/roles.ts';
import LogPage from '../src/pages/admin/log.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { SEARCH_PAUSE_MS } from '../src/services/search.service.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server, staffLogged } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'owner' as const };

let clock: ManualClock;

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const opened = async (at = '/admin/log') =>
{
    const routes: Route[] = [{ path: '/admin/log', component: () => LogPage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return { router, container };
};

const lines = (root: ParentNode) => [...root.querySelectorAll('[data-entry] [data-line]')].map((line) => line.textContent?.trim());

const facts = (root: ParentNode, entry: string) => [...root.querySelectorAll(`${ entry } .facts span`)].map((one) => one.textContent?.trim());

const isolated = (root: ParentNode, entry: string) => [...root.querySelectorAll(`${ entry } [data-line] [dir="ltr"]`)].map((one) => one.textContent);

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const suspensions = () =>
{
    staffLogged({ at: hoursAgo(30), staff: 'mina', staffRole: 'moderator', kind: 'suspend', person: 'reza.t', reason: 'Rude at every table this week.', details: { category: 'harassment', days: '7', until: hoursAgo(-138) } });
    staffLogged({ at: hoursAgo(20), staff: 'alex', staffRole: 'owner', kind: 'suspend', person: 'omid', reason: 'Played two seats at one table.', details: { category: 'cheating' } });
    staffLogged({ at: hoursAgo(10), staff: 'alex', staffRole: 'owner', kind: 'lift', person: 'omid', reason: 'Said sorry to the table.', details: {} });
    staffLogged({ at: hoursAgo(1), kind: 'expire', person: 'reza.t', reason: 'The suspension ran its time.', details: {} });
};

const cleared = () =>
{
    staffLogged({ at: hoursAgo(3), staff: 'mina', staffRole: 'moderator', kind: 'clear', person: 'reza.t', reason: 'A name meant to insult.', details: { part: 'name', from: 'Reza the Cheat' } });
    staffLogged({ at: hoursAgo(2), staff: 'mina', staffRole: 'moderator', kind: 'clear', person: 'reza.t', reason: 'Selling seats in the bio.', details: { part: 'bio', from: 'DM me for seats' } });
    staffLogged({ at: hoursAgo(1.5), staff: 'alex', staffRole: 'owner', kind: 'clear', person: 'reza.t', reason: 'A picture nobody should see.', details: { part: 'picture' } });
    staffLogged({ at: hoursAgo(1), staff: 'alex', staffRole: 'owner', kind: 'sign-out', person: 'reza.t', reason: 'Their wallet was taken.', details: { sessions: '2' } });
};

const handled = () =>
{
    staffLogged({ at: hoursAgo(2), staff: 'mina', staffRole: 'moderator', kind: 'report', person: 'reza.t', reason: 'Nothing rude in the chat.', details: { report: 'r-1', outcome: 'reviewed', reporter: 'sara.k' } });
    staffLogged({ at: hoursAgo(1), staff: 'alex', staffRole: 'owner', kind: 'report', person: 'omid', reason: 'Suspended them for a week.', details: { report: 'r-2', outcome: 'actioned', reporter: 'sara.k' } });
};

const switched = () =>
{
    staffLogged({ at: hoursAgo(5), staff: 'mina', staffRole: 'admin', kind: 'game', reason: 'A bug in the dice.', details: { game: 'ludo', from: 'available', to: 'disabled' } });
    staffLogged({ at: hoursAgo(1), staff: 'alex', staffRole: 'owner', kind: 'game', reason: 'The dice are fixed.', details: { game: 'ludo', from: 'disabled', to: 'available' } });
};

const ended = () =>
{
    staffLogged({ at: hoursAgo(1), staff: 'mina', staffRole: 'admin', kind: 'void', reason: 'Stuck after a fault in the sweep.', details: { match: 'm-1', game: 'hokm', table: 'k7qx' } });
};

const shut = () =>
{
    staffLogged({ at: hoursAgo(1), staff: 'mina', staffRole: 'admin', kind: 'close', reason: 'Left open by a fault.', details: { id: 't-1', game: 'poker', table: 'p3qa' } });
};

const marked = () =>
{
    staffLogged({ at: hoursAgo(2), staff: 'mina', staffRole: 'moderator', kind: 'minor', person: 'reza.t', reason: 'Said in a report that he is fifteen.', details: { to: 'minor' } });
    staffLogged({ at: hoursAgo(1), staff: 'alex', staffRole: 'owner', kind: 'minor', person: 'reza.t', reason: 'Showed an ID that says he is nineteen.', details: { to: 'adult' } });
};

const announced = () =>
{
    staffLogged({ at: hoursAgo(5), staff: 'alex', staffRole: 'owner', kind: 'notice', reason: 'Maintenance tonight.', details: { to: 'up', en: 'Nura restarts at 22:00.', fa: 'نورا ساعت ۲۲ ری‌استارت می‌شه.', hours: '24', until: hoursAgo(-19) } });
    staffLogged({ at: hoursAgo(1), staff: 'mina', staffRole: 'admin', kind: 'notice', reason: 'The restart is done.', details: { to: 'down', en: 'Nura restarts at 22:00.', fa: 'نورا ساعت ۲۲ ری‌استارت می‌شه.' } });
};

const was = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-entry] [data-was]')].map((one) => (one.hidden ? null : one.textContent?.replace(/\s+/g, ' ').trim()));

const story = () =>
{
    staffLogged({ at: hoursAgo(48), staff: 'alex', staffRole: 'owner', kind: 'grant', person: 'mina', reason: 'Runs the Friday tables.', details: { to: 'moderator' } });
    staffLogged({ at: hoursAgo(24), staff: 'alex', staffRole: 'owner', kind: 'change', person: 'mina', reason: 'Steps up for the season.', details: { from: 'moderator', to: 'admin' } });
    staffLogged({ at: hoursAgo(1), staff: 'mina', staffRole: 'admin', kind: 'revoke', person: 'sara.k', reason: 'Asked to step down.', details: { from: 'moderator' } });
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
    useSession().establish(ALEX);
    useToasts().dismissAll();
});

afterEach(() =>
{
    cleanup();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the log', () =>
{
    it('reads newest first, each change as a sentence with the reason given, when, and the role it was made with', async () =>
    {
        story();
        const { container } = await opened();

        expect(lines(container)).toEqual([
            'mina took sara.k off the staff.',
            'alex changed mina from a moderator to an admin.',
            'alex made mina a moderator.'
        ]);
        expect(said(container, '[data-entry]:first-child [data-reason]')).toBe('Asked to step down.');
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['mina', 'sara.k']);
        expect(facts(container, '[data-entry]:first-child')).toEqual(['1 hour ago', 'Admin']);
        expect(facts(container, '[data-entry]:last-child')).toEqual(['2 days ago', 'Owner']);
        expect(container.querySelectorAll('[data-entry] [data-open-report]')).toHaveLength(0);
    });

    it('says a note as a note, with its words where a change keeps its reason', async () =>
    {
        staffLogged({ at: hoursAgo(2), staff: 'mina', staffRole: 'moderator', kind: 'note', person: 'reza.t', reason: 'Rude at a Hokm table, twice.', details: {} });
        const { container } = await opened('/admin/log?kind=note');

        expect(lines(container)).toEqual(['mina wrote a note on reza.t.']);
        expect(said(container, '[data-entry] [data-reason]')).toBe('Rude at a Hokm table, twice.');
        expect(isolated(container, '[data-entry]')).toEqual(['mina', 'reza.t']);
    });

    it('says a suspension with its term and its category, a lift, and one that ran its time with nobody named and no reason', async () =>
    {
        suspensions();
        const { container } = await opened();

        expect(lines(container)).toEqual([
            'The suspension on reza.t ran its time.',
            'alex lifted the suspension on omid.',
            'alex suspended omid for good: Cheating.',
            'mina suspended reza.t for a week: Harassment or abuse.'
        ]);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['reza.t']);
        expect(isolated(container, '[data-entry]:last-child')).toEqual(['mina', 'reza.t']);
        expect(container.querySelector('[data-entry]:first-child [data-reason]')).toBeNull();
        expect(facts(container, '[data-entry]:first-child')).toEqual(['1 hour ago', '']);
        expect(said(container, '[data-entry]:nth-child(2) [data-reason]')).toBe('Said sorry to the table.');
        expect(facts(container, '[data-entry]:last-child')[1]).toBe('Moderator');
    });

    it('says what was taken off a profile, with what a name or a bio said, and every session ended', async () =>
    {
        cleared();
        const { container } = await opened();

        expect(lines(container)).toEqual([
            'alex signed reza.t out everywhere.',
            'alex removed reza.t’s picture.',
            'mina cleared reza.t’s bio.',
            'mina reset reza.t’s name.'
        ]);
        expect(was(container)).toEqual([null, null, 'It said: DM me for seats', 'It said: Reza the Cheat']);
        expect(isolated(container, '[data-entry]:nth-child(2)')).toEqual(['alex', 'reza.t']);
        expect(said(container, '[data-entry]:first-child [data-reason]')).toBe('Their wallet was taken.');
    });

    it('says a report the staff handled, with who filed it and about whom, each handle a run of its own', async () =>
    {
        handled();
        const { container } = await opened('/admin/log?kind=report');

        expect(lines(container)).toEqual([
            'alex acted on sara.k’s report about omid.',
            'mina reviewed sara.k’s report about reza.t: nothing to do.'
        ]);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['alex', 'sara.k', 'omid']);
        expect(said(container, '[data-entry]:last-child [data-reason]')).toBe('Nothing rude in the chat.');
        expect(container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Reports');
        expect(container.querySelector('[data-entry]:first-child [data-open-report]')?.getAttribute('href')).toBe('/admin/reports/r-2');
        expect(said(container, '[data-entry]:last-child [data-open-report]')).toBe('Open the report');
    });

    it('says a game paused and turned back on, naming the game in the reader\'s words and nobody else', async () =>
    {
        switched();
        const { container } = await opened('/admin/log?kind=game');

        expect(lines(container)).toEqual([
            'alex turned Ludo back on.',
            'mina paused Ludo.'
        ]);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['alex']);
        expect(said(container, '[data-entry]:last-child [data-reason]')).toBe('A bug in the dice.');
        expect(container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Games');
        expect(server.calls.filter((call) => call.startsWith('admin.log')).at(-1)).toContain('"kind":"game"');
    });

    it('says a game the staff ended, naming the game in the reader\'s words and the table\'s code set apart', async () =>
    {
        ended();
        const { container } = await opened('/admin/log?kind=void');

        expect(lines(container)).toEqual(['mina ended a game of Hokm at K7QX as no contest.']);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['mina', 'K7QX']);
        expect(container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Games ended');
        expect(server.calls.filter((call) => call.startsWith('admin.log')).at(-1)).toContain('"kind":"void"');
    });

    it('says a table the staff closed, naming the game in the reader\'s words and the table\'s code set apart', async () =>
    {
        shut();
        const { container } = await opened('/admin/log?kind=close');

        expect(lines(container)).toEqual(['mina closed the Poker table P3QA.']);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['mina', 'P3QA']);
        expect(container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Tables closed');

        useLocale().setLocale('fa');
        await settle();

        expect(lines(container)).toEqual(['mina، میز پوکر با کد P3QA رو بست.']);
    });

    it('says who put an announcement up and for how long, who took it down, and what it said in the reader\'s own language', async () =>
    {
        announced();
        const { container } = await opened('/admin/log?kind=notice');

        expect(lines(container)).toEqual(['mina took the announcement down.', 'alex put up an announcement for a day.']);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['mina']);
        expect(was(container)).toEqual(['It said: Nura restarts at 22:00.', 'It said: Nura restarts at 22:00.']);
        expect(container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Announcements');

        useLocale().setLocale('fa');
        await settle();

        expect(lines(container)).toEqual(['mina، اطلاعیه رو برداشت.', 'alex، یه اطلاعیه برای یه روز گذاشت.']);
        expect(was(container)).toEqual(['نوشته بود: نورا ساعت ۲۲ ری‌استارت می‌شه.', 'نوشته بود: نورا ساعت ۲۲ ری‌استارت می‌شه.']);
    });

    it('says who marked somebody under 18 and who marked them an adult again, each handle set apart', async () =>
    {
        marked();
        const { container } = await opened('/admin/log?kind=minor');

        expect(lines(container)).toEqual(['alex marked reza.t as an adult.', 'mina marked reza.t as under 18.']);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['alex', 'reza.t']);
        expect(container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Age');

        useLocale().setLocale('fa');
        await settle();

        expect(lines(container)).toEqual(['alex، reza.t رو بزرگ‌سال ثبت کرد.', 'mina، reza.t رو زیر ۱۸ ثبت کرد.']);
    });

    it('gives the exact moment of each change under a pointer, in the reader\'s own calendar', async () =>
    {
        story();
        const { container } = await opened();
        const time = container.querySelector<HTMLTimeElement>('[data-entry]:first-child [data-when]')!;
        const hover = () =>
        {
            const enter = new Event('pointerenter', { bubbles: true });

            Object.defineProperty(enter, 'pointerType', { value: 'mouse' });
            time.parentElement!.dispatchEvent(enter);
        };

        expect(time.dateTime).toBe(hoursAgo(1));
        expect(time.textContent).toBe('1 hour ago');

        hover();
        clock.advance(400);
        await settle();

        expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(useLocale().date(NOW - 3_600_000, { dateStyle: 'long', timeStyle: 'short' }));
        time.parentElement!.dispatchEvent(new Event('pointerleave', { bubbles: true }));
        useLocale().setLocale('fa');
        await settle();
        hover();
        clock.advance(400);
        await settle();

        expect(document.querySelector('[role="tooltip"]')?.textContent).toMatch(/[۰-۹]/);
        expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(useLocale().date(NOW - 3_600_000, { dateStyle: 'long', timeStyle: 'short' }));
    });

    it('keeps its filters in the address: the kind at a press, a handle after a pause or at Enter', async () =>
    {
        story();
        const { router, container } = await opened();

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Changed')!.click();
        await settle();

        expect(router.location().query.kind).toBe('change');
        expect(lines(container)).toEqual(['alex changed mina from a moderator to an admin.']);

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'All')!.click();
        typeInto(container.querySelector<HTMLInputElement>('#admin-log-staff')!, '@Mina');
        await settle();

        expect(router.location().query.staff).toBeUndefined();
        expect(lines(container)).toHaveLength(3);

        clock.advance(SEARCH_PAUSE_MS);
        await settle();

        expect(router.location().query.staff).toBe('mina');
        expect(lines(container)).toEqual(['mina took sara.k off the staff.']);

        const person = container.querySelector<HTMLInputElement>('#admin-log-person')!;
        typeInto(container.querySelector<HTMLInputElement>('#admin-log-staff')!, '');
        typeInto(person, 'mina');
        person.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();

        expect([router.location().query.staff, router.location().query.person]).toEqual([undefined, 'mina']);
        expect(lines(container)).toEqual([
            'alex changed mina from a moderator to an admin.',
            'alex made mina a moderator.'
        ]);
    });

    it('opens on the filters the address names', async () =>
    {
        story();
        const { container } = await opened('/admin/log?kind=grant&person=mina');

        expect(container.querySelector<HTMLInputElement>('#admin-log-person')!.value).toBe('mina');
        expect(container.querySelector('[aria-pressed="true"]')?.textContent?.trim()).toBe('Added');
        expect(lines(container)).toEqual(['alex made mina a moderator.']);
    });

    it('shows older entries a page at a time, each once, and offers no more past the first', async () =>
    {
        for (let one = 0; one < LOG_PAGE + 5; one += 1)
        {
            staffLogged({ at: hoursAgo(LOG_PAGE + 5 - one), staff: 'alex', staffRole: 'owner', kind: 'grant', person: `p${ one }`, reason: `Entry ${ one }.`, details: { to: 'moderator' } });
        }
        const { container } = await opened();
        const more = () => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Show older');

        expect(lines(container)).toHaveLength(LOG_PAGE);
        expect(lines(container)[0]).toBe(`alex made p${ LOG_PAGE + 4 } a moderator.`);

        more()!.click();
        await settle();

        const all = lines(container);
        expect(all).toHaveLength(LOG_PAGE + 5);
        expect(new Set(all).size).toBe(LOG_PAGE + 5);
        expect(all.at(-1)).toBe('alex made p0 a moderator.');
        expect(more()).toBeUndefined();

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Changed')!.click();
        await settle();

        expect(lines(container)).toEqual([]);
        expect(container.textContent).toContain('Nothing in the log matches.');
    });

    it('says when nothing has been logged, when nothing matches, and when the log could not be read', async () =>
    {
        const { container } = await opened();

        expect(container.textContent).toContain('Nothing has been logged yet.');
        cleanup();

        story();
        const filtered = await opened('/admin/log?staff=nobody');

        expect(filtered.container.textContent).toContain('Nothing in the log matches.');
        cleanup();

        server.staff.owner = 'sara.k';
        const refused = await opened();

        expect(refused.container.textContent).toContain('The log could not be read.');
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        story();
        const { container } = await opened();

        expect(said(container, 'h1')).toBe('تاریخچه');
        expect(lines(container)).toEqual([
            'mina، sara.k رو از تیم برداشت.',
            'alex، mina رو از ناظر کرد ادمین.',
            'alex، mina رو ناظر کرد.'
        ]);
        expect([...container.querySelectorAll('[aria-pressed]')].map((one) => one.textContent?.trim())).toEqual(['همه', 'اضافه شده', 'عوض شده', 'برداشته شده', 'یادداشت‌ها', 'تعلیق‌ها', 'رفع تعلیق', 'پایان تعلیق', 'پاک شده', 'خارج شده', 'گزارش‌ها', 'بازی‌ها', 'بازی‌های تموم‌شده', 'میزهای بسته‌شده', 'سن', 'اطلاعیه‌ها']);
        expect(isolated(container, '[data-entry]:nth-child(2)')).toEqual(['alex', 'mina']);
    });

    it('says what was taken off a profile, and every session ended, in Persian', async () =>
    {
        useLocale().setLocale('fa');
        cleared();
        const { container } = await opened();

        expect(lines(container)).toEqual([
            'alex، reza.t رو از همه‌جا خارج کرد.',
            'alex، عکس reza.t رو برداشت.',
            'mina، بیوی reza.t رو پاک کرد.',
            'mina، اسم reza.t رو برگردوند.'
        ]);
        expect(was(container)).toEqual([null, null, 'نوشته بود: DM me for seats', 'نوشته بود: Reza the Cheat']);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['alex', 'reza.t']);
    });

    it('says a game paused and turned back on in Persian', async () =>
    {
        useLocale().setLocale('fa');
        switched();
        const { container } = await opened();

        expect(lines(container)).toEqual([
            'alex، منچ رو دوباره فعال کرد.',
            'mina، منچ رو متوقف کرد.'
        ]);
    });

    it('says a game the staff ended in Persian', async () =>
    {
        useLocale().setLocale('fa');
        ended();
        const { container } = await opened();

        expect(lines(container)).toEqual(['mina، بازی حکم سر میز K7QX رو بدون نتیجه تموم کرد.']);
        expect(isolated(container, '[data-entry]:first-child')).toEqual(['mina', 'K7QX']);
    });

    it('says a report the staff handled in Persian', async () =>
    {
        useLocale().setLocale('fa');
        handled();
        const { container } = await opened();

        expect(lines(container)).toEqual([
            'alex، به گزارش sara.k درباره‌ی omid رسیدگی کرد.',
            'mina، گزارش sara.k درباره‌ی reza.t رو بررسی کرد: کاری لازم نبود.'
        ]);
        expect(isolated(container, '[data-entry]:last-child')).toEqual(['mina', 'sara.k', 'reza.t']);
        expect(said(container, '[data-entry]:last-child [data-open-report]')).toBe('دیدن گزارش');
    });

    it('says a suspension, a lift and one that ran its time in Persian, each handle a run of its own', async () =>
    {
        useLocale().setLocale('fa');
        suspensions();
        const { container } = await opened();

        expect(lines(container)).toEqual([
            'تعلیق reza.t تموم شد.',
            'alex، تعلیق omid رو برداشت.',
            'alex، omid رو برای همیشه معلق کرد: تقلب.',
            'mina، reza.t رو برای یه هفته معلق کرد: آزار یا توهین.'
        ]);
        expect(isolated(container, '[data-entry]:nth-child(2)')).toEqual(['alex', 'omid']);
        expect(isolated(container, '[data-entry]:last-child')).toEqual(['mina', 'reza.t']);
    });
});
