import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import LivePage from '../src/pages/admin/live.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { READ_EVERY_MS } from '../src/lib/while-seen.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { LIVE_PAGE } from '../../backend/src/domains/admin/roles.ts';
import type { AdminLive } from '../../backend/src/schemas.ts';
import { ApiError, client, server, staffMember } from './fake-api.ts';

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

const opened = async () =>
{
    const routes: Route[] = [
        { path: '/admin/live', component: () => LivePage({}) as unknown as HTMLElement },
        { path: '/admin/people/:handle', component: () => document.createElement('div') }
    ];
    const router = createRouter({ routes, history: createMemoryHistory('/admin/live'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const all = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());

const row = (root: ParentNode, handle: string) => root.querySelector<HTMLElement>(`[data-live] [data-person="${ handle }"]`)!;

const reads = () => server.calls.filter((call) => call.startsWith('admin.live')).length;

const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const person = (handle: string, extra: Partial<AdminLive['rows'][number]> = {}): AdminLive['rows'][number] => ({
    handle,
    displayName: handle.toUpperCase(),
    hue: 40,
    state: 'online',
    since: minutesAgo(5),
    tables: [],
    ...extra
});

const crowd = () =>
{
    server.lookout.online = [
        person('sara.k', {
            displayName: 'Sara Kamali',
            tables: [{ code: 'k7qx', game: 'ludo', mode: 'live', playing: true }, { code: 'h2ab', game: 'hokm', mode: 'live', playing: false }],
            call: { code: 'k7qx', game: 'ludo' }
        }),
        person('mina', { staff: 'moderator', state: 'away', since: minutesAgo(30) }),
        person('reza.t')
    ];
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
    useSession().establish({ ...ALEX, staff: 'owner' });
    useToasts().dismissAll();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('who is online now', () =>
{
    it('lists everybody online by handle, each leading to their page, with their role, whether they look away, when they came and what they are doing', async () =>
    {
        crowd();
        const container = await opened();

        expect(said(container, 'h1')).toBe('Online now');
        expect(said(container, '[data-count]')).toBe('3 online');
        expect([...container.querySelectorAll('[data-live] [data-person]')].map((one) => one.getAttribute('data-person'))).toEqual(['mina', 'reza.t', 'sara.k']);
        expect(row(container, 'sara.k').querySelector('a')?.getAttribute('href')).toBe('/admin/people/sara.k');
        expect(all(row(container, 'sara.k'), '[data-doing] li')).toEqual(['Playing Ludo at K7QX', 'Waiting at a Hokm table, H2AB', 'In the call at K7QX']);
        expect([...row(container, 'sara.k').querySelectorAll('[data-doing] [dir="ltr"]')].map((one) => one.textContent)).toEqual(['K7QX', 'H2AB', 'K7QX']);
        expect(said(row(container, 'sara.k'), '[data-name]')).toBe('Sara Kamali');
        expect(row(container, 'sara.k').querySelector<HTMLElement>('[data-role]')?.hidden).toBe(true);
        expect(row(container, 'sara.k').querySelector<HTMLElement>('[data-away]')?.hidden).toBe(true);
        expect([said(row(container, 'mina'), '[data-role]'), row(container, 'mina').querySelector<HTMLElement>('[data-role]')?.hidden]).toEqual(['Moderator', false]);
        expect([said(row(container, 'mina'), '[data-away]'), row(container, 'mina').querySelector<HTMLElement>('[data-away]')?.hidden]).toEqual(['Away', false]);
        expect(said(row(container, 'mina'), '[data-came]')).toBe('Came 30 minutes ago');
        expect(row(container, 'mina').querySelector('[data-came] time')?.getAttribute('datetime')).toBe(minutesAgo(30));
        expect(all(row(container, 'reza.t'), '[data-doing] li')).toEqual(['Not at a table']);
    });

    it('lays each person out as columns under a heading the eye reads: who, what they are doing and since when, ending in the way to their page', async () =>
    {
        crowd();
        const container = await opened();
        const head = container.querySelector<HTMLElement>('[data-columns]')!;
        const link = row(container, 'sara.k').querySelector('a')!;
        const placed = (selector: string) => link.querySelector(selector)?.closest('[class*="@2xl:col-start-"]')?.className.match(/@2xl:col-start-(\d)/)?.[1];

        expect(head.getAttribute('aria-hidden')).toBe('true');
        expect(head.classList.contains('@2xl:grid')).toBe(true);
        expect(head.closest('.\\@container')).not.toBeNull();
        expect([...head.children].map((one) => one.textContent)).toEqual(['Person', 'Activity', 'Online since']);
        expect([placed('[data-name]'), placed('[data-doing]'), placed('[data-came]')]).toEqual(['2', '3', '4']);
        expect(link.lastElementChild?.tagName.toLowerCase()).toBe('svg');
        cleanup();

        useLocale().setLocale('fa');
        const persian = await opened();

        expect([...persian.querySelectorAll('[data-columns] > *')].map((one) => one.textContent)).toEqual(['کاربر', 'فعالیت', 'آنلاین از']);
    });

    it('pages fifty at a time with Show more, and starts again from the top when it is read again', async () =>
    {
        server.lookout.online = Array.from({ length: LIVE_PAGE + 3 }, (_, at) => person(`p${ String(at).padStart(2, '0') }`));
        const container = await opened();

        expect(container.querySelectorAll('[data-live] [data-person]')).toHaveLength(LIVE_PAGE);
        expect(said(container, '[data-count]')).toBe(`${ LIVE_PAGE + 3 } online`);

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Show more')!.click();
        await settle();

        expect(container.querySelectorAll('[data-live] [data-person]')).toHaveLength(LIVE_PAGE + 3);
        expect([...container.querySelectorAll('button')].some((one) => one.textContent?.trim() === 'Show more')).toBe(false);

        clock.advance(READ_EVERY_MS);
        await settle();

        expect(container.querySelectorAll('[data-live] [data-person]'), 'a list read again shows its first page').toHaveLength(LIVE_PAGE);
    });

    it('reads again every fifteen seconds while the tab is seen, not while it is hidden, at once when it is seen again, and at a press', async () =>
    {
        crowd();
        const container = await opened();

        expect(reads()).toBe(1);

        server.lookout.online = [...server.lookout.online, person('omid.k')];
        clock.advance(READ_EVERY_MS);
        await settle();

        expect([reads(), said(container, '[data-count]')]).toEqual([2, '4 online']);

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
    });

    it('says when nobody is online, and when who is online could not be read', async () =>
    {
        const container = await opened();

        expect(container.textContent).toContain('Nobody is online right now.');
        expect(container.querySelector('[data-empty]')).not.toBeNull();
        expect(container.querySelector('.empty-art')).toBeNull();
        expect(said(container, '[data-count]')).toBe('0 online');
        cleanup();

        vi.spyOn(client.admin, 'live').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down.', undefined));
        crowd();
        const failed = await opened();

        expect(failed.textContent).toContain('Who is online could not be read.');
        expect(failed.querySelector('[data-live]')).toBeNull();
    });

    it('answers a moderator, who may read it', async () =>
    {
        crowd();
        server.staff.owner = 'reza.t';
        server.staff.members = [staffMember('alex', 'moderator', 'reza.t', minutesAgo(600))];
        useSession().reset();
        useSession().establish({ ...ALEX, staff: 'moderator' });
        const container = await opened();

        expect(container.querySelectorAll('[data-live] [data-person]')).toHaveLength(3);
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        crowd();
        const container = await opened();

        expect(said(container, 'h1')).toBe('آنلاین‌ها');
        expect(said(container, '[data-count]')).toBe('۳ نفر آنلاین');
        expect(all(row(container, 'sara.k'), '[data-doing] li')).toEqual(['سر میز K7QX داره منچ بازی می‌کنه', 'سر یه میز حکم با کد H2AB منتظره', 'توی تماس صوتی میز K7QX']);
        expect(said(row(container, 'mina'), '[data-away]')).toBe('در دسترس نیست');
        expect(all(row(container, 'reza.t'), '[data-doing] li')).toEqual(['سر هیچ میزی نیست']);
    });
});
