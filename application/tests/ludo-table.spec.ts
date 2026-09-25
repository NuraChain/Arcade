import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import MatchBoard from '../src/components/games/match-board.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';
import { client } from './fake-api.ts';

type Rendered = HTMLElement;

type Ludo = Extract<MatchView['view'], { kind: 'ludo' }>;

const yard = (seat: number, colour: string): Ludo['seats'][number] => ({
    seat,
    colour,
    tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })),
    home: 0,
    out: false
});

const ludo = (over: Partial<MatchView>, view: Partial<Ludo> = {}): MatchView => ({
    id: 'match-1',
    tableId: 'table-1',
    game: 'ludo',
    rev: 1,
    seats: 2,
    players: [
        { seat: 0, who: 'alex', timeouts: 0 },
        { seat: 1, who: 'sara.k', timeouts: 0 }
    ] as MatchView['players'],
    turn: 0,
    mine: 0,
    startedAt: new Date(400_000).toISOString(),
    view: { kind: 'ludo', moves: [], seats: [yard(0, 'red'), yard(1, 'yellow')], ...view },
    ...over
});

const settle = async (): Promise<void> =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const matches = client.matches as unknown as Record<string, unknown>;

const show = async (match: MatchView): Promise<HTMLElement> =>
{
    matches.view = async () => match;
    useBoard().open(match.id);
    await settle();
    return renderTest(() => MatchBoard({ match }) as Rendered).container;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 5 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useBoard().close();
    delete matches.view;
    vi.restoreAllMocks();
});

describe('the ludo table', () =>
{
    it('seats each player inside their own yard, and marks the one whose turn it is', async () =>
    {
        const container = await show(ludo({}));
        const badges = [...container.querySelectorAll<HTMLElement>('.yard-badge')];

        expect(badges.map((badge) => badge.dataset.corner)).toEqual(['top-left', 'bottom-right']);
        expect(badges[0].querySelector('.table-plate')!.getAttribute('aria-current')).toBe('true');
        expect(badges[1].querySelector('.table-plate')!.getAttribute('aria-current')).toBeNull();
        expect(badges[0].querySelector('.table-plate-name')?.textContent).toBe('You');
    });

    it('puts the die in the middle of the board when the reader can roll, and rolls when it is tapped', async () =>
    {
        const container = await show(ludo({}));
        const roll = vi.spyOn(useBoard(), 'roll').mockResolvedValue('now');
        const die = container.querySelector<HTMLButtonElement>('.board-stage .board-roll');

        expect(die?.getAttribute('aria-label')).toBe('Roll the dice');

        fire(die!, 'click');

        expect(roll).toHaveBeenCalledTimes(1);
    });

    it('offers no die once the roll is in, nor on somebody else’s turn', async () =>
    {
        const rolled = await show(ludo({}, { die: 4, moves: [] }));
        expect(rolled.querySelector('.board-roll')).toBeNull();
        cleanup();
        useBoard().close();

        const theirs = await show(ludo({ turn: 1 }));
        expect(theirs.querySelector('.board-roll')).toBeNull();
    });

    it('keeps the routine words for screen readers and writes out the ones worth reading', async () =>
    {
        const container = await show(ludo({
            players: [
                { seat: 0, who: 'alex', timeouts: 0 },
                { seat: 1, who: 'sara.k', timeouts: 2 }
            ] as MatchView['players']
        }));
        const [mine, theirs] = [...container.querySelectorAll<HTMLElement>('.yard-badge')];

        expect(mine.querySelector('.sr-only')?.textContent).toBe('Your go');
        expect(theirs.querySelector('.table-plate-tag')?.textContent).toBe(useLocale().t('card.lastChance'));
    });
});
