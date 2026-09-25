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

const button = (container: HTMLElement, label: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === label) as HTMLButtonElement | undefined;

const place = (container: HTMLElement, name: string): { x: number; y: number } =>
{
    const plate = [...container.querySelectorAll<HTMLElement>('.poker-seat')]
        .find((element) => element.querySelector('.table-plate-name')?.textContent === name)!;

    return { x: parseFloat(plate.style.left), y: parseFloat(plate.style.top) };
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
