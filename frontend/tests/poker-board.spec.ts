import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import PokerBoard from '../src/components/games/poker-board.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { MatchView } from '../src/api.ts';
import { seatBets, type Box } from '../src/game/chip-spot.ts';

type Rendered = HTMLElement;

type Poker = Extract<MatchView['view'], { kind: 'poker' }>;

const HANDLES = ['dana.w', 'omid.k', 'sara.k', 'reza.t', 'mina', 'leila.a'];

const match = (view: Partial<Poker>, mine: number | null = 0, seats = 6): MatchView => ({
    id: 'match-pk',
    tableId: 'table-pk',
    game: 'poker',
    rev: 7,
    seats,
    players: Array.from({ length: seats }, (_, seat) => ({ seat, who: HANDLES[seat], timeouts: 0 })) as MatchView['players'],
    turn: 0,
    ...(mine === null ? {} : { mine }),
    startedAt: new Date(400_000).toISOString(),
    view: {
        kind: 'poker',
        street: 'preflop',
        hand: 1,
        button: 2,
        turn: 0,
        board: [],
        pot: 30,
        pots: [{ amount: 30, eligible: Array.from({ length: seats }, (_, seat) => seat) }],
        seats: Array.from({ length: seats }, (_, seat) => ({ seat, stack: 1500, bet: 0, folded: false, allIn: false, out: false })),
        blinds: { small: 10, big: 20, level: 1, next: 10 },
        hole: mine === null ? [] : [0, 13],
        ...view
    }
});

const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === label) as HTMLButtonElement | undefined;

const place = (container: HTMLElement, name: string): { x: number; y: number } =>
{
    const plate = [...container.querySelectorAll<HTMLElement>('.poker-seat')]
        .find((element) => element.querySelector('.table-plate-name')?.textContent === name)!;

    return { x: parseFloat(plate.style.getPropertyValue('--x')), y: parseFloat(plate.style.getPropertyValue('--y')) };
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useSettings().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('PokerBoard', () =>
{
    it('sits the reader at the bottom and deals to their LEFT, because poker passes clockwise', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({}) }) as Rendered);
        const me = place(container, 'You');
        const next = place(container, 'omid.k');
        const opposite = place(container, 'reza.t');

        expect(me.y).toBeGreaterThan(80);
        expect(next.x).toBeLessThan(50);
        expect(next.y).toBeGreaterThan(50);
        expect(opposite.y).toBeLessThan(20);
    });

    it('offers check and no fold when there is nothing to call', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 0 }) }) as Rendered);

        expect(button(container, 'Check')).toBeDefined();
        expect(button(container, 'Fold')).toBeUndefined();
    });

    it('offers fold and call when there is a bet to meet, and sends each as its verb', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20 }) }) as Rendered);

        fire(button(container, 'Fold')!, 'click');
        fire(button(container, 'Fold')!, 'click');
        fire(button(container, 'Call 20')!, 'click');

        expect(play.mock.calls.map((call) => call[0])).toEqual([
            { kind: 'poker', verb: 'fold' },
            { kind: 'poker', verb: 'call' }
        ]);
    });

    it('folds the reader’s own cards on the second press and never on the first, and lets them go when anything else is pressed', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20 }) }) as Rendered);
        const cards = () => button(container, 'Fold')!;

        await Promise.resolve();
        await Promise.resolve();

        expect(cards().querySelectorAll('.card-face')).toHaveLength(2);
        expect(cards().getAttribute('aria-pressed')).toBe('false');
        expect(container.querySelector('.poker-own > .contents > .sr-only')?.textContent, 'the cards stopped being said once they were the thing that folds').toMatch(/^Your cards: \S/);

        fire(cards(), 'click');

        expect(play).not.toHaveBeenCalled();
        expect(cards().getAttribute('aria-pressed')).toBe('true');
        expect(cards().dataset.armed).toBe('true');

        fire(container.querySelector('.poker-table')!, 'pointerdown');

        expect(cards().getAttribute('aria-pressed')).toBe('false');
        expect(cards().dataset.armed).toBeUndefined();

        fire(cards(), 'click');
        fire(document.body, 'pointerdown');

        expect(cards().dataset.armed, 'a press on the page outside the table left a fold armed').toBeUndefined();

        fire(cards(), 'click');
        fire(cards(), 'focusout');

        expect(cards().dataset.armed).toBeUndefined();

        fire(cards(), 'click');
        cards().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(cards().dataset.armed).toBeUndefined();
        expect(play).not.toHaveBeenCalled();

        fire(cards(), 'click');
        fire(cards(), 'pointerdown');

        expect(cards().dataset.armed).toBe('true');

        fire(cards(), 'click');

        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith({ kind: 'poker', verb: 'fold' });
    });

    it('draws no bar under the table and nothing in its corners: the turn is said to a screen reader alone, the seconds are on the reader’s own plate and the tip is the last thing in their hand', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: { ...match({ toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500, seats: Array.from({ length: 6 }, (_, seat) => ({ seat, stack: 1500, bet: seat === 4 ? 20 : 0, folded: false, allIn: false, out: false })) }), remainingMs: 20_000 }, turnMs: 30_000 }) as Rendered);
        const live = container.querySelector('[aria-live="polite"]')!;
        const mine = container.querySelector('.poker-seat[data-seat="0"]')!;
        const hand = container.querySelector('.poker-hand')!;

        expect(container.querySelector('.table-grid')!.classList.contains('poker-grid')).toBe(true);
        expect(container.querySelector('.table-grid > .table-bar')).toBeNull();
        expect(container.querySelector('.poker-bar, .table-corner, .poker-chips'), 'something stands under the table or in a corner of it again').toBeNull();
        expect(live.classList.contains('sr-only')).toBe(true);
        expect(live.textContent).toBe('Your turn. 20 to call.');
        expect(container.querySelectorAll('.poker-clock')).toHaveLength(1);
        expect([...mine.querySelectorAll('.table-plate-trail .poker-clock span')].map((one) => one.textContent?.trim())).toEqual(expect.arrayContaining(['20s', 'About 20s left']));
        expect(hand.lastElementChild?.getAttribute('role'), 'the tip is not the last thing in the hand').toBe('note');
        expect(hand.lastElementChild?.getAttribute('data-lamp')).toBe('true');
        expect(container.querySelectorAll('[role="note"]'), 'the tip is drawn in two places').toHaveLength(1);
        expect([...container.querySelectorAll('.poker-hand button')].map((one) => one.textContent?.trim())).toEqual(['Fold', 'Call 20', 'Raise']);
        expect([...container.querySelectorAll('button')].every((one) => one.closest('.poker-hand') !== null)).toBe(true);
    });

    it('draws no seconds on the plate of another seat that is on turn: the ring is its clock, and a screen reader is told the time', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: { ...match({ turn: 3 }), remainingMs: 20_000 }, turnMs: 30_000 }) as Rendered);
        const theirs = container.querySelector('.poker-seat[data-seat="3"]')!;

        expect(container.querySelector('.poker-clock'), 'a number is drawn on a plate that is not the reader\'s').toBeNull();
        expect(theirs.querySelector('.table-plate-clock'), 'the seat on turn has no ring').not.toBeNull();
        expect(theirs.querySelector('.table-plate-trail .sr-only')?.textContent).toContain('About 20s left');
        expect([...container.querySelectorAll('.poker-seat')].filter((seat) => seat.querySelector('.table-plate-trail .inline-flex') !== null).map((seat) => seat.getAttribute('data-seat')), 'a clock runs on a plate whose turn it is not').toEqual(['3']);
    });

    it('gives a seat that is not on turn its cards and nothing to press', () =>
    {
        const waiting = match({ toCall: 20, turn: 3 });
        const { container } = renderTest(() => PokerBoard({ match: { ...waiting, turn: 3 } }) as Rendered);

        expect(container.querySelectorAll('.poker-hand .card-face')).toHaveLength(2);
        expect(container.querySelector('ul.poker-hole')?.getAttribute('aria-label')).toBe('Your cards');
        expect(container.querySelectorAll('button')).toHaveLength(0);
    });

    it('puts the call in front of the reader at the press, and takes it back if the server refuses', async () =>
    {
        let answer: (outcome: 'stale') => void = () => undefined;
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20 }) }) as Rendered);

        fire(button(container, 'Call 20')!, 'click');

        expect(container.querySelector('.poker-bet')?.textContent).toContain('20');

        answer('stale');
        await Promise.resolve();
        await Promise.resolve();

        expect(container.querySelector('.poker-bet')).toBeNull();
    });

    it('raises to what the reader chose, and to the pot on the pot button', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => PokerBoard({
            match: match({ toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500, pot: 50, seats: Array.from({ length: 6 }, (_, seat) => ({ seat, stack: 1500, bet: seat === 4 ? 20 : 0, folded: false, allIn: false, out: false })) })
        }) as Rendered);

        fire(button(container, 'Raise')!, 'click');
        fire(button(container, 'Raise to 40')!, 'click');
        fire(button(container, 'Raise')!, 'click');
        fire(button(container, 'Pot')!, 'click');
        fire(button(container, 'Raise to 90')!, 'click');

        expect(play.mock.calls.map((call) => call[0])).toEqual([
            { kind: 'poker', verb: 'raise', amount: 40 },
            { kind: 'poker', verb: 'raise', amount: 90 }
        ]);
    });

    it('goes all in rather than raising when the whole stack is the only raise left', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20, minRaiseTo: 300, maxRaiseTo: 300 }) }) as Rendered);

        fire(button(container, 'All in, 300')!, 'click');

        expect(play).toHaveBeenCalledWith({ kind: 'poker', verb: 'allin' });
    });

    it('shows no raise at all when nobody is left who could answer one', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20 }) }) as Rendered);

        expect(container.textContent).not.toContain('Raise to');
        expect(container.querySelector('[role="slider"]')).toBeNull();
    });

    it('calls the pot in the middle the total, because it counts the bets still in front of the seats', () =>
    {
        const { container } = renderTest(() => PokerBoard({
            match: match({ pot: 70, seats: Array.from({ length: 6 }, (_, seat) => ({ seat, stack: 1500, bet: seat === 4 ? 40 : 0, folded: false, allIn: false, out: false })) })
        }) as Rendered);

        expect(container.textContent).toContain('Total pot 70');
        expect(container.querySelector('.poker-bet')?.textContent).toContain('40');
    });

    it('names a side pot only when somebody is all in', () =>
    {
        const even = renderTest(() => PokerBoard({ match: match({}) }) as Rendered);

        expect(even.container.textContent).not.toContain('side pot');
        even.unmount();

        const split = renderTest(() => PokerBoard({
            match: match({ pot: 650, pots: [{ amount: 300, eligible: [0, 1, 2] }, { amount: 350, eligible: [1, 2] }] })
        }) as Rendered);

        expect(split.container.textContent).toContain('side pot 350');
    });

    it('gives a spectator the table and nothing to press', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20 }, null) }) as Rendered);

        expect(container.querySelectorAll('button').length).toBe(0);
        expect(container.textContent).not.toContain('Your cards');
    });

    it('says who won the last hand, and with what', () =>
    {
        const { container } = renderTest(() => PokerBoard({
            match: match({ last: { board: [0, 1, 2, 3, 4], shown: [{ seat: 1, cards: [5, 6], category: 'flush' }], pots: [{ amount: 240, winners: [1] }] } })
        }) as Rendered);

        expect(container.textContent).toContain('omid.k won 240 with a flush');
    });

    it('names the best hand the reader holds and prices the call against the pot', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20, pot: 30 }) }) as Rendered);

        expect(container.textContent).toContain('Your best hand so far: a pair of twos.');
        expect(container.textContent).toContain('Calling costs 20 against a pot of 30.');
    });

    it('writes the hand over the reader\'s cards in a line of its own, and keeps the sentence for a screen reader', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20, pot: 30 }) }) as Rendered);
        const name = container.querySelector('.poker-own > .poker-hand-name')!;

        expect(name.textContent).toBe('a pair of twos');
        expect(name.getAttribute('aria-hidden')).toBe('true');
        expect(container.querySelector('.poker-own > .sr-only')?.textContent).toBe('Your best hand so far: a pair of twos.');
    });

    it('says when the hand is the board\'s and not the reader\'s', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({ street: 'river', board: [8, 9, 10, 11, 12], hole: [13, 27] }) }) as Rendered);

        expect(container.querySelector('.poker-hand-name')?.textContent).toMatch(/^The board: a straight flush, \S/);
        expect(container.querySelector('.poker-own > .sr-only')?.textContent).toMatch(/^You are playing the board: a straight flush, \S/);
    });

    it('keeps the row the reader\'s cards lie in when they fold, as two empty places, so the table does not change size', () =>
    {
        const seats = Array.from({ length: 6 }, (_, seat) => ({ seat, stack: 1500, bet: 0, folded: seat === 0, allIn: false, out: false }));
        const { container } = renderTest(() => PokerBoard({ match: match({ turn: 3, hole: [], seats }) }) as Rendered);

        expect(container.querySelector('.poker-hand'), 'the row went with the cards').not.toBeNull();
        expect(container.querySelectorAll('.poker-hand .poker-pocket')).toHaveLength(2);
        expect(container.querySelectorAll('.poker-hand .card-face')).toHaveLength(0);
        expect(container.querySelector('.poker-hand-name')?.textContent).toBe('');
        expect(container.querySelector('.poker-hand button')).toBeNull();
    });

    it('draws no row for somebody who is out of the game, or who is watching', () =>
    {
        const seats = Array.from({ length: 6 }, (_, seat) => ({ seat, stack: seat === 0 ? 0 : 1500, bet: 0, folded: false, allIn: false, out: seat === 0 }));
        const out = renderTest(() => PokerBoard({ match: match({ turn: 3, hole: [], seats }) }) as Rendered);

        expect(out.container.querySelector('.poker-hand')).toBeNull();
        out.unmount();

        const watching = renderTest(() => PokerBoard({ match: match({ turn: 3 }, null) }) as Rendered);

        expect(watching.container.querySelector('.poker-hand')).toBeNull();
    });

    it('says nothing about the hand or the price with the outcome helper off', () =>
    {
        useSettings().update({ hintOutcome: false });

        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20, pot: 30 }) }) as Rendered);

        expect(container.textContent).not.toContain('best hand');
        expect(container.textContent).not.toContain('Calling costs');
        expect(container.querySelector('.poker-hand-name'), 'a line is kept over the cards for a helper that is off').toBeNull();
        expect(button(container, 'Call 20')).toBeDefined();
    });

    it('coaches the rule in play, and goes quiet with the coach off', () =>
    {
        const on = renderTest(() => PokerBoard({ match: match({ toCall: 0 }) }) as Rendered);

        expect(on.container.querySelector('[role="note"]')?.textContent).toContain('There is nothing to call, so checking costs you nothing.');
        on.unmount();

        useSettings().update({ hintRules: false });

        const off = renderTest(() => PokerBoard({ match: match({ toCall: 0 }) }) as Rendered);

        expect(off.container.querySelector('[role="note"]')).toBeNull();
    });

    it('keeps every action with the move helper off, because the table lights nothing to switch off', () =>
    {
        useSettings().update({ hintMoves: false });

        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500, seats: Array.from({ length: 6 }, (_, seat) => ({ seat, stack: 1500, bet: seat === 4 ? 20 : 0, folded: false, allIn: false, out: false })) }) }) as Rendered);

        expect(button(container, 'Fold')).toBeDefined();
        expect(button(container, 'Call 20')).toBeDefined();
        expect(button(container, 'Raise')).toBeDefined();
    });

    it('gives a spectator no tip and no outcome', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20 }, null) }) as Rendered);

        expect(container.querySelector('[role="note"]')).toBeNull();
        expect(container.textContent).not.toContain('best hand');
        expect(container.textContent).not.toContain('Calling costs');
    });
});

/**
 * The boxes are the ones the built server measured on the smallest table a fit cell gives poker: 320 by
 * 200 on a phone with the chat open, six seats, compact plates 64 wide - 36 tall, 54 with a tag - the
 * five card slots and the pot in the middle, and "Last hand" in the top right corner.
 */
describe('where a bet sits on the felt', () =>
{
    const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });

    const meets = (one: Box, two: Box) => one.left < two.right && two.left < one.right && one.top < two.bottom && two.top < one.bottom;

    const inside = (one: Box, frame: Box) => one.left >= frame.left && one.top >= frame.top && one.right <= frame.right && one.bottom <= frame.bottom;

    const table = box(0, 0, 320, 200);

    const centre = [box(88, 67, 144, 36), box(105, 109, 110, 24), box(227, 3, 88, 22)];

    const seats = (tag: boolean): Box[] => [
        box(128, tag ? 146 : 164, 64, tag ? 54 : 36),
        box(14, 113, 64, tag ? 54 : 36),
        box(14, 33, 64, tag ? 54 : 36),
        box(128, 0, 64, tag ? 54 : 36),
        box(242, 33, 64, tag ? 54 : 36),
        box(242, 113, 64, tag ? 54 : 36)
    ];

    const seat = (plates: Box[], width: number) => seatBets(plates.map((plate) => ({ plate, width, height: 22 })), table, plates, centre, 4);

    it('puts a bet beside its own plate on the side nearest the pot, when nothing is in the way', () =>
    {
        const plate = box(128, 400, 64, 36);
        const [spot] = seatBets([{ plate, width: 44, height: 22 }], box(0, 0, 320, 440), [plate], [], 4);

        expect(spot!.bottom).toBeLessThanOrEqual(plate.top);
        expect(spot!.left + 22).toBe(160);
    });

    it('never puts the reader’s all-in bet under their own tagged plate on a short table', () =>
    {
        const plates = seats(true);
        const [spot] = seatBets([{ plate: plates[0], width: 60, height: 22 }], table, plates, centre, 4);

        expect(meets(spot!, plates[0])).toBe(false);
        expect(inside(spot!, table)).toBe(true);
    });

    it('seats six bets on the smallest table, tagged or not, touching no plate, the pot, the cards or each other', () =>
    {
        for (const [tag, width] of [[false, 44], [false, 60], [true, 44]] as const)
        {
            const plates = seats(tag);
            const bets = seat(plates, width);

            for (const [index, bet] of bets.entries())
            {
                expect(bet).not.toBeNull();
                expect(inside(bet!, table)).toBe(true);
                expect(plates.some((plate) => meets(bet!, plate))).toBe(false);
                expect(centre.some((part) => meets(bet!, part))).toBe(false);
                expect(bets.some((other, at) => at !== index && meets(bet!, other!))).toBe(false);
            }
        }
    });

    it('lets a crowded table overlap a bet with a bet before it lets any plate cover one', () =>
    {
        const plates = seats(true);
        const bets = seat(plates, 60);

        for (const bet of bets)
        {
            expect(plates.some((plate) => meets(bet!, plate))).toBe(false);
        }
    });

    const CROWD = {
        en: { allIn: [61, 22], blind: [44, 22], centre: [box(88, 66, 144, 36), box(94, 108, 131, 25)], tap: box(221, -10, 102, 47) },
        fa: { allIn: [63, 24], blind: [45, 24], centre: [box(88, 66, 144, 36), box(105, 108, 111, 25)], tap: box(226, -10, 97, 47) }
    } as const;

    const RAIL = [[128, 180], [14, 140], [14, 60], [128, 20], [241, 60], [241, 140]] as const;

    const railPlate = (place: readonly [number, number], tagged: boolean) =>
    {
        const height = tagged ? 54 : 36;

        return box(place[0], Math.min(200 - height, Math.max(0, place[1] - height / 2)), 64, height);
    };

    const clean = (bets: (Box | null)[], plates: Box[], solid: readonly Box[]) =>
        bets.every((bet, index) => bet !== null
            && inside(bet, table)
            && !plates.some((plate) => meets(bet, plate))
            && !solid.some((part) => meets(bet, part))
            && !bets.some((other, at) => at !== index && other !== null && meets(bet, other)));

    it('seats every crowded pot a phone’s six-seat table can hold, in either language, clear of every plate, the cards, the pot, the Last hand chip’s whole tap area and each other', () =>
    {
        const trios = RAIL.flatMap((_, one) => RAIL.flatMap((__, two) => RAIL.flatMap((___, three) => (one < two && two < three ? [[one, two, three]] : []))));

        expect(trios).toHaveLength(20);

        for (const language of ['en', 'fa'] as const)
        {
            const { allIn, blind, centre: middle, tap } = CROWD[language];

            for (const shoved of trios)
            {
                const plates = RAIL.map((place, seat) => railPlate(place, shoved.includes(seat)));
                const chips = plates.map((plate, seat) => ({ plate, width: shoved.includes(seat) ? allIn[0] : blind[0], height: shoved.includes(seat) ? allIn[1] : blind[1] }));
                const bets = seatBets(chips, table, plates, [...middle, tap], 4);

                expect(clean(bets, plates, [...middle, tap]), `${ language } with ${ shoved.join(',') } all in`).toBe(true);
            }
        }
    });

    it('keeps the big bet of a two-handed shove out of the Last hand chip’s tap area', () =>
    {
        for (const language of ['en', 'fa'] as const)
        {
            const { allIn, blind, centre: middle, tap } = CROWD[language];
            const plates = [railPlate(RAIL[0], false), railPlate(RAIL[3], true)];
            const bets = seatBets([{ plate: plates[0], width: blind[0], height: blind[1] }, { plate: plates[1], width: allIn[0], height: allIn[1] }], table, plates, [...middle, tap], 4);

            expect(clean(bets, plates, [...middle, tap]), language).toBe(true);
        }
    });

    it('answers nothing when no spot beside the plate is on the table at all', () =>
    {
        expect(seatBets([{ plate: box(0, 0, 40, 20), width: 44, height: 22 }], box(0, 0, 40, 20), [], [], 4)).toEqual([null]);
    });


    it('keeps the last hand and the blinds beside the pot, the one place on a table where no seat ever is', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({}) }) as Rendered);
        const tally = container.querySelector('.poker-centre > .poker-tally')!;

        expect([...tally.children].map((one) => one.className)).toEqual(['poker-last', 'poker-pot', 'poker-blinds']);
        expect(tally.querySelector('.poker-pot')?.textContent).toBe('Total pot 30');
        expect(tally.querySelector('.poker-blinds .tally')?.textContent).toBe('10/20');
        expect(tally.querySelector('.poker-blinds .sr-only')?.textContent).toContain('Before the flop');
        expect(tally.querySelector('.poker-last > summary')?.textContent?.trim()).toBe('Last hand');
        expect(container.querySelector<HTMLElement>('.poker-stage')!.dataset.felt, 'the stage still says how tall its felt is').toBeUndefined();
    });

    it('shuts the last hand when anything else on the page is pressed, and leaves it open for a press inside it', async () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({}) }) as Rendered);
        const last = container.querySelector<HTMLDetailsElement>('.poker-last')!;

        await Promise.resolve();
        await Promise.resolve();

        last.open = true;
        fire(last.querySelector('.poker-last-panel')!, 'pointerdown');
        expect(last.open, 'a press inside the panel shut it').toBe(true);

        fire(container.querySelector('.poker-table')!, 'pointerdown');
        expect(last.open, 'the panel stayed open over a table somebody was pressing').toBe(false);

        last.open = true;
        fire(document.body, 'pointerdown');
        expect(last.open).toBe(false);
    });

    it('seats the crowded pot a phone held upright gives a 343x214 felt once the felt has shed its blinds chip', () =>
    {
        const felt = box(0, 0, 343, 214);
        const plates = [box(261, 123, 64, 54), box(140, 175, 64, 36), box(18, 132, 64, 36), box(18, 46, 64, 36), box(140, 0, 64, 54), box(261, 37, 64, 54)];
        const widths = [61, 44, 44, 44, 61, 61];
        const solid = [box(100, 73, 144, 36), box(106, 116, 131, 25), box(244, -10, 102, 47)];
        const bets = seatBets(plates.map((plate, at) => ({ plate, width: widths[at], height: 20 })), felt, plates, solid, 4);

        expect(bets.every((bet, index) => bet !== null
            && inside(bet, felt)
            && !plates.some((plate) => meets(bet, plate))
            && !solid.some((part) => meets(bet, part))
            && !bets.some((other, at) => at !== index && other !== null && meets(bet, other)))).toBe(true);
    });

    it('draws each bet inside its own seat, so it travels with the plate wherever the table puts it', () =>
    {
        const { container } = renderTest(() => PokerBoard({
            match: match({ seats: Array.from({ length: 6 }, (_, at) => ({ seat: at, stack: at === 0 ? 0 : 1500, bet: at === 0 ? 1500 : (at === 3 ? 20 : 0), folded: false, allIn: at === 0, out: false })) })
        }) as Rendered);
        const bets = [...container.querySelectorAll('.poker-bet')];

        expect(bets).toHaveLength(2);
        expect(bets.every((bet) => bet.parentElement?.classList.contains('poker-seat'))).toBe(true);
        expect(bets.map((bet) => bet.closest('.poker-seat')!.querySelector('.table-plate-name')?.textContent)).toEqual(['You', 'reza.t']);
    });
});

describe('a table that is read again', () =>
{
    const rows = (changed: Record<number, Partial<Poker['seats'][number]>> = {}) => Array.from({ length: 6 }, (_, seat) => ({
        seat,
        stack: 1500,
        bet: seat === 4 ? 40 : 0,
        folded: seat === 1,
        allIn: false,
        out: false,
        ...(seat === 5 ? { stack: 0, bet: 300, allIn: true } : {}),
        ...changed[seat]
    }));

    const flop = (view: Partial<Poker> = {}, more: Partial<MatchView> = {}): MatchView => ({
        ...match({
            street: 'flop',
            board: [5, 18, 31],
            pot: 460,
            pots: [{ amount: 240, eligible: [0, 2, 3, 4, 5] }, { amount: 220, eligible: [0, 2, 3, 4] }],
            toCall: 300,
            minRaiseTo: 600,
            maxRaiseTo: 1500,
            seats: rows(),
            last: { board: [1, 2, 3, 4, 6], shown: [{ seat: 2, cards: [8, 21], category: 'pair' }, { seat: 3, cards: [9, 22], category: 'high-card' }], pots: [{ amount: 80, winners: [2] }] },
            ...view
        }),
        remainingMs: 20_000,
        ...more
    });

    const shown = (first: MatchView) =>
    {
        const [current, setCurrent] = createSignal(first);
        const { container } = renderTest(() => PokerBoard({
            get match()
            {
                return current();
            },
            turnMs: 30_000
        }) as Rendered);

        return { container, read: (next: MatchView) => setCurrent(structuredClone(next)) };
    };

    const under = (container: HTMLElement) => [...container.querySelectorAll<Element>('.poker-stage *')];

    const gone = (nodes: readonly Element[]) => nodes
        .filter((one) => !document.contains(one))
        .map((one) => `${ one.tagName.toLowerCase() }.${ (one.getAttribute('class') ?? '').split(' ')[0] }`);

    it('draws nothing again for an answer it already had', () =>
    {
        const { container, read } = shown(flop());
        const before = under(container);

        read(flop());

        expect(before.length, 'the table was not drawn at all').toBeGreaterThan(120);
        expect(gone(before), 'these were drawn again though nothing had changed').toEqual([]);
    });

    it('keeps every plate, card and chip when somebody else puts chips in, and draws only their bet', () =>
    {
        const { container, read } = shown(flop({ turn: 2, toCall: undefined, minRaiseTo: undefined, maxRaiseTo: undefined }));
        const before = under(container);
        const turning = container.querySelector('.poker-seat[data-seat="2"]')!;
        const clock = new Set(['.table-plate-clock', '.table-plate-clock *', '.table-plate-trail *'].flatMap((one) => [...turning.querySelectorAll(one)]));
        const bets = container.querySelectorAll('.poker-bet').length;

        read(flop({ turn: 3, toCall: undefined, minRaiseTo: undefined, maxRaiseTo: undefined, pot: 760, seats: rows({ 2: { stack: 1200, bet: 300 } }) }, { rev: 8 }));

        expect(container.querySelectorAll('.poker-bet').length).toBe(bets + 1);
        expect(container.querySelector('.poker-seat[data-seat="2"] .poker-bet')?.textContent).toBe('300');
        expect(container.querySelector('.poker-seat[data-seat="2"] .table-plate-facts .tally')?.textContent).toBe('1,200');
        expect(before.filter((one) => !document.contains(one) && !clock.has(one)), 'a call by one seat took more off the table than the clock of the turn that ended').toEqual([]);
        expect(gone(before), 'the clock of the turn that ended is still on its plate').toEqual(expect.arrayContaining(['svg.table-plate-clock', 'circle.', 'span.sr-only']));
    });

    it('keeps a bet that grows the pill it was, and takes away only the pill of a bet that is gathered', () =>
    {
        const { container, read } = shown(flop());
        const pill = container.querySelector('.poker-seat[data-seat="4"] .poker-bet')!;
        const before = under(container);

        read(flop({ seats: rows({ 4: { stack: 1300, bet: 200 } }) }, { rev: 8 }));

        expect(container.querySelector('.poker-seat[data-seat="4"] .poker-bet'), 'a raise drew the bet again').toBe(pill);
        expect(pill.textContent).toBe('200');
        expect(gone(before)).toEqual([]);

        read(flop({ street: 'turn', board: [5, 18, 31, 44], seats: rows({ 4: { bet: 0 }, 5: { bet: 0 } }) }, { rev: 9 }));

        expect(gone(before).filter((one) => one === 'span.poker-bet')).toHaveLength(2);
        expect(gone(before).filter((one) => !/^span\.(poker-bet|poker-bet-disc|tally)$/.test(one)), 'the street closing took more off the table than the two bets').toEqual([]);
    });

    it('keeps the cards on the board when another comes, in the slot it had kept empty', () =>
    {
        const { container, read } = shown(flop());
        const slots = [...container.querySelectorAll('.poker-slot')];
        const faces = [...container.querySelectorAll('.poker-board .card-face')];
        const before = under(container);

        expect(slots).toHaveLength(5);
        expect(faces).toHaveLength(3);

        read(flop({ street: 'turn', board: [5, 18, 31, 44] }, { rev: 8 }));

        expect([...container.querySelectorAll('.poker-slot')], 'a slot was made again to take its card').toEqual(slots);
        expect([...container.querySelectorAll('.poker-board .card-face')].slice(0, 3)).toEqual(faces);
        expect(slots.map((slot) => slot.querySelectorAll('.card-face').length)).toEqual([1, 1, 1, 1, 0]);
        expect(gone(before)).toEqual([]);
    });

    it('takes the cards off the board for a new hand and leaves the five slots', () =>
    {
        const { container, read } = shown(flop());
        const slots = [...container.querySelectorAll('.poker-slot')];

        read(flop({ street: 'preflop', hand: 2, board: [], hole: [7, 20] }, { rev: 8 }));

        expect(slots).toHaveLength(5);
        expect([...container.querySelectorAll('.poker-slot')]).toEqual(slots);
        expect(container.querySelectorAll('.poker-board .card-face')).toHaveLength(0);
    });

    it('leaves the reader on the chip they were on while the clock runs down', () =>
    {
        const { container, read } = shown(flop());
        const call = button(container, 'Call 300')!;

        call.focus();
        expect(document.activeElement).toBe(call);

        read(flop());
        expect(document.activeElement, 'a re-read took the chip out from under the keyboard').toBe(call);

        read(flop({}, { remainingMs: 12_000 }));
        expect(document.activeElement, 'the clock moving on took the chip out from under the keyboard').toBe(call);
    });

    it('keeps the last hand open, and its rows, while the table plays on', () =>
    {
        const { container, read } = shown(flop());
        const last = container.querySelector<HTMLDetailsElement>('.poker-last')!;
        const rows = [...last.querySelectorAll('li')];

        last.open = true;
        read(flop({}, { remainingMs: 12_000 }));

        expect(rows).toHaveLength(2);
        expect(container.querySelector('.poker-last'), 'the panel was drawn again and shut').toBe(last);
        expect(last.open).toBe(true);
        expect([...last.querySelectorAll('li')]).toEqual(rows);
    });

    it('keeps the dealer\'s button the one button on the table, and moves it without drawing a plate again', () =>
    {
        const { container, read } = shown(flop());
        const puck = container.querySelector<HTMLElement>('.poker-puck')!;
        const plates = [...container.querySelectorAll('.table-plate')];
        const told = () => [...container.querySelectorAll('.poker-seat')]
            .filter((seat) => seat.querySelector('.table-plate-facts .sr-only') !== null)
            .map((seat) => seat.getAttribute('data-seat'));

        expect(container.querySelectorAll('.poker-puck')).toHaveLength(1);
        expect(puck.parentElement?.classList.contains('poker-table'), 'the button is a plate\'s and not the table\'s').toBe(true);
        expect([puck.dataset.seat, puck.textContent]).toEqual(['2', 'D']);
        expect(told()).toEqual(['2']);
        expect(container.querySelector('.poker-seat[data-seat="2"] .table-plate-facts .sr-only')?.textContent).toBe('Dealer');

        read(flop({}, { remainingMs: 12_000 }));
        expect(container.querySelector('.poker-puck'), 'the button was made again where it already lay').toBe(puck);

        read(flop({ button: 3 }, { rev: 8 }));

        expect(container.querySelector('.poker-puck'), 'the button was made again to move it').toBe(puck);
        expect(puck.dataset.seat).toBe('3');
        expect(told()).toEqual(['3']);
        expect([...container.querySelectorAll('.table-plate')], 'moving the button drew the plates again').toEqual(plates);
    });

    it('keeps what a plate says of its seat, and changes the word in place', () =>
    {
        const { container, read } = shown(flop());
        const tagOf = (seat: number) => container.querySelector(`.poker-seat[data-seat="${ seat }"] .table-plate-tag`);
        const folded = tagOf(1)!;
        const shoved = tagOf(5)!;

        expect([folded.textContent, shoved.textContent]).toEqual(['Folded', 'All in']);

        read(flop({}, { remainingMs: 12_000 }));

        expect(tagOf(1), 'a tag was drawn again for a seat that had not changed').toBe(folded);
        expect(tagOf(5)).toBe(shoved);

        read(flop({ seats: rows({ 4: { folded: true, bet: 0 } }) }, { rev: 8 }));

        expect(tagOf(1)).toBe(folded);
        expect(tagOf(4)?.textContent).toBe('Folded');
        expect(container.querySelector('.poker-seat[data-seat="4"] .poker-backs'), 'a seat that folded kept its cards').toBeNull();
        expect(container.querySelector('.poker-seat[data-seat="3"] .poker-backs')).not.toBeNull();

        read(flop({ seats: rows({ 5: { allIn: false, out: true, bet: 0 } }) }, { rev: 9 }));

        expect(tagOf(5), 'a tag was drawn again to change its word').toBe(shoved);
        expect([shoved.textContent, shoved.getAttribute('data-tone')]).toEqual(['Out', 'neutral']);
    });

    it('keeps the reader\'s two cards the cards they were when the turn comes round to them', () =>
    {
        const { container, read } = shown(flop({ turn: 4, toCall: undefined, minRaiseTo: undefined, maxRaiseTo: undefined }));
        const hand = container.querySelector('.poker-hand')!;

        expect(container.querySelector('.poker-acts')).toBeNull();

        read(flop({ turn: 4, toCall: undefined, minRaiseTo: undefined, maxRaiseTo: undefined }, { remainingMs: 12_000 }));

        expect(container.querySelector('.poker-hand'), 'the hand was drawn again though nothing was dealt').toBe(hand);

        read(flop({ turn: 0, toCall: 0 }, { rev: 8 }));

        expect(container.querySelector('.poker-hand')).toBe(hand);
        expect(button(container, 'Check')).toBeDefined();
    });
});

describe('a table of the shape its room gives it', () =>
{
    const measured = (width: number, height: number) =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({}, 0, 9) }) as Rendered);
        const felt = container.querySelector<HTMLElement>('.poker-table')!;

        felt.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

        return container;
    };

    const lying = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.poker-seat')].map((seat) => seat.dataset.lies?.[0]).join('');

    const at = (container: HTMLElement, seat: number) =>
    {
        const style = container.querySelector<HTMLElement>(`.poker-seat[data-seat="${ seat }"]`)!.style;

        return ['--x', '--y', '--ux', '--uy'].map((name) => Number(style.getPropertyValue(name)));
    };

    it('puts the reader at the middle of the near rail whichever seat the server gave them, and the seat after them to their left', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({}, 2) }) as Rendered);

        expect(at(container, 2).slice(0, 1)).toEqual([50]);
        expect(at(container, 2)[1]).toBeGreaterThan(90);
        expect(at(container, 3)[0], 'the seat after the reader is not to their left').toBeLessThan(50);
        expect(at(container, 3)[1]).toBeGreaterThan(50);
        expect(at(container, 1)[0]).toBeGreaterThan(50);
        expect(at(container, 5)[1], 'the seat across the table is not at its far rail').toBeLessThan(10);
        expect(container.querySelector('.poker-seat[data-seat="2"] .poker-backs'), 'the reader\'s own cards are drawn face down on the felt').toBeNull();
    });

    it('is round until it has been measured, and says how many sit at it', () =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({}, 0, 9) }) as Rendered);
        const [x, y, ux, uy] = at(container, 0);

        expect(container.querySelector('.poker-table')?.getAttribute('data-seats')).toBe('9');
        expect(lying(container)).toBe('ffuuffuuf');
        expect([x, ux, uy]).toEqual([50, 0, -1]);
        expect(y).toBeCloseTo(94.9, 1);
    });

    it('stands three plates along the near rail of a table that lies wide, and one at each end', async () =>
    {
        const container = measured(600, 250);

        await vi.waitFor(() => expect(lying(container)).toBe('ffuffffuf'));

        expect(at(container, 1)[0], 'the seat after the reader is not to their left on the near rail').toBeLessThan(40);
        expect(at(container, 1)[1]).toBeCloseTo(at(container, 0)[1], 5);
        expect(at(container, 2).slice(2), 'a seat at the end of the table does not face along it').toEqual([1, expect.any(Number)]);
    });

    it('stands three plates down each side of a table that stands tall, and two at its head', async () =>
    {
        const container = measured(358, 660);

        await vi.waitFor(() => expect(lying(container)).toBe('fuuuffuuu'));

        expect(at(container, 2).slice(2)).toEqual([1, 0]);
        expect(at(container, 7).slice(2)).toEqual([-1, 0]);
        expect(at(container, 4)[1]).toBeLessThan(10);
    });

    it('seats a bet only once it has measured the table, so no bet is seen where it is not', async () =>
    {
        const seats = Array.from({ length: 9 }, (_, seat) => ({ seat, stack: 1500, bet: seat === 4 ? 20 : 0, folded: false, allIn: false, out: false }));
        const { container } = renderTest(() => PokerBoard({ match: match({ seats }, 0, 9) }) as Rendered);
        const bet = container.querySelector<HTMLElement>('.poker-bet')!;

        expect(bet.dataset.placed, 'a bet was shown before the table had been measured').toBeUndefined();

        await vi.waitFor(() => expect(bet.dataset.placed).toBe('true'));
    });
});

describe('a bet in front of its seat', () =>
{
    const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });

    const meets = (one: Box, two: Box) => one.left < two.right && two.left < one.right && one.top < two.bottom && two.top < one.bottom;

    const table = box(0, 0, 358, 660);

    it('lies straight in front of the cards the seat holds, towards the middle of the table', () =>
    {
        const plate = box(0, 100, 56, 62);
        const cards = box(60, 117, 33, 28);
        const [bet] = seatBets([{ plate: box(0, 100, 93, 62), width: 50, height: 20, toward: { x: 1, y: 0 }, lead: cards }], table, [plate, cards], [], 4);

        expect(bet).toEqual(box(97, 121, 50, 20));
    });

    it('lies in front of the plate of a seat that holds no cards', () =>
    {
        const plate = box(118, 615, 122, 38);
        const [bet] = seatBets([{ plate, width: 50, height: 20, toward: { x: 0, y: -1 } }], table, [plate], [], 4);

        expect(bet).toEqual(box(154, 591, 50, 20));
    });

    it('goes down the table from the far rail, and to the left from the right-hand one', () =>
    {
        const far = box(118, 8, 122, 38);
        const right = box(302, 300, 56, 62);
        const bets = seatBets([
            { plate: far, width: 50, height: 20, toward: { x: 0, y: 1 } },
            { plate: right, width: 50, height: 20, toward: { x: -1, y: 0 } }
        ], table, [far, right], [], 4);

        expect(bets).toEqual([box(154, 50, 50, 20), box(248, 321, 50, 20)]);
    });

    it('follows the longer side of the way to the felt from a seat on a bend', () =>
    {
        const plate = box(480, 40, 104, 41);
        const cards = box(470, 85, 24, 21);
        const [bet] = seatBets([{ plate: box(470, 40, 114, 66), width: 36, height: 16, toward: { x: -0.6, y: 1 }, lead: cards }], box(0, 0, 600, 250), [plate, cards], [], 4);

        expect(bet).toEqual(box(464, 110, 36, 16));
    });

    it('takes a place beside the seat when the place in front is taken, and never one on a plate or on cards', () =>
    {
        const plate = box(0, 100, 56, 62);
        const cards = box(60, 117, 33, 28);
        const taken = box(95, 110, 80, 40);
        const [bet] = seatBets([{ plate: box(0, 100, 93, 62), width: 50, height: 20, toward: { x: 1, y: 0 }, lead: cards }], table, [plate, cards], [taken], 4);

        expect(bet).not.toBeNull();
        expect(bet).not.toEqual(box(97, 121, 50, 20));
        expect([plate, cards, taken].some((other) => meets(bet!, other))).toBe(false);
    });
});
