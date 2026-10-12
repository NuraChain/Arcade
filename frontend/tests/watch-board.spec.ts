import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import WatchBoard from '../src/components/games/watch-board.component.azeroth';
import type { BoardProps } from '../src/components/games/boards.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import type { Watched } from '../src/stores/watch.store.ts';

type Rendered = Parameters<typeof renderTest>[0] extends () => infer R ? R : never;

const handed = vi.hoisted(() => ({ boards: [] as unknown[], told: [] as number[] }));

vi.mock('../src/components/games/match-board.component.azeroth', async () =>
{
    const { createEffect } = await import('azerothjs');

    return {
        default: (props: { events: { seq: number } }) =>
        {
            const drawn = document.createElement('div');

            drawn.dataset.stub = 'board';
            handed.boards.push(props);
            createEffect(() =>
            {
                handed.told.push(props.events.seq);
            });

            return drawn;
        }
    };
});

const watching = (rev: number, live = true) => ({
    match: {
        id: 'watched',
        tableId: 'somewhere',
        game: 'ludo',
        rev,
        seats: 2,
        players: [],
        turn: 0,
        startedAt: new Date(400_000).toISOString(),
        view: { kind: 'ludo', moves: [], controls: 0, seats: [] }
    },
    behind: live ? 30 : 0,
    delay: 30,
    live
} as Watched);

const batchOf = (seq: number, ...revs: number[]): EventBatch => ({
    seq,
    id: 'watched',
    events: revs.map((rev) => ({ rev, seat: 0, at: new Date(400_000).toISOString(), log: { kind: 'ludo', moves: [] } } as unknown as MatchEvent)),
    live: true,
    jump: false
});

const boards = () => handed.boards as BoardProps[];

beforeEach(() =>
{
    cleanup();
    handed.boards.length = 0;
    handed.told.length = 0;
    useLocale().setLocale('en');
});

describe('the board of somebody watching', () =>
{
    it('is handed the game and the events its watcher was handed, and goes on being handed the later ones', async () =>
    {
        const first = batchOf(1, 1);
        const second = batchOf(2, 2, 3);
        const [watch, setWatch] = createSignal(watching(1));
        const [events, setEvents] = createSignal(first);

        const { container } = renderTest(() => WatchBoard({
            get watch()
            {
                return watch();
            },
            get events()
            {
                return events();
            }
        }) as Rendered);

        await vi.waitFor(() => expect(container.querySelector('[data-stub="board"]')).not.toBeNull(), { timeout: 4000 });

        const drawn = container.querySelector('[data-stub="board"]');

        expect(boards()).toHaveLength(1);
        expect(boards()[0].events).toBe(first);
        expect(boards()[0].match.rev).toBe(1);

        setEvents(second);
        await Promise.resolve();

        expect(handed.told, 'a board that follows its events was not told of the later ones').toEqual([1, 2]);
        expect(boards()[0].events).toBe(second);

        setWatch(watching(3));

        expect(boards()[0].events).toBe(second);
        expect(boards()[0].match.rev).toBe(3);
        expect(container.querySelector('[data-stub="board"]'), 'the board was drawn again to be told of a move').toBe(drawn);
        expect(boards()).toHaveLength(1);
    });

    it('is handed nobody\'s seat, nothing to play again with, and no clock', async () =>
    {
        const { container } = renderTest(() => WatchBoard({ watch: watching(1), events: NO_EVENTS }) as Rendered);

        await vi.waitFor(() => expect(container.querySelector('[data-stub="board"]')).not.toBeNull(), { timeout: 4000 });

        expect(Object.keys(boards()[0]).sort()).toEqual(['events', 'match', 'onPresenting']);
        expect(boards()[0].match.mine).toBeUndefined();
    });

    it('offers the way back to the table once the game is over, and not before', async () =>
    {
        const left = vi.fn();
        const [watch, setWatch] = createSignal(watching(3));
        const back = (container: HTMLElement) => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('watch.back'));

        const { container } = renderTest(() => WatchBoard({
            get watch()
            {
                return watch();
            },
            events: NO_EVENTS,
            onDone: left
        }) as Rendered);

        await vi.waitFor(() => expect(container.querySelector('[data-stub="board"]')).not.toBeNull(), { timeout: 4000 });

        const drawn = container.querySelector('[data-stub="board"]');

        expect(back(container)).toBeUndefined();
        expect(container.textContent).toContain(useLocale().t('watch.title'));

        setWatch(watching(5, false));

        expect(container.textContent).toContain(useLocale().t('watch.finished'));
        expect(container.querySelector('[data-stub="board"]'), 'the board was drawn again when its game ended').toBe(drawn);

        fire(back(container)!, 'click');

        expect(left).toHaveBeenCalledTimes(1);
    });

    it('does not say the game is over, or offer the way back, while the board is still showing how it ended', async () =>
    {
        const [watch, setWatch] = createSignal(watching(3));
        const back = (container: HTMLElement) => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === useLocale().t('watch.back'));

        const { container } = renderTest(() => WatchBoard({
            get watch()
            {
                return watch();
            },
            events: NO_EVENTS,
            onDone: () => undefined
        }) as Rendered);

        await vi.waitFor(() => expect(container.querySelector('[data-stub="board"]')).not.toBeNull(), { timeout: 4000 });

        boards()[0].onPresenting?.(true);
        setWatch(watching(5, false));
        await Promise.resolve();

        expect(container.textContent, 'the end was told while its last moves were still being played').toContain(useLocale().t('watch.title'));
        expect(container.textContent).toContain(useLocale().t('watch.why'));
        expect(container.textContent).not.toContain(useLocale().t('watch.finished'));
        expect(back(container), 'the way back was offered under a scene still playing').toBeUndefined();

        boards()[0].onPresenting?.(false);
        await Promise.resolve();

        expect(container.textContent).toContain(useLocale().t('watch.finished'));
        expect(container.textContent, 'a finished game was still explained as a delayed one').not.toContain(useLocale().t('watch.why'));
        expect(back(container)).toBeDefined();
    });

    it('offers no way back to somebody who was handed none', async () =>
    {
        const { container } = renderTest(() => WatchBoard({ watch: watching(5, false), events: NO_EVENTS }) as Rendered);

        await vi.waitFor(() => expect(container.querySelector('[data-stub="board"]')).not.toBeNull(), { timeout: 4000 });

        expect([...container.querySelectorAll('button')].map((one) => one.textContent?.trim())).not.toContain(useLocale().t('watch.back'));
    });

    it.each([
        ['en', 'Back to the table'],
        ['fa', 'برگشت به میز']
    ] as const)('says the way back in %s', async (language, words) =>
    {
        useLocale().setLocale(language);

        const { container } = renderTest(() => WatchBoard({ watch: watching(5, false), events: NO_EVENTS, onDone: () => undefined }) as Rendered);

        await vi.waitFor(() => expect(container.querySelector('[data-stub="board"]')).not.toBeNull(), { timeout: 4000 });

        expect(container.textContent).toContain(words);
    });
});
