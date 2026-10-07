import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import MatchBoard from '../src/components/games/match-board.component.azeroth';
import { seatsFor } from '../src/components/games/seats.ts';
import { ludoOf } from '../src/data/match.ts';
import { CELL, centreOf } from '../src/game/layout.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import type { MatchView } from '../src/api.ts';
import { FINISHED } from '../../backend/src/domains/match/ludo/board.ts';
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

describe('the ludo table, two against two', () =>
{
    const platesOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.yard-badge .table-plate')];

    const tagsOf = (container: HTMLElement) => platesOf(container).map((plate) => plate.querySelector('.table-plate-tag')?.textContent ?? null);

    const sidesSaid = (container: HTMLElement) => platesOf(container).map((plate) => plate.querySelector('.table-plate-team .sr-only')?.textContent ?? null);

    const paintOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.yard-badge')]
        .map((badge) => ['--team-a', '--team-b'].map((tone) => badge.style.getPropertyValue(tone)));

    const stripOf = (container: HTMLElement) => container.querySelector('.table-bar p[aria-live="polite"]')?.textContent ?? null;

    const linesOf = (container: HTMLElement) => [...container.querySelectorAll('.table-bar p')].map((line) => line.textContent ?? '');

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

        expect(tagsOf(container)[2]).toBe(locale.plural('match.missed', 1));
        expect(sidesSaid(container)[2]).toBe(locale.t('card.partner'));
    });

    it('tells a reader whose four are home whose tokens they are moving, on the strip, on the plate and over the moves', async () =>
    {
        const locale = useLocale();
        const waiting = await show(pairs({}, handedOver()));

        expect(stripOf(waiting)).toBe(locale.t('match.turn.helping', { name: nameOf('reza.t') }));
        expect(tagsOf(waiting)).toEqual([locale.t('card.helping'), null, locale.t('card.partner'), null]);
        expect(linesOf(waiting)).not.toContain(locale.t('match.moves.for', { name: nameOf('reza.t') }));

        cleanup();
        useBoard().close();

        const rolled = await show(pairs({}, handedOver({ die: 3, moves: [0] })));

        expect(stripOf(rolled)).toBe(locale.t('match.turn.rolled', { die: '3' }));
        expect(linesOf(rolled)).toContain(locale.t('match.moves.for', { name: nameOf('reza.t') }));
        expect(rolled.querySelectorAll('.table-bar ul button')).toHaveLength(1);
    });

    it('puts no name over the moves of a reader moving their own tokens', async () =>
    {
        const locale = useLocale();
        const container = await show(pairs({}, { die: 6, moves: [0] }));

        expect(container.querySelectorAll('.table-bar ul button')).toHaveLength(1);
        expect(linesOf(container).some((line) => line === locale.t('match.moves.for', { name: nameOf('reza.t') }) || line === locale.t('match.moves.for', { name: nameOf('alex') }))).toBe(false);
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
                }
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
