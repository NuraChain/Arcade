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

const choose = async (root: ParentNode, label: string) =>
{
    root.querySelector<HTMLButtonElement>('[data-category] button[aria-haspopup="listbox"]')!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) => one.textContent?.trim() === label)!.click();
    await settle();
};

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const answered = async (yes: boolean) =>
{
    useOverlay().close(asked().id, yes);
    await settle();
};

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

describe('a profile cleared and every session ended, from the person\'s page', () =>
{
    it('offers only what their profile has, and says so when it has nothing of its own', async () =>
    {
        server.accounts.about['sara.k'] = { avatar: 'http://localhost:1/avatars/abc.webp', bio: 'DM me for seats' };
        const container = await opened();

        expect(all(container, '[data-clear] button')).toEqual(['Remove the picture', 'Reset the name', 'Clear the bio']);
        cleanup();

        server.accounts.about['sara.k'] = { displayName: 'sara.k' };
        const bare = await opened();

        expect(said(bare, '[data-content="none"]')).toBe('Their profile has no picture, name or bio of their own.');
        expect(bare.querySelector('#admin-content-why')).toBeNull();
        expect(said(bare, '[data-sign-out="none"]')).toBe('They are not signed in anywhere.');
    });

    it('resets a name at the press after asking, keeps what it said in the history, and says so once the server has', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'clear');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.clear(request);
        });
        const container = await opened();

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-content-why')!, '  A name meant to insult.  ');
        button(container, 'Reset the name')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Reset Sara Kamali’s name to their handle?',
            lead: 'Their name becomes their handle until they choose another.',
            confirm: 'Take it off',
            destructive: true
        });
        expect(sent).not.toHaveBeenCalled();

        await answered(true);

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { part: 'name', reason: 'A name meant to insult.' } });
        expect(said(container, '[data-person] h1')).toBe('sara.k');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex reset sara.k’s name.']);
        expect(said(container, '[data-history] [data-was]')).toBe('It said: Sara Kamali');
        expect(button(container, 'Reset the name')).toBeUndefined();
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Sara Kamali’s name is now their handle.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.details.part } ${ row.details.from }`)).toEqual(['clear name Sara Kamali']);
    });

    it('removes a picture at the press after asking', async () =>
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

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-content-why')!, 'A picture nobody should see.');
        button(container, 'Remove the picture')!.click();
        await settle();

        expect(asked().props).toMatchObject({ title: 'Remove Sara Kamali’s picture?', lead: 'It goes from their profile, and from this server when no other account shows it.' });

        await answered(true);

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { part: 'picture', reason: 'A picture nobody should see.' } });
        expect(container.querySelector('[data-person] header img')).toBeNull();
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex removed sara.k’s picture.']);
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(container.querySelector('[data-person] header img')).toBeNull();
        expect(toasts()).toEqual(['Sara Kamali’s picture is gone.']);
    });

    it('takes a refused clear back in the refusal\'s words, keeping the reason, and asks for one first', async () =>
    {
        vi.spyOn(client.admin, 'clear').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        server.accounts.about['sara.k'] = { bio: 'DM me for seats' };
        const container = await opened();
        const before = server.calls.length;

        button(container, 'Clear the bio')!.click();
        await settle();

        expect(said(container, '#admin-content-why-error')).toBe('Say why, in three characters or more.');
        expect(useOverlay().items()).toHaveLength(0);
        expect(server.calls.slice(before)).toEqual([]);

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-content-why')!, 'Selling seats in the bio.');
        button(container, 'Clear the bio')!.click();
        await settle();
        await answered(true);

        expect(button(container, 'Clear the bio')).toBeDefined();
        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(toasts()).toEqual(['That is above what your role may do.']);
        expect(container.querySelector<HTMLTextAreaElement>('#admin-content-why')!.value).toBe('Selling seats in the bio.');
    });

    it('sends nothing when a clear or a sign-out is answered no', async () =>
    {
        const clear = vi.spyOn(client.admin, 'clear');
        const signOut = vi.spyOn(client.admin, 'signOut');
        told();
        const container = await opened();

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-content-why')!, 'A name meant to insult.');
        button(container, 'Reset the name')!.click();
        await settle();
        await answered(false);

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-sign-out-why')!, 'Their wallet was taken.');
        button(container, 'Sign them out')!.click();
        await settle();
        await answered(false);

        expect([clear, signOut].map((one) => one.mock.calls.length)).toEqual([0, 0]);
        expect(said(container, '[data-person] h1')).toBe('Sara Kamali');
        expect(all(container, '[data-session] [data-agent]')).toHaveLength(2);
    });

    it('signs them out everywhere at the press after asking, and says nothing is left to end', async () =>
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

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-sign-out-why')!, 'Their wallet was taken.');
        button(container, 'Sign them out')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Sign Sara Kamali out everywhere?',
            lead: 'Every browser they use is signed out at once. They can sign in again with their wallet.',
            confirm: 'Sign them out',
            destructive: true
        });

        await answered(true);

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { reason: 'Their wallet was taken.' } });
        expect(said(container, '[data-sessions="none"]')).toBe('Not signed in anywhere.');
        expect(said(container, '[data-sign-out="none"]')).toBe('They are not signed in anywhere.');
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

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-sign-out-why')!, 'Their device was stolen.');
        button(container, 'Sign them out')!.click();
        await settle();

        expect(asked().props).toMatchObject({ lead: 'Every browser they use is signed out at once. They are a guest, so they cannot sign back in.' });
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.accounts.about['sara.k'] = { bio: 'DM me for seats', sessions: [{ openedAt: hoursAgo(1), device: false }] };
        const container = await opened();

        expect(all(container, '[data-clear] button')).toEqual(['برگردوندن اسم', 'پاک کردن بیو']);
        expect(said(container, '#person-sign-out')).toBe('خارج کردنش از همه‌جا');

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-content-why')!, 'توی بیوش صندلی می‌فروشه.');
        button(container, 'پاک کردن بیو')!.click();
        await settle();

        expect(asked().props).toMatchObject({ title: 'بیوی Sara Kamali پاک بشه؟', confirm: 'برش دار' });
    });
});

describe('a suspension, from the person\'s page', () =>
{
    it('asks before it suspends, then shows it at the press and says so once the server has', async () =>
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

        button(container, 'A week')!.click();
        await choose(container, 'Cheating');
        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!, '  Played two seats at one table.  ');
        button(container, 'Suspend')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Suspend Sara Kamali for a week?',
            lead: 'Every game they are playing is lost and they are signed out everywhere. Lifting it later gives none of that back.',
            confirm: 'Suspend them',
            destructive: true
        });
        expect(sent).not.toHaveBeenCalled();

        await answered(true);

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { days: 7, category: 'cheating', reason: 'Played two seats at one table.' } });
        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(false);
        expect(said(container, '[data-standing]')).toBe(`Suspended until ${ longDate(NOW + 7 * 86_400_000) }: Cheating.`);
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex suspended sara.k for a week: Cheating.']);
        expect(said(container, '[data-sessions="none"]')).toBe('Not signed in anywhere.');
        expect(button(container, 'Suspend')).toBeUndefined();
        expect(button(container, 'Lift it')).toBeDefined();
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Sara Kamali is suspended for a week.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.person } ${ row.details.days } ${ row.details.category }`)).toEqual(['suspend sara.k 7 cheating']);
    });

    it('sends nothing when the question is answered no', async () =>
    {
        const sent = vi.spyOn(client.admin, 'suspend');
        const container = await opened();

        await choose(container, 'Spam or scams');
        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!, 'Sold seats in the chat.');
        button(container, 'Suspend')!.click();
        await settle();
        await answered(false);

        expect(sent).not.toHaveBeenCalled();
        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
        expect(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!.value).toBe('Sold seats in the chat.');
    });

    it('takes a refused suspension back and says why, keeping what was written', async () =>
    {
        vi.spyOn(client.admin, 'suspend').mockRejectedValueOnce(new ApiError(409, 'staff-rank', 'That is above what your role may do.', undefined));
        told();
        const container = await opened();

        await choose(container, 'Spam or scams');
        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!, 'Sold seats in the chat.');
        button(container, 'Suspend')!.click();
        await settle();
        await answered(true);

        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
        expect(said(container, '[data-history="none"]')).toBe('Nothing yet.');
        expect(all(container, '[data-session] [data-agent]')).toHaveLength(2);
        expect(toasts()).toEqual(['That is above what your role may do.']);
        expect(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!.value).toBe('Sold seats in the chat.');
    });

    it('asks what it is for and why before it asks anything else', async () =>
    {
        const container = await opened();
        const before = server.calls.length;

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!, ' ok ');
        button(container, 'Suspend')!.click();
        await settle();

        expect(said(container, '[data-category] [role="alert"]')).toBe('Choose what it is for.');
        expect(said(container, '#admin-suspend-why-error')).toBe('Say why, in three characters or more.');
        expect(useOverlay().items()).toHaveLength(0);
        expect(server.calls.slice(before)).toEqual([]);

        await choose(container, 'Cheating');

        expect(container.querySelector('[data-category] [role="alert"]')).toBeNull();
    });

    it('tells the staff a guest cannot come back, and suspends for good with no end', async () =>
    {
        const sent = vi.spyOn(client.admin, 'suspend');
        const container = await opened();

        button(container, 'For good')!.click();
        await choose(container, 'Something else');
        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!, 'Asked to be kept away.');
        button(container, 'Suspend')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Suspend Sara Kamali for good?',
            lead: 'Every game they are playing is lost and they are signed out everywhere. They are a guest, so they cannot sign back in, even once it is lifted.'
        });

        await answered(true);

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { category: 'other', reason: 'Asked to be kept away.' } });
        expect(said(container, '[data-standing]')).toBe('Suspended for good: Something else.');
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex suspended sara.k for good: Something else.']);
    });

    it('says how long somebody is suspended for and since when, and lifts it at the press', async () =>
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
        expect(button(container, 'Suspend')).toBeUndefined();

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-lift-why')!, ' ok ');
        button(container, 'Lift it')!.click();
        await settle();

        expect(said(container, '#admin-lift-why-error')).toBe('Say why, in three characters or more.');
        expect(server.calls.filter((call) => call.startsWith('admin.lift'))).toEqual([]);

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-lift-why')!, 'Said sorry to the table.');
        button(container, 'Lift it')!.click();
        await settle();

        expect(sent).toHaveBeenCalledWith({ params: { handle: 'sara.k' }, input: { reason: 'Said sorry to the table.' } });
        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
        expect(all(container, '[data-history] [data-line]')).toEqual(['alex lifted the suspension on sara.k.']);
        expect(button(container, 'Suspend')).toBeDefined();
        expect(server.accounts.suspended).toEqual(['sara.k']);
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(container.querySelector<HTMLElement>('[data-suspension]')!.hidden).toBe(true);
        expect(toasts()).toEqual(['Sara Kamali can sign in again.']);
        expect(server.accounts.suspended).toEqual([]);
    });

    it('takes a refused lift back in the refusal\'s own words', async () =>
    {
        vi.spyOn(client.admin, 'lift').mockRejectedValueOnce(new ApiError(409, 'staff-not-suspended', 'They are not suspended.', undefined));
        server.accounts.suspended = ['sara.k'];
        server.accounts.about['sara.k'] = { suspension: { category: 'cheating', since: hoursAgo(1) } };
        const container = await opened();

        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-lift-why')!, 'Said sorry to the table.');
        button(container, 'Lift it')!.click();
        await settle();

        expect(said(container, '[data-standing]')).toBe('Suspended for good: Cheating.');
        expect(toasts()).toEqual(['They are not suspended.']);
        expect(container.querySelector<HTMLTextAreaElement>('#admin-lift-why')!.value).toBe('Said sorry to the table.');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.accounts.suspended = ['sara.k'];
        server.accounts.about['sara.k'] = { suspension: { category: 'cheating', since: hoursAgo(1) } };
        const suspended = await opened();

        expect(said(suspended, '[data-standing]')).toBe('برای همیشه معلقه: تقلب.');
        expect(said(suspended, '#person-lift')).toBe('برداشتن تعلیق');
        expect(button(suspended, 'برش دار')).toBeDefined();
        cleanup();

        const container = await opened('/admin/people/mina');

        button(container, 'یه هفته')!.click();
        await choose(container, 'تقلب');
        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-suspend-why')!, 'دو تا صندلی سر یه میز داشت.');
        button(container, 'تعلیق')!.click();
        await settle();

        expect(asked().props).toMatchObject({ title: 'Mina Sadeghi برای یه هفته معلق بشه؟', confirm: 'تعلیقش کن' });
    });
});
