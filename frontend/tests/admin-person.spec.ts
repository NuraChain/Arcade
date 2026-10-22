import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import PersonPage from '../src/pages/admin/person.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server, staffLogged, staffMember } from './fake-api.ts';

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

const opened = async (at = '/admin/people/sara.k') =>
{
    const routes: Route[] = [
        { path: '/admin/people', component: () => document.createElement('div') },
        { path: '/admin/people/:handle', component: () => PersonPage({}) as unknown as HTMLElement }
    ];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
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

const told = () =>
{
    server.accounts.about['sara.k'] = {
        lastSeenAt: hoursAgo(2),
        strangers: false,
        shown: false,
        wallets: ['0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'],
        filed: 1,
        sessions: [
            { browser: 'Chrome', system: 'Windows', openedAt: hoursAgo(30), usedAt: hoursAgo(1), device: true },
            { openedAt: hoursAgo(50), device: false }
        ],
        devices: [{ label: 'This browser', browser: 'Safari', system: 'iOS', attested: 'wallet', createdAt: hoursAgo(100), seenAt: hoursAgo(3), revoked: true }],
        reportsAbout: [
            { id: 'r1', against: true, other: 'mina', category: 'harassment', status: 'received', at: hoursAgo(5) },
            { id: 'r2', against: false, other: 'reza.t', category: 'spam', status: 'reviewed', at: hoursAgo(6) }
        ],
        paid: { acceptedAt: hoursAgo(200), breakUntil: '2026-10-29T09:00:00.000Z' },
        games: [{ id: 'g1', game: 'ludo', finishedAt: hoursAgo(4), result: 'won', players: ['sara.k', 'mina'] }],
        paidGames: [{ id: 'e1', game: 'hokm', amount: '10000000000000000000', feeBps: 500, seats: 2, seat: 0, state: 'settled', won: false, at: hoursAgo(7) }]
    };
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useToasts().dismissAll();
    as('owner');
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('a person, as the staff read them', () =>
{
    it('tells their account and paid play, wallets, live sign-ins by browser, browsers with keys, reports both ways, games and paid games', async () =>
    {
        told();
        const container = await opened();

        expect(said(container, 'h1')).toBe('Sara Kamali');
        expect(said(container, '[data-strangers]')).toBe('Strangers may not message them.');
        expect(said(container, '[data-shown]')).toBe('Hides when they are online.');
        expect(said(container, '[data-paid]')).toBe('Accepted the terms last week.');
        expect(said(container, '[data-break]')).toBe('On a break until Oct 29, 2026.');
        expect(all(container, '[data-wallets] li')).toEqual(['0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc']);
        expect(all(container, '[data-session] [data-agent]')).toEqual(['Chrome on Windows', 'An unknown browser']);
        expect([...container.querySelectorAll<HTMLElement>('[data-session] [data-keys]')].map((one) => one.hidden)).toEqual([false, true]);
        expect(all(container, '[data-device]')[0]).toContain('Safari on iOS');
        expect(container.querySelector<HTMLElement>('[data-device] [data-revoked]')?.hidden).toBe(false);
        expect(said(container, '[data-filed]')).toBe('They filed 1 report.');
        expect(all(container, '[data-report] [data-said]')).toEqual(['mina reported them: Harassment or abuse', 'They reported reza.t: Spam or scams']);
        expect(all(container, '[data-report] [data-said] [dir="ltr"]')).toEqual(['mina', 'reza.t']);
        expect(said(container, '[data-game="g1"]')).toContain('Won');
        expect(said(container, '[data-game="g1"] [dir="ltr"]')).toBe('mina');
        expect(said(container, '[data-paid-game="e1"]')).toContain('Lost');
        expect(said(container, '[data-paid-game="e1"]')).toContain('10 NURA a seat, 2 seats');
    });

    it('asks the record for its ratings only once they have played, so nothing on it speaks to the reader as the player', async () =>
    {
        const unplayed = await opened();

        expect(said(unplayed, '[data-games="none"]')).toBe('Has not finished a game.');
        expect(unplayed.textContent).not.toContain(useLocale().t('record.emptyLead'));
        cleanup();

        told();
        const played = await opened();

        expect(played.querySelector('[data-games]')).not.toBeNull();
    });

    it('says what the staff did about them, newest first, a note among it', async () =>
    {
        server.staff.members = [staffMember('sara.k', 'moderator', 'alex', hoursAgo(10))];
        staffLogged({ at: hoursAgo(10), staff: 'alex', staffRole: 'owner', kind: 'grant', person: 'sara.k', reason: 'Runs the tables.', details: { to: 'moderator' } });
        staffLogged({ at: hoursAgo(1), staff: 'alex', staffRole: 'owner', kind: 'note', person: 'sara.k', reason: 'Asked about the reports.', details: {} });
        const container = await opened();

        expect(all(container, '[data-history] [data-line]')).toEqual(['alex wrote a note on sara.k.', 'alex made sara.k a moderator.']);
        expect(all(container, '[data-history] [data-reason]')).toEqual(['Asked about the reports.', 'Runs the tables.']);
        expect(said(container, '[data-flags]')).toContain('Moderator');
    });

    it('keeps a note at the press, says so once the server has, and empties the field', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'note');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.note(request);
        });
        const container = await opened();

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-person-note')!, '  Rude at a Hokm table, twice.  ');
        button(container, 'Keep the note')!.click();
        await settle();

        expect(all(container, '[data-history] [data-line]')).toEqual(['alex wrote a note on sara.k.']);
        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { text: 'Rude at a Hokm table, twice.' } });
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(all(container, '[data-history] [data-reason]')).toEqual(['Rude at a Hokm table, twice.']);
        expect(toasts()).toEqual(['Your note is kept.']);
        expect(container.querySelector<HTMLTextAreaElement>('#admin-person-note')!.value).toBe('');
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.person } ${ row.reason }`)).toEqual(['note sara.k Rude at a Hokm table, twice.']);
    });

    it('takes a refused note back and says why, keeping what was written', async () =>
    {
        vi.spyOn(client.admin, 'note').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        const container = await opened();

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-person-note')!, 'Rude at a Hokm table.');
        button(container, 'Keep the note')!.click();
        await settle();

        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(container.querySelectorAll('[data-history] [data-entry]')).toHaveLength(0);
        expect(toasts()).toEqual(['That is above what your role may do.']);
        expect(container.querySelector<HTMLTextAreaElement>('#admin-person-note')!.value).toBe('Rude at a Hokm table.');
    });

    it('asks for three characters or more before it sends a note', async () =>
    {
        const container = await opened();
        const before = server.calls.length;

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-person-note')!, '  ok ');
        button(container, 'Keep the note')!.click();
        await settle();

        expect(said(container, '#admin-person-note-error')).toBe('Write three characters or more.');
        expect(server.calls.slice(before)).toEqual([]);
    });

    it('offers a note only on somebody below the reader, never on themselves', async () =>
    {
        server.staff.owner = 'reza.t';
        server.staff.members = [staffMember('alex', 'admin', 'reza.t', hoursAgo(20)), staffMember('sara.k', 'moderator', 'alex', hoursAgo(10))];
        as('admin');

        const offered = async (handle: string) =>
        {
            const container = await opened(`/admin/people/${ handle }`);
            const has = container.querySelector('#admin-person-note') !== null;

            cleanup();
            return has;
        };

        expect(await offered('sara.k')).toBe(true);
        expect(await offered('mina')).toBe(true);
        expect(await offered('reza.t')).toBe(false);
        expect(await offered('alex')).toBe(false);
    });

    it('says nobody holds a handle that is not there, and when a person could not be read', async () =>
    {
        const missing = await opened('/admin/people/nobody.here');

        expect(missing.textContent).toContain('No one by that name.');
        cleanup();

        vi.spyOn(client.admin, 'person').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));
        const failed = await opened();

        expect(failed.textContent).toContain('This person could not be read.');
        expect(failed.querySelector('[data-person]')).toBeNull();
    });

    it('says it all in Persian, each handle in a sentence set apart', async () =>
    {
        useLocale().setLocale('fa');
        told();
        const container = await opened();
        const category = (key: 'harassment' | 'spam') => useLocale().t(`report.category.${ key }`);

        expect(said(container, '[data-strangers]')).toBe('غریبه‌ها نمی‌تونن بهش پیام بدن.');
        expect(all(container, '[data-session] [data-agent]')).toEqual(['Chrome روی Windows', 'یه مرورگر ناشناخته']);
        expect(all(container, '[data-report] [data-said]')).toEqual([`mina ازش گزارش داد: ${ category('harassment') }`, `از reza.t گزارش داد: ${ category('spam') }`]);
        expect(all(container, '[data-report] [data-said] [dir="ltr"]')).toEqual(['mina', 'reza.t']);
        expect(said(container, '[data-filed]')).toBe('۱ بار گزارش داده.');
        expect(button(container, 'ثبت یادداشت')).toBeDefined();
    });
});
