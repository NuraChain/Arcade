import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import OpenHereSheet from '../src/components/games/open-here-sheet.component.azeroth';
import { GAMES, type GameId } from '../src/data/games.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import GroupPage from '../src/pages/app/group.page.azeroth';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
};

const nameOf = (game: GameId) => useLocale().t(GAMES.find((one) => one.id === game)!.nameKey);

const formatsOf = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${ useLocale().t('create.seats') }"] button`)];

const offered = (container: HTMLElement) => formatsOf(container).map((one) => one.textContent?.trim());

const chosen = (container: HTMLElement) =>
    formatsOf(container).filter((one) => one.getAttribute('aria-pressed') === 'true').map((one) => one.textContent?.trim());

const pressed = (container: HTMLElement, label: string) =>
    fire([...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label)!, 'click');

const picked = (container: HTMLElement, game: GameId) =>
    fire([...container.querySelectorAll<HTMLButtonElement>('fieldset ul button')].find((one) => one.textContent?.includes(nameOf(game)))!, 'click');

const sheet = (props: { conversationId: string; game?: GameId; heads?: number }) =>
{
    const close = vi.fn();
    const routes: Route[] = [
        { path: '/', component: (): HTMLElement => OpenHereSheet({ overlayId: 'test', close, ...props }) as HTMLElement },
        { path: '/app/play/:id', component: (): HTMLElement => document.createElement('div') }
    ];
    const router = createRouter({ routes, history: createMemoryHistory('/'), scroll: false });

    return { close, container: renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container };
};

const listed = async (conversationId: string) =>
{
    await vi.waitFor(() => expect(useChat().conversation(conversationId)).toBeDefined(), { timeout: 4000 });
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(600_000), seed: 9 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, kind: 'guest', isMinor: false });
    useRealtime().reset();
    socket.reset();
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useGroups().reset();
    useChat().reset();
    useSettings().reset();
    useLobby().reset();
    useOverlay().reset();
    useToasts().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useOverlay().reset();
    useToasts().reset();
    useChat().reset();
    useGroups().reset();
    useLobby().reset();
    useRealtime().reset();
    vi.restoreAllMocks();
});

describe('the sheet that opens a table in a conversation', () =>
{
    it('offers a room of four or more both ludo games of four by name, and opens the one that was chosen in that room', async () =>
    {
        await listed('c-friday');

        const locale = useLocale();
        const create = vi.spyOn(client.tables, 'create');
        const { container } = sheet({ conversationId: 'c-friday' });

        expect(offered(container)).toEqual(['2', '3', '4', locale.t('create.format.teams')]);
        expect(chosen(container)).toEqual(['4']);
        expect(container.textContent).not.toContain(locale.t('create.teamsHint.ludo'));

        pressed(container, locale.t('create.format.teams'));

        expect(chosen(container)).toEqual([locale.t('create.format.teams')]);
        expect(container.textContent).toContain(locale.t('create.teamsHint.ludo'));

        pressed(container, locale.t('openHere.open'));
        await settle();

        expect(server.asked).toEqual([{ game: 'ludo', seats: 4, teams: true }]);
        expect(create.mock.calls[0][0].input).toMatchObject({ roomId: 'c-friday', teams: true });
        expect(server.tables.map((table) => table.teams)).toEqual([true]);
    });

    it('opens the plain game of four when nobody chose otherwise', async () =>
    {
        await listed('c-friday');

        const { container } = sheet({ conversationId: 'c-friday' });

        pressed(container, useLocale().t('openHere.open'));
        await settle();

        expect(server.asked).toEqual([{ game: 'ludo', seats: 4, teams: false }]);
    });

    it('names four at hokm as two against two, says what that means there, and opens it as one', async () =>
    {
        await listed('c-friday');

        const locale = useLocale();
        const { container } = sheet({ conversationId: 'c-friday' });

        picked(container, 'hokm');

        expect(offered(container)).toEqual(['2', '3', locale.t('create.format.teams')]);
        expect(chosen(container)).toEqual([locale.t('create.format.teams')]);
        expect(container.textContent).toContain(locale.t('create.teamsHint.hokm'));

        pressed(container, '3');

        expect(chosen(container)).toEqual(['3']);
        expect(container.textContent).not.toContain(locale.t('create.teamsHint.hokm'));

        pressed(container, locale.t('create.format.teams'));
        pressed(container, locale.t('openHere.open'));
        await settle();

        expect(server.asked).toEqual([{ game: 'hokm', seats: 4, teams: true }]);
    });

    it('offers a room of three no game of four, and a room of two no choice at all', async () =>
    {
        await listed('c-sara');

        const locale = useLocale();
        const three = sheet({ conversationId: 'c-friday', heads: 3 }).container;

        expect(offered(three)).toEqual(['2', '3']);
        expect(chosen(three)).toEqual(['3']);

        cleanup();

        const two = sheet({ conversationId: 'c-sara' }).container;

        expect(formatsOf(two)).toEqual([]);
        expect(two.textContent).not.toContain(locale.t('create.teamsHint.ludo'));

        pressed(two, locale.t('openHere.open'));
        await settle();

        expect(server.asked).toEqual([{ game: 'ludo', seats: 2, teams: false }]);
    });

    it('says the same in Persian, in Persian', async () =>
    {
        await listed('c-friday');

        const locale = useLocale();
        const english = [locale.t('create.format.teams'), locale.t('create.teamsHint.ludo')];

        locale.setLocale('fa');

        const { container } = sheet({ conversationId: 'c-friday' });
        const persian = [locale.t('create.format.teams'), locale.t('create.teamsHint.ludo')];

        pressed(container, persian[0]);

        expect(chosen(container)).toEqual([persian[0]]);
        expect(container.textContent).toContain(persian[1]);
        expect(persian[0]).not.toBe(english[0]);
        expect(persian[1]).not.toBe(english[1]);
    });

    it('keeps the choice of seats it has drawn when the catalogue is read again', async () =>
    {
        await listed('c-friday');

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
            status: 'available',
            rules: { seats: [2, 3, 4], modes: ['live', 'turns'], targets: [], stakes: 'none', partners: 'optional', hasCube: false, hasBlinds: false }
        }];
        useCatalogue().reset();
        await settle();

        const { container } = sheet({ conversationId: 'c-friday' });
        const locale = useLocale();

        pressed(container, locale.t('create.format.teams'));

        const control = container.querySelector('[role="group"]');
        const hint = [...container.querySelectorAll('p')].find((line) => line.textContent === locale.t('create.teamsHint.ludo'));
        const reads = server.calls.filter((one) => one === 'catalogue.games').length;

        expect(control).not.toBeNull();
        expect(hint).toBeDefined();

        useCatalogue().reset();
        await settle();

        expect(server.calls.filter((one) => one === 'catalogue.games').length).toBeGreaterThan(reads);
        expect(container.querySelector('[role="group"]')).toBe(control);
        expect(container.contains(hint!)).toBe(true);
        expect(chosen(container)).toEqual([locale.t('create.format.teams')]);
    });
});

describe('a group\'s offer to play together', () =>
{
    const opened = async (slug: string) =>
    {
        const routes: Route[] = [
            { path: '/app/groups/:id', component: (): HTMLElement => GroupPage() as HTMLElement },
            { path: '/app/play/:id', component: (): HTMLElement => document.createElement('div') }
        ];
        const router = createRouter({ routes, history: createMemoryHistory(`/app/groups/${ slug }`), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() => expect(container.querySelector('#group-name')).not.toBeNull(), { timeout: 4000 });
        await settle();

        return container;
    };

    const offer = () =>
    {
        const top = useOverlay().top();

        return top === null ? null : { label: top.label, conversationId: top.props.conversationId, game: top.props.game, heads: top.props.heads };
    };

    it('is the same sheet, opened on the group\'s room, its game and its head count, and it names both ludo games of four', async () =>
    {
        const locale = useLocale();

        await useGroups().join('lunch-ludo');

        const page = await opened('lunch-ludo');
        const heads = server.groups.find((one) => one.slug === 'lunch-ludo')!.members.length;

        expect(offer()).toBeNull();

        pressed(page, locale.t('groups.playTogether'));
        await settle();

        expect(offer()).toEqual({ label: locale.t('openHere.title'), conversationId: 'conv-lunch-ludo', game: 'ludo', heads });
        expect(server.asked).toEqual([]);

        cleanup();

        const { container } = sheet({ conversationId: 'conv-lunch-ludo', game: 'ludo', heads });

        expect(offered(container)).toEqual(['2', '3', '4', locale.t('create.format.teams')]);

        pressed(container, locale.t('create.format.teams'));
        pressed(container, locale.t('openHere.open'));
        await settle();

        expect(server.asked).toEqual([{ game: 'ludo', seats: 4, teams: true }]);
    });

    it('starts on the game the group plays, with four named as two against two where that is how it is played', async () =>
    {
        const locale = useLocale();
        const page = await opened('friday-night-crew');

        pressed(page, locale.t('groups.playTogether'));
        await settle();

        const asked = offer()!;

        expect(asked).toMatchObject({ conversationId: 'conv-friday-night-crew', game: 'hokm' });

        cleanup();

        const { container } = sheet({ conversationId: 'conv-friday-night-crew', game: 'hokm', heads: asked.heads as number });

        expect(offered(container)).toEqual(['2', '3', locale.t('create.format.teams')]);
        expect(chosen(container)).toEqual([locale.t('create.format.teams')]);
    });

    it('tells a group of one that it is too small, and opens nothing', async () =>
    {
        const locale = useLocale();
        const made = await useGroups().create({ name: 'Only Me', blurb: '', crest: 'crest-cup', hue: 90, game: 'ludo', privacy: 'public' });
        const page = await opened(made.slug);

        pressed(page, locale.t('groups.playTogether'));
        await settle();

        expect(offer()).toBeNull();
        expect(server.asked).toEqual([]);
        expect(useToasts().items().map((toast) => toast.text)).toContain(locale.t('groups.tooFew'));
    });
});
