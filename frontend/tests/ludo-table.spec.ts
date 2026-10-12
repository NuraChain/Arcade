import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { batch, createSignal } from 'azerothjs';

import MatchBoard from '../src/components/games/match-board.component.azeroth';
import WatchBoard from '../src/components/games/watch-board.component.azeroth';
import { seatsFor } from '../src/components/games/seats.ts';
import { ludoOf } from '../src/data/match.ts';
import { CELL, centreOf } from '../src/game/layout.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS, useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import type { Watched } from '../src/stores/watch.store.ts';
import type { MatchView } from '../src/api.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { FINISHED, YARD, cellAt, coloursFor } from '../../backend/src/domains/match/ludo/board.ts';
import { apply } from '../../backend/src/domains/match/ludo/engine.ts';
import type { EngineAction, LudoState } from '../../backend/src/domains/match/ludo/state.ts';
import * as turns from '../../backend/src/domains/match/turns.ts';
import { matchView } from '../../backend/src/schemas.ts';
import { client } from './fake-api.ts';

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

    it('offers a move nowhere but on the pawn: no list, no button, and no sentence on show', async () =>
    {
        const container = await show(ludo({}, { die: 6, moves: [0] }));
        const bar = container.querySelector('.table-bar') as HTMLElement;
        const drawn = [...bar.children].filter((one) => !one.classList.contains('sr-only'));

        expect(container.querySelectorAll('.table-stage button'), 'a move is offered as a button').toHaveLength(0);
        expect(container.querySelector('.table-stage ul')).toBeNull();
        expect(bar.querySelector('p[aria-live="polite"]')?.classList.contains('sr-only')).toBe(true);
        expect(drawn.every((one) => one.getAttribute('role') === 'note' || one.classList.contains('ludo-clock') || one.classList.contains('ludo-upright')), drawn.map((one) => one.className).join(' | ')).toBe(true);
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

        expect(plateDie(container, 0), 'the plate told the roll while the die was still turning').toBeNull();

        await elapse(700);

        expect(plateDie(container, 0)).not.toBeNull();
        expect(plateDie(container, 1)).toBeNull();

        tell(seen(moved.state, 1, 3), [happened(3, 0, moved.moves)]);
        await flush();

        expect(plateDie(container, 0)).toBeNull();
        expect(pawn(container, '0-0').hasAttribute('data-moving')).toBe(true);

        await elapse(700);

        expect(pawn(container, '0-0').style.translate).toBe(onSquare('red', 13));
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

        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        host.dispatchEvent(new MouseEvent('pointerup', { clientX: spot.x, clientY: spot.y - CELL * 300, bubbles: true }));
        await flush();

        expect(move).toHaveBeenCalledWith(0);
        expect(pawn(container, '0-0').hasAttribute('data-moving'), 'the pawn waited for the server').toBe(true);

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
        vi.spyOn(usePeople(), 'want').mockImplementation(() => undefined);

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
