import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import { PEOPLE_PAGE } from '../../backend/src/domains/admin/roles.ts';
import PeoplePage from '../src/pages/admin/people.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { SEARCH_PAUSE_MS } from '../src/services/search.service.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';

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

const opened = async (at = '/admin/people') =>
{
    const routes: Route[] = [{ path: '/admin/people', component: () => PeoplePage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return { router, container };
};

const handlesOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-people] [data-person]')].map((row) => row.dataset.person);

const rowOf = (root: ParentNode, handle: string) => root.querySelector(`[data-person="${ handle }"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const chip = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((one) => one.textContent?.trim() === label)!;

const typeInto = (field: HTMLInputElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('the people', () =>
{
    it('lists everybody newest first, with their role, their flags and their reports, each leading to the person', async () =>
    {
        server.accounts.suspended = ['reza.t'];
        server.accounts.reported = { 'sara.k': 2 };
        const { container } = await opened();

        expect(handlesOf(container).slice(0, 4)).toEqual(['alex', 'sara.k', 'kian16', 'reza.t']);
        expect(rowOf(container, 'alex')).toContain('Owner');
        expect(rowOf(container, 'kian16')).toContain('Minor');
        expect(rowOf(container, 'reza.t')).toContain('Suspended');
        expect(rowOf(container, 'sara.k')).toContain('2 reports');
        expect(rowOf(container, 'mina')).not.toMatch(/Owner|Minor|Suspended|report/);
        expect(container.querySelector('[data-person="sara.k"]')?.getAttribute('href')).toBe('/admin/people/sara.k');
    });

    it('searches once the typing pauses, or at Enter, and keeps the words and the list in the address', async () =>
    {
        const { router, container } = await opened();
        const field = container.querySelector<HTMLInputElement>('[role="search"] input')!;

        typeInto(field, 'Sara');
        await settle();

        expect(router.location().query.q).toBeUndefined();

        clock.advance(SEARCH_PAUSE_MS);
        await settle();

        expect(router.location().query.q).toBe('Sara');
        expect(handlesOf(container)).toEqual(['sara.k']);

        chip(container, 'Minors').click();
        await settle();

        expect(router.location().query.list).toBe('minors');
        expect(container.textContent).toContain('Nobody matches.');

        typeInto(field, '');
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();

        expect([router.location().query.q, router.location().query.list]).toEqual([undefined, 'minors']);
        expect(handlesOf(container)).toEqual(['kian16']);
    });

    it('opens on the list and the words the address names', async () =>
    {
        const { container } = await opened('/admin/people?list=staff');

        expect(handlesOf(container)).toEqual(['alex']);
        expect(container.querySelector('button[aria-pressed="true"]')?.textContent?.trim()).toBe('Staff');
    });

    it('shows older people a page at a time, each once, and offers no more past the last', async () =>
    {
        server.accounts.crowd = Array.from({ length: 60 }, (_, at) => `crowd${ at }`);
        const { container } = await opened();
        const more = () => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Show older');

        expect(handlesOf(container)).toHaveLength(PEOPLE_PAGE);

        more()!.click();
        await settle();

        const all = handlesOf(container);

        expect(all.at(-1)).toBe('crowd59');
        expect(new Set(all).size).toBe(all.length);
        expect(more()).toBeUndefined();

        chip(container, 'Minors').click();
        await settle();

        expect(handlesOf(container)).toEqual(['kian16']);
    });

    it('says when the people could not be read', async () =>
    {
        server.staff.owner = 'sara.k';
        const { container } = await opened();

        expect(container.textContent).toContain('The people could not be read.');
        expect(container.querySelector('[data-people]')).toBeNull();
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.accounts.reported = { 'sara.k': 3 };
        const { container } = await opened();

        expect(container.querySelector('h1')?.textContent).toBe('کاربرها');
        expect([...container.querySelectorAll('button[aria-pressed]')].map((one) => one.textContent?.trim())).toEqual(['تازه‌ترین‌ها', 'معلق‌شده‌ها', 'زیر ۱۸ ساله‌ها', 'تیم', 'گزارش‌شده‌ها']);
        expect(rowOf(container, 'alex')).toContain('مالک');
        expect(rowOf(container, 'kian16')).toContain('زیر ۱۸');
        expect(rowOf(container, 'sara.k')).toContain('۳ گزارش');
    });
});
