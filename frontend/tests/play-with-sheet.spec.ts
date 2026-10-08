import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter } from 'azerothjs';

import PlayWithSheet from '../src/components/social/play-with-sheet.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import { TABLE_RULES } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { playWith } from '../src/lib/play-with.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useParty } from '../src/stores/party.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { INVITE_MS } from '../../backend/src/domains/party/rules.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
};

const opened = async (personId: string, teamable = true) =>
{
    const closed: unknown[] = [];
    const close = (result?: unknown) =>
    {
        closed.push(result);
    };
    const router = createRouter({
        routes: [
            { path: '/', component: () => PlayWithSheet({ overlayId: 'play-with', close, personId, teamable }) as HTMLElement },
            { path: '/app/play/:id', component: () => document.createElement('div') }
        ],
        history: createMemoryHistory('/'),
        scroll: false
    });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    await vi.waitFor(() => expect(container.querySelector('h2')).not.toBeNull(), { timeout: 4000 });
    await settle();

    return { container, router, closed };
};

const rowOf = (container: HTMLElement, game: string) => container.querySelector<HTMLElement>(`[role="group"][aria-label="${ game }"]`);

const offers = (container: HTMLElement) => Object.fromEntries(
    [...container.querySelectorAll<HTMLElement>('[role="group"]')].map((row) => [
        row.getAttribute('aria-label') ?? '',
        [...row.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '')
    ])
);

const button = (within: ParentNode | null, name: string) =>
    [...(within?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((one) => one.textContent?.trim() === name) ?? null;

const panelIn = (container: HTMLElement) => container.querySelector<HTMLElement>('section[aria-label]');

const told = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

const askedBy = async (leader: string, game = 'hokm') =>
{
    const answer = await server.parties.invite(leader, 'alex', game);

    if (!answer.ok)
    {
        throw new Error(`the invitation was refused: ${ answer.why }`);
    }

    return (await server.parties.state(leader)).party!.id;
};

const standing = async (of: unknown, verb: string, stand: () => Promise<unknown>, run: () => Promise<void>) =>
{
    const routes = of as Record<string, unknown>;
    const real = routes[verb];

    routes[verb] = stand;

    try
    {
        await run();
    }
    finally
    {
        routes[verb] = real;
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(6_000_000);
    setRuntime({ clock, seed: 31 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useSettings().reset();
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useOverlay().reset();
    useToasts().reset();
    useLobby().reset();
    useParty().reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await useSocial().refresh();
    await settle();
    server.calls = [];
});

afterEach(() =>
{
    vi.restoreAllMocks();
    cleanup();
    useParty().reset();
    useLobby().reset();
    useOverlay().reset();
    useToasts().reset();
    useSocial().reset();
    useRealtime().reset();
});

describe('playing with somebody', () =>
{
    it('offers a team-up and a private table at a game played in pairs, and a private table alone at any other', async () =>
    {
        const { container } = await opened('sara.k');

        expect(container.querySelector('h2')?.textContent).toBe('Play with Sara Kamali');
        expect(container.textContent).toContain('Team up to play on one side, two against two.');
        expect(offers(container)).toEqual({
            Hokm: ['Team up', 'Private table'],
            Ludo: ['Team up', 'Private table'],
            Poker: ['Private table'],
            Backgammon: ['Private table']
        });
        expect(panelIn(container)).toBeNull();
        expect(server.calls, 'opening the sheet asked for a team or a table').not.toEqual(expect.arrayContaining(['parties.invite']));
        expect(server.calls).not.toContain('tables.create');
    });

    it('offers no team-up with somebody who cannot be asked, and does not talk about one', async () =>
    {
        const { container } = await opened('sara.k', false);

        expect(offers(container)).toEqual({ Hokm: ['Private table'], Poker: ['Private table'], Backgammon: ['Private table'], Ludo: ['Private table'] });
        expect(container.textContent).not.toContain('Team up');
    });

    it('lists only what can be played', async () =>
    {
        const ludo = GAMES.find((game) => game.id === 'ludo')!;

        server.games = [{
            id: 'ludo',
            slug: 'ludo',
            nameKey: ludo.nameKey,
            blurbKey: ludo.blurbKey,
            categoryKey: ludo.categoryKey,
            category: 'board',
            minPlayers: 2,
            maxPlayers: 4,
            status: 'coming-soon',
            rules: { ...TABLE_RULES.ludo }
        }];
        useCatalogue().reset();
        await settle();

        const { container } = await opened('sara.k');

        expect(Object.keys(offers(container))).toEqual(['Hokm', 'Poker', 'Backgammon']);
    });

    it('names somebody it has only a handle for by the handle', async () =>
    {
        const { container } = await opened('somebody-nobody-described');

        expect(container.querySelector('h2')?.textContent).toBe('Play with somebody-nobody-described');
    });

    it('says it in Persian to a Persian reader', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = await opened('sara.k');
        const t = useLocale().t;

        expect(container.querySelector('h2')?.textContent).toBe(t('party.sheet.title', { name: 'Sara Kamali' }));
        expect(offers(container)[t('games.hokm.name')]).toEqual([t('party.teamUp'), t('party.private')]);
        expect(container.textContent).not.toContain('Private table');
    });
});

describe('teaming up from the sheet', () =>
{
    it('asks once for the game that was pressed, says nothing, and becomes the team', async () =>
    {
        const { container } = await opened('sara.k');

        fire(button(rowOf(container, 'Ludo'), 'Team up')!, 'click');

        expect(button(rowOf(container, 'Ludo'), 'Team up')?.getAttribute('aria-busy')).toBe('true');
        expect(button(rowOf(container, 'Hokm'), 'Team up')?.getAttribute('aria-busy'), 'every game span as though it had been asked for').not.toBe('true');

        fire(button(rowOf(container, 'Ludo'), 'Team up')!, 'click');
        fire(button(rowOf(container, 'Hokm'), 'Team up')!, 'click');

        expect(button(rowOf(container, 'Ludo'), 'Team up')?.getAttribute('aria-busy'), 'a press that asked for nothing moved the wait to another game').toBe('true');
        expect(button(rowOf(container, 'Hokm'), 'Team up')?.getAttribute('aria-busy')).not.toBe('true');

        await vi.waitFor(() => expect(panelIn(container)).not.toBeNull(), { timeout: 4000 });

        expect(server.calls.filter((call) => call === 'parties.invite')).toHaveLength(1);
        expect((await server.parties.state('sara.k')).invites).toMatchObject([{ game: 'ludo', from: 'alex' }]);
        expect(offers(container), 'the games stayed on offer beside a team with the same person').toEqual({});
        expect(container.textContent).not.toContain('Team up to play on one side');
        expect(told()).toEqual([]);
    });

    it('says a refusal in its own sentence and stays where it was', async () =>
    {
        await useParty().invite('sara.k', 'hokm');
        server.parties.decline('sara.k', useParty().party()!.id);
        await useParty().refresh();
        useToasts().dismissAll();

        const { container } = await opened('sara.k');

        fire(button(rowOf(container, 'Hokm'), 'Team up')!, 'click');
        await vi.waitFor(() => expect(told()).toEqual([['warning', 'Try again in a moment.']]), { timeout: 4000 });
        await settle();

        expect(panelIn(container)).toBeNull();
        expect(button(rowOf(container, 'Hokm'), 'Team up')?.getAttribute('aria-busy')).not.toBe('true');
        expect(Object.keys(offers(container))).toHaveLength(4);
    });

    it('is a yes to somebody who has already asked for that game: one team, theirs, and no second one beside it', async () =>
    {
        const theirs = await askedBy('sara.k');

        await useParty().refresh();

        const { container } = await opened('sara.k');

        expect(offers(container).Hokm).toEqual(['Team up', 'Private table']);

        server.calls = [];
        fire(button(rowOf(container, 'Hokm'), 'Team up')!, 'click');

        await vi.waitFor(() => expect(server.calls).toContain('parties.invite'), { timeout: 4000 });
        await vi.waitFor(() => expect(useParty().working('invite')).toBe(false), { timeout: 4000 });
        await settle();

        expect(useParty().party()).toMatchObject({ id: theirs, game: 'hokm', leader: 'sara.k', member: 'alex', stage: 'ready' });
        expect(useParty().invites(), 'the invitation that was taken up is still on a card').toEqual([]);
        expect(panelIn(container)?.querySelector('[role="status"]')?.textContent).toBe('Sara Kamali will start the search.');
        expect((await server.parties.state('sara.k')).invites, 'each of them was left holding the other’s invitation').toEqual([]);
        expect(server.calls.filter((call) => call.startsWith('parties.') && call !== 'parties.state')).toEqual(['parties.invite']);
        expect(told()).toEqual([]);
    });
});

describe('the team in the sheet', () =>
{
    const leading = async () =>
    {
        await useParty().invite('sara.k', 'hokm');

        return useParty().party()!.id;
    };

    it('names the two of them and the game, and says who is being waited for', async () =>
    {
        await leading();

        const { container } = await opened('sara.k');
        const panel = panelIn(container)!;

        expect(panel.getAttribute('aria-label')).toBe('Your team');
        expect([...panel.querySelectorAll('[dir="auto"]')].map((one) => one.textContent)).toEqual(['Alex Morgan', 'Sara Kamali']);
        expect(panel.textContent).toContain('Hokm');
        expect(panel.querySelector('[role="status"]')?.textContent).toBe('Waiting for Sara Kamali…');
        expect([...panel.querySelectorAll('button')].map((one) => one.textContent?.trim()), 'something to start a search with was offered before there is one').toEqual(['Leave team']);
    });

    it('tells whoever asked that the other one is in, in the panel it already drew', async () =>
    {
        const id = await leading();
        const { container } = await opened('sara.k');
        const panel = panelIn(container)!;
        const leave = button(panel, 'Leave team')!;

        leave.focus();
        await useParty().refresh();
        await server.parties.accept('sara.k', id);
        await useParty().refresh();

        expect(panelIn(container), 'the panel was drawn again by a read').toBe(panel);
        expect(panel.querySelector('[role="status"]')?.textContent).toBe('Sara Kamali is in. Ready when you are.');
        expect(button(panel, 'Leave team')).toBe(leave);
        expect(document.activeElement, 'the reader was put back on the page body').toBe(leave);
    });

    it('tells whoever said yes who starts the search', async () =>
    {
        const id = await askedBy('sara.k');

        await useParty().refresh();
        await useParty().accept(id);

        const { container } = await opened('sara.k');
        const panel = panelIn(container)!;

        expect(panel.querySelector('[role="status"]')?.textContent).toBe('Sara Kamali will start the search.');
        expect([...panel.querySelectorAll('[dir="auto"]')].map((one) => one.textContent)).toEqual(['Alex Morgan', 'Sara Kamali']);
        expect([...panel.querySelectorAll('button')].map((one) => one.textContent?.trim())).toEqual(['Leave team']);
    });

    it('runs the time the invitation has left along the panel, and stops once the other one is in', async () =>
    {
        const id = await leading();

        clock.advance(30_000);

        const { container } = await opened('sara.k');
        const bar = panelIn(container)!.querySelector<HTMLElement>('[data-clock]')!;

        expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(bar.style.getPropertyValue('--left')).toBe(`${ INVITE_MS - 30_000 }ms`);
        expect(Number(bar.style.getPropertyValue('--from'))).toBeCloseTo(2 / 3, 3);

        clock.advance(10_000);
        await useParty().refresh();

        expect(panelIn(container)!.querySelector('[data-clock]'), 'the bar was drawn again by a read').toBe(bar);
        expect(bar.style.getPropertyValue('--left'), 'the bar was started again by a read').toBe(`${ INVITE_MS - 30_000 }ms`);

        await server.parties.accept('sara.k', id);
        await useParty().refresh();

        expect(panelIn(container)!.querySelector('[data-clock]')).toBeNull();
    });

    it('leaves on Leave team, once, says nothing, and offers the games again', async () =>
    {
        await leading();

        const { container } = await opened('sara.k');

        server.calls = [];
        fire(button(panelIn(container), 'Leave team')!, 'click');

        expect(button(panelIn(container), 'Leave team')?.getAttribute('aria-busy')).toBe('true');

        fire(button(panelIn(container), 'Leave team')!, 'click');

        await vi.waitFor(() => expect(panelIn(container)).toBeNull(), { timeout: 4000 });
        await settle();

        expect(server.calls.filter((call) => call === 'parties.leave')).toHaveLength(1);
        expect(Object.keys(offers(container))).toHaveLength(4);
        expect(told()).toEqual([]);
    });

    it('changes the game by leaving and asking again, at once and with nothing said', async () =>
    {
        await leading();

        const { container } = await opened('sara.k');

        fire(button(panelIn(container), 'Leave team')!, 'click');
        await vi.waitFor(() => expect(panelIn(container)).toBeNull(), { timeout: 4000 });
        await settle();

        server.calls = [];
        fire(button(rowOf(container, 'Ludo'), 'Team up')!, 'click');
        await vi.waitFor(() => expect(server.calls).toContain('parties.invite'), { timeout: 4000 });
        await vi.waitFor(() => expect(useParty().working('invite')).toBe(false), { timeout: 4000 });
        await settle();

        expect(told(), 'taking an invitation back made the asker wait').toEqual([]);
        expect(useParty().party()).toMatchObject({ game: 'ludo', leader: 'alex', member: 'sara.k', stage: 'inviting' });
        expect(panelIn(container)?.querySelector('[role="status"]')?.textContent).toBe('Waiting for Sara Kamali…');
    });

    it('goes when the other one says not now, and the games are offered again', async () =>
    {
        const id = await leading();
        const { container } = await opened('sara.k');

        server.parties.decline('sara.k', id);
        await useParty().refresh();

        expect(panelIn(container)).toBeNull();
        expect(told()).toEqual([['warning', 'Sara Kamali can’t play right now']]);
        expect(Object.keys(offers(container))).toHaveLength(4);
    });

    it('is shown beside somebody else’s games, with the way out of it, and a second team is refused in words', async () =>
    {
        await leading();

        const { container } = await opened('reza.t');
        const panel = panelIn(container)!;

        expect(container.querySelector('h2')?.textContent).toBe('Play with Reza Tehrani');
        expect(panel.querySelector('[role="status"]')?.textContent).toBe('Waiting for Sara Kamali…');
        expect(button(panel, 'Leave team')).not.toBeNull();
        expect(offers(container).Hokm).toEqual(['Team up', 'Private table']);

        fire(button(rowOf(container, 'Hokm'), 'Team up')!, 'click');
        await vi.waitFor(() => expect(told()).toEqual([['warning', 'You are already in a team. Leave it first.']]), { timeout: 4000 });

        expect(panelIn(container)).toBe(panel);
    });
});

describe('a team that could not be read', () =>
{
    it('is said to be that, never no team, and is read again on Try again', async () =>
    {
        await useParty().invite('sara.k', 'hokm');

        let container!: HTMLElement;

        await standing(client.parties, 'state', () => Promise.reject(new ApiError(503, 'unavailable', 'The server is not answering.', undefined)), async () =>
        {
            useParty().reset();
            await settle();

            container = (await opened('sara.k')).container;

            expect(container.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Your team could not be read just now.');
            expect(panelIn(container)).toBeNull();
            expect(Object.keys(offers(container)), 'the games were taken away with the team').toHaveLength(4);
        });

        fire(button(container, 'Try again')!, 'click');

        await vi.waitFor(() => expect(panelIn(container)).not.toBeNull(), { timeout: 4000 });

        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('is not said of a team that is still being asked about', async () =>
    {
        const answers: (() => void)[] = [];
        const real = client.parties.state;

        await standing(client.parties, 'state', async () =>
        {
            await new Promise<void>((resolve) =>
            {
                answers.push(resolve);
            });

            return await real();
        }, async () =>
        {
            useParty().reset();
            await settle();

            const { container } = await opened('sara.k');

            expect(useParty().known()).toBe(false);
            expect(container.querySelector('[role="alert"]'), 'a read that is out was called a read that failed').toBeNull();
            expect(Object.keys(offers(container))).toHaveLength(4);

            answers.forEach((answer) => answer());
            await settle();
        });
    });

    it('goes on showing the team it last read when a later read fails', async () =>
    {
        await useParty().invite('sara.k', 'hokm');

        const { container } = await opened('sara.k');
        const panel = panelIn(container);

        await standing(client.parties, 'state', () => Promise.reject(new ApiError(503, 'unavailable', 'The server is not answering.', undefined)), async () =>
        {
            await useParty().refresh().catch(() => undefined);

            expect(panelIn(container)).toBe(panel);
            expect(container.querySelector('[role="alert"]')).toBeNull();
        });
    });
});

describe('a private table from the sheet', () =>
{
    it('opens one with them in it, goes there and closes', async () =>
    {
        const { container, router, closed } = await opened('sara.k');

        fire(button(rowOf(container, 'Backgammon'), 'Private table')!, 'click');

        expect(button(rowOf(container, 'Backgammon'), 'Private table')?.getAttribute('aria-busy')).toBe('true');

        fire(button(rowOf(container, 'Backgammon'), 'Private table')!, 'click');
        fire(button(rowOf(container, 'Poker'), 'Private table')!, 'click');

        await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//), { timeout: 4000 });

        expect(server.calls.filter((call) => call === 'tables.create')).toHaveLength(1);
        expect(server.tables).toHaveLength(1);
        expect(server.tables[0]).toMatchObject({ game: 'backgammon', privacy: 'invite' });
        expect(server.tables[0].chairs.map((chair) => chair.invited)).toContain('sara.k');
        expect(router.location().pathname).toBe(`/app/play/${ server.tables[0].id }`);
        expect(closed).toEqual([true]);
        expect(server.calls).not.toContain('parties.invite');
    });

    it('says the table would not open, stays, and can be pressed again', async () =>
    {
        const { container, router, closed } = await opened('sara.k');

        await standing(client.tables, 'create', () => Promise.reject(new ApiError(500, 'internal', 'Something went wrong.', undefined)), async () =>
        {
            fire(button(rowOf(container, 'Hokm'), 'Private table')!, 'click');
            await vi.waitFor(() => expect(told()).toEqual([['warning', 'That table would not open. Try again in a moment.']]), { timeout: 4000 });
            await settle();
        });

        expect(router.location().pathname).toBe('/');
        expect(closed).toEqual([]);
        expect(button(rowOf(container, 'Hokm'), 'Private table')?.getAttribute('aria-busy')).not.toBe('true');

        fire(button(rowOf(container, 'Hokm'), 'Private table')!, 'click');

        await vi.waitFor(() => expect(closed).toEqual([true]), { timeout: 4000 });
    });
});

describe('the way to the sheet', () =>
{
    it('is one sheet however often it is asked for, named for who it is with', async () =>
    {
        playWith('sara.k', true);
        playWith('sara.k', true);

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });
        await settle();

        expect(useOverlay().items().map((entry) => [entry.id, entry.component, entry.label, entry.props.personId, entry.props.teamable]))
            .toEqual([['play-with', PlayWithSheet, 'Play with Sara Kamali', 'sara.k', true]]);
    });

    it('carries that somebody cannot be asked', async () =>
    {
        playWith('kian16', false);

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].props).toMatchObject({ personId: 'kian16', teamable: false });
    });
});
