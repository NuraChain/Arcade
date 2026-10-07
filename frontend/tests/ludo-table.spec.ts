import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import MatchBoard from '../src/components/games/match-board.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';
import * as turns from '../../backend/src/domains/match/turns.ts';
import { matchView } from '../../backend/src/schemas.ts';
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
    ...(over.finishedAt === undefined ? { turn: 0 } : {}),
    mine: 0,
    startedAt: new Date(400_000).toISOString(),
    view: { kind: 'ludo', moves: [], seats: [yard(0, 'red'), yard(1, 'yellow')], ...view },
    ...over
});

const settle = async () =>
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
                { seat: 1, who: 'sara.k', timeouts: turns.MISSES_ALLOWED - 1 }
            ] as MatchView['players']
        }));
        const [mine, theirs] = [...container.querySelectorAll<HTMLElement>('.yard-badge')];

        expect(mine.querySelector('.sr-only')?.textContent).toBe('Your go');
        expect(theirs.querySelector('.table-plate-tag')?.textContent).toBe(useLocale().t('card.lastChance'));
    });

    it('takes the last chance from the server’s own rule, so a different limit moves the warning with it', async () =>
    {
        vi.spyOn(turns, 'nextMissForfeits').mockImplementation((timeouts) => timeouts + 1 >= 5);

        const locale = useLocale();
        const tag = async (timeouts: number) =>
        {
            const container = await show(ludo({
                players: [
                    { seat: 0, who: 'alex', timeouts: 0 },
                    { seat: 1, who: 'sara.k', timeouts }
                ] as MatchView['players']
            }));
            const plate = container.querySelectorAll<HTMLElement>('.yard-badge')[1].querySelector<HTMLElement>('.table-plate-tag')!;
            const read = { text: plate.textContent, tone: plate.dataset.tone };

            cleanup();
            useBoard().close();

            return read;
        };

        expect(await tag(3)).toEqual({ text: locale.plural('match.missed', 3), tone: 'gold' });
        expect(await tag(4)).toEqual({ text: locale.t('card.lastChance'), tone: 'danger' });
    });

    it('writes no tag on the plates of a game being watched, whose seats come without a count of missed turns', async () =>
    {
        const locale = useLocale();
        const match = matchView.parse(ludo({
            mine: undefined,
            players: [
                { seat: 0, who: 'alex' },
                { seat: 1, who: 'sara.k' }
            ]
        }));

        expect(match.players.map((player) => Object.keys(player))).toEqual([['seat', 'who'], ['seat', 'who']]);

        const badges = [...(await show(match)).querySelectorAll<HTMLElement>('.yard-badge')];

        expect(badges.map((badge) => badge.querySelector('.table-plate-tag'))).toEqual([null, null]);
        expect(badges.map((badge) => badge.querySelector('.sr-only')?.textContent)).toEqual([locale.t('card.turn'), locale.t('card.waiting')]);
    });

    it('says No contest on a seat the finished game never judged, and Left on the seat that walked', async () =>
    {
        const container = await show(ludo({
            finishedAt: new Date(500_000).toISOString(),
            outcome: 'abandoned',
            players: [
                { seat: 0, who: 'alex', timeouts: 0, result: 'void' },
                { seat: 1, who: 'sara.k', timeouts: 0, result: 'abandoned' }
            ] as MatchView['players']
        }, { seats: [yard(0, 'red'), { ...yard(1, 'yellow'), out: true }] }));
        const [mine, theirs] = [...container.querySelectorAll<HTMLElement>('.yard-badge')];

        expect(mine.querySelector('.table-plate-tag')?.textContent).toBe('No contest');
        expect(theirs.querySelector('.table-plate-tag')?.textContent).toBe(useLocale().t('card.out'));
    });

    it('marks nobody on turn once the game is over, for either player and for somebody watching', async () =>
    {
        const locale = useLocale();

        for (const mine of [0, 1, undefined])
        {
            const match = matchView.parse(ludo({
                mine,
                winner: 1,
                outcome: 'won',
                finishedAt: new Date(500_000).toISOString(),
                players: [
                    { seat: 0, who: 'alex', timeouts: 0, result: 'lost' },
                    { seat: 1, who: 'sara.k', timeouts: 0, result: 'won' }
                ] as MatchView['players']
            }));

            expect(Object.keys(match)).not.toContain('turn');

            const container = await show(match);
            const plates = [...container.querySelectorAll<HTMLElement>('.table-plate')];

            expect(plates.map((plate) => plate.querySelector('.table-plate-tag')?.textContent)).toEqual([locale.t('card.lost'), locale.t('card.won')]);
            expect(plates.map((plate) => [plate.getAttribute('aria-current'), plate.dataset.turn ?? null])).toEqual([[null, null], [null, null]]);
            expect(container.querySelector('.table-plate-clock, .table-plate-trail, .board-roll, .table-bar')).toBeNull();

            for (const said of [locale.t('match.turn.yours'), locale.t('card.yourTurn'), locale.t('card.turn')])
            {
                expect(container.textContent, `seat ${ mine } is told "${ said }"`).not.toContain(said);
            }

            cleanup();
            useBoard().close();
        }
    });
});
