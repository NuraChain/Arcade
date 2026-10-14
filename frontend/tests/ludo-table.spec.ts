import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { batch, createSignal } from 'azerothjs';

import DieFace from '../src/components/games/die-face.component.azeroth';
import MatchBoard from '../src/components/games/match-board.component.azeroth';
import { RESULT_OUT, RESULT_WAIT } from '../src/components/games/table-result.component.azeroth';
import WatchBoard from '../src/components/games/watch-board.component.azeroth';
import { seatsFor } from '../src/components/games/seats.ts';
import { ludoOf } from '../src/data/match.ts';
import { CELL, centreOf } from '../src/game/layout.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS, useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import type { Watched } from '../src/stores/watch.store.ts';
import type { MatchView } from '../src/api.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { FINISHED, YARD, cellAt, coloursFor } from '../../backend/src/domains/match/ludo/board.ts';
import { apply } from '../../backend/src/domains/match/ludo/engine.ts';
import type { EngineAction, LudoState } from '../../backend/src/domains/match/ludo/state.ts';
import * as turns from '../../backend/src/domains/match/turns.ts';
import { matchView } from '../../backend/src/schemas.ts';
import { client } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import { watchedBoxes } from './fake-boxes.ts';

type Rendered = HTMLElement;

type Ludo = Extract<MatchView['view'], { kind: 'ludo' }>;

const yard = (seat: number, colour: string, side = seat, at = -1): Ludo['seats'][number] => ({
    seat,
    colour,
    tokens: [0, 1, 2, 3].map((piece) => ({ piece, at })),
    home: at === FINISHED ? 4 : 0,
    out: false,
    side
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
    view: { kind: 'ludo', moves: [], controls: over.turn ?? 0, seats: [yard(0, 'red'), yard(1, 'yellow')], ...view },
    ...over
});

const SEATED = ['alex', 'sara.k', 'reza.t', 'mina'];

const COLOURS = ['red', 'green', 'yellow', 'blue'];

const pairs = (over: Partial<MatchView>, view: Partial<Ludo> = {}): MatchView => ({
    id: 'match-2',
    tableId: 'table-2',
    game: 'ludo',
    rev: 1,
    seats: 4,
    players: SEATED.map((who, seat) => ({ seat, who, timeouts: 0, side: seat % 2 })),
    ...(over.finishedAt === undefined ? { turn: 0 } : {}),
    mine: 0,
    startedAt: new Date(400_000).toISOString(),
    view: { kind: 'ludo', moves: [], controls: over.turn ?? 0, seats: COLOURS.map((colour, seat) => yard(seat, colour, seat % 2)), ...view },
    ...over
});

const handedOver = (view: Partial<Ludo> = {}): Partial<Ludo> => ({
    controls: 2,
    seats: COLOURS.map((colour, seat) => yard(seat, colour, seat % 2, seat === 0 ? FINISHED : -1)),
    ...view
});

const nameOf = (handle: string) => usePeople().byHandle(handle)?.displayName ?? handle;

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
    return renderTest(() => MatchBoard({ match, events: NO_EVENTS }) as Rendered).container;
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

    it('lets the other player\'s plate be pressed, and not the reader\'s own', async () =>
    {
        useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Reader', bio: '', hue: 210, isMinor: false });

        try
        {
            const container = await show(ludo({}));
            const plates = [...container.querySelectorAll('.table-plate')].map((plate) => [plate.querySelector('.table-plate-name')?.textContent?.trim(), plate.querySelector('.table-plate-press')?.getAttribute('aria-label') ?? null]);

            expect(plates.filter(([, press]) => press === null), 'the plate nobody is offered is not the reader\'s own, or is not the only one').toEqual([['You', null]]);
            expect(plates.filter(([, press]) => press !== null).map(([name, press]) => press === `More about ${ name }`)).toEqual([true]);
        }
        finally
        {
            useSession().reset();
        }
    });

    it('offers a move nowhere but on the pawn: no list, no button, and no sentence on show', async () =>
    {
        const container = await show(ludo({}, { die: 6, moves: [0] }));
        const bar = container.querySelector('.table-bar') as HTMLElement;
        const drawn = [...bar.children].filter((one) => !one.classList.contains('sr-only'));

        expect(container.querySelectorAll('.table-stage button:not(.table-plate-press)'), 'a move is offered as a button').toHaveLength(0);
        expect(container.querySelector('.table-stage ul')).toBeNull();
        expect(bar.querySelector('p[aria-live="polite"]')?.classList.contains('sr-only')).toBe(true);
        expect(drawn.map((one) => one.className), 'something is drawn at the foot of the table').toEqual([]);
    });

    it('draws nothing at the foot of the table: the clock is on the plate of whoever is to play, short, with the long words for a reader', async () =>
    {
        const day = 24 * 3_600_000;
        const locale = useLocale();
        const timersIn = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.yard-badge .table-plate')].map((plate) => plate.querySelector<HTMLElement>('.table-plate-facts .plate-timer'));

        const theirs = await show(ludo({ turn: 1, remainingMs: day }));

        expect(theirs.querySelector('.table-bar .plate-timer, .table-bar .coach-line, .table-bar [role="note"]')).toBeNull();
        expect(timersIn(theirs).map((timer) => timer !== null), 'the clock is not on the plate of the seat to play, and only there').toEqual([false, true]);
        expect(timersIn(theirs)[1]!.querySelector('span[aria-hidden="true"]')?.textContent).toBe(locale.t('match.deadline.brief.hours', { hours: locale.n(24) }));
        expect(timersIn(theirs)[1]!.querySelector('.sr-only')?.textContent).toBe(locale.t('match.deadline.hours', { hours: locale.n(24) }));
        expect(timersIn(theirs)[1]!.parentElement?.getAttribute('dir')).toBe('ltr');

        cleanup();
        useBoard().close();

        const mine = await show(ludo({ remainingMs: 45_000 }));

        expect(timersIn(mine).map((timer) => timer !== null)).toEqual([true, false]);
        expect(timersIn(mine)[0]!.querySelector('span[aria-hidden="true"]')?.textContent).toBe(locale.t('match.deadline.brief', { seconds: locale.n(45) }));

        cleanup();
        useBoard().close();
        locale.setLocale('fa');

        const persian = await show(ludo({ turn: 1, remainingMs: day }));
        const timer = timersIn(persian)[1]!;

        expect(timer.querySelector('span[aria-hidden="true"]')?.textContent).toBe(locale.t('match.deadline.brief.hours', { hours: locale.n(24) }));
        expect(timer.parentElement?.getAttribute('dir'), 'the Persian clock took the direction of the frame, which never turns').toBe('rtl');
        expect(timer.closest('.ludo-frame')).not.toBeNull();

        cleanup();
        useBoard().close();

        const still = await show(ludo({ turn: 1 }));

        expect(timersIn(still), 'a clock is drawn at a table that keeps no time').toEqual([null, null]);
    });

    it('stands the lamp in the frame of the board, in the reader\'s own direction, and gives it the advice to turn a phone held sideways', async () =>
    {
        const turned = (width: number, height: number) =>
        {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
            Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
            useDevice().start();
            window.dispatchEvent(new Event('resize'));
        };

        const locale = useLocale();
        const lampIn = (container: HTMLElement) => container.querySelector<HTMLElement>('.ludo-frame > .ludo-lamp');

        turned(844, 390);

        try
        {
            const container = await show(ludo({ turn: 1 }));

            expect(container.querySelector('.table-bar .coach-line')).toBeNull();
            expect(lampIn(container)?.getAttribute('dir')).toBe('ltr');
            expect(lampIn(container)?.querySelector('.coach-line[data-lamp]')?.textContent).toContain(locale.t('match.upright'));

            turned(390, 844);
            await settle();

            expect(lampIn(container)?.querySelector('.coach-line'), 'a board held upright is told to turn the phone').toBeNull();

            cleanup();
            useBoard().close();
            turned(844, 390);

            const ruled = await show(ludo({}));
            const lamp = lampIn(ruled)?.querySelector('.coach-line[data-lamp]');

            expect(lamp?.textContent, 'the advice to turn the phone was said over a rule of the game').toContain(locale.t('helpers.ludo.tip.yard'));
            expect(lamp?.textContent).not.toContain(locale.t('match.upright'));

            cleanup();
            useBoard().close();
            locale.setLocale('fa');

            const persian = await show(ludo({ turn: 1 }));

            expect(lampIn(persian)?.getAttribute('dir')).toBe('rtl');
            expect(lampIn(persian)?.querySelector('.coach-line[data-lamp]')?.textContent).toContain(locale.t('match.upright'));

            cleanup();
            useBoard().close();

            const finished = await show(ludo({
                finishedAt: new Date(500_000).toISOString(),
                players: [
                    { seat: 0, who: 'alex', timeouts: 0, result: 'lost' },
                    { seat: 1, who: 'sara.k', timeouts: 0, result: 'won' }
                ] as MatchView['players']
            }));

            expect(finished.querySelector('.ludo-lamp .coach-line'), 'a game that is over was told to turn the phone').toBeNull();
        }
        finally
        {
            turned(1024, 768);
            useDevice().stop();
        }
    });

    it('keeps a plate\'s tag and its clock in one strip of the plate\'s own line, so neither is a piece of the pill', async () =>
    {
        const locale = useLocale();
        const container = await show(pairs({ turn: 2, remainingMs: 60_000 }));
        const plates = [...container.querySelectorAll<HTMLElement>('.yard-badge .table-plate')];
        const strips = plates.map((plate) => plate.querySelector<HTMLElement>('.table-plate-facts .plate-tabs'));
        const partner = strips[2]!;

        expect(strips.every((strip) => strip !== null), 'a plate has no strip for its tag and its clock').toBe(true);
        expect([...partner.querySelectorAll('.table-plate-tag, .plate-timer')].map((one) => (one.classList.contains('plate-timer') ? 'clock' : one.textContent))).toEqual([locale.t('card.partner'), 'clock']);
        expect(partner.querySelector('.table-plate-tag')?.getAttribute('data-tone')).toBe('neutral');
        expect(partner.querySelector('.table-plate-tag')?.getAttribute('dir')).toBe('ltr');
        expect(plates.flatMap((plate) => [...plate.children]).filter((one) => one.classList.contains('table-plate-tag')), 'a tag is a piece of the pill again, where it lay on the pawns-home dots of a phone').toEqual([]);
        expect(strips.map((strip) => strip!.querySelectorAll('.table-plate-tag, .plate-timer').length)).toEqual([0, 0, 2, 0]);
        expect(strips[0]!.children).toHaveLength(0);

        cleanup();
        useBoard().close();
        locale.setLocale('fa');

        const persian = await show(pairs({ turn: 2, remainingMs: 60_000 }));
        const tag = [...persian.querySelectorAll<HTMLElement>('.yard-badge .plate-tabs .table-plate-tag')][0];

        expect(tag?.textContent).toBe(locale.t('card.partner'));
        expect(tag?.getAttribute('dir'), 'a Persian tag took the direction of the frame, which never turns, and a count in it would stand on the wrong side').toBe('rtl');
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
        expect(theirs.querySelector('.table-plate-tag')?.textContent).toBe(useLocale().plural('card.missed', turns.MISSES_ALLOWED - 1));
        expect(theirs.querySelector('.table-plate-tag')?.getAttribute('data-tone')).toBe('danger');
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

        expect(await tag(3)).toEqual({ text: locale.plural('card.missed', 3), tone: 'gold' });
        expect(await tag(4)).toEqual({ text: locale.plural('card.missed', 4), tone: 'danger' });
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

    it('says Void on a seat the finished game never judged, and Left on the seat that walked', async () =>
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

        expect(mine.querySelector('.table-plate-tag')?.textContent).toBe('Void');
        expect(theirs.querySelector('.table-plate-tag')?.textContent).toBe('Left');
    });

    it.each([
        ['resign', 'Gave up'],
        ['timeout', 'Timeout'],
        ['left', 'Left']
    ] as const)('says on a yard\'s badge which way its seat went out of the game (%s)', async (exit, words) =>
    {
        const container = await show(ludo({
            players: [
                { seat: 0, who: 'alex', timeouts: 0 },
                { seat: 1, who: 'sara.k', timeouts: 0, result: 'abandoned', exit }
            ] as MatchView['players']
        }, { seats: [yard(0, 'red'), { ...yard(1, 'yellow'), out: true }] }));
        const theirs = [...container.querySelectorAll<HTMLElement>('.yard-badge')][1];

        expect(theirs.querySelector('.table-plate-tag')?.textContent).toBe(words);
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
            expect(container.querySelector('.table-plate-clock, .table-plate-trail, .board-roll, .table-bar, .plate-timer, .ludo-lamp .coach-line')).toBeNull();

            for (const said of [locale.t('match.turn.yours'), locale.t('card.yourTurn'), locale.t('card.turn')])
            {
                expect(container.textContent, `seat ${ mine } is told "${ said }"`).not.toContain(said);
            }

            cleanup();
            useBoard().close();
        }
    });
});

describe('the ludo table, two against two', () =>
{
    const platesOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.yard-badge .table-plate')];

    const tagsOf = (container: HTMLElement) => platesOf(container).map((plate) => plate.querySelector('.table-plate-tag')?.textContent ?? null);

    const sidesSaid = (container: HTMLElement) => platesOf(container).map((plate) => plate.querySelector('.table-plate-team .sr-only')?.textContent ?? null);

    const paintOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.yard-badge')]
        .map((badge) => ['--team-a', '--team-b'].map((tone) => badge.style.getPropertyValue(tone)));

    const stripOf = (container: HTMLElement) => container.querySelector('.table-bar p[aria-live="polite"]')?.textContent ?? null;

    const drawn = async (container: HTMLElement) =>
    {
        for (let wait = 0; wait < 20 && container.querySelector('.lp') === null; wait += 1)
        {
            await settle();
        }
    };

    const quietly = () =>
    {
        const animate = Element.prototype.animate;
        const thrown: string[] = [];

        vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, ...args: Parameters<Element['animate']>)
        {
            const [frames] = args;

            if (Array.isArray(frames) && frames[0]?.translate === '50cqi 50cqi')
            {
                thrown.push((this as HTMLElement).style.background);
            }

            const running = animate.apply(this, args);

            running.finished.catch(() => undefined);
            return running;
        });

        return thrown;
    };

    const tap = async (container: HTMLElement, match: MatchView, key: string) =>
    {
        const host = container.querySelector('.board-canvas') as HTMLElement;
        const token = seatsFor(ludoOf(match)!, match.mine).find((one) => one.key === key)!;
        const spot = centreOf(token.col, token.row, 1000);

        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        host.dispatchEvent(new MouseEvent('pointerup', { clientX: spot.x, clientY: spot.y - CELL * 1000 * 0.3, bubbles: true }));
        await settle();
    };

    it('marks every plate with its side, writes Partner on the plate of the reader\'s own and says Opponent of the other two', async () =>
    {
        const locale = useLocale();
        const container = await show(pairs({}));

        expect(platesOf(container).map((plate) => plate.dataset.team)).toEqual(['0', '1', '0', '1']);
        expect(platesOf(container).map((plate) => plate.querySelector<HTMLElement>('.table-plate-team')?.dataset.side)).toEqual(['0', '1', '0', '1']);
        expect(tagsOf(container)).toEqual([null, null, locale.t('card.partner'), null]);
        expect(sidesSaid(container)).toEqual([null, locale.t('card.opponent'), null, locale.t('card.opponent')]);
    });

    it('numbers the two sides for somebody watching, and calls nobody a partner', async () =>
    {
        const locale = useLocale();
        const container = await show(pairs({ mine: undefined }));

        expect(tagsOf(container)).toEqual([null, null, null, null]);
        expect(sidesSaid(container)).toEqual(['1', '2', '1', '2'].map((n) => locale.t('team.n', { n })));
    });

    it('draws no side on any plate where every seat plays for itself', async () =>
    {
        const container = await show(ludo({}));

        expect(platesOf(container).map((plate) => plate.dataset.team)).toEqual([undefined, undefined]);
        expect(container.querySelector('.table-plate-team')).toBeNull();
        expect(tagsOf(container)).toEqual([null, null]);
        expect(paintOf(container)).toEqual([['', ''], ['', '']]);
    });

    it('paints the mark of a side in the colours of the two seats that play for it, the same on both partners\' plates and for somebody watching', async () =>
    {
        const sides = [
            ['var(--ludo-red)', 'var(--ludo-yellow)'],
            ['var(--ludo-green)', 'var(--ludo-blue)'],
            ['var(--ludo-red)', 'var(--ludo-yellow)'],
            ['var(--ludo-green)', 'var(--ludo-blue)']
        ];

        for (const mine of [0, 3, undefined])
        {
            expect(paintOf(await show(pairs({ mine }))), `read as seat ${ mine }`).toEqual(sides);

            cleanup();
            useBoard().close();
        }
    });

    it('says Partner in the tag only while nothing more unusual is to be said, and then says it on the side mark', async () =>
    {
        const locale = useLocale();
        const container = await show(pairs({
            players: SEATED.map((who, seat) => ({ seat, who, timeouts: seat === 2 ? 1 : 0, side: seat % 2 }))
        }));

        expect(tagsOf(container)[2]).toBe(locale.plural('card.missed', 1));
        expect(sidesSaid(container)[2]).toBe(locale.t('card.partner'));
    });

    it('tells a reader whose four are home whose tokens they are moving, in the sentence and on the plate', async () =>
    {
        const locale = useLocale();
        const waiting = await show(pairs({}, handedOver()));

        expect(stripOf(waiting)).toBe(locale.t('match.turn.helping', { name: nameOf('reza.t') }));
        expect(tagsOf(waiting)).toEqual([locale.t('card.helping'), null, locale.t('card.partner'), null]);

        cleanup();
        useBoard().close();

        const rolled = await show(pairs({}, handedOver({ die: 3, moves: [0] })));

        expect(stripOf(rolled)).toBe(locale.t('match.turn.rolled', { die: '3' }));
        expect(tagsOf(rolled)).toEqual([locale.t('card.helping'), null, locale.t('card.partner'), null]);
        expect(rolled.querySelector('.table-stage ul')).toBeNull();
    });

    it('still says who is helping once the table has drawn the board, from the pawns the table shows', async () =>
    {
        const locale = useLocale();
        const container = await show(pairs({}, handedOver()));

        await drawn(container);
        await settle();

        expect(container.querySelectorAll('.lp').length, 'the table drew the board').toBeGreaterThan(0);
        expect(tagsOf(container)).toEqual([locale.t('card.helping'), null, locale.t('card.partner'), null]);
    });

    it('tags nobody as helping while a reader moves their own tokens', async () =>
    {
        const locale = useLocale();
        const container = await show(pairs({}, { die: 6, moves: [0] }));

        expect(tagsOf(container)).toEqual([null, null, locale.t('card.partner'), null]);
    });

    it('tells everybody else who is moving whose tokens, and the partner that they are theirs', async () =>
    {
        const locale = useLocale();
        const opponent = await show(pairs({ mine: 1 }, handedOver()));

        expect(stripOf(opponent)).toBe(locale.t('match.turn.helpingTheirs', { name: nameOf('alex'), partner: nameOf('reza.t') }));
        expect(tagsOf(opponent)).toEqual([locale.t('card.helping'), null, null, locale.t('card.partner')]);

        cleanup();
        useBoard().close();

        const partner = await show(pairs({ mine: 2 }, handedOver()));

        expect(stripOf(partner)).toBe(locale.t('match.turn.helpingYours', { name: nameOf('alex') }));

        cleanup();
        useBoard().close();

        const watcher = await show(pairs({ mine: undefined }, handedOver()));

        expect(stripOf(watcher)).toBe(locale.t('match.turn.helpingTheirs', { name: nameOf('alex'), partner: nameOf('reza.t') }));
    });

    it('takes a tap on a partner\'s token as a move only from a reader who is moving them', async () =>
    {
        quietly();

        const move = vi.spyOn(useBoard(), 'move').mockResolvedValue('now');
        const helping = pairs({}, handedOver({ die: 6, moves: [0] }));
        const helper = await show(helping);

        await drawn(helper);
        await tap(helper, helping, '2-3');

        expect(move).toHaveBeenCalledTimes(1);
        expect(move).toHaveBeenCalledWith(0);

        cleanup();
        useBoard().close();
        move.mockClear();

        const own = pairs({}, { die: 6, moves: [0] });
        const mover = await show(own);

        await drawn(mover);
        await tap(mover, own, '2-3');

        expect(move).not.toHaveBeenCalled();

        await tap(mover, own, '0-3');

        expect(move).toHaveBeenCalledWith(0);
    });

    it('takes no tap from the partner whose tokens are being moved, even on a board that offers them a move', async () =>
    {
        quietly();

        const move = vi.spyOn(useBoard(), 'move').mockResolvedValue('now');
        const lent = pairs({ mine: 2 }, handedOver({ die: 6, moves: [0] }));
        const owner = await show(lent);

        await drawn(owner);
        await tap(owner, lent, '2-3');

        expect(move).not.toHaveBeenCalled();
    });

    it('lights the tokens of the partner for a reader who is moving them', async () =>
    {
        quietly();

        const helper = await show(pairs({}, handedOver({ die: 6, moves: [0] })));

        await drawn(helper);

        expect(helper.querySelectorAll('.lp')).toHaveLength(16);
        expect([...helper.querySelectorAll<HTMLElement>('.lp[data-movable]')].map((piece) => piece.dataset.colour)).toEqual(['yellow', 'yellow', 'yellow', 'yellow']);
        expect([...helper.querySelectorAll<HTMLElement>('.lg')].map((one) => one.dataset.colour), 'the square a partner\'s token would reach is not marked in the partner\'s colour').toEqual(['yellow']);
    });

    it('throws confetti in the colour of every seat that won, and none where nobody did', async () =>
    {
        const thrown = quietly();
        const toneOf = (hex: string) =>
        {
            const probe = document.createElement('span');

            probe.style.background = hex;

            return probe.style.background;
        };
        const finished = (results: MatchView['players'][number]['result'][], outcome: MatchView['outcome']) => pairs({
            rev: 2,
            finishedAt: new Date(500_000).toISOString(),
            outcome,
            ...(outcome === 'won' ? { winner: 0 } : {}),
            players: SEATED.map((who, seat) => ({ seat, who, timeouts: 0, side: seat % 2, result: results[seat] }))
        });

        for (const [results, outcome, colours] of [
            [['won', 'lost', 'won', 'lost'], 'won', ['#FF5A4E', '#FFC72C']],
            [['void', 'abandoned', 'void', 'void'], 'abandoned', []]
        ] as const)
        {
            const [current, setCurrent] = createSignal(pairs({}));
            const props = {
                get match()
                {
                    return current();
                },
                events: NO_EVENTS
            };

            matches.view = async () => current();
            useBoard().open(current().id);
            await settle();

            const container = renderTest(() => MatchBoard(props) as Rendered).container;

            await drawn(container);
            thrown.length = 0;
            setCurrent(finished([...results], outcome));
            await settle();

            const tones = new Set(thrown);

            expect([...colours].every((hex) => tones.has(toneOf(hex))), `${ outcome }: ${ [...tones].join(' ') }`).toBe(true);
            expect(['#2FC262', '#3F8CFF'].some((hex) => tones.has(toneOf(hex)))).toBe(false);
            expect(thrown.length > 0).toBe(colours.length > 0);

            cleanup();
            useBoard().close();
        }
    });
});

describe('the ludo table, played from what happened', () =>
{
    type Told = Extract<MatchEvent['log'], { kind: 'ludo' }>['moves'];

    const EMPTY = [YARD, YARD, YARD, YARD];

    const standing = (pieces: number[][], die: number | null, turn = 0): LudoState =>
    {
        const colours = coloursFor(pieces.length);

        return {
            v: 1,
            game: 'ludo',
            players: pieces.map((row, seat) => ({ seat, colour: colours[seat], pieces: [...row], out: false, side: seat })),
            turn,
            die,
            sixes: die === 6 ? 1 : 0,
            rev: 1,
            winner: null
        };
    };

    const stepped = (state: LudoState, action: EngineAction) =>
    {
        const outcome = apply(state, action);

        if (!outcome.ok)
        {
            throw new Error(outcome.reason);
        }

        return { state: outcome.state, moves: outcome.events as unknown as Told };
    };

    const seen = (state: LudoState, mine: number | null, rev: number, over: Partial<MatchView> = {}): MatchView => ({
        id: 'match-9',
        tableId: 'table-9',
        game: 'ludo',
        rev,
        seats: state.players.length,
        players: state.players.map((player) => ({ seat: player.seat, who: SEATED[player.seat], timeouts: 0 })) as MatchView['players'],
        ...(state.winner === null ? { turn: state.players[state.turn].seat } : {}),
        ...(mine === null ? {} : { mine }),
        startedAt: new Date(400_000).toISOString(),
        view: ludoEngine.view(state, mine) as MatchView['view'],
        ...over
    });

    const happened = (rev: number, seat: number, moves: Told): MatchEvent => ({ rev, seat, at: '', log: { kind: 'ludo', moves } });

    const flush = async () =>
    {
        for (let turn = 0; turn < 12; turn += 1)
        {
            await Promise.resolve();
        }
    };

    const elapse = async (ms: number) =>
    {
        const clock = runtime().clock as ManualClock;

        for (let left = ms; left > 0; left -= 10)
        {
            clock.advance(Math.min(10, left));
            await flush();
        }

        await flush();
    };

    const drawn = async (container: HTMLElement) =>
    {
        for (let wait = 0; wait < 40 && container.querySelector('.lp') === null; wait += 1)
        {
            await settle();
        }
    };

    const live = async (first: MatchView, wait = true, extra: { onPresenting?: (busy: boolean) => void } = {}) =>
    {
        const [current, setCurrent] = createSignal(first);
        const [told, setTold] = createSignal<EventBatch>(NO_EVENTS);

        matches.view = async () => current();
        useBoard().open(first.id);
        await settle();

        const view = renderTest(() => MatchBoard({
            get match()
            {
                return current();
            },
            get events()
            {
                return told();
            },
            ...extra
        }) as Rendered);

        if (wait)
        {
            await drawn(view.container);
        }

        return {
            container: view.container,
            tell: (next: MatchView, events: MatchEvent[]) => batch(() =>
            {
                setCurrent(next);
                setTold((held) => ({ seq: held.seq + 1, id: next.id, events, live: true, jump: false }));
            }),
            move: (next: MatchView) => setCurrent(next)
        };
    };

    const pawn = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`.lp[data-key="${ key }"]`)!;

    const stageOf = (container: HTMLElement) => container.querySelector('.table-stage') as HTMLElement;

    const dots = (container: HTMLElement, plate: number) => container.querySelectorAll('.yard-badge')[plate].querySelectorAll('[data-home="true"]').length;

    const tags = (container: HTMLElement) => [...container.querySelectorAll('.yard-badge')].map((badge) => badge.querySelector('.table-plate-tag')?.textContent ?? null);

    const plateDie = (container: HTMLElement, plate: number) => container.querySelectorAll('.yard-badge')[plate].querySelector('.table-plate-trail [role="img"]');

    const cq = (value: number) => `${ value.toFixed(3) }cqi`;

    const onSquare = (colour: 'red' | 'yellow', progress: number) =>
    {
        const cell = cellAt(colour, progress)!;
        const spot = centreOf(cell.col, cell.row + 0.1, 100);

        return `${ cq(spot.x) } ${ cq(spot.y) }`;
    };

    const quiet = () =>
    {
        const animate = Element.prototype.animate;

        vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, ...args: Parameters<Element['animate']>)
        {
            const running = animate.apply(this, args);

            running.finished.catch(() => undefined);

            return running;
        });
    };

    const wonBy = (state: LudoState, mine: number | null, rev: number) => seen(state, mine, rev, {
        finishedAt: new Date(401_000).toISOString(),
        outcome: 'won',
        winner: 1,
        players: [
            { seat: 0, who: SEATED[0], timeouts: 0, result: 'lost' },
            { seat: 1, who: SEATED[1], timeouts: 0, result: 'won' }
        ] as MatchView['players']
    });

    const closing = () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [FINISHED, FINISHED, FINISHED, 54]], 2, 1);

        return { before, after: stepped(before, { kind: 'move', seat: 1, piece: 3 }) };
    };

    it('lands a pawn that is walking when its box changes size, and plays the rest of the move', async () =>
    {
        quiet();

        const boxes = watchedBoxes();

        try
        {
            const { before, after } = closing();
            const { container, tell } = await live(seen(before, 0, 1));
            const animate = vi.mocked(Element.prototype.animate);

            expect(boxes.watching(stageOf(container)), 'the table\'s box is not the one that is watched').toBe(1);

            boxes.size(stageOf(container), 900, 700);
            animate.mockClear();
            tell(wonBy(after.state, 0, 2), [happened(2, 1, after.moves)]);
            await flush();

            const walking = animate.mock.results.map((one) => one.value as Animation);

            expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
            expect(walking.some((one) => one.playState === 'running'), 'no pawn was walking').toBe(true);

            boxes.size(stageOf(container), 900, 520);
            await flush();

            expect(walking.filter((one) => one.playState === 'running'), 'a walk measured on a board of one size went on being walked on another').toEqual([]);
            expect(stageOf(container).getAttribute('data-presenting'), 'the rest of the move was thrown away').toBe('true');

            await elapse(6000);

            expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
            expect(dots(container, 1), 'the pawn was not counted home').toBe(4);
        }
        finally
        {
            vi.unstubAllGlobals();
        }
    });

    it('walks what the other seat did, counts a pawn home when it is home, and shows the result only then', async () =>
    {
        quiet();

        const { before, after } = closing();
        const { container, tell } = await live(seen(before, 0, 1));

        expect(after.moves.map((move) => move.e)).toEqual(['step', 'home', 'finish']);
        expect(dots(container, 1)).toBe(3);

        tell(wonBy(after.state, 0, 2), [happened(2, 1, after.moves)]);
        await flush();

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(pawn(container, '1-3').hasAttribute('data-moving')).toBe(true);
        expect(container.querySelector('.table-result'), 'the result was shown over a pawn still walking').toBeNull();
        expect(tags(container), 'a plate said who won while the last pawn was still walking').toEqual([null, null]);
        expect(dots(container, 1), 'the pawn was counted home before it was').toBe(3);

        await elapse(700);

        expect(dots(container, 1)).toBe(4);
        expect(container.querySelector('.table-result'), 'the result was shown over the celebration').toBeNull();
        expect(tags(container), 'a plate said who won while the confetti was still in the air').toEqual([null, null]);

        await elapse(2000);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(container.querySelector('.table-result')).not.toBeNull();
        expect(tags(container)).toEqual([useLocale().t('card.lost'), useLocale().t('card.won')]);
    });

    it('says a seat missed its turn only when the board has shown the turn played for it', async () =>
    {
        quiet();

        const from = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(from, { kind: 'roll', seat: 0, die: 3 });
        const missing = [{ seat: 0, who: SEATED[0], timeouts: 1 }, { seat: 1, who: SEATED[1], timeouts: 0 }] as MatchView['players'];
        const { container, tell } = await live(seen(from, 1, 1));
        const said = () => tags(container).filter((one) => one !== null);

        tell(seen(rolled.state, 1, 2, { players: missing }), [happened(2, 0, rolled.moves)]);
        await flush();

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(said(), 'a plate said a turn was missed while the roll made for it was still in the air').toEqual([]);

        await elapse(3000);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(said()).toEqual([useLocale().plural('card.missed', 1)]);

        tell(seen(rolled.state, 1, 3, { players: missing.map((one) => (one.seat === 0 ? { ...one, timeouts: 2 } : one)) as MatchView['players'] }), []);
        await flush();

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(said(), 'a board with nothing to show first kept the missed turn to itself').toEqual([useLocale().plural('card.missed', 2)]);
    });

    it('gives the board only so long to show how the game ended', async () =>
    {
        quiet();

        const counts = vi.spyOn(runtime().clock, 'after');
        const { before, after } = closing();
        const { container, tell } = await live(seen(before, 0, 1));

        tell(wonBy(after.state, 0, 2), [happened(2, 1, after.moves)]);
        await flush();

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(counts.mock.calls.filter(([ms]) => ms === RESULT_WAIT), 'the board was given as long as it liked to show how the game ended').toHaveLength(1);
    });

    it('gives the board as long as it likes to show a game that is going on', async () =>
    {
        quiet();

        const counts = vi.spyOn(runtime().clock, 'after');
        const from = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(from, { kind: 'roll', seat: 0, die: 3 });
        const { container, tell } = await live(seen(from, 0, 1));

        tell(seen(rolled.state, 0, 2), [happened(2, 0, rolled.moves)]);
        await flush();

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(counts.mock.calls.filter(([ms]) => ms === RESULT_WAIT), 'a game that is going on was given only so long to be shown').toHaveLength(0);
    });

    it('lets the result leave when another game starts at the table, over a board already set for that game', async () =>
    {
        quiet();

        const { after } = closing();
        const { container, tell } = await live(wonBy(after.state, 0, 2));
        const result = () => container.querySelector('.table-result');

        await flush();

        expect(result()).not.toBeNull();
        expect(dots(container, 1)).toBe(4);

        tell(seen(standing([EMPTY, EMPTY], null, 0), 0, 0, { id: 'match-next' }), []);
        await flush();

        expect(result()?.getAttribute('data-leaving'), 'the result of the game before stood over the next one, or was gone in one frame').toBe('true');
        expect(result()?.querySelectorAll('.table-result-card li'), 'the result went telling of a game that had only just begun').toHaveLength(2);
        expect(dots(container, 1), 'the board kept the last game on it under a result that was leaving').toBe(0);
        expect(tags(container)).toEqual([null, null]);

        await elapse(RESULT_OUT - 10);

        expect(result(), 'the result was taken away before it had faded').not.toBeNull();

        await elapse(10);

        expect(result()).toBeNull();
    });

    it('says a seat has gone when its pawns have gone home, in a game that goes on', async () =>
    {
        quiet();

        const before = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD], [7, 30, YARD, YARD]], null, 1);
        const left = stepped(before, { kind: 'forfeit', seat: 0, reason: 'left' });
        const gone = seen(left.state, 1, 2, {
            players: [
                { seat: 0, who: SEATED[0], timeouts: 0, result: 'abandoned', exit: 'left' },
                { seat: 1, who: SEATED[1], timeouts: 0 },
                { seat: 2, who: SEATED[2], timeouts: 0 }
            ] as MatchView['players']
        });
        const { container, tell } = await live(seen(before, 1, 1));

        tell(gone, [happened(2, 0, left.moves)]);
        await flush();

        expect(tags(container), 'a plate said a seat had left while its pawns still stood on the board').toEqual([null, null, null]);

        await elapse(600);

        expect(tags(container)).toEqual([useLocale().t('card.out'), null, null]);
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });

    it('says who gave up when that ends the game, and who won only with the result', async () =>
    {
        quiet();

        const before = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD]], null, 1);
        const left = stepped(before, { kind: 'forfeit', seat: 0, reason: 'resign' });
        const ended = seen(left.state, 1, 2, {
            finishedAt: new Date(401_000).toISOString(),
            outcome: 'won',
            winner: 1,
            players: [
                { seat: 0, who: SEATED[0], timeouts: 0, result: 'abandoned', exit: 'resign' },
                { seat: 1, who: SEATED[1], timeouts: 0, result: 'won' }
            ] as MatchView['players']
        });
        const { container, tell } = await live(seen(before, 1, 1));

        expect(left.moves.map((move) => move.e)).toEqual(['forfeit', 'finish']);

        tell(ended, [happened(2, 0, left.moves)]);
        await flush();
        await elapse(200);

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(tags(container), 'the winner was named while the table was still playing').toEqual([useLocale().t('card.gaveUp'), null]);

        await elapse(2500);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(tags(container)).toEqual([useLocale().t('card.gaveUp'), useLocale().t('card.won')]);
    });

    it('puts a roll on the plate of whoever rolled it once it has landed, and takes it off when it is used', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });
        const { container, tell } = await live(seen(before, 1, 1));

        tell(seen(rolled.state, 1, 2), [happened(2, 0, rolled.moves)]);
        await flush();

        expect(plateDie(container, 0), 'the plate told the roll while the die was still in the air').toBeNull();

        await elapse(2700);

        expect(plateDie(container, 0)).not.toBeNull();
        expect(plateDie(container, 1)).toBeNull();

        tell(seen(moved.state, 1, 3), [happened(3, 0, moved.moves)]);
        await flush();

        expect(plateDie(container, 0)).toBeNull();
        expect(pawn(container, '0-0').hasAttribute('data-moving')).toBe(true);

        await elapse(700);

        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 13));
    });

    const seated = async (first: MatchView) =>
    {
        matches.view = async () => first;
        useBoard().open(first.id);
        await settle();

        const view = renderTest(() => MatchBoard({
            get match()
            {
                return useBoard().match() ?? first;
            },
            get events()
            {
                return useBoard().events();
            }
        }) as Rendered);

        await drawn(view.container);

        return view.container;
    };

    const hand = (container: HTMLElement) => container.querySelector<HTMLElement>('.lb-die')!;

    const saying = (container: HTMLElement) => container.querySelector('p[aria-live="polite"]')?.textContent ?? null;

    const lit = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.lp[data-movable]')].map((one) => one.dataset.key);

    const marked = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.lg')].map((one) => one.dataset.goal);

    const tap = (container: HTMLElement, colour: 'red' | 'yellow', progress: number) =>
    {
        const host = container.querySelector('.board-canvas') as HTMLElement;
        const cell = cellAt(colour, progress)!;
        const spot = centreOf(cell.col, cell.row, 1000);

        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        host.dispatchEvent(new MouseEvent('pointerup', { clientX: spot.x, clientY: spot.y - CELL * 300, bubbles: true }));
    };

    it('keeps the die in the middle for the reader, lifts it at the press, and holds the roll\'s words, its lit pawns and their taps until it has landed', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const answers: (() => void)[] = [];
        const move = vi.spyOn(useBoard(), 'move').mockResolvedValue('now');

        matches.play = async () =>
        {
            await new Promise<void>((resolve) =>
            {
                answers.push(resolve);
            });

            return { applied: 'now', match: seen(rolled.state, 0, 2), events: [happened(2, 0, rolled.moves)] };
        };

        const container = await seated(seen(before, 0, 1));
        const yours = useLocale().t('match.turn.yours');

        expect(hand(container).hasAttribute('data-hand'), 'no die waited in the middle for the reader').toBe(true);
        expect(hand(container).hidden).toBe(false);
        expect(container.querySelector('.board-roll .die3d'), 'the button drew a second die over the table\'s own').toBeNull();
        expect(container.querySelectorAll('.board-stage .die3d')).toHaveLength(1);
        expect(saying(container)).toBe(yours);

        fire(container.querySelector('.board-roll')!, 'click');
        await flush();

        expect(hand(container).hasAttribute('data-rattle'), 'the die lay still while the roll was being asked for').toBe(true);

        answers[0]();
        await flush();
        await flush();

        expect(container.querySelector('.board-roll')).toBeNull();
        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(saying(container), 'the roll was said while its die was in the air').toBe(yours);
        expect(lit(container), 'a pawn lit up before the die had landed').toEqual([]);
        expect(marked(container), 'a landing was marked before the die had landed').toEqual([]);
        expect(plateDie(container, 0)).toBeNull();

        tap(container, 'red', 10);
        await flush();

        expect(move, 'a pawn was moved on a roll nobody had seen land').not.toHaveBeenCalled();

        await elapse(1250);

        expect(saying(container)).toBe(useLocale().t('match.turn.rolled', { die: useLocale().n(3) }));
        expect(lit(container)).toEqual(['0-0']);
        expect(marked(container)).toEqual(['0-0']);
        expect(container.querySelector<HTMLElement>('.lg')!.style.translate).toBe(onSquare('red', 13));
        expect(hand(container).hasAttribute('data-rattle')).toBe(false);
        expect(container.querySelectorAll('.board-stage .die3d')).toHaveLength(1);

        tap(container, 'red', 10);
        await flush();

        expect(move).toHaveBeenCalledWith(0);

        delete matches.play;
    });

    it('puts the die down again when the roll is refused', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const answers: ((error: Error) => void)[] = [];

        matches.play = async () => await new Promise((_resolve, reject) =>
        {
            answers.push(reject);
        });

        const container = await seated(seen(before, 0, 1, { id: 'match-refused', tableId: 'table-refused' }));

        fire(container.querySelector('.board-roll')!, 'click');
        await flush();

        expect(hand(container).hasAttribute('data-rattle')).toBe(true);

        answers[0](new Error('offline'));
        await settle();

        expect(hand(container).hasAttribute('data-rattle'), 'a roll that was refused left the die shaking for good').toBe(false);
        expect(hand(container).hasAttribute('data-hand')).toBe(true);
        expect(container.querySelector('.board-roll')).not.toBeNull();

        delete matches.play;
    });

    it('hands the reader the die when the table has shown the turn is theirs, and not while the seat before them is still moving', async () =>
    {
        quiet();

        const before = standing([EMPTY, [10, YARD, YARD, YARD]], 3, 1);
        const moved = stepped(before, { kind: 'move', seat: 1, piece: 0 });
        const [theirs, setTheirs] = createSignal(false);

        vi.spyOn(useBoard(), 'canRoll').mockImplementation(() => theirs());

        const { container, tell } = await live(seen(before, 0, 1));

        expect(hand(container).hidden).toBe(true);

        tell(seen(moved.state, 0, 2), [happened(2, 1, moved.moves)]);
        setTheirs(true);
        await flush();

        expect(container.querySelector('.board-roll'), 'a reader whose turn it is was kept from rolling').not.toBeNull();
        expect(pawn(container, '1-0').hasAttribute('data-moving')).toBe(true);
        expect(hand(container).hasAttribute('data-hand'), 'the reader was handed the die while the seat before them was still moving').toBe(false);

        await elapse(1200);

        expect(pawn(container, '1-0').hasAttribute('data-moving')).toBe(false);
        expect(hand(container).hasAttribute('data-hand')).toBe(true);
        expect(hand(container).hidden).toBe(false);
    });

    it('leaves the die in the reader\'s hand while the table shows a seat that left on their turn', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD], [7, 30, YARD, YARD]], null, 0);
        const left = stepped(before, { kind: 'forfeit', seat: 2, reason: 'resign' });

        vi.spyOn(useBoard(), 'canRoll').mockReturnValue(true);

        const { container, tell } = await live(seen(before, 0, 1));

        expect(left.moves.map((move) => move.e)).toEqual(['forfeit']);
        expect(hand(container).hasAttribute('data-hand')).toBe(true);

        tell(seen(left.state, 0, 2), [happened(2, 2, left.moves)]);
        await flush();

        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');
        expect(hand(container).hidden, 'the die was taken out of the reader\'s hand to show somebody else leaving').toBe(false);
        expect(hand(container).hasAttribute('data-hand')).toBe(true);

        await elapse(1200);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(hand(container).hasAttribute('data-hand')).toBe(true);
    });

    it('takes the die out of the reader\'s hand for good once the roll is no longer theirs', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null, 0);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });
        const [theirs, setTheirs] = createSignal(true);

        vi.spyOn(useBoard(), 'canRoll').mockImplementation(() => theirs());

        const { container, tell } = await live(seen(before, 0, 1));

        expect(hand(container).hasAttribute('data-hand')).toBe(true);

        setTheirs(false);
        tell(seen(rolled.state, 0, 2), [happened(2, 0, rolled.moves)]);
        await elapse(1300);
        tell(seen(moved.state, 0, 3), [happened(3, 0, moved.moves)]);
        await elapse(1500);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 13));
        expect(hand(container).hidden, 'a die came back to a hand whose roll had gone').toBe(true);
        expect(hand(container).hasAttribute('data-hand')).toBe(false);
    });

    it('hurries what the table is still showing when the roll is pressed, and leaves it alone when it is not', async () =>
    {
        quiet();

        const before = standing([EMPTY, [10, YARD, YARD, YARD]], 5, 1);
        const moved = stepped(before, { kind: 'move', seat: 1, piece: 0 });
        const [theirs, setTheirs] = createSignal(false);

        vi.spyOn(useBoard(), 'canRoll').mockImplementation(() => theirs());
        vi.spyOn(useBoard(), 'roll').mockReturnValue(new Promise(() => undefined));

        const slow = await live(seen(before, 0, 1));

        slow.tell(seen(moved.state, 0, 2), [happened(2, 1, moved.moves)]);
        setTheirs(true);
        await elapse(240);

        expect(pawn(slow.container, '1-0').hasAttribute('data-moving'), 'five squares were walked in a quarter of a second with nobody pressing').toBe(true);

        cleanup();
        useBoard().close();
        setTheirs(false);

        const told = vi.fn();
        const pressed = await live(seen(before, 0, 1), true, { onPresenting: told });

        pressed.tell(seen(moved.state, 0, 2), [happened(2, 1, moved.moves)]);
        setTheirs(true);
        await flush();
        fire(pressed.container.querySelector('.board-roll')!, 'click');
        await elapse(240);

        expect(pawn(pressed.container, '1-0').hasAttribute('data-moving'), 'a pressed roll waited out the whole of somebody else\'s walk').toBe(false);
        expect(pawn(pressed.container, '1-0').style.translate).toBe(onSquare('yellow', 15));
        expect(hand(pressed.container).hasAttribute('data-rattle')).toBe(true);
        expect(stageOf(pressed.container).hasAttribute('data-presenting')).toBe(false);

        told.mockClear();
        fire(pressed.container.querySelector('.board-roll')!, 'click');
        await flush();

        expect(told, 'a roll pressed at a still table said the table was playing').not.toHaveBeenCalled();
    });

    it('holds nothing for a board that opens on a roll, for one that has not arrived, or with little of the turn left', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const said = useLocale().t('match.turn.rolled', { die: useLocale().n(3) });
        const opened = await live(seen(rolled.state, 0, 2));

        expect(saying(opened.container)).toBe(said);
        expect(lit(opened.container)).toEqual(['0-0']);
        expect(hand(opened.container).hidden, 'a board that opened on a roll threw it again').toBe(true);
        expect(plateDie(opened.container, 0)?.getAttribute('aria-label')).toBe(said);

        useLocale().setLocale('fa');
        await flush();

        expect(plateDie(opened.container, 0)?.getAttribute('aria-label'), 'the reader\'s own plate spoke of them as of somebody else').toBe(useLocale().t('match.turn.rolled', { die: useLocale().n(3) }));

        useLocale().setLocale('en');
        await flush();

        opened.tell(seen(rolled.state, 0, 3), []);
        await flush();

        expect(stageOf(opened.container).hasAttribute('data-presenting')).toBe(false);
        expect(lit(opened.container), 'a board that moved with nothing to show went on holding its reader').toEqual(['0-0']);

        cleanup();
        useBoard().close();

        const late = await live(seen(before, 0, 1), false);

        late.tell(seen(rolled.state, 0, 2), [happened(2, 0, rolled.moves)]);
        await flush();

        expect(late.container.querySelector('.lp')).toBeNull();
        expect(saying(late.container), 'a board that could not be drawn yet kept its reader waiting').toBe(said);

        cleanup();
        useBoard().close();

        const hurried = await live(seen(before, 0, 1));

        hurried.tell(seen(rolled.state, 0, 2, { remainingMs: 5000 }), [happened(2, 0, rolled.moves)]);
        await flush();

        expect(stageOf(hurried.container).getAttribute('data-presenting')).toBe('true');
        expect(saying(hurried.container), 'a turn with five seconds left waited for a die').toBe(said);
        expect(lit(hurried.container)).toEqual(['0-0']);
    });

    it('keeps the tip about a roll to itself until the die has landed', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const six = stepped(before, { kind: 'roll', seat: 0, die: 6 });
        const tipOf = (container: HTMLElement) => container.querySelector('.ludo-frame > .ludo-lamp [role="note"]')?.textContent ?? null;
        const { container, tell } = await live(seen(before, 0, 1));

        expect(tipOf(container)).toBeNull();

        tell(seen(six.state, 0, 2), [happened(2, 0, six.moves)]);
        await flush();

        expect(tipOf(container), 'the tip gave the six away while the die was in the air').toBeNull();

        await elapse(1250);

        expect(tipOf(container)).toContain(useLocale().t('helpers.ludo.tip.six'));
    });

    it('says a roll nobody could play when its die has landed, in the words for whoever rolled, and then whose turn it is', async () =>
    {
        quiet();

        const stuckFrom = standing([[10, YARD, YARD, YARD], EMPTY], null, 1);
        const stuck = stepped(stuckFrom, { kind: 'roll', seat: 1, die: 3 });
        const locale = useLocale();
        const theirs = locale.t('match.turn.theirs', { name: nameOf(SEATED[1]) });
        const { container, tell } = await live(seen(stuckFrom, 0, 1));

        expect(stuck.moves.map((move) => move.e)).toEqual(['roll', 'pass']);
        expect(saying(container)).toBe(theirs);

        tell(seen(stuck.state, 0, 2), [happened(2, 1, stuck.moves)]);
        await flush();

        expect(saying(container), 'the turn was said to have passed while the die was in the air').toBe(theirs);

        await elapse(1250);

        expect(saying(container)).toBe(locale.t('match.stuck.them', { name: nameOf(SEATED[1]), die: locale.n(3) }));
        expect(stageOf(container).getAttribute('data-presenting')).toBe('true');

        await elapse(1400);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(saying(container)).toBe(locale.t('match.turn.yours'));

        cleanup();
        useBoard().close();

        const mineFrom = standing([EMPTY, [10, YARD, YARD, YARD]], null, 0);
        const mine = stepped(mineFrom, { kind: 'roll', seat: 0, die: 2 });
        const own = await live(seen(mineFrom, 0, 1));

        own.tell(seen(mine.state, 0, 2), [happened(2, 0, mine.moves)]);
        await elapse(1250);

        expect(saying(own.container)).toBe(locale.t('match.stuck.you', { die: locale.n(2) }));

        cleanup();
        useBoard().close();

        const sixFrom = standing([[52, FINISHED, FINISHED, FINISHED], EMPTY], null, 0);
        const six = stepped(sixFrom, { kind: 'roll', seat: 0, die: 6 });
        const wasted = await live(seen(sixFrom, 1, 1));

        wasted.tell(seen(six.state, 1, 2), [happened(2, 0, six.moves)]);
        await elapse(1250);

        expect(saying(wasted.container)).toBe(locale.t('match.wasted.them', { name: nameOf(SEATED[0]) }));

        cleanup();
        useBoard().close();

        const thirdFrom: LudoState = { ...standing([[10, YARD, YARD, YARD], EMPTY], null, 0), sixes: 2 };
        const third = stepped(thirdFrom, { kind: 'roll', seat: 0, die: 6 });
        const sixes = await live(seen(thirdFrom, 0, 1));

        expect(third.moves.map((move) => move.e)).toEqual(['roll', 'pass']);

        sixes.tell(seen(third.state, 0, 2), [happened(2, 0, third.moves)]);
        await elapse(1250);

        expect(saying(sixes.container)).toBe(locale.t('match.sixes.you'));
    });

    it('says every one of those sentences in Persian too', () =>
    {
        const locale = useLocale();
        const english = (['match.stuck.you', 'match.stuck.them', 'match.sixes.you', 'match.sixes.them', 'match.wasted.you', 'match.wasted.them', 'match.rolled.them'] as const)
            .map((key) => locale.t(key, { name: 'Sara', die: '3' }));

        locale.setLocale('fa');

        const persian = (['match.stuck.you', 'match.stuck.them', 'match.sixes.you', 'match.sixes.them', 'match.wasted.you', 'match.wasted.them', 'match.rolled.them'] as const)
            .map((key) => locale.t(key, { name: 'Sara', die: '3' }));

        expect(persian.every((line, index) => line !== english[index] && /[؀-ۿ]/.test(line))).toBe(true);
        expect(persian.filter((line) => line.includes('{'))).toEqual([]);
        expect(english.filter((line) => line.includes('{'))).toEqual([]);
    });

    it('keeps the turn on whoever moved until their pawn has landed, and passes it then', async () =>
    {
        const start = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 4, 1);
        const moved = stepped(start, { kind: 'move', seat: 1, piece: 0 });
        const table = await live(seen(start, 0, 5));
        const current = () => [...table.container.querySelectorAll('.yard-badge')].map((badge) => badge.querySelector('.table-plate')?.getAttribute('aria-current') ?? null);
        const helping = () => [...table.container.querySelectorAll('.yard-badge .table-plate-tag')].filter((tag) => tag.textContent === useLocale().t('card.helping')).length;

        expect(current()).toEqual([null, 'true']);

        table.tell(seen(moved.state, 0, 6), [happened(6, 1, moved.moves)]);
        await elapse(150);

        expect(current(), 'the turn left a player whose pawn was still walking').toEqual([null, 'true']);
        expect(helping(), 'a seat of a game with no partners was said to be helping while its pawn walked').toBe(0);

        await elapse(3000);

        expect(current()).toEqual(['true', null]);
    });

    it('shows the die on its roller\'s plate once it has been picked up from the board, and names whoever rolled it', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null, 1);
        const rolled = stepped(before, { kind: 'roll', seat: 1, die: 4 });
        const { container, tell } = await live(seen(before, 0, 1));

        tell(seen(rolled.state, 0, 2), [happened(2, 1, rolled.moves)]);
        await elapse(1300);

        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
        expect(hand(container).hidden).toBe(false);
        expect(plateDie(container, 1), 'the plate showed a die that was still lying on the board').toBeNull();

        await elapse(1500);

        expect(hand(container).hidden).toBe(true);
        expect(plateDie(container, 1)?.getAttribute('aria-label')).toBe(useLocale().t('match.rolled.them', { name: nameOf(SEATED[1]), die: useLocale().n(4) }));
        expect(plateDie(container, 0)).toBeNull();
        expect(plateDie(container, 1)!.querySelector('.die3d')?.getAttribute('data-face')).toBe('4');
    });

    it('draws a die face that follows its number, and keeps the last one when it is handed none', async () =>
    {
        const [value, setValue] = createSignal<number | undefined>(4);
        const { container } = renderTest(() => DieFace({
            get value()
            {
                return value() as number;
            },
            label: 'a die'
        }) as Rendered);

        await flush();

        const face = () => container.querySelector<HTMLElement>('[role="img"] .die3d')?.dataset.face;

        expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('a die');
        expect(container.querySelector('.die3d')?.hasAttribute('data-flat')).toBe(true);
        expect(face()).toBe('4');

        setValue(2);
        await flush();

        expect(face()).toBe('2');

        setValue(undefined);
        await flush();

        expect(face(), 'a die face handed nothing took the page down').toBe('2');
    });

    it('offers no die to somebody watching, nor to a seat that is not on turn', async () =>
    {
        quiet();

        const position = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null, 0);
        const watching = await live(seen(position, null, 1));

        expect(hand(watching.container).hidden).toBe(true);
        expect(watching.container.querySelector('.board-roll')).toBeNull();

        cleanup();
        useBoard().close();

        const waiting = await live(seen(position, 1, 1));

        expect(hand(waiting.container).hidden).toBe(true);
        expect(waiting.container.querySelector('.board-roll')).toBeNull();
    });

    it('moves the reader\'s pawn at the press, walks nothing again for the answer, and takes it back when the server says no', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], 3, 0);
        const moved = stepped(before, { kind: 'move', seat: 0, piece: 0 });
        const first = seen(before, 0, 1);
        const answers: ((outcome: 'now' | 'stale') => void)[] = [];
        const move = vi.spyOn(useBoard(), 'move').mockImplementation(async () => await new Promise((resolve) =>
        {
            answers.push(resolve);
        }));
        const { container, tell } = await live(first);
        const host = container.querySelector('.board-canvas') as HTMLElement;
        const cell = cellAt('red', 10)!;
        const spot = centreOf(cell.col, cell.row, 1000);

        expect(marked(container)).toEqual(['0-0']);

        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        host.dispatchEvent(new MouseEvent('pointerup', { clientX: spot.x, clientY: spot.y - CELL * 300, bubbles: true }));
        await flush();

        expect(move).toHaveBeenCalledWith(0);
        expect(pawn(container, '0-0').hasAttribute('data-moving'), 'the pawn waited for the server').toBe(true);
        expect(marked(container), 'the mark stayed on the board under a pawn that had set off').toEqual([]);

        await elapse(600);

        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 13));

        tell(seen(moved.state, 0, 2), [happened(2, 0, moved.moves)]);
        answers[0]('now');
        await flush();

        expect(pawn(container, '0-0').hasAttribute('data-moving'), 'the answer walked the pawn a second time').toBe(false);

        await elapse(300);

        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 13));

        cleanup();
        useBoard().close();
        answers.length = 0;

        const again = await live(first);
        const board = again.container.querySelector('.board-canvas') as HTMLElement;

        vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        board.dispatchEvent(new MouseEvent('pointerup', { clientX: spot.x, clientY: spot.y - CELL * 300, bubbles: true }));
        await elapse(600);

        expect(pawn(again.container, '0-0').style.translate).toBe(onSquare('red', 13));

        answers[0]('stale');
        await elapse(700);

        expect(pawn(again.container, '0-0').style.translate, 'a refused move was left where the reader put it').toBe(onSquare('red', 10));
        expect(stageOf(again.container).hasAttribute('data-presenting')).toBe(false);
        expect(marked(again.container), 'a refused move left its square unmarked').toEqual(['0-0']);
    });

    it('takes a press on the marked square as a press on the pawn that would land there', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], 3, 0);
        const move = vi.spyOn(useBoard(), 'move').mockResolvedValue('now');
        const { container } = await live(seen(before, 0, 1));
        const host = container.querySelector('.board-canvas') as HTMLElement;
        const cell = cellAt('red', 13)!;
        const spot = centreOf(cell.col, cell.row, 1000);

        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        host.dispatchEvent(new MouseEvent('pointerup', { clientX: spot.x, clientY: spot.y, bubbles: true }));
        await flush();

        expect(move).toHaveBeenCalledWith(0);
        expect(pawn(container, '0-0').hasAttribute('data-moving')).toBe(true);
    });

    const named = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.lp-hit[role="button"]')].map((one) => one.getAttribute('aria-label'));

    const rollWith = (container: HTMLElement, detail: number) => container.querySelector('.board-roll')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));

    it('names every pawn that may move for somebody who cannot see the board, in both languages, on a board that is a group and not a picture', async () =>
    {
        quiet();

        const { container } = await live(seen(standing([[10, FINISHED - 2, YARD, YARD], [38, YARD, YARD, YARD]], 2, 0), 0, 1));

        expect(named(container)).toEqual(['Token 1: move 2 squares and send a token home', 'Token 2: move 2 squares and reach home']);
        expect(container.querySelector('.board-plate')!.getAttribute('role')).toBe('group');
        expect(container.querySelector('.board-plate')!.getAttribute('aria-label')).toBe(useLocale().t('match.board'));
        expect(container.querySelector('.board-canvas')!.hasAttribute('aria-hidden'), 'the pawns that can be pressed are hidden from a screen reader').toBe(false);

        useLocale().setLocale('fa');
        await flush();

        const persian = named(container);

        expect(persian).toHaveLength(2);
        expect(persian.every((line) => line !== null && /[؀-ۿ]/.test(line) && !line.includes('{')), persian.join(' | ')).toBe(true);
        expect(persian[0]).not.toBe(persian[1]);
    });

    it('names a single square as one, and every pawn of a yard that may come out by the one way out', async () =>
    {
        quiet();

        const one = await live(seen(standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 1, 0), 0, 1));

        expect(named(one.container)).toEqual(['Token 1: move 1 square']);

        cleanup();
        useBoard().close();

        const out = await live(seen(standing([EMPTY, [26, YARD, YARD, YARD]], 6, 0), 0, 1));

        expect(named(out.container)).toEqual(Array.from({ length: 4 }, () => 'Bring a token out of the yard and send a token home'));

        cleanup();
        useBoard().close();

        const free = await live(seen(standing([EMPTY, [5, YARD, YARD, YARD]], 6, 0), 0, 1));

        expect(named(free.container)).toEqual(Array.from({ length: 4 }, () => 'Bring a token out of the yard'));
    });

    it('hands the keyboard from the die to a pawn that may move and back to the die, for a reader who rolled with a key', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 6 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });
        const here = { id: 'match-keys', tableId: 'table-keys' };

        matches.play = async (request: { input: { play: { verb: string } } }) => (request.input.play.verb === 'roll'
            ? { applied: 'now', match: seen(rolled.state, 0, 2, here), events: [happened(2, 0, rolled.moves)] }
            : { applied: 'now', match: seen(moved.state, 0, 3, here), events: [happened(3, 0, moved.moves)] });

        const container = await seated(seen(before, 0, 1, here));

        rollWith(container, 0);
        await elapse(1400);

        const on = document.activeElement as HTMLElement;

        expect(on.classList.contains('lp-hit'), 'the keyboard was left on nothing when the pawns lit up').toBe(true);
        expect(on.parentElement!.dataset.key).toBe('0-0');
        expect(on.getAttribute('aria-label')).toBe('Token 1: move 6 squares');

        on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await elapse(1500);

        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 16));
        expect(document.activeElement, 'the keyboard was not handed back to the die').toBe(container.querySelector('.board-roll'));

        delete matches.play;
    });

    it('leaves the keyboard alone after a roll made with a pointer, and wherever the reader has put it off the table', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const elsewhere = document.createElement('input');
        const first = { id: 'match-mouse', tableId: 'table-mouse' };
        const second = { id: 'match-away', tableId: 'table-away' };

        matches.play = async (request: { params: { id: string } }) => ({ applied: 'now', match: seen(rolled.state, 0, 2, request.params.id === first.id ? first : second), events: [happened(2, 0, rolled.moves)] });
        document.body.append(elsewhere);

        const container = await seated(seen(before, 0, 1, first));

        await flush();

        expect(document.activeElement, 'the die took the keyboard from a reader who had not touched it').toBe(document.body);

        rollWith(container, 1);
        await elapse(1400);

        expect(lit(container)).toEqual(['0-0']);
        expect(document.activeElement?.classList.contains('lp-hit') ?? false, 'a roll made with a mouse moved the keyboard onto a pawn').toBe(false);

        cleanup();
        useBoard().close();

        const again = await seated(seen(before, 0, 1, second));

        rollWith(again, 0);
        elsewhere.focus();
        await elapse(1400);

        expect(lit(again)).toEqual(['0-0']);
        expect(document.activeElement, 'the keyboard was taken from where the reader had put it').toBe(elsewhere);

        elsewhere.remove();
        delete matches.play;
    });

    it('does not bring the keyboard back to the die from where the reader has since put it', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], null, 0);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 6 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });
        const here = { id: 'match-gone', tableId: 'table-gone' };
        const elsewhere = document.createElement('input');

        matches.play = async (request: { input: { play: { verb: string } } }) => (request.input.play.verb === 'roll'
            ? { applied: 'now', match: seen(rolled.state, 0, 2, here), events: [happened(2, 0, rolled.moves)] }
            : { applied: 'now', match: seen(moved.state, 0, 3, here), events: [happened(3, 0, moved.moves)] });
        document.body.append(elsewhere);

        const container = await seated(seen(before, 0, 1, here));

        rollWith(container, 0);
        await elapse(1400);
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        elsewhere.focus();
        await elapse(1500);

        expect(container.querySelector('.board-roll'), 'the roll did not come back').not.toBeNull();
        expect(document.activeElement).toBe(elsewhere);

        elsewhere.remove();
        delete matches.play;
    });

    it('gives the die the keyboard once it can be pressed, when the board came back before the answer to the move', async () =>
    {
        quiet();

        const focus = HTMLElement.prototype.focus;

        vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, ...args: Parameters<HTMLElement['focus']>)
        {
            if (!(this instanceof HTMLButtonElement && this.disabled))
            {
                focus.apply(this, args);
            }
        });

        const rolled = standing([[10, YARD, YARD, YARD], EMPTY], 6, 0);
        const moved = stepped(rolled, { kind: 'move', seat: 0, piece: 0 });
        const here = { id: 'match-push', tableId: 'table-push' };

        socket.reset();
        matches.since = async () => ({ match: seen(rolled, 0, 1, here), events: [] });

        const stops = [useRealtime().start(), useBoard().start()];

        socket.accept();

        try
        {
            const container = await seated(seen(rolled, 0, 1, here));
            const under = container.querySelector<HTMLElement>('.lp[data-key="0-0"] .lp-hit')!;

            under.focus();
            under.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            await flush();

            const sent = socket.sent.filter((frame) => frame.t === 'play').at(-1)!;

            expect(sent, 'the move did not go over the socket').toBeDefined();

            socket.deliver({ v: 1, t: 'game', n: 3, at: 400_000, match: seen(moved.state, 0, 2, here), events: [happened(2, 0, moved.moves)] });
            await elapse(1200);

            expect(container.querySelector<HTMLButtonElement>('.board-roll')?.disabled, 'the die was not held while the move was still being answered').toBe(true);

            socket.deliver({ v: 1, t: 'ack', n: 4, key: sent.key, match: seen(moved.state, 0, 2, here), applied: 'now', events: [happened(2, 0, moved.moves)] });
            await elapse(200);

            expect(document.activeElement, 'the keyboard was not handed back to the die').toBe(container.querySelector('.board-roll'));
        }
        finally
        {
            for (const stop of stops.reverse())
            {
                stop();
            }

            useBoard().reset();
            useRealtime().reset();
            socket.reset();
            delete matches.since;
        }
    });

    it('plays nothing that happened before the board could be drawn', async () =>
    {
        quiet();

        const before = standing([[10, YARD, YARD, YARD], EMPTY], 3, 0);
        const moved = stepped(before, { kind: 'move', seat: 0, piece: 0 });
        const { container, tell } = await live(seen(before, 1, 1), false);

        expect(container.querySelector('.lp')).toBeNull();

        tell(seen(moved.state, 1, 2), [happened(2, 0, moved.moves)]);
        await drawn(container);

        expect(pawn(container, '0-0').hasAttribute('data-moving')).toBe(false);
        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 13));
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });

    it('tells whoever drew it when it is playing, when it has finished, and when it is taken down', async () =>
    {
        quiet();

        const heard: boolean[] = [];
        const before = standing([[10, YARD, YARD, YARD], EMPTY], 3, 0);
        const moved = stepped(before, { kind: 'move', seat: 0, piece: 0 });
        const { container, tell } = await live(seen(before, null, 1), true, {
            onPresenting: (busy) =>
            {
                heard.push(busy);
            }
        });

        expect(heard, 'a board at rest said it was playing').not.toContain(true);

        tell(seen(moved.state, null, 2), [happened(2, 0, moved.moves)]);
        await flush();

        expect(heard.at(-1)).toBe(true);
        expect(pawn(container, '0-0').hasAttribute('data-moving')).toBe(true);

        const before2 = heard.length;

        cleanup();

        expect(heard.slice(before2), 'a board taken down in the middle of a move left whoever drew it waiting').toEqual([false]);
    });

    it('is not called over, for somebody watching, before the board has shown how it ended', async () =>
    {
        quiet();
        vi.spyOn(usePeople(), 'want').mockImplementation(async () => undefined);

        const { before, after } = closing();
        const [watch, setWatch] = createSignal<Watched>({ match: seen(before, null, 1), behind: 30, delay: 30, live: true });
        const [told, setTold] = createSignal<EventBatch>(NO_EVENTS);
        const { container } = renderTest(() => WatchBoard({
            get watch()
            {
                return watch();
            },
            get events()
            {
                return told();
            },
            onDone: () => undefined
        }) as Rendered);
        const over = () => container.textContent?.includes(useLocale().t('watch.finished')) ?? false;
        const back = () => [...container.querySelectorAll('button')].some((one) => one.textContent?.trim() === useLocale().t('watch.back'));

        await drawn(container);
        await flush();

        batch(() =>
        {
            setWatch({ match: wonBy(after.state, null, 2), behind: 0, delay: 30, live: false });
            setTold({ seq: 1, id: 'match-9', events: [happened(2, 1, after.moves)], live: true, jump: false });
        });
        await flush();

        expect(stageOf(container).getAttribute('data-presenting'), 'the end of the game was not played').toBe('true');
        expect(over(), 'the game was called over while its last pawn was still walking').toBe(false);
        expect(back()).toBe(false);
        expect(container.querySelector('.table-result')).toBeNull();

        const clock = runtime().clock as ManualClock;
        let early = 0;

        for (let step = 0; step < 200; step += 1)
        {
            clock.advance(10);
            await flush();

            if ((over() || back()) && stageOf(container).hasAttribute('data-presenting'))
            {
                early += 1;
            }
        }

        expect(early, 'the frame said the game was over under a board still showing it').toBe(0);
        expect(over()).toBe(true);
        expect(back()).toBe(true);
        expect(container.querySelector('.table-result')).not.toBeNull();
    });

    it('draws a new game at the same board from its beginning', async () =>
    {
        quiet();

        const before = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD]], null, 0);
        const { container, move } = await live(seen(before, 0, 7));

        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 10));

        move(seen(standing([EMPTY, EMPTY], null, 0), 0, 1, { id: 'match-10' }));
        await flush();

        expect(container.querySelectorAll('.lp[data-moving]')).toHaveLength(0);
        expect(container.querySelectorAll('.lp')).toHaveLength(8);
        expect(pawn(container, '0-0').style.translate).not.toBe(onSquare('red', 10));
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });
});
