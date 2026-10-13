import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@azerothjs/testing';

import { CARD_FLY, CARD_GAP, CHIP_FLY, DISC_GAP, GATHER, GATHER_GAP, POT_FLY, POT_GAP, RACK, RUN_OUT, SHOW_LEAST, SHOW_LINGER, TURN } from '../src/game/poker-beats.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { BLINDS, EVERYBODY, backs, discs, elapse, faced, flown, heard, match, namedAt, places, pocketed, pot, rows, seated, shownAt, stack, told } from './poker-mounted.ts';

const LONG = 12000;

const BOARD = [1, 15, 29, 43, 8];

const CALLED = CHIP_FLY + 2 * DISC_GAP;

const GATHERED = GATHER + 2 * DISC_GAP + GATHER_GAP;

const HAND = TURN + CARD_GAP;

const folded = { folded: true };

const river = () => match(
    {
        street: 'river',
        board: BOARD,
        turn: 2,
        pot: 250,
        pots: [{ amount: 250, eligible: [1, 2] }],
        hole: [],
        seats: rows({ 0: folded, 1: { stack: 1360, bet: 60 }, 2: { stack: 1420 }, 3: { stack: 1490, ...folded }, 4: { stack: 1480, ...folded }, 5: folded })
    },
    { turn: 2 }
);

const dealt: Parameters<typeof told>[2][] = [
    { e: 'end', hand: 1, dealt: EVERYBODY },
    { e: 'deal', hand: 2, button: 3, small: 10, big: 20 },
    { e: 'blind', seat: 4, amount: 10 },
    { e: 'blind', seat: 5, amount: 20 }
];

const tabled = (winners: number[]) => heard(1, told(
    8,
    2,
    { e: 'call', seat: 2, amount: 60 },
    { e: 'show', seat: 1, cards: [5, 18], category: 'pair' },
    { e: 'show', seat: 2, cards: [7, 20], category: 'two-pair' },
    { e: 'pot', amount: 310, winners },
    ...dealt
));

const second = (turn: number, stacks: Record<number, number> = { 2: 1670 }, gone: readonly number[] = []) => match(
    {
        hand: 2,
        button: 3,
        turn,
        hole: [4, 17],
        blinds: { small: 10, big: 20, level: 1, next: 9 },
        seats: rows({
            0: { stack: stacks[0] ?? 1500 },
            1: { stack: stacks[1] ?? 1360, out: gone.includes(1) },
            2: { stack: stacks[2] ?? 1360 },
            3: { stack: 1490 },
            4: { stack: 1470, bet: 10 },
            5: { stack: 1480, bet: 20 }
        }),
        ...(turn === 0 ? { toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 } : {})
    },
    { rev: 8, turn }
);

const placed = (clone: HTMLElement) => [clone.style.left, clone.style.top, clone.style.width];

const said = (container: HTMLElement) => [...container.querySelectorAll('.table-fit > p[aria-live="polite"]')].map((one) => one.textContent ?? '');

const until = async (met: () => boolean, most = LONG) =>
{
    let waited = 0;

    while (!met() && waited < most)
    {
        await elapse(10);
        waited += 10;
    }

    return waited;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useSettings().reset();
    places();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('a hand of poker that ends in front of the table', () =>
{
    it('turns a hand over where it lies, each card growing from its back to a face that can be read, the second a beat after the first, and names it when both are up', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, read } = await seated(river());

        expect([backs(container, 1), backs(container, 2)]).toEqual([2, 2]);

        await read(second(1), tabled([2]));
        await elapse(CALLED + GATHERED);

        const [first] = flown(container);
        const grown = animate.mock.calls.filter((_, at) => animate.mock.contexts[at] === first).flatMap((call) => (call[0] as Keyframe[]).map((frame) => frame.scale)).filter((scale) => scale !== undefined);

        expect(backs(container, 1), 'the backs lay under the hand that was being turned over').toBe(0);
        expect(container.querySelector('.poker-seat[data-seat="1"] .poker-backs'), 'the place of the cards was given up while they turned').not.toBeNull();
        expect(flown(container).map(placed), 'the cards were not turned over into the places of their faces').toEqual([['86px', '550px', '20px'], ['100px', '550px', '20px']]);
        expect(flown(container).every((one) => one.classList.contains('turning') && one.querySelector('.card-face') !== null)).toBe(true);
        expect(grown[0], 'the card did not start at the size of the back it was turned from').toBe('0.6 0.6');
        expect(grown.at(-1), 'the card did not end at the size of its face').toBe('1 1');
        expect([shownAt(container, 1), namedAt(container, 1)], 'a hand was on the table before it had been turned over').toEqual([[], '']);
        expect(backs(container, 2), 'the hand that is shown second was turned with the first').toBe(2);

        await elapse(TURN - 10);

        expect(shownAt(container, 1), 'a card lay face up under the card that was still turning into it').toEqual([]);

        await elapse(10);

        expect([shownAt(container, 1), namedAt(container, 1), flown(container).length], 'the first card was not face up when its own turn ended, or the hand was named on one card').toEqual([[5], '', 1]);

        await elapse(CARD_GAP - 10);

        expect(shownAt(container, 1)).toEqual([5]);

        await elapse(10);

        expect(shownAt(container, 1)).toEqual([5, 18]);
        expect(namedAt(container, 1)).toBe('a pair');
        expect(container.querySelector<HTMLElement>('.poker-seat[data-seat="1"] .poker-named')?.dataset.placed, 'the name of a hand was not seated by the solver that seats a bet, the moment it was written').toBe('true');
        expect(container.querySelectorAll('.poker-seat[data-seat="1"] .card-back').length, 'the backs of a hand that is face up were still drawn').toBe(0);
        expect(container.querySelector('.poker-seat[data-seat="1"] .poker-shown')?.getAttribute('aria-label'), 'the cards of a hand that is shown have no name to be read by').toMatch(/\S+ and \S+/);

        expect(await until(() => shownAt(container, 2).length === 2), 'the second hand was not turned over straight after the first').toBeLessThanOrEqual(HAND + 10);
        expect(shownAt(container, 2)).toEqual([7, 20]);
        expect(namedAt(container, 2)).toBe('two pair');
        expect(flown(container)).toEqual([]);
    });

    it('shows the reader’s own hand by naming it: their cards lie face up in front of them already, and nothing is turned', async () =>
    {
        const mine = match(
            {
                street: 'river',
                board: BOARD,
                turn: 0,
                toCall: 60,
                pot: 250,
                pots: [{ amount: 250, eligible: [0, 1] }],
                seats: rows({ 0: { stack: 1420 }, 1: { stack: 1360, bet: 60 }, 2: folded, 3: { stack: 1490, ...folded }, 4: { stack: 1480, ...folded }, 5: folded })
            },
            { turn: 0 }
        );
        const { container, read } = await seated(mine);

        await read(second(1, { 0: 1670, 2: 1500 }), heard(1, told(
            8,
            0,
            { e: 'call', seat: 0, amount: 60 },
            { e: 'show', seat: 0, cards: [0, 13], category: 'pair' },
            { e: 'show', seat: 1, cards: [5, 18], category: 'high-card' },
            { e: 'pot', amount: 310, winners: [0] },
            ...dealt
        )));
        await elapse(CALLED + GATHERED);

        expect(namedAt(container, 0), 'the reader’s hand was not named when they showed it').toBe('a pair');
        expect(flown(container), 'the reader’s cards were turned over though they lie face up').toEqual([]);
        expect(pocketed(container)).toBe(2);
        expect(container.querySelector('.poker-seat[data-seat="0"] .poker-shown'), 'the reader’s hand was drawn twice').toBeNull();
        expect(backs(container, 1), 'the hand shown after the reader’s was turned with it').toBe(2);

        await until(() => shownAt(container, 1).length === 2);

        expect([shownAt(container, 1), namedAt(container, 1), namedAt(container, 0)]).toEqual([[5, 18], 'high card', 'a pair']);

        await until(() => stack(container, 0) === '1,670');

        expect([namedAt(container, 0), namedAt(container, 1)]).toEqual(['a pair (won)', 'high card']);
    });

    it('turns every hand over for somebody watching, who has none of their own, and marks the one that won', async () =>
    {
        const { container, read } = await seated({ ...river(), mine: undefined });

        await read({ ...second(1), mine: undefined }, tabled([2]));
        await until(() => shownAt(container, 2).length === 2);

        expect([shownAt(container, 1), shownAt(container, 2), namedAt(container, 1), namedAt(container, 2)]).toEqual([[5, 18], [7, 20], 'a pair', 'two pair']);
        expect(container.querySelector('.poker-hand'), 'somebody watching was given a hand of their own').toBeNull();

        await until(() => pot(container) === 'Total pot 0');

        expect([namedAt(container, 1), namedAt(container, 2)]).toEqual(['a pair', 'two pair (won)']);

        await until(() => stack(container, 2) === '1,670');
        await elapse(LONG);

        expect(container.querySelectorAll('.poker-shown, .poker-named'), 'the hands of a hand that is over were left in front of somebody watching').toHaveLength(0);
    });

    it('holds a showdown for the table to read before the pot is pushed', async () =>
    {
        const { container, read } = await seated(river());

        await read(second(1), tabled([2]));
        await elapse(CALLED + GATHERED + 2 * HAND);

        expect(shownAt(container, 2)).toEqual([7, 20]);

        await elapse(SHOW_LINGER - 10);

        expect([pot(container), discs(container).length], 'the pot was pushed before the hands could be read').toEqual(['Total pot 310', 0]);

        await elapse(10);

        expect(pot(container)).toBe('Total pot 0');
    });

    it('holds it for less when the reader is to act in the hand after', async () =>
    {
        const { container, read } = await seated(river());

        await read(second(0), tabled([2]));
        await elapse(CALLED + GATHERED + 2 * HAND + SHOW_LEAST - 10);

        expect([pot(container), shownAt(container, 2)], 'a reader who is to act was not shown the hands at all').toEqual(['Total pot 310', [7, 20]]);

        await elapse(10);

        expect(pot(container), 'a reader who is to act waited as long as one who is not').toBe('Total pot 0');
    });

    it('pays a pot in chips: the total drops as they leave, the winner’s stack counts them when they land, and the hand that won is marked', async () =>
    {
        const { container, read } = await seated(river());

        await read(second(0), tabled([2]));
        await elapse(CALLED + GATHERED + 2 * HAND + SHOW_LEAST - 10);

        expect([namedAt(container, 1), namedAt(container, 2)], 'a hand was marked as the winner before the pot was pushed').toEqual(['a pair', 'two pair']);
        expect(said(container)[1], 'somebody who cannot see the table was told who won before the pot was pushed').toBe('');

        await elapse(10);

        expect(said(container)[1], 'somebody who cannot see the table was not told who won the pot, and with what').toBe('sara.k won 310 with two pair');

        expect(discs(container).map(placed), 'the pot did not go to the plate of its winner, in five discs').toEqual(Array.from({ length: 5 }, () => ['195px', '515px', '10px']));
        expect([pot(container), stack(container, 2)], 'the chips were counted before they had landed').toEqual(['Total pot 0', '1,360']);
        expect([namedAt(container, 1), namedAt(container, 2)]).toEqual(['a pair', 'two pair (won)']);

        await elapse(POT_FLY + 4 * POT_GAP - 10);

        expect(stack(container, 2)).toBe('1,360');

        await elapse(10);

        expect(stack(container, 2)).toBe('1,670');
        expect(discs(container)).toEqual([]);
    });

    it('splits a pot between its winners, each paid at their own plate', async () =>
    {
        const { container, read } = await seated(river());
        const share = Array.from({ length: 4 }, (_, at) => at);

        await read(second(1, { 1: 1515, 2: 1515 }), tabled([1, 2]));
        await elapse(CALLED + GATHERED + 2 * HAND + SHOW_LINGER);

        expect(discs(container).map(placed)).toEqual([...share.map(() => ['135px', '615px', '10px']), ...share.map(() => ['195px', '515px', '10px'])]);
        expect([namedAt(container, 1), namedAt(container, 2)]).toEqual(['a pair (won)', 'two pair (won)']);
        expect([stack(container, 1), stack(container, 2)]).toEqual(['1,360', '1,360']);

        await elapse(POT_FLY + 3 * POT_GAP);

        expect([stack(container, 1), stack(container, 2), pot(container)]).toEqual(['1,515', '1,515', 'Total pot 0']);
    });

    it('plays a run-out the way a table does: the chips nobody called go back, the hands are turned over, only then do the streets come, a beat before each, and the pot when the board has been read', async () =>
    {
        const shoved = match(
            {
                turn: 2,
                pot: 1530,
                pots: [{ amount: 1530, eligible: [1, 2] }],
                hole: [],
                seats: rows({ 0: folded, 1: { stack: 0, bet: 1500, allIn: true }, 2: { stack: 1000 }, 3: { stack: 1490, bet: 10, ...folded }, 4: { stack: 1480, bet: 20, ...folded }, 5: folded })
            },
            { turn: 2 }
        );
        const { container, read } = await seated(shoved);
        const seen: string[] = [];
        const when: Record<string, number> = {};
        const street = RUN_OUT + CARD_FLY + TURN;
        let waited = 0;
        const note = (what: string, met: boolean) =>
        {
            if (met && !seen.includes(what))
            {
                seen.push(what);
                when[what] = waited;
            }
        };

        await read(second(1, { 1: 500, 2: 2030 }), heard(1, told(
            8,
            2,
            { e: 'allin', seat: 2, amount: 1000 },
            { e: 'board', street: 'flop', cards: [1, 15, 29] },
            { e: 'board', street: 'turn', cards: [43] },
            { e: 'board', street: 'river', cards: [8] },
            { e: 'refund', seat: 1, amount: 500 },
            { e: 'show', seat: 1, cards: [5, 18], category: 'pair' },
            { e: 'show', seat: 2, cards: [7, 20], category: 'two-pair' },
            { e: 'pot', amount: 2030, winners: [2] },
            ...dealt
        )));

        for (; waited < LONG && seen.length < 7; waited += 10)
        {
            note('chips back', stack(container, 1) === '500');
            note('first hand', shownAt(container, 1).length === 2);
            note('second hand', shownAt(container, 2).length === 2);
            note('flop', faced(container) === 3);
            note('turn', faced(container) === 4);
            note('river', faced(container) === 5);
            note('pot', pot(container) === 'Total pot 0');
            await elapse(10);
        }

        expect(seen).toEqual(['chips back', 'first hand', 'second hand', 'flop', 'turn', 'river', 'pot']);
        expect([Math.abs(when.turn - when.flop - street), Math.abs(when.river - when.turn - street)].every((off) => off <= 10), `a street of a run-out came ${ when.turn - when.flop } and ${ when.river - when.turn } ms after the one before, not a beat and its own time`).toBe(true);
        expect(Math.abs(when.pot - when.river - SHOW_LINGER), 'the pot of a run-out was pushed before its board could be read').toBeLessThanOrEqual(10);

        await elapse(LONG);

        expect([stack(container, 1), stack(container, 2), pot(container)]).toEqual(['500', '2,030', 'Total pot 30']);
    });

    it('sweeps the hands that were shown to the dealer face up when the next is dealt, with the board', async () =>
    {
        const { container, read } = await seated(river());

        await read(second(1), tabled([2]));
        await until(() => pot(container) === 'Total pot 0');
        await until(() => flown(container).length > 0);

        const leaving = flown(container).map((one) => [one.style.width, one.querySelector('.card-face') !== null, one.classList.contains('stack')]);

        expect(leaving.filter(([wide]) => wide === '20px'), 'the hands that were shown did not leave for the dealer face up, at the size they had').toEqual(Array.from({ length: 4 }, () => ['20px', true, false]));
        expect(leaving.filter(([wide]) => wide === '24px')).toHaveLength(5);
        expect(leaving).toHaveLength(9);
        expect([shownAt(container, 1), shownAt(container, 2), namedAt(container, 1), namedAt(container, 2)], 'the hands of a hand that is over were on the table when the next was dealt').toEqual([[], [], '', '']);

        await elapse(LONG);

        expect([1, 2, 3, 4, 5].map((seat) => backs(container, seat))).toEqual([2, 2, 2, 2, 2]);
        expect(container.querySelectorAll('.poker-shown, .poker-named')).toHaveLength(0);
    });

    it('sweeps the hand of somebody the showdown put out to the dealer face up, when they are told to be out', async () =>
    {
        const { container, read } = await seated(river());

        await read(second(1, { 2: 1670 }, [1]), heard(1, told(
            8,
            2,
            { e: 'call', seat: 2, amount: 60 },
            { e: 'show', seat: 1, cards: [5, 18], category: 'pair' },
            { e: 'show', seat: 2, cards: [7, 20], category: 'two-pair' },
            { e: 'pot', amount: 310, winners: [2] },
            { e: 'end', hand: 1, dealt: EVERYBODY },
            { e: 'bust', seat: 1, place: 6, by: [2] },
            { e: 'deal', hand: 2, button: 3, small: 10, big: 20 },
            { e: 'blind', seat: 4, amount: 10 },
            { e: 'blind', seat: 5, amount: 20 }
        )));
        await until(() => pot(container) === 'Total pot 0');
        await until(() => flown(container).length > 0);

        const leaving = flown(container).map((one) => [one.style.width, one.querySelector('.card-face') !== null, one.classList.contains('stack')]);

        expect(leaving.filter(([wide]) => wide === '20px'), 'the hand of the seat that went out and the hand that won did not both leave face up').toEqual(Array.from({ length: 4 }, () => ['20px', true, false]));
        expect(leaving.some(([, , stacked]) => stacked), 'a hand that lay face up left for the dealer as backs').toBe(false);
        expect(container.querySelector<HTMLElement>('.poker-seat[data-seat="1"] .table-plate')?.dataset.dim).toBe('true');

        await elapse(LONG);

        expect([1, 2, 3, 4, 5].map((seat) => backs(container, seat)), 'a seat that is out was dealt into the next hand').toEqual([0, 2, 2, 2, 2]);
    });

    it('keeps the tilt cards lie at: a card is turned from the tilt of its back to the tilt of its face, and leaves for the dealer from there', async () =>
    {
        const real = globalThis.getComputedStyle.bind(globalThis);

        vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) =>
        {
            const style = real(element, pseudo);
            const tilt = element.classList.contains('poker-face') ? '-4deg' : (element.classList.contains('card-back') ? '-5deg' : null);

            return tilt === null ? style : new Proxy(style, { get: (target, key) => (key === 'rotate' ? tilt : Reflect.get(target, key) as unknown) });
        });

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, read } = await seated(river());
        const tilts = (clone: Element) => animate.mock.calls
            .filter((_, at) => animate.mock.contexts[at] === clone)
            .flatMap((call) => (call[0] as Keyframe[]).map((frame) => frame.rotate))
            .filter((rotate) => rotate !== undefined);

        await read(second(1), tabled([2]));
        await elapse(CALLED + GATHERED);

        expect(tilts(flown(container)[0]), 'a card was straightened before it was turned over, or lay straight when it was up').toEqual(['-5deg', '-4deg']);

        await until(() => pot(container) === 'Total pot 0');
        await until(() => flown(container).length > 0);

        expect(flown(container).filter((one) => one.style.width === '20px').map((one) => tilts(one)[0]), 'a card that lay tilted was straightened as it left for the dealer').toEqual(['-4deg', '-4deg', '-4deg', '-4deg']);
    });

    it('racks the stack of somebody who walks out off the felt, and their plate goes dark when it has gone', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, read } = await seated(match());
        const plate = () => container.querySelector<HTMLElement>('.poker-seat[data-seat="5"] .table-plate');

        await read(match({ seats: rows({ ...BLINDS, 5: { stack: 0, out: true } }) }, { rev: 8 }), heard(1, told(8, 5, { e: 'forfeit', seat: 5, reason: 'left', place: 6 })));
        await elapse(10);

        const going = discs(container);

        expect(going, 'a stack of 1,500 did not leave in five discs').toHaveLength(5);
        expect((animate.mock.calls[animate.mock.contexts.lastIndexOf(going[0])][0] as Keyframe[]).at(-1)?.opacity, 'the discs of a stack that leaves the game were set down in full view on the rail').toBe(0);
        expect(going.map((one) => [Math.round(parseFloat(one.style.left)), Math.round(parseFloat(one.style.top))]), 'the discs did not go out over the rail behind the plate').toEqual(Array.from({ length: 5 }, () => [417, 173]));
        expect([stack(container, 5), plate()?.dataset.dim, backs(container, 5)], 'the plate went dark before its stack had gone').toEqual(['1,500', undefined, 2]);

        await elapse(RACK + 4 * DISC_GAP - 20);

        expect(plate()?.dataset.dim).toBeUndefined();

        await elapse(20);

        expect([stack(container, 5), plate()?.dataset.dim]).toEqual(['0', 'true']);
        expect(container.querySelector('.poker-seat[data-seat="5"] .poker-backs'), 'the cards of somebody who walked out stayed in front of them').toBeNull();
    });

    it('turns nothing over for somebody who asked for less motion, and still shows the hands and pays the pot', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { container, read } = await seated(river());
        const turning: number[] = [];

        await read(second(1), tabled([2]));

        for (let waited = 0; waited < LONG && pot(container) !== 'Total pot 0'; waited += 10)
        {
            turning.push(flown(container).filter((one) => one.classList.contains('turning')).length);
            await elapse(10);
        }

        expect(Math.max(...turning), 'a card was turned over in front of somebody who asked for less motion').toBe(0);
        expect([shownAt(container, 1), shownAt(container, 2)]).toEqual([[5, 18], [7, 20]]);

        await elapse(LONG);

        expect([stack(container, 2), pot(container)]).toEqual(['1,670', 'Total pot 30']);
    });

    it('shows the hand that won to somebody who opens a table whose game is over, and no hand of anybody who is out', async () =>
    {
        const over = match(
            {
                street: 'river',
                board: BOARD,
                pot: 0,
                pots: [],
                hole: [],
                winner: 2,
                last: { board: BOARD, shown: [{ seat: 1, cards: [5, 18], category: 'pair' }, { seat: 2, cards: [7, 20], category: 'two-pair' }], pots: [{ amount: 3000, winners: [2] }] },
                seats: rows({ 0: { stack: 0, out: true }, 1: { stack: 0, out: true }, 2: { stack: 9000 }, 3: { stack: 0, out: true }, 4: { stack: 0, out: true }, 5: { stack: 0, out: true } })
            },
            { turn: undefined, finishedAt: new Date(401_000).toISOString() }
        );
        const { container } = await seated(over);

        expect([shownAt(container, 2), namedAt(container, 2)]).toEqual([[7, 20], 'two pair (won)']);
        expect([shownAt(container, 1), namedAt(container, 1)], 'somebody who is out of the game still had a hand on the table').toEqual([[], '']);
    });
});
