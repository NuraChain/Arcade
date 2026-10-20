import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import LookingStrip from '../src/components/app/looking-strip.component.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { looking } from '../src/lib/looking.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import type { TableSummary } from '../src/api.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const arrived = async (id: string) =>
{
    useLobby().open(id);
    useLobby().close();
    await settle();
};

const shown = () =>
{
    const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => LookingStrip({}) }) as HTMLElement).container;
};

const strips = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-looking]')];

const named = (strip: HTMLElement, name: string) =>
    [...strip.querySelectorAll<HTMLElement>('a, button')].find((one) => one.textContent?.trim() === name) ?? null;

const waiting = (extra: Partial<TableSummary> = {}): TableSummary => ({
    id: 'table-waiting',
    code: 'wait01',
    game: 'ludo',
    seats: 4,
    mode: 'live',
    privacy: 'public',
    target: 0,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: 'off',
    teams: false,
    status: 'open',
    chairs: [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, who: 'sara.k', ready: true }, { seat: 2 }, { seat: 3 }] as TableSummary['chairs'],
    taken: 2,
    mine: 0,
    createdAt: new Date(0).toISOString(),
    ...extra
});

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(2_700_000), seed: 23 });
    server.reset();
    useCatalogue().reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useSettings().reset();
    useToasts().reset();
    useLobby().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useSettings().reset();
    useToasts().reset();
    useLobby().reset();
    useRealtime().reset();
});

describe('whether a table is a search', () =>
{
    it('is one while the reader sits ready at a table quick play fills, with a chair anybody may take and no game on', () =>
    {
        expect(looking(waiting())).toBe(true);
        expect(looking(waiting({ privacy: 'friends' })), 'a table for friends is filled by a friend’s search too').toBe(true);
    });

    it('is not one once it is full, once a game is on, when it has closed, when it is not public, or before the reader is ready', () =>
    {
        const unready = [{ seat: 0, who: 'alex', ready: false, host: true }, { seat: 1, who: 'sara.k', ready: true }, { seat: 2 }, { seat: 3 }] as TableSummary['chairs'];
        const { mine: _mine, ...unseated } = waiting();

        const full = [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, who: 'sara.k', ready: true }, { seat: 2, who: 'reza.t', ready: false }, { seat: 3, who: 'parisa', ready: false }] as TableSummary['chairs'];

        expect(looking(waiting({ chairs: full, taken: 4 })), 'full').toBe(false);
        expect(looking(waiting({ matchId: 'match-1' })), 'a game is on').toBe(false);
        expect(looking(waiting({ status: 'closed' })), 'closed').toBe(false);
        const kept = [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, who: 'sara.k', ready: true }, { seat: 2, invited: 'reza.t' }, { seat: 3, invited: 'parisa' }] as TableSummary['chairs'];

        expect(looking(waiting({ privacy: 'invite' })), 'invitation only').toBe(false);
        expect(looking(waiting({ privacy: 'room' })), 'a table of a room').toBe(false);
        expect(looking(waiting({ chairs: kept })), 'every free chair is being kept for somebody').toBe(false);
        expect(looking(waiting({ chairs: unready })), 'not ready').toBe(false);
        expect(looking(unseated as TableSummary), 'not sitting').toBe(false);
    });
});

describe('the strip that says a search is on', () =>
{
    it('says what is being looked for and how many are there, wherever the reader is, and leads to the table', async () =>
    {
        const lobby = useLobby();
        const container = shown();

        await settle();

        expect(strips(container), 'a strip with nothing being looked for').toHaveLength(0);

        const id = await lobby.quick('ludo', { seats: 4 });

        await settle();

        expect(strips(container), 'the strip was drawn on the page the reader is about to leave for the table').toHaveLength(0);

        await arrived(id);

        const [strip] = strips(container);

        expect(strip.getAttribute('role')).toBe('status');
        expect(strip.textContent).toContain(useLocale().t('quickMatch.looking', { game: 'Ludo', here: '1', seats: '4' }));
        expect(named(strip, useLocale().t('quickMatch.go'))?.getAttribute('href')).toBe(`/app/play/${ id }`);
    });

    it('counts the players as they arrive, on the strip it has already drawn', async () =>
    {
        const lobby = useLobby();
        const container = shown();

        await arrived(await lobby.quick('ludo', { seats: 4 }));

        const [strip] = strips(container);

        server.tables[0].chairs[1].who = 'sara.k';
        server.tables[0].chairs[1].ready = true;
        server.tables[0].taken = 2;
        await lobby.refresh();
        await settle();

        expect(strips(container)[0], 'the strip was drawn again').toBe(strip);
        expect(strip.textContent).toContain(useLocale().t('quickMatch.looking', { game: 'Ludo', here: '2', seats: '4' }));
    });

    it('says two against two where that is what is being looked for', async () =>
    {
        const lobby = useLobby();
        const container = shown();

        await arrived(await lobby.quick('hokm', { seats: 4, teams: true }));

        expect(strips(container)[0].textContent).toContain(useLocale().t('quickMatch.lookingTeams', { game: 'Hokm', here: '1', seats: '4' }));
    });

    it('stops looking when asked: the chair goes back and the strip with it', async () =>
    {
        const lobby = useLobby();
        const container = shown();

        await arrived(await lobby.quick('ludo', { seats: 4 }));
        server.calls = [];

        fire(named(strips(container)[0], useLocale().t('quickMatch.stop'))!, 'click');

        await vi.waitFor(() => expect(strips(container)).toHaveLength(0), { timeout: 4000 });

        expect(server.calls, 'a stop was sent as a forfeit, or not at all').toContain('tables.leave');
        expect(lobby.seated()).toEqual([]);
    });

    it('goes when the table fills and its game starts, and is not there for a table the reader opened by invitation', async () =>
    {
        const lobby = useLobby();
        const container = shown();
        const invited = await lobby.host('ludo', { ...defaultTable('ludo'), privacy: 'invite' }, []);

        await lobby.ready(invited, true);
        await settle();

        expect(strips(container), 'a table by invitation was called a search').toHaveLength(0);

        await arrived(await lobby.quick('backgammon'));

        expect(strips(container)).toHaveLength(1);

        const table = server.tables.find((one) => one.game === 'backgammon')!;

        table.chairs[1].who = 'sara.k';
        table.chairs[1].ready = true;
        table.taken = 2;
        table.matchId = 'match-started';
        await lobby.refresh();
        await settle();

        expect(strips(container), 'still looking for players at a table whose game is on').toHaveLength(0);
    });

    it('says the game has started when a stop comes too late, and reads the table again', async () =>
    {
        const lobby = useLobby();
        const container = shown();
        const tables = client.tables as unknown as Record<string, (input: unknown) => Promise<unknown>>;
        const real = tables.leave;

        await arrived(await lobby.quick('ludo', { seats: 2 }));

        tables.leave = async () =>
        {
            throw new ApiError(409, 'playing', 'A game is being played at this table.', undefined);
        };

        try
        {
            server.calls = [];
            fire(named(strips(container)[0], useLocale().t('quickMatch.stop'))!, 'click');

            await vi.waitFor(() => expect(useToasts().items().map((toast) => [toast.kind, toast.text])).toEqual([['warning', useLocale().t('play.leave.started')]]), { timeout: 4000 });
            await settle();

            expect(server.calls).toContain('tables.mine');
            expect(named(strips(container)[0], useLocale().t('quickMatch.stop'))?.getAttribute('aria-busy')).not.toBe('true');
        }
        finally
        {
            tables.leave = real;
        }
    });

    it('is there for a friend’s table a search seated the reader at, which the next search would fill too', async () =>
    {
        const lobby = useLobby();
        const container = shown();
        const theirs = await lobby.host('ludo', { ...defaultTable('ludo'), privacy: 'friends' }, []);

        server.tables[0].chairs[0].who = 'sara.k';
        server.tables[0].host = 'sara.k';
        server.friends = ['sara.k'];

        const found = await lobby.quick('ludo');

        expect(found, 'a friend’s table was passed over by the search').toBe(theirs);

        await arrived(found);

        expect(strips(container)).toHaveLength(1);
    });

    it('says it in Persian, with its own digits', async () =>
    {
        useLocale().setLocale('fa');

        const lobby = useLobby();
        const container = shown();

        await arrived(await lobby.quick('ludo', { seats: 4 }));

        const said = strips(container)[0].textContent ?? '';

        expect(said).toContain(useLocale().t('quickMatch.looking', { game: useLocale().t('games.ludo.name'), here: useLocale().n(1), seats: useLocale().n(4) }));
        expect(said).toContain(useLocale().t('quickMatch.stop'));
        expect(said).not.toContain('Looking');
        expect(said).toContain('۴');
    });
});
