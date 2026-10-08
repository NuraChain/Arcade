import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type MountNode } from 'azerothjs';

import CreateGameForm from '../src/components/games/create-game-form.component.azeroth';
import GameGrid from '../src/components/games/game-grid.component.azeroth';
import GameHero from '../src/components/games/game-hero.component.azeroth';
import TableRow from '../src/components/games/table-row.component.azeroth';
import GamePage from '../src/pages/app/game.page.azeroth';
import { defaultTable, formatsOf, isValidTable, TABLE_RULES } from '../src/data/tables.ts';
import { GAMES } from '../src/data/games.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { ARRIVAL_MS, useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { TableSummary } from '../src/api.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

let clock: ReturnType<typeof manualClock>;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const READS = ['tables.mine', 'tables.view', 'tables.byCode', 'tables.watchable'];

const written = () => server.calls.filter((call) => call.startsWith('tables.') && !READS.includes(call));

const parked = async (run: (answers: (() => void)[]) => Promise<void>) =>
{
    const tables = client.tables as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    const real = tables.quick;
    const answers: (() => void)[] = [];

    tables.quick = async (input) =>
    {
        await new Promise<void>((resolve) =>
        {
            answers.push(resolve);
        });

        return await real(input);
    };

    try
    {
        await run(answers);
    }
    finally
    {
        tables.quick = real;
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(2_000_000);
    setRuntime({ clock, seed: 5 });
    server.reset();
    useCatalogue().reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'guest',
        isMinor: false
    });
    useSettings().reset();
    useLobby().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useSettings().reset();
    useLobby().reset();
    useRealtime().reset();
});

describe('what a table config may say', () =>
{
    it('no longer claims anything about fairness', () =>
    {
        // `fairness: 'dice' | 'deal'` became two sentences in the UI - every roll committed
        // before it is shown, every deal shuffled from a checkable seed - and nothing implemented
        // either one. The rule is gone from the column, the wire and the copy together.
        for (const game of GAMES)
        {
            expect(Object.keys(TABLE_RULES[game.id]), game.id).not.toContain('fairness');
        }
    });

    it('offers each seat count once, and four twice where the game leaves two against two to whoever opens the table', () =>
    {
        const said = (partners: 'none' | 'optional' | 'required') =>
            formatsOf({ seats: [2, 3, 4], partners }).map((format) => `${ format.seats }${ format.teams ? ' in pairs' : '' }`);

        expect(said('none')).toEqual(['2', '3', '4']);
        expect(said('optional')).toEqual(['2', '3', '4', '4 in pairs']);
        expect(said('required')).toEqual(['2', '3', '4 in pairs']);
        expect(formatsOf({ seats: [2, 6, 9], partners: 'required' }).some((format) => format.teams)).toBe(false);
    });

    it('calls a table valid only in a format the rules it is held to offer', () =>
    {
        const hokm = TABLE_RULES.hokm;
        const ludo = TABLE_RULES.ludo;

        expect(isValidTable(defaultTable('hokm'), hokm)).toBe(true);
        expect(isValidTable({ ...defaultTable('hokm'), teams: false }, hokm)).toBe(false);
        expect(isValidTable({ ...defaultTable('hokm'), seats: 2 }, hokm)).toBe(false);
        expect(isValidTable({ ...defaultTable('hokm'), seats: 2, teams: false }, hokm)).toBe(true);
        expect(isValidTable({ ...defaultTable('ludo'), teams: true }, ludo)).toBe(true);
        expect(isValidTable({ ...defaultTable('ludo'), seats: 3, teams: true }, ludo)).toBe(false);
        expect(isValidTable({ ...defaultTable('ludo'), teams: true }, { ...ludo, partners: 'none' })).toBe(false);
    });
});

describe('the create form', () =>
{
    const cubeSwitch = (container: HTMLElement) =>
        [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((one) => one.textContent?.includes('Doubling cube'))!;

    const chip = (container: HTMLElement, label: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label)!;

    const formats = (container: HTMLElement) =>
        [...container.querySelector('fieldset')!.querySelectorAll<HTMLButtonElement>('button')];

    const offered = (container: HTMLElement) => formats(container).map((one) => one.textContent?.trim());

    const chosen = (container: HTMLElement) =>
        formats(container).filter((one) => one.getAttribute('aria-pressed') === 'true').map((one) => one.textContent?.trim());

    it('names four at hokm as two against two, and says what that means and whose partner the first guest is', () =>
    {
        const hokm = GAMES.find((game) => game.id === 'hokm')!;
        const locale = useLocale();
        const { container } = renderTest(() => CreateGameForm({ game: hokm, onCreated: () => undefined }) as HTMLElement);

        expect(offered(container)).toEqual(['2 players', '3 players', '2 v 2']);
        expect(chosen(container)).toEqual(['2 v 2']);
        expect(container.textContent).toContain(locale.t('create.teamsHint.hokm'));
        expect(container.textContent).toContain(locale.t('create.partnerHint'));

        fire(chip(container, '3 players'), 'click');

        expect(chosen(container)).toEqual(['3 players']);
        expect(container.textContent).not.toContain(locale.t('create.teamsHint.hokm'));
        expect(container.textContent).not.toContain(locale.t('create.partnerHint'));

        fire(chip(container, '2 v 2'), 'click');

        expect(chosen(container)).toEqual(['2 v 2']);
        expect(container.textContent).toContain(locale.t('create.partnerHint'));
    });

    it('says the same in Persian, in Persian', () =>
    {
        const hokm = GAMES.find((game) => game.id === 'hokm')!;
        const locale = useLocale();
        const english = [locale.t('create.format.teams'), locale.t('create.teamsHint.hokm'), locale.t('create.partnerHint')];

        locale.setLocale('fa');

        const { container } = renderTest(() => CreateGameForm({ game: hokm, onCreated: () => undefined }) as HTMLElement);
        const persian = [locale.t('create.format.teams'), locale.t('create.teamsHint.hokm'), locale.t('create.partnerHint')];

        expect(chosen(container)).toEqual([persian[0]]);

        for (const [at, sentence] of persian.entries())
        {
            expect(container.textContent).toContain(sentence);
            expect(sentence).not.toBe(english[at]);
        }
    });

    it('offers no choice of seats where the game plays one way', () =>
    {
        const backgammon = GAMES.find((game) => game.id === 'backgammon')!;
        const { container } = renderTest(() => CreateGameForm({ game: backgammon, onCreated: () => undefined }) as HTMLElement);

        expect(container.textContent).not.toContain(useLocale().t('create.seats'));
        expect(container.textContent).not.toContain(useLocale().t('create.partnerHint'));
    });

    it('offers no cube in a one-point match and says why, then offers it again at three points', () =>
    {
        const backgammon = GAMES.find((game) => game.id === 'backgammon')!;
        const { container } = renderTest(() => CreateGameForm({ game: backgammon, onCreated: () => undefined }) as HTMLElement);

        expect(cubeSwitch(container).getAttribute('aria-checked')).toBe('false');
        expect(cubeSwitch(container).disabled).toBe(true);
        expect(cubeSwitch(container).textContent).toContain('A one-point match has no cube');

        fire(chip(container, '3 points'), 'click');

        expect(cubeSwitch(container).getAttribute('aria-checked')).toBe('true');
        expect(cubeSwitch(container).disabled).toBe(false);
        expect(cubeSwitch(container).textContent).toContain('double what the game is worth');
    });

    it('says whether the table it opens is two against two, from the seats on the form when it is sent', async () =>
    {
        const hokm = GAMES.find((game) => game.id === 'hokm')!;
        const opened = (container: HTMLElement) => fire(container.querySelector<HTMLFormElement>('form')!, 'submit');

        const four = renderTest(() => CreateGameForm({ game: hokm, onCreated: () => undefined }) as HTMLElement).container;

        opened(four);
        await settle();

        cleanup();

        const two = renderTest(() => CreateGameForm({ game: hokm, onCreated: () => undefined }) as HTMLElement).container;

        fire(chip(two, '2 players'), 'click');
        opened(two);
        await settle();

        expect(server.asked).toEqual([
            { game: 'hokm', seats: 4, teams: true },
            { game: 'hokm', seats: 2, teams: false }
        ]);
    });

    it('opens a table with no call unless its switch was turned on, and then with one for the whole table', async () =>
    {
        const ludo = GAMES.find((game) => game.id === 'ludo')!;
        const voiceSwitch = (container: HTMLElement) =>
            [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((one) => one.textContent?.includes('Voice chat'))!;

        const quiet = renderTest(() => CreateGameForm({ game: ludo, onCreated: () => undefined }) as HTMLElement).container;

        expect(voiceSwitch(quiet).getAttribute('aria-checked')).toBe('false');
        fire(quiet.querySelector<HTMLFormElement>('form')!, 'submit');
        await settle();

        cleanup();

        const talking = renderTest(() => CreateGameForm({ game: ludo, onCreated: () => undefined }) as HTMLElement).container;

        fire(voiceSwitch(talking), 'click');
        expect(voiceSwitch(talking).getAttribute('aria-checked')).toBe('true');
        fire(talking.querySelector<HTMLFormElement>('form')!, 'submit');
        await settle();

        expect(server.tables.map((table) => table.voice)).toEqual(['off', 'table']);
    });

    it('still says it, as a plain no, for a game that leaves the choice to whoever opens the table', async () =>
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
            status: 'available',
            rules: { seats: [2, 3, 4], modes: ['live', 'turns'], targets: [], stakes: 'none', partners: 'optional', hasCube: false, hasBlinds: false }
        }];
        useCatalogue().reset();
        await settle();

        const { container } = renderTest(() => CreateGameForm({ game: ludo, onCreated: () => undefined }) as HTMLElement);

        await settle();
        fire(container.querySelector<HTMLFormElement>('form')!, 'submit');
        await settle();

        expect(useCatalogue().rules('ludo').partners).toBe('optional');
        expect(server.asked).toEqual([{ game: 'ludo', seats: 4, teams: false }]);
        expect(server.asked[0].teams).toBe(false);
    });

    it('offers both games of four where the published rules leave the choice open, and opens the one that was chosen', async () =>
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
            status: 'available',
            rules: { seats: [2, 3, 4], modes: ['live', 'turns'], targets: [], stakes: 'none', partners: 'optional', hasCube: false, hasBlinds: false }
        }];
        useCatalogue().reset();
        await settle();

        const { container } = renderTest(() => CreateGameForm({ game: ludo, onCreated: () => undefined }) as HTMLElement);

        await settle();

        expect(offered(container)).toEqual(['2 players', '3 players', '4 players', '2 v 2']);
        expect(chosen(container)).toEqual(['4 players']);
        expect(container.textContent).not.toContain(useLocale().t('create.partnerHint'));

        fire(chip(container, '2 v 2'), 'click');

        expect(chosen(container)).toEqual(['2 v 2']);
        expect(container.textContent).toContain(useLocale().t('create.partnerHint'));

        fire(container.querySelector<HTMLFormElement>('form')!, 'submit');
        await settle();

        expect(server.asked).toEqual([{ game: 'ludo', seats: 4, teams: true }]);
    });
});

describe('a game that is played in pairs', () =>
{
    const chips = (id: 'hokm' | 'ludo' | 'poker' | 'backgammon') =>
    {
        const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });
        const hero = () => GameHero({ game: GAMES.find((game) => game.id === id)!, onQuickPlay: () => undefined });

        return renderTest(() => RouterProvider({ router, children: hero }) as HTMLElement).container.textContent ?? '';
    };

    it('says so on its page, and no other game does', () =>
    {
        expect(chips('hokm')).toContain('Partners at four');

        for (const id of ['ludo', 'poker', 'backgammon'] as const)
        {
            expect(chips(id), id).not.toContain('Partners at four');
        }
    });

    it('does not say a game that only allows partners is played in them', async () =>
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
            status: 'available',
            rules: { seats: [2, 3, 4], modes: ['live', 'turns'], targets: [], stakes: 'none', partners: 'optional', hasCube: false, hasBlinds: false }
        }];
        useCatalogue().reset();
        await settle();

        expect(useCatalogue().rules('ludo').partners).toBe('optional');
        expect(chips('ludo')).not.toContain('Partners at four');
    });

    const publish = async (partners: 'none' | 'optional') =>
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
            status: 'available',
            rules: { seats: [2, 3, 4], modes: ['live', 'turns'], targets: [], stakes: 'none', partners, hasCube: false, hasBlinds: false }
        }];
        useCatalogue().reset();
        await settle();
    };

    const cards = async (slug: string) =>
    {
        const router = createRouter({
            routes: [{ path: '/app/games/:slug', component: () => GamePage() as HTMLElement }],
            history: createMemoryHistory(`/app/games/${ slug }`),
            scroll: false
        });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);
        const listed = () => [...container.querySelectorAll('[aria-labelledby="game-about"] ol > li')];

        await vi.waitFor(() => expect(listed().length).toBeGreaterThan(0), { timeout: 4000 });

        const read = listed().map((card) => [...card.children].map((part) => part.textContent?.trim()));

        cleanup();

        return read;
    };

    it('says a game that leaves two against two to whoever opens the table can be played that way at four, in both languages, and never that it is played in pairs', () =>
    {
        const locale = useLocale();

        expect(chips('ludo')).toContain('2 v 2 at four');
        expect(chips('ludo')).not.toContain('Partners at four');

        for (const id of ['hokm', 'poker', 'backgammon'] as const)
        {
            expect(chips(id), id).not.toContain('2 v 2 at four');
        }

        locale.setLocale('fa');

        const persian = locale.t('games.partners.optional');

        expect(persian).not.toBe('2 v 2 at four');
        expect(chips('ludo')).toContain(persian);
        expect(chips('ludo')).not.toContain(locale.t('games.partners.required'));
        expect(chips('hokm')).not.toContain(persian);
    });

    it('takes that from the rules the server published, not from the ones this browser was built with', async () =>
    {
        await publish('none');

        expect(useCatalogue().rules('ludo').partners).toBe('none');
        expect(chips('ludo')).not.toContain('2 v 2 at four');

        await publish('optional');

        expect(chips('ludo')).toContain('2 v 2 at four');
    });

    it('writes a fourth card about two against two on the page of the game that can be played that way, and three on every other', async () =>
    {
        const locale = useLocale();
        const ludo = [1, 2, 3, 4] as const;

        expect(await cards('ludo')).toEqual(ludo.map((card) => [String(card), locale.t(`game.rules.ludo.${ card }`)]));

        for (const slug of ['hokm', 'poker', 'backgammon'])
        {
            expect(await cards(slug), slug).toHaveLength(3);
        }

        const english = locale.t('game.rules.ludo.4');

        locale.setLocale('fa');

        const persian = await cards('ludo');

        expect(persian).toEqual(ludo.map((card) => [locale.n(card), locale.t(`game.rules.ludo.${ card }`)]));
        expect(persian[3][1]).not.toBe(english);
    });
});

describe('a button that finds a seat', () =>
{
    const stub = () => document.createElement('div');

    const shown = (children: () => MountNode) =>
    {
        const router = createRouter({ routes: [{ path: '/', component: stub }], history: createMemoryHistory('/'), scroll: false });

        return renderTest(() => RouterProvider({ router, children }) as HTMLElement).container;
    };

    const named = (container: HTMLElement, name: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].filter((one) => one.textContent?.trim() === name);

    const busy = (button: HTMLButtonElement) => button.getAttribute('aria-busy') === 'true' && button.getAttribute('aria-disabled') === 'true';

    const said = (container: HTMLElement) =>
        [...container.querySelectorAll('[role="status"]')].map((one) => one.textContent?.trim() ?? '').filter((text) => text !== '');

    const game = (id: 'hokm' | 'ludo') => GAMES.find((one) => one.id === id)!;

    it('spins on the game’s page while its search is out, says so to a screen reader, and sends one request however often it is pressed', async () =>
    {
        const lobby = useLobby();
        const container = shown(() => GameHero({ game: game('ludo'), onQuickPlay: () => void lobby.quick('ludo') }));

        await settle();

        const [button] = named(container, useLocale().t('app.nav.quickPlay'));

        expect(busy(button)).toBe(false);
        expect(said(container)).toEqual([]);

        await parked(async (answers) =>
        {
            fire(button, 'click');
            fire(button, 'click');
            await settle();

            expect(busy(button)).toBe(true);
            expect(said(container)).toEqual([useLocale().t('quickMatch.busy')]);
            expect(answers).toHaveLength(1);

            answers[0]();

            const found = await lobby.quick('ludo');

            await settle();

            expect(busy(button), 'the button was let go before the table’s page had arrived').toBe(true);

            lobby.open(found);
            await settle();

            expect(busy(button)).toBe(false);
            expect(said(container)).toEqual([]);
        });
    });

    it('leaves a card alone while a search for its game is out: a card only leads to the game', async () =>
    {
        const lobby = useLobby();
        const container = shown(() => GameGrid({ games: [game('hokm'), game('ludo')], label: 'Games' }));

        await settle();

        await parked(async (answers) =>
        {
            void lobby.quick('ludo');
            await settle();

            expect(lobby.finding()).toEqual(['ludo']);
            expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
            expect(said(container)).toEqual([]);
            expect([...container.querySelectorAll('a')].filter((one) => one.textContent?.trim() === useLocale().t('games.play')).map((one) => one.getAttribute('href'))).toEqual(['/app/games/hokm', '/app/games/ludo']);

            answers[0]();
            lobby.open(await lobby.quick('ludo'));
            await settle();
        });
    });

    it('says it in Persian too', async () =>
    {
        useLocale().setLocale('fa');

        const lobby = useLobby();
        const container = shown(() => GameHero({ game: game('ludo'), onQuickPlay: () => void lobby.quick('ludo') }));

        await settle();

        await parked(async (answers) =>
        {
            fire(named(container, useLocale().t('app.nav.quickPlay'))[0], 'click');
            await settle();

            expect(said(container)).toEqual([useLocale().t('quickMatch.busy')]);
            expect(useLocale().t('quickMatch.busy')).not.toBe('Finding you a seat');

            answers[0]();
            await lobby.quick('ludo');
        });
    });

    const gamePage = async () =>
    {
        const router = createRouter({
            routes: [{ path: '/app/games/:slug', component: () => GamePage() as HTMLElement }, { path: '/app/play/:id', component: stub }],
            history: createMemoryHistory('/app/games/ludo'),
            scroll: false
        });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

        await vi.waitFor(() => expect(named(container, useLocale().t('app.nav.quickPlay'))).toHaveLength(2), { timeout: 4000 });

        return named(container, useLocale().t('app.nav.quickPlay'));
    };

    it('asks what to look for from both places the game page offers it, the bar a phone keeps at the foot included, and looks for nothing by itself', async () =>
    {
        useOverlay().reset();

        const buttons = await gamePage();

        server.calls = [];

        for (const button of buttons)
        {
            fire(button, 'click');
            fire(button, 'click');

            await vi.waitFor(() => expect(useOverlay().top()).not.toBeNull(), { timeout: 4000 });

            expect(useOverlay().items(), 'two presses opened two sheets').toHaveLength(1);
            expect(useOverlay().top()!.props.game).toBe('ludo');
            expect(useOverlay().top()!.label).toBe(useLocale().t('quickMatch.title'));

            useOverlay().reset();
        }

        expect(written(), 'pressing Quick play looked for a table before anybody said what to look for').toEqual([]);
    });

    it('spins in both of them while a search for that game is out', async () =>
    {
        const lobby = useLobby();
        const buttons = await gamePage();

        await parked(async (answers) =>
        {
            void lobby.quick('ludo', { seats: 2 });
            await settle();

            expect(buttons.map(busy)).toEqual([true, true]);

            answers[0]();
            lobby.open(await lobby.quick('ludo'));
            await settle();

            expect(buttons.map(busy)).toEqual([false, false]);
        });
    });
});

describe('a table in a list', () =>
{
    const row = (voice: 'off' | 'table') =>
    {
        const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });
        const table = {
            id: 'one',
            code: 'ONE',
            game: 'hokm',
            seats: 4,
            mode: 'live',
            privacy: 'public',
            target: 7,
            cube: false,
            blinds: 'low',
            chat: true,
            voice,
            teams: true,
            status: 'open',
            chairs: [],
            taken: 1,
            createdAt: '2026-09-22T00:00:00.000Z'
        } as never;

        return renderTest(() => RouterProvider({ router, children: () => TableRow({ table }) }) as HTMLElement).container;
    };

    it('wears the voice mark only when it has a call', () =>
    {
        const mark = `[aria-label="${ useLocale().t('voice.tableHas') }"]`;

        expect(row('off').querySelector(mark)).toBeNull();
        expect(row('table').querySelector(mark)).not.toBeNull();
    });
});

describe('the lobby store', () =>
{
    it('opens a table and seats the host in the first chair', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('hokm', defaultTable('hokm'), []);

        lobby.open(id);
        await settle();

        const table = lobby.table()!;
        expect(table.host).toBe('alex');
        expect(table.mine).toBe(0);
        expect(table.taken).toBe(1);
        expect(table.status).toBe('open');
        expect(table.chairs.length).toBe(4);
        expect(server.calls).toContain('tables.create');
    });

    it('holds a chair for each person the host invited, the first of them opposite the host at a team table', async () =>
    {
        const lobby = useLobby();
        const heldAt = async (game: 'hokm' | 'ludo') =>
        {
            const id = await lobby.host(game, defaultTable(game), ['sara.k', 'reza.t']);

            lobby.open(id);
            await settle();

            return lobby.table()!.chairs.map((chair) => chair.invited);
        };

        expect(await heldAt('hokm')).toEqual([undefined, 'reza.t', 'sara.k', undefined]);
        expect(await heldAt('ludo')).toEqual([undefined, 'sara.k', 'reza.t', undefined]);
    });

    it('asks for the table the game makes at the seats it finally has, whatever the config it was handed said', async () =>
    {
        const lobby = useLobby();
        const catalogue = useCatalogue();

        expect(catalogue.defaults('hokm')).toMatchObject({ seats: 4, teams: true });
        expect(catalogue.defaults('ludo')).toMatchObject({ seats: 4, teams: false });

        await lobby.host('hokm', catalogue.defaults('hokm'), []);
        await lobby.host('hokm', { ...catalogue.defaults('hokm'), seats: 2 }, []);
        await lobby.host('hokm', { ...catalogue.defaults('hokm'), seats: 4, teams: false }, []);
        await lobby.host('ludo', { ...catalogue.defaults('ludo'), teams: true }, []);
        await lobby.host('ludo', { ...catalogue.defaults('ludo'), seats: 3, teams: true }, []);
        await lobby.host('poker', { ...catalogue.defaults('poker'), teams: true }, []);

        expect(server.asked).toEqual([
            { game: 'hokm', seats: 4, teams: true },
            { game: 'hokm', seats: 2, teams: false },
            { game: 'hokm', seats: 4, teams: true },
            { game: 'ludo', seats: 4, teams: true },
            { game: 'ludo', seats: 3, teams: false },
            { game: 'poker', seats: 6, teams: false }
        ]);
    });

    it('remembers where this account is sitting, across a reload', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('poker', defaultTable('poker'), []);

        expect(lobby.seated().map((table) => table.id)).toEqual([id]);

        await lobby.leave(id, false);
        expect(lobby.seated()).toEqual([]);
    });

    it('asks the server for a seat in one request, and does none of the looking, sitting or starting itself', async () =>
    {
        const lobby = useLobby();
        const theirs = await lobby.host('ludo', { ...defaultTable('ludo'), privacy: 'public' }, []);

        server.tables[0].chairs[0].who = 'sara.k';
        server.tables[0].host = 'sara.k';
        server.calls = [];

        expect(await lobby.quick('ludo')).toBe(theirs);
        expect(written()).toEqual(['tables.quick']);
        expect(server.tables).toHaveLength(1);
        expect(server.tables[0].chairs[1]).toMatchObject({ who: 'alex', ready: true });
        expect(lobby.seated().map((table) => table.id)).toEqual([theirs]);
    });

    it('says the game and who the call is for, and leaves every other choice to the server', async () =>
    {
        const lobby = useLobby();

        await lobby.quick('ludo');
        useSettings().update({ voiceTables: true });
        await lobby.quick('backgammon');

        expect(server.sought).toEqual([{ game: 'ludo', voice: 'off' }, { game: 'backgammon', voice: 'table' }]);
        expect(server.tables.map((table) => [table.game, table.voice, table.mode])).toEqual([['ludo', 'off', 'live'], ['backgammon', 'table', 'live']]);
    });

    it('says what the reader is looking for, and nothing about a choice that was left open', async () =>
    {
        const lobby = useLobby();

        await lobby.quick('backgammon', { target: 3, cube: false });
        await lobby.quick('hokm', { seats: 4, teams: true, mode: 'turns' });
        await lobby.quick('poker', { blinds: 'mid' });
        await lobby.quick('ludo', {});

        expect(server.sought).toEqual([
            { game: 'backgammon', target: 3, cube: false, voice: 'off' },
            { game: 'hokm', seats: 4, teams: true, mode: 'turns', voice: 'off' },
            { game: 'poker', blinds: 'mid', voice: 'off' },
            { game: 'ludo', voice: 'off' }
        ]);
        expect(server.tables.map((table) => [table.game, table.seats, table.mode])).toEqual([['backgammon', 2, 'live'], ['hokm', 4, 'turns'], ['poker', 6, 'live'], ['ludo', 4, 'live']]);
        expect(server.tables[0]).toMatchObject({ target: 3, cube: false });
        expect(server.tables[1]).toMatchObject({ teams: true });
        expect(server.tables[2]).toMatchObject({ blinds: 'mid' });
    });

    it('is seated ready, and is handed a game the server started when it took the last chair', async () =>
    {
        const lobby = useLobby();
        const theirs = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 2, privacy: 'public' }, []);

        server.tables[0].chairs[0].who = 'sara.k';
        server.tables[0].chairs[0].ready = true;
        server.tables[0].host = 'sara.k';
        server.calls = [];

        expect(await lobby.quick('ludo')).toBe(theirs);
        expect(written()).toEqual(['tables.quick']);
        expect(server.tables[0].chairs.map((chair) => chair.ready)).toEqual([true, true]);
        expect(server.tables[0].matchId).toBeDefined();
        expect(lobby.seated().map((table) => table.matchId)).toEqual([server.tables[0].matchId]);
    });

    it('plays again by saying ready, and starts the next game only when nobody is left to say it', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('backgammon', defaultTable('backgammon'), []);

        server.tables[0].chairs[1].who = 'sara.k';
        server.calls = [];

        await lobby.again(id);

        expect(server.tables[0].chairs[0].ready).toBe(true);
        expect(server.calls).toContain('tables.ready');
        expect(server.calls).not.toContain('tables.start');

        server.tables[0].chairs[0].ready = false;
        server.tables[0].chairs[1].ready = true;
        server.calls = [];

        await lobby.again(id);

        expect(server.calls).toEqual(expect.arrayContaining(['tables.ready', 'tables.start']));
    });

    it('opens the smallest table of four or more, or the largest the game plays', () =>
    {
        const catalogue = useCatalogue();

        expect(catalogue.defaults('ludo').seats).toBe(4);
        expect(catalogue.defaults('hokm').seats).toBe(4);
        expect(catalogue.defaults('backgammon').seats).toBe(2);
    });

    it('is given a table to wait at when there is nothing to join, with no table opened by the browser', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.quick('backgammon');

        expect(written()).toEqual(['tables.quick']);
        expect(lobby.seated().map((table) => table.id)).toEqual([id]);
        expect(server.tables[0]).toMatchObject({ host: 'alex', privacy: 'public', seats: 2 });
        expect(server.tables[0].chairs[0]).toMatchObject({ who: 'alex', ready: true });
    });

    it('asks again once the table it found has been opened, and is answered with that table', async () =>
    {
        const lobby = useLobby();
        const first = await lobby.quick('hokm');

        lobby.open(first);

        expect(await lobby.quick('hokm')).toBe(first);
        expect(server.calls.filter((call) => call === 'tables.quick')).toHaveLength(2);
        expect(server.tables).toHaveLength(1);
    });

    it('answers a press between the answer and the table’s page with the table it was given, even with its game already on, and asks nothing', async () =>
    {
        const lobby = useLobby();
        const theirs = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 2, privacy: 'public' }, []);

        server.tables[0].chairs[0].who = 'sara.k';
        server.tables[0].chairs[0].ready = true;
        server.tables[0].host = 'sara.k';

        expect(await lobby.quick('ludo')).toBe(theirs);
        expect(server.tables[0].matchId).toBeDefined();

        server.calls = [];

        expect(await lobby.quick('ludo')).toBe(theirs);
        expect(written()).toEqual([]);
        expect(server.tables).toHaveLength(1);
        expect(server.tables[0].chairs.map((chair) => chair.who)).toEqual(['sara.k', 'alex']);
    });

    it('stops waiting for the table’s page after a while, and asks again on the next press', async () =>
    {
        const lobby = useLobby();
        const first = await lobby.quick('ludo');

        clock.advance(ARRIVAL_MS - 1);

        expect([...lobby.finding()]).toEqual(['ludo']);

        clock.advance(1);

        expect([...lobby.finding()]).toEqual([]);

        server.calls = [];

        expect(await lobby.quick('ludo')).toBe(first);
        expect(written()).toEqual(['tables.quick']);
    });

    it('lets go of every search when it is reset, and of the wait for a page with it', async () =>
    {
        const lobby = useLobby();
        const timers = clock.pending();

        await lobby.quick('ludo');

        expect(clock.pending()).toBe(timers + 1);

        lobby.reset();
        await settle();

        expect([...lobby.finding()]).toEqual([]);
        expect(clock.pending()).toBe(timers);

        server.calls = [];
        await lobby.quick('ludo');

        expect(written()).toEqual(['tables.quick']);
    });

    describe('while a search is out', () =>
    {
        it('answers a second press with the same search, so a double tap is one request', async () =>
        {
            const lobby = useLobby();

            await parked(async (answers) =>
            {
                const first = lobby.quick('ludo');
                const second = lobby.quick('ludo');

                await settle();

                expect(second).toBe(first);
                expect(answers).toHaveLength(1);

                answers[0]();

                expect(await second).toBe(await first);
                expect(server.tables).toHaveLength(1);
                expect(server.calls.filter((call) => call === 'tables.quick')).toHaveLength(1);
            });
        });

        it('is one search for a game whatever the second press asks for, so nobody is seated twice by a slip', async () =>
        {
            const lobby = useLobby();

            await parked(async (answers) =>
            {
                const first = lobby.quick('ludo', { seats: 2 });
                const second = lobby.quick('ludo', { seats: 4 });

                await settle();

                expect(second).toBe(first);
                expect(answers).toHaveLength(1);

                answers[0]();
                await first;

                expect(server.sought).toEqual([{ game: 'ludo', seats: 2, voice: 'off' }]);
                expect(server.tables).toHaveLength(1);
            });
        });

        it('says which game it is finding a seat for, until the table it found has been opened', async () =>
        {
            const lobby = useLobby();

            expect([...lobby.finding()]).toEqual([]);

            await parked(async (answers) =>
            {
                const search = lobby.quick('ludo');

                expect([...lobby.finding()]).toEqual(['ludo']);

                await settle();
                answers[0]();

                const found = await search;

                expect([...lobby.finding()], 'the search was let go before the table’s page had arrived').toEqual(['ludo']);

                lobby.open('some-other-table');

                expect([...lobby.finding()]).toEqual(['ludo']);

                lobby.open(found);

                expect([...lobby.finding()]).toEqual([]);
            });
        });

        it('searches for another game beside it, as a request of its own', async () =>
        {
            const lobby = useLobby();

            await parked(async (answers) =>
            {
                const ludo = lobby.quick('ludo');
                const hokm = lobby.quick('hokm');

                await settle();

                expect(hokm).not.toBe(ludo);
                expect(answers).toHaveLength(2);
                expect([...lobby.finding()].sort()).toEqual(['hokm', 'ludo']);

                answers[1]();
                lobby.open(await hokm);

                expect([...lobby.finding()]).toEqual(['ludo']);

                answers[0]();
                lobby.open(await ludo);

                expect([...lobby.finding()]).toEqual([]);
                expect(server.tables.map((table) => table.game)).toEqual(['hokm', 'ludo']);
            });
        });
    });

    it('stops finding when the server refuses, hands the refusal on, and searches again on the next press', async () =>
    {
        const lobby = useLobby();
        const tables = client.tables as unknown as Record<string, unknown>;
        const real = tables.quick;

        tables.quick = async () =>
        {
            throw new ApiError(422, 'quick-game', 'That game cannot be played right now.', undefined);
        };

        try
        {
            await expect(lobby.quick('ludo')).rejects.toMatchObject({ status: 422, code: 'quick-game' });
        }
        finally
        {
            tables.quick = real;
        }

        expect([...lobby.finding()]).toEqual([]);
        expect(lobby.seated()).toEqual([]);
        expect(await lobby.quick('ludo')).toBe(server.tables[0].id);
    });

    it('calls a full table an answer rather than a failure', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('backgammon', defaultTable('backgammon'), []);

        // Two seats, and the fake gives the second to whoever asks - so asking again finds none.
        server.tables[0].chairs[1].who = 'sara.k';
        server.tables[0].chairs[0].who = 'sara.k';

        const seat = await lobby.claim(id);
        expect(seat).toBeNull();
    });

    it('answers with the chair somebody already holds rather than a second one', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('hokm', defaultTable('hokm'), []);

        expect(await lobby.claim(id)).toBe(0);
        expect(await lobby.claim(id)).toBe(0);
    });

    it('flags only my own chair as ready', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('hokm', defaultTable('hokm'), []);
        lobby.open(id);
        await settle();

        await lobby.ready(id, true);
        await settle();

        const chairs = lobby.table()!.chairs;
        expect(chairs[0].ready).toBe(true);
        expect(chairs.slice(1).every((chair) => !chair.ready)).toBe(true);
    });

    it('closes a table behind the last person out', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('poker', defaultTable('poker'), []);
        lobby.open(id);
        await settle();

        await lobby.leave(id, false);
        await settle();

        expect(server.tables.find((table) => table.id === id)?.status).toBe('closed');
        expect(lobby.openId()).toBe('');
    });

    it('says whether a leave may forfeit, exactly as its caller did', async () =>
    {
        const lobby = useLobby();
        const waiting = await lobby.host('poker', defaultTable('poker'), []);
        const playing = await lobby.host('backgammon', defaultTable('backgammon'), []);

        server.tables.find((table) => table.id === playing)!.matchId = 'live-1';
        server.calls = [];

        await lobby.leave(waiting, false);
        await lobby.leave(playing, true);

        expect(server.calls.filter((call) => call.startsWith('tables.leave'))).toEqual(['tables.leave', 'tables.leave:forfeit']);
        expect(lobby.seated()).toEqual([]);
    });

    it('is still at a table whose game began before a leave that may not forfeit it', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('backgammon', defaultTable('backgammon'), []);
        const held = server.tables.find((table) => table.id === id)!;

        lobby.open(id);
        await settle();

        held.chairs[1].who = 'sara.k';
        held.matchId = 'live-1';

        await expect(lobby.leave(id, false)).rejects.toMatchObject({ status: 409, code: 'playing' });
        await settle();

        expect(held.chairs.map((chair) => chair.who)).toEqual(['alex', 'sara.k']);
        expect(lobby.openId()).toBe(id);
        expect(lobby.seated().map((table) => table.id)).toEqual([id]);
    });

    it('calls a table nobody opened an answer, not a failure', async () =>
    {
        const lobby = useLobby();
        lobby.open('table-nope');
        await settle();

        expect(lobby.table()).toBeNull();
        expect(lobby.failed() ?? null).toBeNull();
    });

    describe('a host taking somebody out of a chair', () =>
    {
        const hosting = async () =>
        {
            const lobby = useLobby();
            const id = await lobby.host('ludo', defaultTable('ludo'), []);
            const held = server.tables.find((table) => table.id === id)!;

            held.chairs[1].who = 'sara.k';
            lobby.open(id);
            await settle();
            server.calls = [];

            return { lobby, id, held };
        };

        it('is one request naming them, after which the table is read again and their chair is empty', async () =>
        {
            const { lobby, id } = await hosting();

            expect(lobby.table()!.chairs.map((chair) => chair.who)).toEqual(['alex', 'sara.k', undefined, undefined]);

            await lobby.remove(id, 'sara.k');
            await settle();

            expect(written()).toEqual(['tables.remove']);
            expect(server.calls).toContain('tables.view');
            expect(lobby.table()!.chairs.map((chair) => chair.who)).toEqual(['alex', undefined, undefined, undefined]);
            expect(lobby.table()!.taken).toBe(1);
            expect(server.keptOut[id]).toEqual(['sara.k']);
        });

        it('hands a refusal on to whoever asked, and leaves the chair as it was', async () =>
        {
            const { lobby, id, held } = await hosting();

            held.matchId = 'live-1';

            await expect(lobby.remove(id, 'sara.k')).rejects.toMatchObject({ status: 409, code: 'playing' });
            await expect(lobby.remove(id, 'nobody-sitting-here')).rejects.toMatchObject({ status: 409, code: 'playing' });

            delete held.matchId;

            await expect(lobby.remove(id, 'nobody-sitting-here')).rejects.toMatchObject({ status: 404, code: 'not-found' });
            expect(held.chairs[1].who).toBe('sara.k');
            expect(server.keptOut[id]).toBeUndefined();
        });
    });

    describe('somebody a host took out of a chair', () =>
    {
        const guestAt = async (privacy: 'public' | 'friends' | 'room' | 'invite') =>
        {
            const lobby = useLobby();
            const id = await lobby.host('ludo', { ...defaultTable('ludo'), privacy }, []);
            const held = server.tables.find((table) => table.id === id)!;

            held.host = 'sara.k';
            held.chairs[0].who = 'sara.k';
            held.chairs[1].who = 'alex';
            await lobby.refresh();
            lobby.open(id);
            await settle();

            expect(lobby.table()?.mine).toBe(1);

            delete held.chairs[1].who;
            server.keptOut[id] = ['alex'];
            server.calls = [];

            return { lobby, id, held };
        };

        it.each(['public', 'friends', 'room'] as const)('reads a %s table again when it is rung, and is told there that the host took them out', async (privacy) =>
        {
            const { lobby, id } = await guestAt(privacy);

            await lobby.refresh();
            await settle();

            expect(server.calls).toContain('tables.view');
            expect(lobby.table()?.id).toBe(id);
            expect(lobby.table()?.removed).toBe(true);
            expect(lobby.table()?.mine).toBeUndefined();
            expect(lobby.seated()).toEqual([]);
        });

        it('asks nothing more about a table by invitation, which they can no longer see', async () =>
        {
            const { lobby } = await guestAt('invite');

            await lobby.refresh();
            await lobby.refresh();
            await settle();

            expect(server.calls).not.toContain('tables.view');
            expect(lobby.table()).toBeNull();
            expect(lobby.failed() ?? null).toBeNull();
        });

        it('asks about it again once the page is opened again, as an invitation leads them to do', async () =>
        {
            const { lobby, id, held } = await guestAt('invite');

            await lobby.refresh();
            await settle();

            expect(lobby.table()).toBeNull();

            server.keptOut[id] = [];
            held.chairs[1].invited = 'alex';
            lobby.open(id);

            await vi.waitFor(() => expect(lobby.table()?.id).toBe(id));

            expect(lobby.table()?.removed).toBeUndefined();
            expect(lobby.table()?.chairs[1].invited).toBe('alex');
        });

        it('still asks nothing more about a table for their friends that its own host lost the chair at', async () =>
        {
            const lobby = useLobby();
            const id = await lobby.host('ludo', { ...defaultTable('ludo'), privacy: 'friends' }, []);
            const held = server.tables.find((table) => table.id === id)!;

            held.chairs[1].who = 'sara.k';
            lobby.open(id);
            await settle();

            delete held.chairs[0].who;
            server.calls = [];

            await lobby.refresh();
            await settle();

            expect(server.calls).not.toContain('tables.view');
            expect(lobby.table()).toBeNull();
        });
    });

    it('re-reads itself when the table doorbell rings', async () =>
    {
        const lobby = useLobby();
        const stop = lobby.start();

        useRealtime().start();
        socket.accept();
        await lobby.host('hokm', defaultTable('hokm'), []);
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'table', id: 'table-1', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('tables.mine');
        stop();
    });

    it('counts only the tables that are waiting on this account', async () =>
    {
        const lobby = useLobby();
        const first = await lobby.host('hokm', defaultTable('hokm'), []);
        await lobby.host('ludo', defaultTable('ludo'), []);

        server.tables.find((table) => table.id === first)!.yourTurn = true;
        await lobby.refresh();
        await settle();

        expect(lobby.seated().length).toBe(2);
        expect(lobby.waiting().map((table) => table.id)).toEqual([first]);
    });

    it('re-reads where it is sitting when a game it plays moves', async () =>
    {
        const lobby = useLobby();
        const stop = lobby.start();

        useRealtime().start();
        socket.accept();
        await lobby.host('ludo', defaultTable('ludo'), []);
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'game', id: 'some-match', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('tables.mine');
        stop();
    });
});

describe('what the reader did at a table, shown before the server has said so', () =>
{
    const routes = client.tables as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const holding = async (verb: string, run: (out: { asked: unknown[]; answer: () => void }) => Promise<void>) =>
    {
        const real = routes[verb];
        const asked: unknown[] = [];
        const waiting: (() => void)[] = [];
        let owed = 0;

        const answer = () =>
        {
            const next = waiting.shift();

            if (next === undefined)
            {
                owed += 1;
            }
            else
            {
                next();
            }
        };

        routes[verb] = async (input) =>
        {
            asked.push(input);

            if (owed > 0)
            {
                owed -= 1;
            }
            else
            {
                await new Promise<void>((resolve) =>
                {
                    waiting.push(resolve);
                });
            }

            return await real(input);
        };

        try
        {
            await run({ asked, answer });
        }
        finally
        {
            routes[verb] = real;
        }
    };

    const answering = async (verb: string, answer: (input: unknown) => Promise<unknown>, run: () => Promise<void>) =>
    {
        const real = routes[verb];

        routes[verb] = answer;

        try
        {
            await run();
        }
        finally
        {
            routes[verb] = real;
        }
    };

    const view = routes.view;

    const seated = async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 2, privacy: 'public' }, []);
        const row = server.tables.find((table) => table.id === id)!;

        row.chairs[1].who = 'sara.k';
        lobby.open(id);
        await lobby.refresh();
        await settle();

        return { lobby, id, row };
    };

    const mine = (lobby: ReturnType<typeof useLobby>) => lobby.table()!.chairs[0].ready;

    it('says ready in the same turn as the press, while the request is still out', async () =>
    {
        const { lobby, id, row } = await seated();

        await holding('ready', async ({ asked, answer }) =>
        {
            const said = lobby.ready(id, true);

            expect(mine(lobby)).toBe(true);
            expect(lobby.table()!.chairs[1].ready).toBe(false);

            await settle();
            expect(asked).toEqual([{ params: { id }, input: { ready: true } }]);
            expect(row.chairs[0].ready).toBe(false);
            expect(mine(lobby)).toBe(true);

            answer();
            await said;

            expect(row.chairs[0].ready).toBe(true);
            expect(mine(lobby)).toBe(true);
        });
    });

    it('goes on saying it through a read of the table that lands while the request is out', async () =>
    {
        const { lobby, id } = await seated();

        await holding('ready', async ({ answer }) =>
        {
            const said = lobby.ready(id, true);

            await lobby.refresh();
            await settle();
            expect(mine(lobby)).toBe(true);

            answer();
            await said;
            expect(mine(lobby)).toBe(true);
        });
    });

    it('goes back to what the server holds, and hands the refusal on, when the server says no', async () =>
    {
        const { lobby, id } = await seated();
        const refusal = new ApiError(409, 'table-closed', 'That table has closed.', undefined);

        await answering('ready', async () =>
        {
            throw refusal;
        }, async () =>
        {
            const said = lobby.ready(id, true);

            expect(mine(lobby)).toBe(true);
            await expect(said).rejects.toBe(refusal);
            expect(mine(lobby)).toBe(false);
        });
    });

    it('sends two presses one after the other, in the order they were made, and ends on the last', async () =>
    {
        const { lobby, id, row } = await seated();

        await holding('ready', async ({ asked, answer }) =>
        {
            const on = lobby.ready(id, true);
            const off = lobby.ready(id, false);

            await settle();
            expect(mine(lobby)).toBe(false);
            expect(asked).toEqual([{ params: { id }, input: { ready: true } }]);

            answer();
            await on;
            await settle();
            expect(asked).toEqual([{ params: { id }, input: { ready: true } }, { params: { id }, input: { ready: false } }]);
            expect(row.chairs[0].ready).toBe(true);
            expect(mine(lobby)).toBe(false);

            answer();
            await off;
            expect(row.chairs[0].ready).toBe(false);
            expect(mine(lobby)).toBe(false);
        });
    });

    it('sends the second press though the first was refused', async () =>
    {
        const { lobby, id, row } = await seated();
        let turn = 0;
        const real = routes.ready;

        await answering('ready', async (input) =>
        {
            turn += 1;

            if (turn === 1)
            {
                throw new ApiError(502, 'bad-gateway', 'No answer.', undefined);
            }

            return await real(input);
        }, async () =>
        {
            const first = lobby.ready(id, true);
            const second = lobby.ready(id, true);

            await expect(first).rejects.toThrow('No answer.');
            await second;
            expect(row.chairs[0].ready).toBe(true);
            expect(mine(lobby)).toBe(true);
        });
    });

    it('touches the chair of the table that was pressed and no other', async () =>
    {
        const { lobby, id } = await seated();
        const other = await lobby.host('hokm', defaultTable('hokm'), []);

        await holding('ready', async ({ answer }) =>
        {
            const said = lobby.ready(other, true);

            expect(lobby.table()!.id).toBe(id);
            expect(lobby.table()!.chairs.map((chair) => chair.ready)).toEqual([false, false]);

            answer();
            await said;
        });
    });

    it('is the table itself while nothing is out, so nothing is drawn again for it', async () =>
    {
        const { lobby, id } = await seated();
        const before = lobby.table();

        expect(lobby.table()).toBe(before);

        await lobby.ready(id, true);
        await settle();

        const after = lobby.table();

        expect(lobby.table()).toBe(after);
        expect(after!.chairs[0].ready).toBe(true);
    });

    it('plays again by saying ready at once', async () =>
    {
        const { lobby, id, row } = await seated();

        await holding('ready', async ({ answer }) =>
        {
            const said = lobby.again(id);

            expect(mine(lobby)).toBe(true);
            await settle();
            expect(row.chairs[0].ready).toBe(false);

            answer();
            await said;
            expect(row.chairs[0].ready).toBe(true);
            expect(mine(lobby)).toBe(true);
        });
    });

    it('says who is waited for when the table it holds is still the one from before the game ended', async () =>
    {
        const { lobby, id, row } = await seated();

        row.matchId = 'the-game-that-ended';
        row.yourTurn = true;
        row.chairs[0].ready = true;
        row.chairs[1].ready = true;

        await answering('view', async (input) =>
        {
            const read = await view(input) as TableSummary;

            return read.matchId === undefined ? read : { ...read, status: 'playing' };
        }, async () =>
        {
            await lobby.refresh();
            await settle();
            expect(lobby.table()).toMatchObject({ matchId: 'the-game-that-ended', status: 'playing', yourTurn: true });

            await holding('ready', async ({ answer }) =>
            {
                const said = lobby.again(id, 'the-game-that-ended');
                const shown = lobby.table()!;

                expect(shown.matchId).toBeUndefined();
                expect(shown.yourTurn).toBeUndefined();
                expect(shown.status).toBe('ready');
                expect(shown.chairs.map((chair) => chair.ready)).toEqual([true, false]);
                expect(shown.chairs.map((chair) => chair.who)).toEqual(['alex', 'sara.k']);

                delete row.matchId;
                delete row.yourTurn;
                row.chairs[0].ready = false;
                row.chairs[1].ready = false;
                answer();
                await said;

                expect(lobby.table()!.matchId).toBeUndefined();
                expect(lobby.table()!.chairs.map((chair) => chair.ready)).toEqual([true, false]);
            });
        });
    });

    it('says a chair is free where somebody left the table the game ended at', async () =>
    {
        const { lobby, id, row } = await seated();

        row.matchId = 'the-game-that-ended';
        row.chairs[0].ready = true;
        delete row.chairs[1].who;
        await lobby.refresh();
        await settle();

        await holding('ready', async ({ answer }) =>
        {
            const said = lobby.again(id, 'the-game-that-ended');

            expect(lobby.table()).toMatchObject({ status: 'open', taken: 1 });
            expect(lobby.table()!.matchId).toBeUndefined();
            expect(lobby.table()!.chairs.map((chair) => chair.ready)).toEqual([true, false]);

            delete row.matchId;
            answer();
            await said;
        });
    });

    it('takes a table that names another game as it stands, and only says the reader is ready', async () =>
    {
        const { lobby, id, row } = await seated();

        row.matchId = 'a-game-still-on';
        row.chairs[1].ready = true;
        await lobby.refresh();
        await settle();

        await holding('ready', async ({ answer }) =>
        {
            const said = lobby.again(id, 'the-game-that-ended');

            expect(lobby.table()).toMatchObject({ matchId: 'a-game-still-on' });
            expect(lobby.table()!.chairs.map((chair) => chair.ready)).toEqual([true, true]);

            answer();
            await said.catch(() => undefined);
        });
    });

    it('keeps what was pressed when the request went through and the table could not be read again, until it can', async () =>
    {
        const { lobby, id, row } = await seated();

        await answering('view', async () =>
        {
            throw new ApiError(502, 'bad-gateway', 'No answer.', undefined);
        }, async () =>
        {
            await lobby.ready(id, true);
            expect(mine(lobby)).toBe(true);

            await lobby.refresh();
            await settle();
        });

        expect(row.chairs[0].ready).toBe(true);
        expect(mine(lobby)).toBe(true);

        row.chairs[0].ready = false;
        await lobby.refresh();
        await settle();
        expect(mine(lobby)).toBe(false);
    });

    it('forgets what was pressed when the store is reset', async () =>
    {
        const { lobby, id } = await seated();

        await holding('ready', async ({ asked, answer }) =>
        {
            const said = lobby.ready(id, true);

            await settle();
            lobby.reset();
            lobby.open(id);
            await vi.waitFor(() => expect(lobby.table()?.id).toBe(id));
            expect(mine(lobby)).toBe(false);

            const after = lobby.ready(id, true);

            await settle();
            expect(asked).toHaveLength(2);

            answer();
            answer();
            await said.catch(() => undefined);
            await after;
        });
    });
});
