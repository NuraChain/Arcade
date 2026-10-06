import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

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
        fire(button(container, 'Call 20')!, 'click');

        expect(play.mock.calls.map((call) => call[0])).toEqual([
            { kind: 'poker', verb: 'fold' },
            { kind: 'poker', verb: 'call' }
        ]);
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

    it('says nothing about the hand or the price with the outcome helper off', () =>
    {
        useSettings().update({ hintOutcome: false });

        const { container } = renderTest(() => PokerBoard({ match: match({ toCall: 20, pot: 30 }) }) as Rendered);

        expect(container.textContent).not.toContain('best hand');
        expect(container.textContent).not.toContain('Calling costs');
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

    const feltOf = (height: number) =>
    {
        const { container } = renderTest(() => PokerBoard({ match: match({}) }) as Rendered);
        const felt = container.querySelector<HTMLElement>('.poker-table')!;

        felt.getBoundingClientRect = () => ({ left: 0, top: 0, right: 343, bottom: height, width: 343, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

        return container.querySelector<HTMLElement>('.poker-stage')!;
    };

    it('sheds the blinds chip from a felt shorter than 16rem, so the bar carries it and a crowded pot keeps the rail', async () =>
    {
        const stage = feltOf(214);

        await vi.waitFor(() => expect(stage.dataset.felt).toBe('short'));
        expect(stage.querySelector('.poker-bar-facts')).not.toBeNull();
    });

    it('keeps the blinds chip on a felt with the room for it', async () =>
    {
        const stage = feltOf(300);

        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(stage.dataset.felt).toBeUndefined();
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
