import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, Routes, type Route } from 'azerothjs';

import ReasonSheet from '../src/components/admin/reason-sheet.component.azeroth';
import PlayPage from '../src/pages/admin/play.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { AdminMatches, AdminTables } from '../../backend/src/schemas.ts';
import { PLAY_PAGE, type StaffRole } from '../../backend/src/domains/admin/roles.ts';
import { ApiError, client, server, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', staff: 'owner' as const };

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const mounted = async (at = '/admin/play') =>
{
    const routes: Route[] = [{ path: '/admin/play', component: () => PlayPage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return { router, container };
};

const opened = async (at = '/admin/play') => (await mounted(at)).container;

const chips = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].map((one) => [one.textContent?.trim(), one.getAttribute('aria-pressed')]);

const chip = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find((one) => one.textContent?.trim().startsWith(label))!;

const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const face = (handle: string, hue: number) => ({ handle, displayName: handle.toUpperCase(), hue });

const matchOf = (id: string, game: string, extra: Partial<AdminMatches['rows'][number]> = {}): AdminMatches['rows'][number] => ({
    id,
    game,
    code: `c${ id }`,
    mode: 'live',
    startedAt: minutesAgo(3),
    deadline: new Date(NOW + 20_000).toISOString(),
    players: [{ seat: 0, ...face('sara.k', 10) }, { seat: 1, ...face('reza.t', 200) }],
    ...extra
});

const tableOf = (id: string, game: string, extra: Partial<AdminTables['rows'][number]> = {}): AdminTables['rows'][number] => ({
    id,
    code: `t${ id }`,
    game,
    mode: 'live',
    privacy: 'public',
    seats: 4,
    taken: 1,
    host: face('mina', 120),
    people: [{ seat: 0, ...face('mina', 120) }],
    at: minutesAgo(10),
    quick: false,
    ...extra
});

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const row = (root: ParentNode, game: string) => root.querySelector<HTMLElement>(`[data-games] [data-game="${ game }"]`)!;

const statuses = (root: ParentNode) => [...root.querySelectorAll('[data-games] [data-game]')].map((one) => [one.getAttribute('data-game'), one.getAttribute('data-status')]);

const counts = (root: ParentNode, game: string) => [...row(root, game).querySelectorAll('[data-counts] > span')].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());

const press = (root: ParentNode, game: string) => row(root, game).querySelector<HTMLButtonElement>('button')!;

const asked = () => useOverlay().items().find((one) => one.phase !== 'closing')!;

const answered = async (reason: string | null) =>
{
    useOverlay().close(asked().id, reason);
    await settle();
};

const toasts = () => useToasts().items().map((one) => one.text);

const games = () =>
{
    server.play.games = [
        { game: 'hokm', status: 'available', matches: 2, tables: 1 },
        { game: 'poker', status: 'disabled', matches: 1, tables: 0 },
        { game: 'backgammon', status: 'coming-soon', matches: 0, tables: 0 },
        { game: 'ludo', status: 'available', matches: 0, tables: 3 }
    ];
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish(ALEX);
    useToasts().dismissAll();
    useOverlay().reset();
    games();
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the games, on and off', () =>
{
    it('lists every game in the server\'s order with whether it is on, the games being played and the tables waiting', async () =>
    {
        const container = await opened();

        expect(container.querySelector('#admin-play-games')?.textContent).toBe('The games');
        expect(statuses(container)).toEqual([['hokm', 'available'], ['poker', 'disabled'], ['backgammon', 'coming-soon'], ['ludo', 'available']]);
        expect([...container.querySelectorAll('[data-games] [data-name]')].map((one) => one.textContent)).toEqual(['Hokm', 'Poker', 'Backgammon', 'Ludo']);
        expect(counts(container, 'hokm')).toEqual(['2 games being played', '1 table waiting']);
        expect(counts(container, 'ludo')).toEqual(['0 games being played', '3 tables waiting']);
        expect(said(row(container, 'hokm'), '[data-name] + *')).toBe('On');
        expect(said(row(container, 'poker'), '[data-name] + *')).toBe('Paused');
        expect(said(row(container, 'backgammon'), '[data-name] + *')).toBe('Coming soon');
        expect([press(container, 'hokm').textContent?.trim(), press(container, 'hokm').getAttribute('aria-label')]).toEqual(['Pause', 'Pause Hokm']);
        expect([press(container, 'poker').textContent?.trim(), press(container, 'poker').getAttribute('aria-label')]).toEqual(['Turn on', 'Turn on Poker']);
        expect(row(container, 'backgammon').querySelector('button')).toBeNull();
        expect(said(row(container, 'backgammon'), '[data-soon]')).toBe('Not ready to be played yet');
    });

    it('lays the games, the games being played and the tables waiting out as columns under headings the eye reads, the words of a count kept for a screen reader', async () =>
    {
        server.playing.matches = [matchOf('m2', 'hokm')];
        server.playing.tables = [tableOf('t1', 'hokm')];
        const { router, container } = await mounted();
        const heads = () => [...container.querySelectorAll<HTMLElement>('[data-columns]')];
        const words = () => heads().map((head) => [...head.children].map((one) => one.textContent));
        const placed = (root: Element, selector: string) => root.querySelector(selector)?.className.match(/@3xl:col-start-(\d)/)?.[1];

        expect(container.querySelector('[data-columns]')?.closest('.\\@container')).not.toBeNull();
        expect(heads().map((head) => [head.getAttribute('aria-hidden'), head.classList.contains('@2xl:grid')])).toEqual([['true', true]]);
        expect(words()).toEqual([['Game', 'Being played', 'Tables waiting']]);
        expect(row(container, 'hokm').querySelector('[data-counts]')?.classList.contains('@2xl:contents')).toBe(true);
        expect([...row(container, 'hokm').querySelectorAll('[data-counts] > span > span:last-child')].map((one) => [one.textContent, one.classList.contains('@2xl:sr-only')])).toEqual([['games being played', true], ['table waiting', true]]);

        await router.navigate('/admin/play?view=matches');
        await settle();

        const match = container.querySelector('[data-match="m2"]')!;

        expect(heads().map((head) => [head.getAttribute('aria-hidden'), head.classList.contains('@3xl:grid')])).toEqual([['true', true]]);
        expect(words()).toEqual([['Game', 'Players']]);
        expect([placed(match, '[data-players]'), placed(match, '[data-end]')]).toEqual(['3', '4']);
        expect(match.firstElementChild?.classList.contains('@3xl:contents')).toBe(true);

        await router.navigate('/admin/play?view=tables');
        await settle();

        const table = container.querySelector('[data-table="t1"]')!;

        expect(words()).toEqual([['Table', 'In the chairs']]);
        expect([placed(table, '[data-people]'), placed(table, '[data-close]')]).toEqual(['3', '4']);
        cleanup();

        useLocale().setLocale('fa');
        const persian = await opened('/admin/play?view=tables');

        expect([...persian.querySelectorAll('[data-columns] > *')].map((one) => one.textContent)).toEqual(['میز', 'پشت میز']);
    });

    it('asks why before it pauses a game, as a question that loses something, and does nothing when it is put away', async () =>
    {
        const container = await opened();

        press(container, 'ludo').click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'Pause Ludo?',
            lead: 'Until it is on again nobody can open a table of Ludo, look for a game of it or start one. The games already being played go on to their end.',
            confirm: 'Pause it',
            destructive: true
        });

        await answered(null);

        expect(server.calls.filter((call) => call.startsWith('admin.switchGame'))).toEqual([]);
        expect(statuses(container)[3]).toEqual(['ludo', 'available']);

        press(container, 'ludo').click();
        await settle();
        useOverlay().close(asked().id);
        await settle();

        expect(server.calls.filter((call) => call.startsWith('admin.switchGame'))).toEqual([]);
    });

    it('pauses a game at the press once the reason is given, and says so once the server has', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'switchGame');

        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.switchGame(request);
        });

        const container = await opened();
        const kept = row(container, 'hokm');

        press(container, 'ludo').click();
        await settle();
        await answered('A bug in the dice');

        expect(sent).toHaveBeenCalledWith({ params: { game: 'ludo' }, input: { on: false, reason: 'A bug in the dice' } });
        expect(statuses(container)).toEqual([['hokm', 'available'], ['poker', 'disabled'], ['backgammon', 'coming-soon'], ['ludo', 'disabled']]);
        expect(said(row(container, 'ludo'), '[data-name] + *')).toBe('Paused');
        expect(press(container, 'ludo').textContent?.trim()).toBe('Turn on');
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(toasts()).toEqual(['Ludo is paused.']);
        expect(server.staff.log.map((one) => [one.kind, one.reason, one.details])).toEqual([['game', 'A bug in the dice', { game: 'ludo', from: 'available', to: 'disabled' }]]);
        expect(statuses(container)[3]).toEqual(['ludo', 'disabled']);
        expect(row(container, 'hokm'), 'a row the switch did not touch is the row it was').toBe(kept);
    });

    it('turns a paused game back on, asked as a question that loses nothing', async () =>
    {
        const container = await opened();

        press(container, 'poker').click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'Turn Poker back on?',
            lead: 'Everybody can open tables of it, look for games and start them again at once.',
            confirm: 'Turn it on',
            destructive: false
        });

        await answered('The deal is fixed');

        expect(statuses(container)[1]).toEqual(['poker', 'available']);
        expect(toasts()).toEqual(['Poker is on again.']);
        expect(server.staff.log.map((one) => one.details)).toEqual([{ game: 'poker', from: 'disabled', to: 'available' }]);
    });

    it('takes a refused switch back and says it did not go through', async () =>
    {
        vi.spyOn(client.admin, 'switchGame').mockRejectedValueOnce(new ApiError(404, 'not-found', 'Nothing there.', undefined));

        const container = await opened();

        press(container, 'hokm').click();
        await settle();
        await answered('Pausing it for a fix');

        expect(statuses(container)[0]).toEqual(['hokm', 'available']);
        expect(toasts()).toEqual(['That did not go through. Try again.']);
        expect(server.staff.log).toEqual([]);
    });

    it('says the games could not be read, with a way to try again', async () =>
    {
        vi.spyOn(client.admin, 'play').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));

        const container = await opened();

        expect(container.textContent).toContain('The games could not be read.');
        expect(container.querySelector('[data-games]')).toBeNull();

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('common.retry'))!.click();
        await settle();

        expect(statuses(container)).toHaveLength(4);
    });

    it('offers what to show, counting the games being played and the tables waiting, with Stuck only while a game is stuck', async () =>
    {
        let container = await opened();

        expect(chips(container)).toEqual([['Games', 'true'], ['Being played3', 'false'], ['Waiting4', 'false']]);

        cleanup();
        server.play.stuck = 2;
        container = await opened();

        expect(chips(container).map((one) => one[0])).toEqual(['Games', 'Being played3', 'Waiting4', 'Stuck2']);
    });

    it('lists the games being played: the game, its code, the pace, when it started and when the turn runs out, the stake, and who plays in which seat', async () =>
    {
        server.playing.matches = [
            matchOf('m2', 'hokm', { stake: '10000000000000000000' }),
            matchOf('m1', 'ludo', { mode: 'turns', deadline: new Date(NOW + 3 * 3_600_000).toISOString(), stuck: { since: minutesAgo(60), kind: 'no-engine' } })
        ];

        const { router, container } = await mounted();

        chip(container, 'Being played').click();
        await settle();

        const first = container.querySelector('[data-match="m2"]')!;
        const second = container.querySelector('[data-match="m1"]')!;

        expect(router.location().query.view).toBe('matches');
        expect([...container.querySelectorAll('[data-match]')].map((one) => one.getAttribute('data-match'))).toEqual(['m2', 'm1']);
        expect([said(first, '[data-name]'), said(first, '[data-code]'), said(first, '[data-stake]')]).toEqual(['Hokm', 'cm2', '10 NURA']);
        expect([...first.querySelectorAll('[data-when]')].map((one) => one.textContent)).toEqual(['Started 3 minutes ago', 'Turn runs out in 20 seconds']);
        expect(said(first, '[data-pace]')).toBe('Live');
        expect([...first.querySelectorAll('[data-players] li [dir="ltr"]')].map((one) => one.textContent?.trim())).toEqual(['sara.k', 'reza.t']);
        expect(first.querySelector('[data-stuck]')).toBeNull();
        expect([said(second, '[data-pace]'), said(second, '[data-stuck-mark]')]).toEqual(['Turn-based', 'Stuck']);
        expect(said(second, '[data-stuck] > span')).toBe('This server has no engine for its game.');
        expect([...second.querySelectorAll('[data-stuck] [data-when]')].map((one) => one.textContent)).toEqual(['Since 1 hour ago']);
        expect(server.calls).toContain('admin.liveMatches {}');
    });

    it('lists only the stuck games under Stuck, from the address', async () =>
    {
        server.play.stuck = 1;
        server.playing.matches = [matchOf('m2', 'hokm'), matchOf('m1', 'ludo', { stuck: { since: minutesAgo(5), kind: 'no-turn' } })];

        const container = await opened('/admin/play?view=stuck');

        expect([...container.querySelectorAll('[data-match]')].map((one) => one.getAttribute('data-match'))).toEqual(['m1']);
        expect(said(container, '[data-stuck] span')).toBe('Its game names nobody on turn.');
        expect(chip(container, 'Stuck').getAttribute('aria-pressed')).toBe('true');
        expect(server.calls).toContain('admin.liveMatches {"list":"stuck"}');
    });

    it('lists the tables waiting: the game, its code, the pace, who may sit, the chairs taken, quick play, when it opened, the host and the stake', async () =>
    {
        server.playing.tables = [
            tableOf('t2', 'backgammon', { seats: 2, taken: 1, quick: true, privacy: 'public', stake: '5000000000000000000' }),
            tableOf('t1', 'hokm', { mode: 'turns', privacy: 'room', taken: 3 }),
            tableOf('t0', 'ludo', { privacy: 'invite', host: undefined })
        ];

        const { router, container } = await mounted();

        chip(container, 'Waiting').click();
        await settle();

        const quick = container.querySelector('[data-table="t2"]')!;
        const room = container.querySelector('[data-table="t1"]')!;

        expect(router.location().query.view).toBe('tables');
        expect([...container.querySelectorAll('[data-table]')].map((one) => one.getAttribute('data-table'))).toEqual(['t2', 't1', 't0']);
        expect([said(quick, '[data-name]'), said(quick, '[data-code]'), said(quick, '[data-stake]'), said(quick, '[data-quick]')]).toEqual(['Backgammon', 'tt2', '5 NURA', 'Quick play']);
        expect([said(quick, '[data-pace]'), said(quick, '[data-privacy]'), said(quick, '[data-seated]'), said(quick, '[data-when]')]).toEqual(['Live', 'Anyone', '1 of 2 seated', 'Opened 10 minutes ago']);
        expect(said(quick, '[data-host] [dir="ltr"]')).toBe('mina');
        expect([said(room, '[data-pace]'), said(room, '[data-privacy]'), said(room, '[data-seated]')]).toEqual(['Turn-based', 'In a chat', '3 of 4 seated']);
        expect(room.querySelector('[data-quick]')).toBeNull();
        expect(container.querySelector('[data-table="t0"] [data-host]')).toBeNull();
        expect(said(container, '[data-table="t0"] [data-privacy]')).toBe('By invitation');
    });

    it('shows older games and tables a page at a time, each once', async () =>
    {
        server.playing.matches = Array.from({ length: PLAY_PAGE + 2 }, (_, at) => matchOf(`m${ at }`, 'ludo'));
        server.playing.tables = Array.from({ length: PLAY_PAGE + 2 }, (_, at) => tableOf(`t${ at }`, 'hokm'));

        let container = await opened('/admin/play?view=matches');

        expect(container.querySelectorAll('[data-match]')).toHaveLength(PLAY_PAGE);

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Show older')!.click();
        await settle();

        expect(new Set([...container.querySelectorAll('[data-match]')].map((one) => one.getAttribute('data-match'))).size).toBe(PLAY_PAGE + 2);
        expect([...container.querySelectorAll('button')].some((one) => one.textContent?.trim() === 'Show older')).toBe(false);

        cleanup();
        container = await opened('/admin/play?view=tables');

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Show older')!.click();
        await settle();

        expect(new Set([...container.querySelectorAll('[data-table]')].map((one) => one.getAttribute('data-table'))).size).toBe(PLAY_PAGE + 2);
    });

    it('says when nothing is being played, nothing is stuck and nothing waits, and when a list could not be read, with a way to try again', async () =>
    {
        let container = await opened('/admin/play?view=matches');

        expect(container.textContent).toContain('No game is being played right now.');
        expect(container.querySelector('[data-empty]')).not.toBeNull();
        expect(container.querySelector('.empty-art')).toBeNull();

        cleanup();
        container = await opened('/admin/play?view=stuck');

        expect(container.textContent).toContain('No game is stuck.');

        cleanup();
        container = await opened('/admin/play?view=tables');

        expect(container.textContent).toContain('No table is waiting for a game.');

        cleanup();
        vi.spyOn(client.admin, 'waitingTables').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal server error', undefined));
        server.playing.tables = [tableOf('t1', 'hokm')];
        container = await opened('/admin/play?view=tables');

        expect(container.textContent).toContain('This list could not be read.');

        [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('common.retry'))!.click();
        await settle();

        expect(container.querySelectorAll('[data-table]')).toHaveLength(1);
    });

    it('says the lists in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.playing.tables = [tableOf('t1', 'hokm', { privacy: 'friends', taken: 2 })];

        const container = await opened('/admin/play?view=tables');

        expect(chips(container).map((one) => one[0])).toEqual(['همه‌ی بازی‌ها', 'در جریان۳', 'میزهای منتظر۴']);
        expect([said(container, '[data-privacy]'), said(container, '[data-seated]')]).toEqual(['دوست‌ها', '۲ از ۴ صندلی پره']);
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');

        const container = await opened();

        expect([...container.querySelectorAll('[data-games] [data-name]')].map((one) => one.textContent)).toEqual(['حکم', 'پوکر', 'تخته‌نرد', 'منچ']);
        expect(said(row(container, 'hokm'), '[data-name] + *')).toBe('فعال');
        expect(said(row(container, 'poker'), '[data-name] + *')).toBe('متوقف');
        expect(counts(container, 'hokm')).toEqual(['۲ بازی در جریان', '۱ میز منتظر']);
        expect([press(container, 'hokm').textContent?.trim(), press(container, 'hokm').getAttribute('aria-label')]).toEqual(['توقف', 'توقف حکم']);

        press(container, 'ludo').click();
        await settle();

        expect(asked().props).toMatchObject({ title: 'منچ متوقف بشه؟', confirm: 'متوقفش کن' });

        await answered('یه مشکل توی تاس');

        expect(toasts()).toEqual(['منچ متوقف شد.']);
    });
});

describe('ending a game being played', () =>
{
    const end = (root: ParentNode, id: string) => root.querySelector<HTMLButtonElement>(`[data-match="${ id }"] [data-end] button`);

    const listed = (root: ParentNode) => [...root.querySelectorAll('[data-match]')].map((one) => one.getAttribute('data-match'));

    const admin = () =>
    {
        server.staff.members = [staffMember('sara.k', 'admin', 'alex', minutesAgo(60)), staffMember('mina', 'admin', 'alex', minutesAgo(30))];
        server.me = 'sara.k';
        useSession().reset();
        useSession().establish({ ...ALEX, id: 'u-sara', handle: 'sara.k', displayName: 'Sara', staff: 'admin' });
    };

    it('offers End on a game the reader outranks everybody in, and says why on the others', async () =>
    {
        admin();
        server.playing.matches = [
            matchOf('m1', 'ludo', { players: [{ seat: 0, ...face('reza.t', 1) }, { seat: 1, ...face('leila.a', 2), staff: 'moderator' }] }),
            matchOf('m2', 'hokm', { players: [{ seat: 0, ...face('sara.k', 1), staff: 'admin' }, { seat: 1, ...face('reza.t', 2) }] }),
            matchOf('m3', 'poker', { players: [{ seat: 0, ...face('mina', 1), staff: 'admin' }, { seat: 1, ...face('reza.t', 2) }] }),
            matchOf('m4', 'ludo', { players: [{ seat: 0, ...face('alex', 1), staff: 'owner' }, { seat: 1, ...face('reza.t', 2) }] })
        ];

        const container = await opened('/admin/play?view=matches');

        expect([end(container, 'm1')?.textContent?.trim(), end(container, 'm1')?.getAttribute('aria-label')]).toEqual(['End game', 'End the Ludo game at CM1']);
        expect(container.querySelector('[data-match="m1"] [data-end-barred]')).toBeNull();

        for (const id of ['m2', 'm3', 'm4'])
        {
            expect(end(container, id), id).toBeNull();
        }

        expect(said(container, '[data-match="m2"] [data-end-barred]')).toBe('You are playing in this game.');
        expect(said(container, '[data-match="m3"] [data-end-barred]')).toBe('Somebody in it holds a role at or above yours.');
        expect(said(container, '[data-match="m4"] [data-end-barred]')).toBe('Somebody in it holds a role at or above yours.');
    });

    it('asks why before it ends a game, as a question that loses something, saying the stakes go back at a table played for NURA, and does nothing when it is put away', async () =>
    {
        server.playing.matches = [matchOf('m1', 'ludo'), matchOf('m2', 'hokm', { stake: '10000000000000000000' })];

        const container = await opened('/admin/play?view=matches');

        end(container, 'm1')!.click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'End this game of Ludo?',
            lead: 'It ends now as no contest: nobody is rated and nobody earns anything from it. Everybody stays at the table and can start again.',
            confirm: 'End it',
            destructive: true
        });

        await answered(null);

        expect(listed(container)).toEqual(['m1', 'm2']);
        expect(server.calls.filter((call) => call.startsWith('admin.voidMatch'))).toEqual([]);

        end(container, 'm2')!.click();
        await settle();

        expect(asked().props).toMatchObject({
            title: 'End this game of Hokm?',
            lead: 'It ends now as no contest: nobody is rated and nobody earns anything from it, and every stake goes back to its player. Everybody stays at the table and can start again.'
        });

        await answered(null);
    });

    it('takes the game off the list at the press once the reason is given, says so once the server has, and reads the counts again', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'voidMatch');

        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.voidMatch(request);
        });

        server.play.games = server.play.games.map((one) => (one.game === 'ludo' ? { ...one, matches: 1 } : one));
        server.playing.matches = [matchOf('m1', 'ludo'), matchOf('m2', 'hokm')];

        const container = await opened('/admin/play?view=matches');
        const kept = container.querySelector('[data-match="m2"]');

        expect(chips(container).find((one) => one[0]?.startsWith('Being played'))?.[0]).toBe('Being played4');

        end(container, 'm1')!.click();
        await settle();
        await answered('Stuck after a fault in the sweep');

        expect(sent).toHaveBeenCalledWith({ params: { id: 'm1' }, input: { reason: 'Stuck after a fault in the sweep' } });
        expect(listed(container)).toEqual(['m2']);
        expect(toasts()).toEqual([]);

        server.calls = [];
        answer();
        await settle();

        expect(toasts()).toEqual(['The Ludo game at CM1 is over and counts for nobody.']);
        expect(listed(container)).toEqual(['m2']);
        expect(container.querySelector('[data-match="m2"]'), 'a row the end did not touch is the row it was').toBe(kept);
        expect(server.calls).toEqual(expect.arrayContaining(['admin.play', 'admin.liveMatches {}']));
        expect(chips(container).find((one) => one[0]?.startsWith('Being played'))?.[0]).toBe('Being played3');
        expect(server.staff.log.map((one) => [one.kind, one.reason, one.details])).toEqual([['void', 'Stuck after a fault in the sweep', { match: 'm1', game: 'ludo', table: 'cm1' }]]);
    });

    it('puts a refused game back and says why in the reader\'s words', async () =>
    {
        server.playing.matches = [matchOf('m1', 'ludo'), matchOf('m2', 'hokm')];

        const container = await opened('/admin/play?view=matches');

        server.playing.matches = server.playing.matches.filter((one) => one.id !== 'm1');
        server.playing.over = ['m1'];
        end(container, 'm1')!.click();
        await settle();
        await answered('Stuck after a fault in the sweep');

        expect(toasts()).toEqual(['That game has already ended.']);
        expect(listed(container), 'the list is read again either way').toEqual(['m2']);
        expect(server.staff.log).toEqual([]);

        vi.spyOn(client.admin, 'voidMatch').mockRejectedValueOnce(new ApiError(409, 'staff-in-game', 'Nobody ends a game they are playing in.', undefined));
        useToasts().dismissAll();
        end(container, 'm2')!.click();
        await settle();
        await answered('Stuck after a fault in the sweep');

        expect(listed(container)).toEqual(['m2']);
        expect(toasts()).toEqual(['Nobody ends a game they are playing in.']);
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        admin();
        server.playing.matches = [
            matchOf('m1', 'ludo', { players: [{ seat: 0, ...face('reza.t', 1) }, { seat: 1, ...face('leila.a', 2) }] }),
            matchOf('m2', 'hokm', { players: [{ seat: 0, ...face('sara.k', 1), staff: 'admin' }, { seat: 1, ...face('reza.t', 2) }] })
        ];

        const container = await opened('/admin/play?view=matches');

        expect([end(container, 'm1')?.textContent?.trim(), end(container, 'm1')?.getAttribute('aria-label')]).toEqual(['تموم کردن بازی', 'تموم کردن بازی منچ سر میز CM1']);
        expect(said(container, '[data-match="m2"] [data-end-barred]')).toBe('خودت توی این بازی هستی.');

        end(container, 'm1')!.click();
        await settle();

        expect(asked().props).toMatchObject({ title: 'این بازی منچ تموم بشه؟', confirm: 'تمومش کن' });

        await answered('یه مشکل توی نوبت‌ها');

        expect(toasts()).toEqual(['بازی منچ سر میز CM1 تموم شد و برای هیچ‌کس حساب نمی‌شه.']);
    });
});

describe('closing a table waiting', () =>
{
    const close = (root: ParentNode, id: string) => root.querySelector<HTMLButtonElement>(`[data-table="${ id }"] [data-close] button`);

    const listed = (root: ParentNode) => [...root.querySelectorAll('[data-table]')].map((one) => one.getAttribute('data-table'));

    const admin = () =>
    {
        server.staff.members = [staffMember('sara.k', 'admin', 'alex', minutesAgo(60)), staffMember('mina', 'admin', 'alex', minutesAgo(30))];
        server.me = 'sara.k';
        useSession().reset();
        useSession().establish({ ...ALEX, id: 'u-sara', handle: 'sara.k', displayName: 'Sara', staff: 'admin' });
    };

    const seated = (...people: [string, StaffRole?][]) => people.map(([handle, staff], seat) => ({ seat, ...face(handle, seat * 40), ...(staff === undefined ? {} : { staff }) }));

    it('offers Close on a table the reader outranks everybody at, says why on the others, and crowns the host among the people at it', async () =>
    {
        admin();
        server.playing.tables = [
            tableOf('t1', 'ludo', { host: face('reza.t', 0), people: seated(['reza.t'], ['leila.a', 'moderator']), taken: 2 }),
            tableOf('t2', 'hokm', { people: seated(['sara.k', 'admin']) }),
            tableOf('t3', 'poker', { people: seated(['mina', 'admin']) }),
            tableOf('t4', 'ludo', { people: seated(['alex', 'owner']) })
        ];

        const container = await opened('/admin/play?view=tables');

        expect([close(container, 't1')?.textContent?.trim(), close(container, 't1')?.getAttribute('aria-label')]).toEqual(['Close table', 'Close the Ludo table TT1']);
        expect(container.querySelector('[data-table="t1"] [data-close-barred]')).toBeNull();
        expect([...container.querySelectorAll('[data-table="t1"] [data-people] li')].map((one) => [one.querySelector('[dir="ltr"]')?.textContent, one.hasAttribute('data-host')])).toEqual([['reza.t', true], ['leila.a', false]]);
        expect(said(container, '[data-table="t1"] [data-host] .sr-only')).toBe('Host');

        for (const id of ['t2', 't3', 't4'])
        {
            expect(close(container, id), id).toBeNull();
        }

        expect(said(container, '[data-table="t2"] [data-close-barred]')).toBe('You are sitting at this table.');
        expect(said(container, '[data-table="t3"] [data-close-barred]')).toBe('Somebody at it holds a role at or above yours.');
        expect(said(container, '[data-table="t4"] [data-close-barred]')).toBe('Somebody at it holds a role at or above yours.');
    });

    it('asks why before it closes a table, as a question that loses something, and does nothing when it is put away', async () =>
    {
        server.playing.tables = [tableOf('t1', 'ludo')];

        const container = await opened('/admin/play?view=tables');

        close(container, 't1')!.click();
        await settle();

        expect(asked().component).toBe(ReasonSheet);
        expect(asked().props).toMatchObject({
            title: 'Close the Ludo table TT1?',
            lead: 'Nobody can sit at it or start a game at it any more, and it leaves every list. Whoever is sitting there is told Nura’s team closed it.',
            confirm: 'Close it',
            destructive: true
        });

        await answered(null);

        expect(listed(container)).toEqual(['t1']);
        expect(server.calls.filter((call) => call.startsWith('admin.closeTable'))).toEqual([]);
    });

    it('takes the table off the list at the press once the reason is given, says so once the server has, and reads the counts again', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'closeTable');

        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.closeTable(request);
        });

        server.playing.tables = [tableOf('t1', 'ludo'), tableOf('t2', 'hokm')];

        const container = await opened('/admin/play?view=tables');
        const kept = container.querySelector('[data-table="t2"]');

        expect(chips(container).find((one) => one[0]?.startsWith('Waiting'))?.[0]).toBe('Waiting4');

        close(container, 't1')!.click();
        await settle();
        await answered('Left open by a fault');

        expect(sent).toHaveBeenCalledWith({ params: { id: 't1' }, input: { reason: 'Left open by a fault' } });
        expect(listed(container)).toEqual(['t2']);
        expect(toasts()).toEqual([]);

        server.calls = [];
        answer();
        await settle();

        expect(toasts()).toEqual(['The Ludo table TT1 is closed.']);
        expect(listed(container)).toEqual(['t2']);
        expect(container.querySelector('[data-table="t2"]'), 'a row the close did not touch is the row it was').toBe(kept);
        expect(server.calls).toEqual(expect.arrayContaining(['admin.play', 'admin.waitingTables {}']));
        expect(chips(container).find((one) => one[0]?.startsWith('Waiting'))?.[0]).toBe('Waiting3');
        expect(server.staff.log.map((one) => [one.kind, one.reason, one.details])).toEqual([['close', 'Left open by a fault', { id: 't1', table: 'tt1', game: 'ludo' }]]);
    });

    it('puts a refused table back in the reader\'s words, and reads the list again either way', async () =>
    {
        server.playing.tables = [tableOf('t1', 'ludo'), tableOf('t2', 'hokm')];

        const container = await opened('/admin/play?view=tables');

        server.playing.tables = server.playing.tables.filter((one) => one.id !== 't1');
        server.playing.shut = ['t1'];
        close(container, 't1')!.click();
        await settle();
        await answered('Left open by a fault');

        expect(toasts()).toEqual(['That table has already closed.']);
        expect(listed(container), 'the list is read again either way').toEqual(['t2']);
        expect(server.staff.log).toEqual([]);

        vi.spyOn(client.admin, 'closeTable').mockRejectedValueOnce(new ApiError(409, 'staff-table-playing', 'A game is being played or starting at that table.', undefined));
        useToasts().dismissAll();
        close(container, 't2')!.click();
        await settle();
        await answered('Left open by a fault');

        expect(listed(container)).toEqual(['t2']);
        expect(toasts()).toEqual(['A game is being played or starting at that table.']);
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        admin();
        server.playing.tables = [
            tableOf('t1', 'ludo', { host: face('reza.t', 0), people: seated(['reza.t']) }),
            tableOf('t2', 'hokm', { people: seated(['sara.k', 'admin']) })
        ];

        const container = await opened('/admin/play?view=tables');

        expect([close(container, 't1')?.textContent?.trim(), close(container, 't1')?.getAttribute('aria-label')]).toEqual(['بستن میز', 'بستن میز منچ با کد TT1']);
        expect(said(container, '[data-table="t1"] [data-host] .sr-only')).toBe('میزبان');
        expect(said(container, '[data-table="t2"] [data-close-barred]')).toBe('خودت پشت این میز نشستی.');

        close(container, 't1')!.click();
        await settle();

        expect(asked().props).toMatchObject({ title: 'میز منچ با کد TT1 بسته بشه؟', confirm: 'ببندش' });

        await answered('یه خطا بازش گذاشته بود');

        expect(toasts()).toEqual(['میز منچ با کد TT1 بسته شد.']);
    });
});
