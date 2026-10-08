import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter } from 'azerothjs';

import QuickFinder from '../src/components/games/quick-finder.component.azeroth';
import type { GameId } from '../src/data/games.ts';
import { TABLE_RULES } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { fitted, recallAsk, rememberAsk } from '../src/lib/quick-asks.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
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

const opened = (game: GameId) =>
{
    const closed: unknown[] = [];
    const router = createRouter({
        routes: [
            {
                path: '/',
                component: () => QuickFinder({
                    overlayId: 'quick-finder',
                    close: (result?: unknown) =>
                    {
                        closed.push(result);
                    },
                    game
                }) as HTMLElement
            },
            { path: '/app/play/:id', component: () => document.createElement('div') }
        ],
        history: createMemoryHistory('/'),
        scroll: false
    });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement);

    return { container, router, closed };
};

const group = (container: HTMLElement, legend: string) =>
    [...container.querySelectorAll<HTMLFieldSetElement>('fieldset')].find((one) => one.querySelector('legend')?.textContent?.trim() === legend) ?? null;

const offered = (container: HTMLElement, legend: string) =>
    [...(group(container, legend)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((one) => one.textContent?.trim() ?? '');

const chosen = (container: HTMLElement, legend: string) =>
    [...(group(container, legend)?.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]') ?? [])].map((one) => one.textContent?.trim() ?? '');

const press = async (container: HTMLElement, legend: string, name: string) =>
{
    const button = [...(group(container, legend)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((one) => one.textContent?.trim() === name);

    expect(button, `${ legend }: ${ name }`).toBeDefined();
    fire(button!, 'click');
    await settle();
};

const finder = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === useLocale().t('quickMatch.find'))!;

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
    setRuntime({ clock: manualClock(2_500_000), seed: 21 });
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

describe('what somebody was last looking for', () =>
{
    it('is kept as far as the game still makes such a table, and no further', () =>
    {
        const held = { seats: 4, teams: true, mode: 'turns', target: 13 };

        expect(fitted(held, TABLE_RULES.hokm)).toEqual({ seats: 4, teams: true, mode: 'turns', target: 13 });
        expect(fitted(held, TABLE_RULES.poker), 'a table poker does not make was asked for').toEqual({});
        expect(fitted({ seats: 6, teams: false, blinds: 'mid' }, TABLE_RULES.poker)).toEqual({ seats: 6, teams: false, blinds: 'mid' });
        expect(fitted({ seats: 6, blinds: 'mid' }, TABLE_RULES.poker), 'a size with no word about sides is half a table').toEqual({ blinds: 'mid' });
        expect(fitted({ seats: 'four', teams: 'yes', mode: 'fast', target: '7', cube: 'on', blinds: 'huge' }, TABLE_RULES.hokm)).toEqual({});
        expect(fitted({ blinds: 'mid', cube: true }, TABLE_RULES.ludo), 'blinds and a cube at a game with neither').toEqual({});
    });

    it('has no cube in a game to one point, where there is nothing to double', () =>
    {
        expect(fitted({ target: 1, cube: true }, TABLE_RULES.backgammon)).toEqual({ target: 1 });
        expect(fitted({ target: 1, cube: false }, TABLE_RULES.backgammon)).toEqual({ target: 1 });
        expect(fitted({ target: 3, cube: false }, TABLE_RULES.backgammon)).toEqual({ target: 3, cube: false });
        expect(fitted({ cube: true }, TABLE_RULES.backgammon)).toEqual({ cube: true });
    });

    it('is remembered for each game by itself, with the device’s other settings, and goes when they are reset', () =>
    {
        rememberAsk('ludo', { seats: 2, teams: false });
        rememberAsk('backgammon', { target: 5 });

        expect(recallAsk('ludo', TABLE_RULES.ludo)).toEqual({ seats: 2, teams: false });
        expect(recallAsk('backgammon', TABLE_RULES.backgammon)).toEqual({ target: 5 });
        expect(recallAsk('hokm', TABLE_RULES.hokm)).toEqual({});
        expect(useSettings().settings().quickAsks).toEqual({ ludo: { seats: 2, teams: false }, backgammon: { target: 5 } });

        useSettings().reset();

        expect(recallAsk('ludo', TABLE_RULES.ludo)).toEqual({});
    });

    it('reads whatever else is found where it is kept as nothing chosen', () =>
    {
        useSettings().update({ quickAsks: ['not', 'what', 'was', 'kept'] as unknown as Record<string, unknown> });

        expect(recallAsk('ludo', TABLE_RULES.ludo)).toEqual({});

        useSettings().update({ quickAsks: { ludo: 'two', backgammon: null } });

        expect(recallAsk('ludo', TABLE_RULES.ludo)).toEqual({});
        expect(recallAsk('backgammon', TABLE_RULES.backgammon)).toEqual({});

        rememberAsk('ludo', { seats: 3, teams: false });

        expect(recallAsk('ludo', TABLE_RULES.ludo)).toEqual({ seats: 3, teams: false });
    });
});

describe('the sheet that asks what to look for', () =>
{
    const any = () => useLocale().t('quickMatch.any');

    it('offers each table the game makes, with nothing chosen until somebody chooses', async () =>
    {
        const { container } = opened('hokm');

        await settle();

        expect(offered(container, 'Seats')).toEqual([any(), '2 players', '3 players', '2 v 2']);
        expect(chosen(container, 'Seats')).toEqual([any()]);
        expect(offered(container, 'Play to')).toEqual([any(), '7 hands', '13 hands']);
        expect(chosen(container, 'Play to')).toEqual([any()]);
        expect(chosen(container, 'Pace')).toEqual(['Live']);
        expect(group(container, 'Doubling cube'), 'a cube at a card game').toBeNull();
        expect(group(container, 'Blinds')).toBeNull();
    });

    it('offers only what each game has: a cube and a length at backgammon, blinds at poker, and no pace where there is one', async () =>
    {
        const backgammon = opened('backgammon').container;

        await settle();

        expect(group(backgammon, 'Seats'), 'a choice of one').toBeNull();
        expect(offered(backgammon, 'Play to')).toEqual([any(), '1 point', '3 points', '5 points']);
        expect(offered(backgammon, 'Doubling cube')).toEqual([any(), useLocale().t('quickMatch.cube.on'), useLocale().t('quickMatch.cube.off')]);

        cleanup();

        const poker = opened('poker').container;

        await settle();

        expect(offered(poker, 'Seats')).toEqual([any(), '2 players', '6 players', '9 players']);
        expect(offered(poker, 'Blinds')).toEqual([any(), 'Low', 'Mid', 'High']);
        expect(group(poker, 'Pace'), 'a pace was offered where the game has one').toBeNull();
        expect(group(poker, 'Play to')).toBeNull();
    });

    it('asks for exactly what was chosen, goes to the table it is given and closes behind itself', async () =>
    {
        const { container, router, closed } = opened('ludo');

        await settle();
        await press(container, useLocale().t('quickMatch.game'), 'Hokm');
        await press(container, 'Seats', '2 v 2');
        await press(container, 'Pace', 'Turn-based');
        await press(container, 'Play to', '13 hands');

        expect(chosen(container, 'Seats')).toEqual(['2 v 2']);
        expect(chosen(container, 'Play to')).toEqual(['13 hands']);

        fire(finder(container), 'click');

        await vi.waitFor(() => expect(router.location().pathname).toBe(`/app/play/${ server.tables[0]?.id }`), { timeout: 4000 });

        expect(server.sought).toEqual([{ game: 'hokm', seats: 4, teams: true, mode: 'turns', target: 13, voice: 'off' }]);
        expect(server.tables[0]).toMatchObject({ game: 'hokm', seats: 4, teams: true, mode: 'turns', target: 13, privacy: 'public' });
        expect(closed).toEqual([true]);
    });

    it('asks for nothing that was left at Any', async () =>
    {
        const { container, router } = opened('backgammon');

        await settle();
        fire(finder(container), 'click');

        await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//), { timeout: 4000 });

        expect(server.sought).toEqual([{ game: 'backgammon', voice: 'off' }]);
    });

    it('takes a choice back when Any is pressed again', async () =>
    {
        const { container, router } = opened('ludo');

        await settle();
        await press(container, 'Seats', '2 players');
        await press(container, 'Seats', any());

        expect(chosen(container, 'Seats')).toEqual([any()]);

        fire(finder(container), 'click');

        await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//), { timeout: 4000 });

        expect(server.sought).toEqual([{ game: 'ludo', voice: 'off' }]);
    });

    it('has no cube to ask about in a game to one point, and lets go of one that had been chosen', async () =>
    {
        const { container, router } = opened('backgammon');

        await settle();
        await press(container, 'Doubling cube', useLocale().t('quickMatch.cube.on'));
        await press(container, 'Play to', '1 point');

        expect(group(container, 'Doubling cube'), 'a cube was offered where it can never be turned').toBeNull();

        fire(finder(container), 'click');

        await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//), { timeout: 4000 });

        expect(server.sought).toEqual([{ game: 'backgammon', target: 1, voice: 'off' }]);
        expect(server.tables[0]).toMatchObject({ target: 1, cube: false });
    });

    it('opens on what the reader looked for last time at that game, and on each game’s own when the game is changed', async () =>
    {
        rememberAsk('ludo', { seats: 2, teams: false });
        rememberAsk('backgammon', { target: 5, cube: false });

        const { container } = opened('ludo');

        await settle();

        expect(chosen(container, 'Seats')).toEqual(['2 players']);

        await press(container, useLocale().t('quickMatch.game'), 'Backgammon');

        expect(chosen(container, 'Play to')).toEqual(['5 points']);
        expect(chosen(container, 'Doubling cube')).toEqual([useLocale().t('quickMatch.cube.off')]);

        await press(container, useLocale().t('quickMatch.game'), 'Hokm');

        expect(chosen(container, 'Seats')).toEqual([any()]);
    });

    it('remembers what was asked for, for the next time', async () =>
    {
        const { container, router } = opened('ludo');

        await settle();
        await press(container, 'Seats', '3 players');
        fire(finder(container), 'click');

        await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//), { timeout: 4000 });

        expect(recallAsk('ludo', TABLE_RULES.ludo)).toEqual({ seats: 3, teams: false });
    });

    it('is one request however often it is pressed, and says it is finding a seat while that is out', async () =>
    {
        const { container, router } = opened('ludo');

        await settle();

        const button = finder(container);

        await parked(async (answers) =>
        {
            fire(button, 'click');
            fire(button, 'click');
            await settle();

            expect(button.getAttribute('aria-busy')).toBe('true');
            expect([...container.querySelectorAll('[role="status"]')].map((one) => one.textContent)).toContain(useLocale().t('quickMatch.busy'));
            expect(answers).toHaveLength(1);

            answers[0]();

            await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//), { timeout: 4000 });
        });

        expect(server.calls.filter((call) => call === 'tables.quick')).toHaveLength(1);
    });

    it('keeps what was asked for while the search is out: the choices do nothing until it has been answered', async () =>
    {
        const { container, router } = opened('ludo');

        await settle();
        await press(container, 'Seats', '2 players');

        await parked(async (answers) =>
        {
            fire(finder(container), 'click');
            await settle();

            const held = group(container, 'Seats')!.parentElement!;

            expect(held.hasAttribute('inert'), 'the choices could still be changed under a search that was already out').toBe(true);

            await press(container, 'Seats', '4 players');
            await press(container, useLocale().t('quickMatch.game'), 'Hokm');

            expect(chosen(container, 'Seats')).toEqual(['2 players']);
            expect(chosen(container, useLocale().t('quickMatch.game'))).toEqual(['Ludo']);

            answers[0]();

            await vi.waitFor(() => expect(router.location().pathname).toMatch(/^\/app\/play\//), { timeout: 4000 });
        });

        expect(server.sought).toEqual([{ game: 'ludo', seats: 2, teams: false, voice: 'off' }]);
        expect(recallAsk('ludo', TABLE_RULES.ludo)).toEqual({ seats: 2, teams: false });
    });

    it('opens busy on a game whose search is still out, and neither sends nor remembers a second ask for it', async () =>
    {
        await parked(async (answers) =>
        {
            const first = useLobby().quick('ludo', { seats: 2, teams: false });

            await settle();

            const { container } = opened('ludo');

            await settle();

            expect(finder(container).getAttribute('aria-busy')).toBe('true');

            await press(container, 'Seats', '4 players');
            fire(finder(container), 'click');
            await settle();

            expect(answers, 'a second search for the game went out beside the first').toHaveLength(1);
            expect(recallAsk('ludo', TABLE_RULES.ludo), 'an ask that was never sent was remembered as the last one').toEqual({});

            answers[0]();
            await first;
        });
    });

    it('stays open with its button back when the search is refused, and says why', async () =>
    {
        const { container, router, closed } = opened('ludo');
        const tables = client.tables as unknown as Record<string, (input: unknown) => Promise<unknown>>;
        const real = tables.quick;

        await settle();

        tables.quick = async () =>
        {
            throw new ApiError(422, 'quick-options', 'That is not a table this game makes.', undefined);
        };

        try
        {
            fire(finder(container), 'click');

            await vi.waitFor(() => expect(useToasts().items().map((toast) => [toast.kind, toast.text])).toEqual([['warning', useLocale().t('tables.refused.quick-options')]]), { timeout: 4000 });
            await settle();

            expect(finder(container).getAttribute('aria-busy')).not.toBe('true');
            expect(router.location().pathname).toBe('/');
            expect(closed).toEqual([]);
        }
        finally
        {
            tables.quick = real;
        }
    });

    it('asks in Persian too', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = opened('backgammon');

        await settle();

        const said = container.textContent ?? '';

        for (const key of ['quickMatch.title', 'quickMatch.lead', 'quickMatch.game', 'quickMatch.any', 'quickMatch.find', 'quickMatch.cube.on', 'quickMatch.cube.off'] as const)
        {
            expect(said, key).toContain(useLocale().t(key));
        }

        expect(said).not.toContain('Find a game');
    });
});
