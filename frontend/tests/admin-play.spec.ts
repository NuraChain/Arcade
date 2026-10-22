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
import { ApiError, client, server } from './fake-api.ts';

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

const opened = async () =>
{
    const routes: Route[] = [{ path: '/admin/play', component: () => PlayPage({}) as unknown as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory('/admin/play'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await settle();
    return container;
};

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
