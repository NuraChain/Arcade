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

        expect(said(container, 'h1')).toBe('گزارش کارها');
        expect(lines(container)).toEqual([
            'mina، sara.k رو از تیم برداشت.',
            'alex، mina رو از ناظر کرد ادمین.',
            'alex، mina رو ناظر کرد.'
        ]);
        expect([...container.querySelectorAll('[aria-pressed]')].map((one) => one.textContent?.trim())).toEqual(['همه', 'اضافه شده', 'عوض شده', 'برداشته شده']);
        expect(isolated(container, '[data-entry]:nth-child(2)')).toEqual(['alex', 'mina']);
    });
});
