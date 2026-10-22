import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import { LOG_PAGE, type StaffRole } from '../../backend/src/domains/admin/roles.ts';
import PersonPage from '../src/pages/admin/person.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
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

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const answered = async (value: unknown) =>
{
    useOverlay().close(asked().id, value);
    await settle();
};

const act = (root: ParentNode, id: string) => root.querySelector<HTMLButtonElement>(`[data-act="${ id }"]`)!.click();

const acts = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-act]')].map((one) => one.dataset.act);

const labels = (root: ParentNode) => all(root, '[data-act]');

const longDate = (at: number) => useLocale().date(at, { dateStyle: 'long', timeStyle: 'short' });

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
    useOverlay().reset();
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
        expect([...container.querySelectorAll('[data-report] [data-status]')].map((one) => [one.getAttribute('data-status'), one.textContent?.trim()])).toEqual([['received', 'Waiting'], ['reviewed', 'Reviewed']]);
        expect([...container.querySelectorAll<HTMLTimeElement>('[data-report] [data-when]')].map((one) => one.dateTime)).toEqual([hoursAgo(5), hoursAgo(6)]);
        expect([...container.querySelectorAll('[data-report] a')].map((one) => one.getAttribute('href'))).toEqual(['/admin/reports/r1', '/admin/reports/r2']);
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

    it('shows their whole history a page at a time, and starts again from the newest once something new is written', async () =>
    {
        const many = LOG_PAGE * 2 + 3;

        for (let one = 0; one < many; one += 1)
        {
            staffLogged({ at: hoursAgo(many - one), staff: 'mina', staffRole: 'moderator', kind: 'note', person: 'sara.k', reason: `Note ${ one }`, details: {} });
        }

        const container = await opened();
        const more = () => button(container, 'Show older');
        const reasons = () => all(container, '[data-history] [data-reason]');

        expect(reasons()).toHaveLength(LOG_PAGE);
        expect(reasons()[0]).toBe(`Note ${ many - 1 }`);

        more()!.click();
        await settle();

        expect(reasons()).toHaveLength(LOG_PAGE * 2);

        more()!.click();
        await settle();

        expect(reasons()).toHaveLength(many);
        expect(new Set(reasons()).size).toBe(many);
        expect(reasons().at(-1)).toBe('Note 0');
        expect(more()).toBeUndefined();

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-person-note')!, 'One more note on top.');
        button(container, 'Keep the note')!.click();
        await settle();

        expect(reasons()).toHaveLength(LOG_PAGE);
        expect(reasons()[0]).toBe('One more note on top.');
        expect(more()).toBeDefined();
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
            const has = [container.querySelector('#admin-person-note') !== null, container.querySelector('[data-actions]') !== null];

            cleanup();
            return has;
        };

        expect(await offered('sara.k')).toEqual([true, true]);
        expect(await offered('mina')).toEqual([true, true]);
        expect(await offered('reza.t')).toEqual([false, false]);
        expect(await offered('alex')).toEqual([false, false]);
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

describe('a person\'s page, laid out', () =>
{
    it('opens on a summary of who they are: their flags, when they joined and were seen, where they are signed in and their first wallet', async () =>
    {
        told();
        server.staff.members = [staffMember('sara.k', 'moderator', 'alex', hoursAgo(10))];
        const container = await opened();
        const summary = container.querySelector('[data-person] header[data-summary]')!;

        expect(summary.querySelector('h1')?.textContent).toBe('Sara Kamali');
        expect(all(summary, '[data-flags] > *')).toEqual(['Moderator', '1 report']);
        expect(said(summary, '[data-reach]')).toBe('Signed in on 2 browsers');
        expect([...summary.querySelectorAll<HTMLTimeElement>('[data-facts] time')].map((one) => one.dateTime)).toEqual([new Date(Date.parse('2026-10-20T09:00:00.000Z') - 3_600_000).toISOString(), hoursAgo(2)]);
        expect(said(summary, '[data-wallet] [dir="ltr"]')).toBe('0x3c44…93bc');
        cleanup();

        server.staff.members = [];
        server.accounts.about['sara.k'] = {};
        const bare = await opened();

        expect(said(bare, '[data-reach]')).toBe('Signed in nowhere');
        expect(bare.querySelector('[data-wallet]')).toBeNull();
        expect(said(bare, '[data-flags]')).toBe('');
    });

    it('copies their whole first wallet from the summary', async () =>
    {
        told();
        const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const wrote = vi.fn(async () => undefined);

        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: wrote } });

        try
        {
            const container = await opened();

            container.querySelector<HTMLButtonElement>('[data-wallet] button')!.click();
            await settle();

            expect(container.querySelector('[data-wallet] button')?.getAttribute('aria-label')).toBe('Copy the wallet');
            expect(wrote).toHaveBeenCalledWith('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc');
            expect(toasts()).toEqual(['Wallet copied']);
        }
        finally
        {
            if (original === undefined)
            {
                Reflect.deleteProperty(navigator, 'clipboard');
            }
            else
            {
                Object.defineProperty(navigator, 'clipboard', original);
            }
        }
    });

    it('keeps what it shows in tabs named in the address, the overview first and the reports counted', async () =>
    {
        told();
        const routes: Route[] = [{ path: '/admin/people/:handle', component: () => PersonPage({}) as unknown as HTMLElement }];
        const router = createRouter({ routes, history: createMemoryHistory('/admin/people/sara.k'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);
        const shown = () => [...container.querySelectorAll<HTMLElement>('[data-panel]')].filter((one) => !one.hidden).map((one) => one.dataset.panel);
        const tab = (id: string) => container.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${ id }"]`)!;

        await settle();

        expect([...container.querySelectorAll('[role="tab"]')].map((one) => one.textContent?.trim())).toEqual(['Overview', 'Reports2', 'Games', 'History']);
        expect(shown()).toEqual(['overview']);
        expect(tab('overview').getAttribute('aria-selected')).toBe('true');
        expect([...container.querySelectorAll('[data-panel]')].map((one) => one.getAttribute('role'))).toEqual(['tabpanel', 'tabpanel', 'tabpanel', 'tabpanel']);

        tab('reports').click();
        await settle();

        expect(router.location().query.tab).toBe('reports');
        expect(shown()).toEqual(['reports']);

        tab('overview').click();
        await settle();

        expect(router.location().query.tab).toBeUndefined();
        cleanup();

        const history = await opened('/admin/people/sara.k?tab=history');

        expect([...history.querySelectorAll<HTMLElement>('[data-panel]')].filter((one) => !one.hidden).map((one) => one.dataset.panel)).toEqual(['history']);
        cleanup();

        const unknown = await opened('/admin/people/sara.k?tab=nothing');

        expect([...unknown.querySelectorAll<HTMLElement>('[data-panel]')].filter((one) => !one.hidden).map((one) => one.dataset.panel)).toEqual(['overview']);
    });

    it('puts the actions beside the tabs once there is room, and asks for no column where the reader may not act', async () =>
    {
        const container = await opened();
        const layout = container.querySelector<HTMLElement>('[data-layout]')!;

        expect(layout.classList.contains('@4xl:grid-cols-[minmax(0,1fr)_19rem]')).toBe(true);
        expect(layout.querySelector('[data-actions]')?.parentElement?.className).toContain('@4xl:col-start-2');
        expect(layout.querySelector('[data-actions]')?.parentElement?.classList.contains('@4xl:sticky')).toBe(true);
        expect(layout.closest('.\\@container')).not.toBeNull();
        cleanup();

        server.staff.owner = 'reza.t';
        server.staff.members = [staffMember('alex', 'admin', 'reza.t', hoursAgo(20))];
        as('admin');
        const above = await opened('/admin/people/reza.t');

        expect(above.querySelector('[data-actions]')).toBeNull();
        expect(above.querySelector<HTMLElement>('[data-layout]')!.classList.contains('@4xl:grid-cols-[minmax(0,1fr)_19rem]')).toBe(false);
    });

    it('tells the staff a player has no rated games yet in plain words, never the player\'s invitation to sit down', async () =>
    {
        server.accounts.about['sara.k'] = { games: [{ id: 'g1', game: 'ludo', finishedAt: hoursAgo(4), result: 'void', players: ['sara.k', 'mina'] }] };
        const container = await opened();

        await vi.waitFor(() => expect(said(container, '[data-record-blank]')).toBe('No rated games yet.'));
        expect(container.textContent).not.toContain(useLocale().t('record.emptyLead'));
        expect(container.querySelector('[data-panel="games"] .empty-art')).toBeNull();
    });
});

describe('acting on an account, from the person\'s page', () =>
{
    it('offers what can be done to them as one list, each opening a sheet: only what their profile has, and the sign-out only while they are signed in', async () =>
    {
        server.accounts.about['sara.k'] = { avatar: 'http://localhost:1/avatars/abc.webp', bio: 'DM me for seats' };
        const container = await opened();

        expect(acts(container)).toEqual(['suspend', 'minor', 'picture', 'name', 'bio']);
        expect(labels(container)).toEqual(['Suspend the account', 'Mark as under 18', 'Remove the picture', 'Reset the name', 'Clear the bio']);
        expect([...container.querySelectorAll('[data-act]')].every((one) => one.getAttribute('aria-haspopup') === 'dialog')).toBe(true);
        expect([...container.querySelectorAll('[data-act]')].map((one) => one.classList.contains('text-danger'))).toEqual([true, true, true, true, true]);
        cleanup();

        server.accounts.about['sara.k'] = { displayName: 'sara.k' };
        const bare = await opened();

        expect(acts(bare)).toEqual(['suspend', 'minor']);
        cleanup();

        told();
        const signedIn = await opened();

        expect(acts(signedIn)).toEqual(['suspend', 'minor', 'name', 'sign-out']);
    });
});

describe('a profile cleared and every session ended, from the person\'s page', () =>
{
    it('resets a name at the press after asking why, keeps what it said in the history, and says so once the server has', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'clear');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.clear(request);
        });
        const container = await opened();

        act(container, 'name');
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Reset Sara Kamali’s name to their handle?',
            lead: 'Their name becomes their handle until they choose another.',
            confirm: 'Take it off',
            destructive: true
        });
        expect(asked().props).not.toHaveProperty('initial');
        expect(sent).not.toHaveBeenCalled();

        await answered('A name meant to insult.');

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { part: 'name', reason: 'A name meant to insult.' } });
        expect(said(container, '[data-person] h1')).toBe('sara.k');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex reset sara.k’s name.']);
        expect(said(container, '[data-history] [data-was]')).toBe('It said: Sara Kamali');
        expect(acts(container)).not.toContain('name');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Sara Kamali’s name is now their handle.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.details.part } ${ row.details.from }`)).toEqual(['clear name Sara Kamali']);
    });

    it('removes a picture at the press after asking why', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'clear');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.clear(request);
        });
        server.accounts.about['sara.k'] = { avatar: 'http://localhost:1/avatars/abc.webp' };
        const container = await opened();

        expect(container.querySelector('[data-person] header img')).not.toBeNull();

        act(container, 'picture');
        await settle();

        expect(asked().props).toMatchObject({ title: 'Remove Sara Kamali’s picture?', lead: 'It goes from their profile, and from this server when no other account shows it.' });

        await answered('A picture nobody should see.');

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { part: 'picture', reason: 'A picture nobody should see.' } });
        expect(container.querySelector('[data-person] header img')).toBeNull();
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex removed sara.k’s picture.']);
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(container.querySelector('[data-person] header img')).toBeNull();
        expect(toasts()).toEqual(['Sara Kamali’s picture is gone.']);
    });

    it('takes a refused clear back in the refusal\'s words, and asks again with the reason it was given', async () =>
    {
        vi.spyOn(client.admin, 'clear').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        server.accounts.about['sara.k'] = { bio: 'DM me for seats' };
        const container = await opened();
        const before = server.calls.length;

        act(container, 'bio');
        await settle();

        expect(server.calls.slice(before)).toEqual([]);

        await answered('Selling seats in the bio.');

        expect(acts(container)).toContain('bio');
        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(toasts()).toEqual(['That is above what your role may do.']);

        act(container, 'bio');
        await settle();

        expect(asked().props).toMatchObject({ initial: 'Selling seats in the bio.' });
    });

    it('sends nothing when the sheet is put away', async () =>
    {
        const clear = vi.spyOn(client.admin, 'clear');
        const signOut = vi.spyOn(client.admin, 'signOut');
        told();
        const container = await opened();

        act(container, 'name');
        await settle();
        await answered(null);

        act(container, 'sign-out');
        await settle();
        await answered(null);

        expect([clear, signOut].map((one) => one.mock.calls.length)).toEqual([0, 0]);
        expect(said(container, '[data-person] h1')).toBe('Sara Kamali');
        expect(all(container, '[data-session] [data-agent]')).toHaveLength(2);
    });

    it('signs them out everywhere at the press after asking why, and offers it no longer', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'signOut');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.signOut(request);
        });
        told();
        const container = await opened();

        act(container, 'sign-out');
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Sign Sara Kamali out everywhere?',
            lead: 'Every browser they use is signed out at once. They can sign in again with their wallet.',
            confirm: 'Sign them out',
            destructive: true
        });

        await answered('Their wallet was taken.');

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { reason: 'Their wallet was taken.' } });
        expect(said(container, '[data-sessions="none"]')).toBe('Not signed in anywhere.');
        expect(said(container, '[data-reach]')).toBe('Signed in nowhere');
        expect(acts(container)).not.toContain('sign-out');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex signed sara.k out everywhere.']);
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Sara Kamali is signed out everywhere.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.details.sessions }`)).toEqual(['sign-out 2']);
    });

    it('tells the staff a guest signed out cannot come back', async () =>
    {
        server.accounts.about['sara.k'] = { sessions: [{ openedAt: hoursAgo(1), device: false }] };
        const container = await opened();

        act(container, 'sign-out');
        await settle();

        expect(asked().props).toMatchObject({ lead: 'Every browser they use is signed out at once. They are a guest, so they cannot sign back in.' });
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.accounts.about['sara.k'] = { bio: 'DM me for seats', sessions: [{ openedAt: hoursAgo(1), device: false }] };
        const container = await opened();

        expect(labels(container).slice(2)).toEqual(['برگردوندن اسم', 'پاک کردن بیو', 'خارج کردنش از همه‌جا']);

        act(container, 'bio');
        await settle();

        expect(asked().props).toMatchObject({ title: 'بیوی Sara Kamali پاک بشه؟', confirm: 'برش دار' });
    });
});

describe('a suspension, from the person\'s page', () =>
{
    it('asks how long, what for and why in a sheet, then shows it at the press and says so once the server has', async () =>
    {
        told();
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'suspend');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.suspend(request);
        });
        const container = await opened();

        act(container, 'suspend');
        await settle();

        expect(asked().props).toMatchObject({ name: 'Sara Kamali', guest: false });
        expect(asked().props).not.toHaveProperty('initial');
        expect(sent).not.toHaveBeenCalled();

        await answered({ days: 7, category: 'cheating', reason: 'Played two seats at one table.' });

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { days: 7, category: 'cheating', reason: 'Played two seats at one table.' } });
        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(false);
        expect(said(container, '[data-standing]')).toBe(`Suspended until ${ longDate(NOW + 7 * 86_400_000) }: Cheating.`);
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex suspended sara.k for a week: Cheating.']);
        expect(said(container, '[data-sessions="none"]')).toBe('Not signed in anywhere.');
        expect(acts(container)).toEqual(['lift', 'minor', 'name']);
        expect(said(container, '[data-flags]')).toContain('Suspended');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Sara Kamali is suspended for a week.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.person } ${ row.details.days } ${ row.details.category }`)).toEqual(['suspend sara.k 7 cheating']);
    });

    it('sends nothing when the sheet is put away', async () =>
    {
        const sent = vi.spyOn(client.admin, 'suspend');
        const container = await opened();

        act(container, 'suspend');
        await settle();
        await answered(null);

        expect(sent).not.toHaveBeenCalled();
        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
    });

    it('takes a refused suspension back and says why, and asks again with what was chosen and written', async () =>
    {
        vi.spyOn(client.admin, 'suspend').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        told();
        const container = await opened();
        const ask = { days: 30, category: 'spam', reason: 'Sold seats in the chat.' };

        act(container, 'suspend');
        await settle();
        await answered(ask);

        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(all(container, '[data-session] [data-agent]')).toHaveLength(2);
        expect(toasts()).toEqual(['That is above what your role may do.']);
        expect(acts(container)[0]).toBe('suspend');

        act(container, 'suspend');
        await settle();

        expect(asked().props).toMatchObject({ initial: ask });
    });

    it('tells the sheet a guest cannot come back, and suspends for good with no end', async () =>
    {
        const sent = vi.spyOn(client.admin, 'suspend');
        const container = await opened();

        act(container, 'suspend');
        await settle();

        expect(asked().props).toMatchObject({ name: 'Sara Kamali', guest: true });

        await answered({ days: null, category: 'other', reason: 'Asked to be kept away.' });

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { category: 'other', reason: 'Asked to be kept away.' } });
        expect(said(container, '[data-standing]')).toBe('Suspended for good: Something else.');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex suspended sara.k for good: Something else.']);
    });

    it('says how long somebody is suspended for and since when, and lifts it at the press once asked why', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'lift');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.lift(request);
        });
        server.accounts.suspended = ['sara.k'];
        server.accounts.about['sara.k'] = { suspension: { category: 'spam', until: '2026-10-29T09:00:00.000Z', since: hoursAgo(5) } };
        const container = await opened();

        expect(said(container, '[data-standing]')).toBe(`Suspended until ${ longDate(Date.parse('2026-10-29T09:00:00.000Z')) }: Spam or scams.`);
        expect(said(container, '[data-since]')).toBe('Since 5 hours ago');
        expect(acts(container)[0]).toBe('lift');
        expect(container.querySelector('[data-act="lift"]')?.classList.contains('text-danger')).toBe(false);

        act(container, 'lift');
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Lift the suspension on Sara Kamali?',
            lead: 'They can sign in again straight away. The games they lost and the sessions that ended do not come back.',
            confirm: 'Lift it',
            destructive: false
        });

        await answered('Said sorry to the table.');

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { reason: 'Said sorry to the table.' } });
        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex lifted the suspension on sara.k.']);
        expect(acts(container)[0]).toBe('suspend');
        expect(server.accounts.suspended).toEqual(['sara.k']);
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
        expect(toasts()).toEqual(['Sara Kamali can sign in again.']);
        expect(server.accounts.suspended).toEqual([]);
    });

    it('takes a refused lift back in the refusal\'s own words, and asks again with the reason', async () =>
    {
        vi.spyOn(client.admin, 'lift').mockRejectedValueOnce(new ApiError(409, 'staff-not-suspended', 'They are not suspended.', undefined));
        server.accounts.suspended = ['sara.k'];
        server.accounts.about['sara.k'] = { suspension: { category: 'cheating', since: hoursAgo(1) } };
        const container = await opened();

        act(container, 'lift');
        await settle();
        await answered('Said sorry to the table.');

        expect(said(container, '[data-standing]')).toBe('Suspended for good: Cheating.');
        expect(toasts()).toEqual(['They are not suspended.']);

        act(container, 'lift');
        await settle();

        expect(asked().props).toMatchObject({ initial: 'Said sorry to the table.' });
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.accounts.suspended = ['sara.k'];
        server.accounts.about['sara.k'] = { suspension: { category: 'cheating', since: hoursAgo(1) } };
        const suspended = await opened();

        expect(said(suspended, '[data-standing]')).toBe('برای همیشه معلقه: تقلب.');
        expect(labels(suspended)[0]).toBe('برداشتن تعلیق');

        act(suspended, 'lift');
        await settle();

        expect(asked().props).toMatchObject({ title: 'تعلیق Sara Kamali برداشته بشه؟', confirm: 'برش دار' });
    });
});

describe('marking somebody under 18, from the person\'s page', () =>
{
    it('asks why before it marks somebody under 18, as a question that loses something, then shows it at the press and says so once the server has', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'minor');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.minor(request);
        });
        server.accounts.about['sara.k'] = { strangers: true };
        const container = await opened();

        expect(acts(container)).toContain('minor');
        expect(acts(container)).not.toContain('adult');

        act(container, 'minor');
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Mark Sara Kamali as under 18?',
            lead: 'Messages from strangers go off for them and they cannot play for NURA. They are stood up from any table played for NURA that waits, and any such game they are playing ends as no contest, with every stake given back.',
            confirm: 'Mark as under 18',
            destructive: true
        });

        await answered('Said in a report that she is fifteen.');

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { minor: true, reason: 'Said in a report that she is fifteen.' } });
        expect(said(container, '[data-flags]')).toBe('Minor');
        expect(said(container, '[data-strangers]')).toBe('Strangers may not message them.');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex marked sara.k as under 18.']);
        expect(said(container, '[data-act="adult"]')).toBe('Mark as an adult');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Sara Kamali is marked as under 18.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.details.to }`)).toEqual(['minor minor']);
    });

    it('marks somebody under 18 an adult, as a question that loses nothing', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'minor');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.minor(request);
        });
        server.accounts.about['sara.k'] = { minor: true, strangers: false };
        const container = await opened();

        expect(said(container, '[data-flags]')).toBe('Minor');
        expect(acts(container)).not.toContain('minor');

        act(container, 'adult');
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Mark Sara Kamali as an adult?',
            lead: 'They can turn messages from strangers on themselves, and play for NURA once they accept its terms.',
            confirm: 'Mark as an adult',
            destructive: false
        });

        await answered('Showed an ID that says she is nineteen.');

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { minor: false, reason: 'Showed an ID that says she is nineteen.' } });
        expect(said(container, '[data-flags]')).toBe('');
        expect(said(container, '[data-strangers]')).toBe('Strangers may not message them.');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex marked sara.k as an adult.']);
        expect(said(container, '[data-act="minor"]')).toBe('Mark as under 18');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Sara Kamali is marked as an adult.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.details.to }`)).toEqual(['minor adult']);
    });

    it('takes a refused mark back in the refusal\'s words, and asks again with the reason', async () =>
    {
        vi.spyOn(client.admin, 'minor').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        const container = await opened();

        act(container, 'minor');
        await settle();
        await answered('Said in a report that she is fifteen.');

        expect(said(container, '[data-flags]')).toBe('');
        expect(acts(container)).toContain('minor');
        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(toasts()).toEqual(['That is above what your role may do.']);

        act(container, 'minor');
        await settle();

        expect(asked().props).toMatchObject({ initial: 'Said in a report that she is fifteen.' });
    });

    it('sends nothing when the sheet is put away', async () =>
    {
        const sent = vi.spyOn(client.admin, 'minor');
        const container = await opened();

        act(container, 'minor');
        await settle();
        await answered(null);

        expect(sent).not.toHaveBeenCalled();
        expect(said(container, '[data-flags]')).toBe('');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const container = await opened();

        expect(said(container, '[data-act="minor"]')).toBe('ثبت زیر ۱۸');

        act(container, 'minor');
        await settle();

        expect(asked().props).toMatchObject({ title: 'Sara Kamali زیر ۱۸ ثبت بشه؟', confirm: 'ثبت زیر ۱۸', destructive: true });

        await answered('توی یه گزارش گفته پونزده سالشه.');

        expect(all(container, '[data-history] [data-line]')).toEqual(['alex، sara.k رو زیر ۱۸ ثبت کرد.']);
        expect(toasts()).toEqual(['Sara Kamali زیر ۱۸ ثبت شد.']);
    });
});
