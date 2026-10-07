import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import { dealerOf } from '../../backend/src/domains/match/hokm/scoring.ts';
import HokmBoard from '../src/components/games/hokm-board.component.azeroth';
import { TIMING } from '../src/game/motion.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';

type Rendered = HTMLElement;

type Hokm = Extract<MatchView['view'], { kind: 'hokm' }>;

const match = (view: Partial<Hokm>, mine = 1): MatchView => ({
    id: 'match-1',
    tableId: 'table-1',
    game: 'hokm',
    rev: 3,
    seats: 4,
    players: [0, 1, 2, 3].map((seat) => ({ seat, who: `سارا${ seat }`, timeouts: 0 })) as MatchView['players'],
    turn: 0,
    mine,
    startedAt: new Date(400_000).toISOString(),
    view: {
        kind: 'hokm',
        phase: 'trump',
        hakem: 0,
        dealer: 3,
        turn: 0,
        lead: 0,
        hand: [],
        plays: [],
        trick: [],
        seats: [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: seat === 0 ? 5 : 0, tricks: 0, out: false })),
        points: [0, 0],
        target: 7,
        round: 1,
        needed: 7,
        full: 13,
        ...view
    }
});

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    useDevice().overrideCoarse(null);
    vi.restoreAllMocks();
});

describe('HokmBoard', () =>
{
    it('draws no hand at all while the reader is waiting for trump with nothing dealt to them', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: match({}) }) as Rendered);

        expect(container.querySelector('.hokm-table')).not.toBeNull();
        expect(container.querySelector('.hokm-hand')).toBeNull();
        expect(container.querySelector('[aria-label="Your hand"]')).toBeNull();
    });

    it('still draws the hand once there are cards in it', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: match({ hand: [0, 14, 30] }, 0) }) as Rendered);

        expect(container.querySelectorAll('.hokm-hand').length).toBe(1);
        expect(container.querySelectorAll('.hokm-hand .card-hold').length).toBe(3);
    });

    it('says which hand of the match is being played beside the score', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: match({ round: 4 }) }) as Rendered);

        expect(container.querySelector('.hokm-side')?.textContent).toContain('Hand 4');
    });

    it('gives the sentence in the middle of the table the page direction, because the table itself is forced left to right', () =>
    {
        useLocale().setLocale('fa');
        const persian = renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        expect(persian.container.querySelector('.hokm-centre')!.getAttribute('dir')).toBe('rtl');
        persian.unmount();

        useLocale().setLocale('en');
        const english = renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        expect(english.container.querySelector('.hokm-centre')!.getAttribute('dir')).toBe('ltr');
    });

    it('lets a sentence with a name in it follow the page, and only a bare name follow its own script', () =>
    {
        const { container } = renderTest(() => HokmBoard({
            match: match({ phase: 'tricks', trump: 'spades', took: { lead: 0, cards: [0, 1, 2, 3], seat: 2 } })
        }) as Rendered);
        const side = container.querySelector('.hokm-side')!;
        const sentences = [...side.querySelectorAll('span, p')].filter((element) =>
            element.children.length === 0 && /is the hakem|took the trick/.test(element.textContent ?? ''));

        expect(sentences.length).toBe(2);
        for (const sentence of sentences)
        {
            expect(sentence.getAttribute('dir'), sentence.textContent ?? '').toBeNull();
        }

        const sides = [...side.querySelectorAll('dt')];

        expect(sides.length).toBe(2);
        for (const names of sides)
        {
            expect(names.getAttribute('dir'), names.textContent ?? '').toBeNull();
        }
    });
});

describe('the table in motion', () =>
{
    const clock = () => runtime().clock as ManualClock;

    const playing = () => match({ phase: 'tricks', trump: 'spades', turn: 1, lead: 1, hand: [40, 41], plays: [] }, 0);

    const card = (rev: number, seat: number, at: number): MatchEvent => ({ rev, seat, at: '', log: { kind: 'hokm', moves: [{ e: 'card', seat, card: at }] } });

    const drive = (): ((events: MatchEvent[]) => void) =>
    {
        const [batch, setBatch] = createSignal<EventBatch>({ seq: 0, events: [] });

        vi.spyOn(useBoard(), 'events').mockImplementation(batch);

        return (events) => setBatch((held) => ({ seq: held.seq + 1, events }));
    };

    it('flies a card in from the seat that played it, and shows the real card only once it lands', () =>
    {
        const send = drive();
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = renderTest(() => HokmBoard({ match: playing() }) as Rendered);

        send([card(4, 1, 12)]);
        clock().advance(0);

        const real = container.querySelector('.hokm-trick[data-card="12"]');

        expect(real?.getAttribute('data-landing')).toBe('true');
        expect(animate).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(animate.mock.calls[0][0])).toContain('translate');

        clock().advance(TIMING.FLY_THEIRS);

        expect(container.querySelector('.hokm-trick[data-card="12"]')?.getAttribute('data-landing')).toBeNull();
    });

    it('only fades a card in at its place under reduced motion', () =>
    {
        const send = drive();
        const animate = vi.spyOn(Element.prototype, 'animate');

        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);
        renderTest(() => HokmBoard({ match: playing() }) as Rendered);

        send([card(4, 1, 12)]);
        clock().advance(0);

        const frames = JSON.stringify(animate.mock.calls[0][0]);

        expect(frames).toContain('opacity');
        expect(frames).not.toContain('translate');
    });

    it('holds a finished trick where everybody can read it, then gathers it to the winner', () =>
    {
        const send = drive();
        const { container } = renderTest(() => HokmBoard({ match: playing() }) as Rendered);

        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            { rev: 7, seat: 0, at: '', log: { kind: 'hokm', moves: [{ e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }] } }
        ]);

        const took = 3 * TIMING.SEQ_GAP + TIMING.FLY + TIMING.SETTLE;

        clock().advance(took);

        expect(container.querySelector('.hokm-trick[data-took="true"]')?.getAttribute('data-card')).toBe('2');

        clock().advance(TIMING.HOLD - 1);

        expect(container.querySelectorAll('.hokm-trick').length).toBe(4);

        clock().advance(1);

        expect(container.querySelectorAll('.hokm-trick').length).toBe(0);
    });

    it('shows a card at its place after only the fade under reduced motion', () =>
    {
        const send = drive();

        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { container } = renderTest(() => HokmBoard({ match: playing() }) as Rendered);

        send([card(4, 1, 12)]);
        clock().advance(0);
        clock().advance(TIMING.FADE);

        expect(container.querySelector('.hokm-trick[data-card="12"]')?.getAttribute('data-landing')).toBeNull();
    });

    it('gathers a held trick after the short hold when the next lead arrives in a later batch', () =>
    {
        const send = drive();
        const { container } = renderTest(() => HokmBoard({ match: playing() }) as Rendered);

        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            { rev: 7, seat: 0, at: '', log: { kind: 'hokm', moves: [{ e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }] } }
        ]);

        const took = 3 * TIMING.SEQ_GAP + TIMING.FLY + TIMING.SETTLE;

        clock().advance(took);
        send([card(8, 2, 30)]);
        clock().advance(TIMING.HOLD_MIN);

        expect(container.querySelectorAll('.hokm-trick:not([data-card="30"])').length).toBe(0);
    });

    it('animates a rematch at the same table from its first card', () =>
    {
        const send = drive();
        const [current, setCurrent] = createSignal(match({ phase: 'tricks', trump: 'spades', turn: 1, lead: 1, hand: [40, 41], plays: [] }, 0));
        const animate = vi.spyOn(Element.prototype, 'animate');
        const props = {
            get match()
            {
                return current();
            }
        };
        const { container } = renderTest(() => HokmBoard(props) as Rendered);

        setCurrent({ ...current(), id: 'match-2', rev: 0 });
        send([card(1, 1, 12)]);
        clock().advance(0);

        expect(animate).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.hokm-trick[data-card="12"]')).not.toBeNull();
    });

    it('never replays the batch that was already there when the board mounted', () =>
    {
        const [batch] = createSignal<EventBatch>({ seq: 7, events: [card(3, 1, 12)] });

        vi.spyOn(useBoard(), 'events').mockImplementation(batch);

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = renderTest(() => HokmBoard({ match: playing() }) as Rendered);

        clock().advance(2000);

        expect(animate).not.toHaveBeenCalled();
        expect(container.querySelector('.hokm-trick')).toBeNull();
    });

    it('jumps straight to the board when the log has a gap in it', () =>
    {
        const send = drive();
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = renderTest(() => HokmBoard({ match: playing() }) as Rendered);

        send([card(9, 1, 12)]);
        clock().advance(2000);

        expect(animate).not.toHaveBeenCalled();
        expect(container.querySelector('.hokm-trick')).toBeNull();
    });
});

describe('playing a card with a finger', () =>
{
    const turn = () => match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }, 0);

    const cardButton = (container: HTMLElement, card: number) =>
        container.querySelectorAll<HTMLButtonElement>('.card-hold')[[0, 14, 30].indexOf(card)];

    it('lifts the card on the first tap and plays it on the second, so a slip of the thumb costs nothing', () =>
    {
        useDevice().overrideCoarse(true);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);

        fire(cardButton(container, 14), 'click');

        expect(play).not.toHaveBeenCalled();
        expect(cardButton(container, 14).dataset.picked).toBe('true');
        expect(cardButton(container, 14).getAttribute('aria-pressed')).toBe('true');

        fire(cardButton(container, 14), 'click');

        expect(play).toHaveBeenCalledWith({ kind: 'hokm', verb: 'card', card: 14 });
    });

    it('offers a button that plays the lifted card, and moves the lift when another card is tapped', () =>
    {
        useDevice().overrideCoarse(true);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);

        fire(cardButton(container, 0), 'click');
        fire(cardButton(container, 14), 'click');

        expect(cardButton(container, 0).dataset.picked).toBeUndefined();
        expect(cardButton(container, 14).dataset.picked).toBe('true');

        const button = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith('Play the'));
        fire(button!, 'click');

        expect(play).toHaveBeenCalledWith({ kind: 'hokm', verb: 'card', card: 14 });
    });

    it('plays on the first click with a mouse, where a hover already lifts the card', () =>
    {
        useDevice().overrideCoarse(false);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);

        fire(cardButton(container, 0), 'click');

        expect(play).toHaveBeenCalledWith({ kind: 'hokm', verb: 'card', card: 0 });
    });
});

describe('playing ahead of the server', () =>
{
    const turn = () => match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }, 0);

    const drive = (): ((events: MatchEvent[]) => void) =>
    {
        const [batch, setBatch] = createSignal<EventBatch>({ seq: 0, events: [] });

        vi.spyOn(useBoard(), 'events').mockImplementation(batch);

        return (events) => setBatch((held) => ({ seq: held.seq + 1, events }));
    };

    const press = (container: HTMLElement, card: number) =>
        fire(container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!, 'click');

    it('takes the card out of the hand and flies it to the felt at the press, before the server has answered', () =>
    {
        useDevice().overrideCoarse(false);
        drive();
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);

        press(container, 14);

        expect(container.querySelector('.card-hold[data-card="14"]')).toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')?.getAttribute('data-landing')).toBe('true');
        expect(animate).toHaveBeenCalledTimes(1);
    });

    it('does not fly the card a second time when the server says it was played', () =>
    {
        useDevice().overrideCoarse(false);
        const send = drive();
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));
        const animate = vi.spyOn(Element.prototype, 'animate');
        const [current, setCurrent] = createSignal(turn());
        const { container } = renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);

        press(container, 14);
        setCurrent({ ...match({ phase: 'tricks', trump: 'spades', turn: 1, lead: 0, trick: [14], hand: [0, 30], plays: [] }, 0), rev: 4 });
        send([{ rev: 4, seat: 0, at: '', log: { kind: 'hokm', moves: [{ e: 'card', seat: 0, card: 14 }] } }]);
        (runtime().clock as ManualClock).advance(TIMING.FLY + 100);

        expect(animate).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll('.hokm-trick[data-card="14"]').length).toBe(1);
    });

    it('puts a refused card back in the hand', async () =>
    {
        useDevice().overrideCoarse(false);
        drive();
        vi.spyOn(useBoard(), 'play').mockResolvedValue('stale');
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);

        press(container, 14);
        await Promise.resolve();
        await Promise.resolve();

        expect(container.querySelector('.card-hold[data-card="14"]')).not.toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
    });
});

describe('the game helpers', () =>
{
    const following = () => match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 3, trick: [34], hand: [38, 0, 40], plays: [38] }, 0);

    const watching = (): MatchView => ({ ...match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 3, trick: [34] }), mine: undefined });

    const cardButton = (container: HTMLElement, card: number) =>
        container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!;

    afterEach(() =>
    {
        useSettings().reset();
    });

    it('lights the playable cards, and with the lighting off leaves every card at rest while an illegal one still refuses', () =>
    {
        useDevice().overrideCoarse(false);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: following() }) as Rendered);

        expect(cardButton(container, 38).dataset.legal).toBe('true');
        expect(cardButton(container, 0).dataset.legal).toBe('false');

        useSettings().update({ hintMoves: false });

        expect([38, 0, 40].map((card) => cardButton(container, card).dataset.legal)).toEqual(['hidden', 'hidden', 'hidden']);
        expect(cardButton(container, 0).disabled).toBe(true);

        fire(cardButton(container, 0), 'click');

        expect(play).not.toHaveBeenCalled();
    });

    it('says whether the card in hand would take the trick, and stops saying it when the helper is off', () =>
    {
        useDevice().overrideCoarse(false);
        const { container } = renderTest(() => HokmBoard({ match: following() }) as Rendered);

        cardButton(container, 38).focus();

        expect(container.querySelector('.hokm-outcome')?.textContent).toBe('Takes the trick so far.');
        expect(cardButton(container, 38).getAttribute('aria-label')).toBe('Play the A of Hearts. Takes the trick so far.');

        useSettings().update({ hintOutcome: false });

        expect(container.querySelector('.hokm-outcome')).toBeNull();
        expect(cardButton(container, 38).getAttribute('aria-label')).toBe('Play the A of Hearts');
    });

    it('puts the outcome of a lifted card beside the button that plays it', () =>
    {
        useDevice().overrideCoarse(true);
        const { container } = renderTest(() => HokmBoard({ match: following() }) as Rendered);

        fire(cardButton(container, 38), 'click');

        const button = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith('Play the'));

        expect(button?.getAttribute('aria-label')).toBe('Play the A of Hearts. Takes the trick so far.');
        expect(container.querySelector('.hokm-outcome')?.textContent).toBe('Takes the trick so far.');
    });

    it('coaches the rule that binds this play, and goes quiet when the coach is off', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: following() }) as Rendered);

        expect(container.querySelector('[role="note"]')?.textContent).toContain('You have to follow the suit that was led.');

        useSettings().update({ hintRules: false });

        expect(container.querySelector('[role="note"]')).toBeNull();
    });

    it('tells the hakem which suit they hold most of while trump is being named', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: match({ hand: [38, 37, 30, 0, 14] }, 0) }) as Rendered);

        expect(container.querySelector('[role="note"]')?.textContent).toContain('You hold more hearts than any other suit.');
    });

    it('gives somebody watching neither tips nor outcomes', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: watching() }) as Rendered);

        expect(container.querySelector('[role="note"]')).toBeNull();
        expect(container.querySelector('.hokm-outcome')).toBeNull();
    });
});

describe('the two-handed draw', () =>
{
    const two = (view: Partial<Hokm>, mine: number | null): MatchView => ({
        ...match({
            hakem: 0,
            dealer: 1,
            trump: 'spades',
            points: [0, 0],
            seats: [0, 1].map((seat) => ({ seat, side: seat, held: 5, tricks: 0, out: false })),
            ...view
        }, mine ?? 0),
        seats: 2,
        players: [0, 1].map((seat) => ({ seat, who: `dana${ seat }`, timeouts: 0 })) as MatchView['players'],
        ...(mine === null ? { mine: undefined } : {})
    });

    const drawing = (mine: number | null) => two({ phase: 'draw', turn: 0, stock: 39, hand: [1, 15, 27, 40, 41, 50, 51], ...(mine === 0 ? { offer: 12 } : {}) }, mine);

    const named = (container: HTMLElement, words: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes(words)) ?? null;

    it('offers the drawn card and its two choices to the drawer alone', () =>
    {
        const drawer = renderTest(() => HokmBoard({ match: drawing(0) }) as Rendered);

        expect(drawer.container.querySelector('.hokm-draw .card-face')).not.toBeNull();
        expect(named(drawer.container, 'Keep the')).not.toBeNull();
        expect(named(drawer.container, 'Take the next card')).not.toBeNull();
        drawer.unmount();

        for (const reader of [1, null])
        {
            const other = renderTest(() => HokmBoard({ match: drawing(reader) }) as Rendered);

            expect(other.container.querySelector('.hokm-draw'), `reader ${ reader }`).toBeNull();
            expect(named(other.container, 'Take the next card'), `reader ${ reader }`).toBeNull();
            other.unmount();
        }
    });

    it('keeps or passes the drawn card through the board', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: drawing(0) }) as Rendered);

        fire(named(container, 'Keep the')!, 'click');
        fire(named(container, 'Take the next card')!, 'click');

        expect(play.mock.calls.map(([body]) => body)).toEqual([
            { kind: 'hokm', verb: 'keep' },
            { kind: 'hokm', verb: 'reject' }
        ]);
    });

    it('shows the stock as a count to everybody and the hand as so many of thirteen to its holder', () =>
    {
        const drawer = renderTest(() => HokmBoard({ match: drawing(0) }) as Rendered);

        expect(drawer.container.querySelector('.hokm-stock')?.textContent).toContain('39');
        expect(drawer.container.querySelector('.hokm-filled')?.textContent).toContain('7/13');
        expect(drawer.container.querySelector('.hokm-filled')?.textContent).toContain('7 of 13 cards');
        drawer.unmount();

        const watcher = renderTest(() => HokmBoard({ match: drawing(null) }) as Rendered);

        expect(watcher.container.querySelector('.hokm-stock')?.textContent).toContain('39');
        expect(watcher.container.querySelector('.hokm-filled')).toBeNull();
    });

    it('lets the seat putting cards down choose them, and confirms only at the exact count', () =>
    {
        useDevice().overrideCoarse(false);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: two({ phase: 'discard', turn: 0, discard: 3, stock: 42, hand: [3, 14, 27, 40, 51] }, 0) }) as Rendered);
        const hold = (card: number) => container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!;
        const confirm = () => named(container, 'Put these 3 face down')!;

        expect(hold(3).disabled).toBe(false);
        expect(hold(3).getAttribute('aria-pressed')).toBe('false');
        expect(confirm().disabled).toBe(true);

        [51, 3, 27].forEach((card) => fire(hold(card), 'click'));

        expect(hold(3).getAttribute('aria-pressed')).toBe('true');
        expect(confirm().disabled).toBe(false);

        fire(hold(40), 'click');

        expect(confirm().disabled).toBe(true);

        fire(hold(40), 'click');
        fire(confirm(), 'click');

        expect(play).toHaveBeenCalledWith({ kind: 'hokm', verb: 'discard', cards: [3, 27, 51] });
    });

    it('gives the seat waiting on a discard nothing to press', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: two({ phase: 'discard', turn: 0, stock: 42, hand: [3, 14, 27, 40, 51] }, 1) }) as Rendered);

        expect([...container.querySelectorAll<HTMLButtonElement>('.card-hold')].every((button) => button.disabled)).toBe(true);
        expect(named(container, 'face down')).toBeNull();
    });

    it('tells the drawer which card their keep put face down, and draws nothing else about the cards put down', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: two({ phase: 'draw', turn: 1, stock: 37, glimpse: 9, hand: [1, 15, 27, 40, 41, 50] }, 0) }) as Rendered);

        expect(container.textContent).toContain('went face down');
        expect(container.querySelector('[class*="discard"], [class*="burn"]')).toBeNull();
    });
});

describe('who dealt the hand, and what takes it', () =>
{
    const seated = (seats: number, view: Partial<Hokm>, mine?: number): MatchView => ({
        ...match({}, 0),
        seats,
        players: Array.from({ length: seats }, (_, seat) => ({ seat, who: `dana${ seat }`, timeouts: 0 })) as MatchView['players'],
        mine,
        view: {
            kind: 'hokm',
            phase: 'tricks',
            hakem: 0,
            dealer: dealerOf(0, seats),
            trump: 'spades',
            turn: 0,
            lead: 0,
            hand: [],
            plays: [],
            trick: [],
            seats: Array.from({ length: seats }, (_, seat) => ({ seat, side: seats === 4 ? seat % 2 : seat, held: seats === 3 ? 17 : 13, tricks: 0, out: false })),
            points: Array.from({ length: seats === 4 ? 2 : seats }, () => 0),
            target: 7,
            round: 1,
            full: seats === 3 ? 17 : 13,
            ...(seats === 3 ? {} : { needed: 7 }),
            ...view
        }
    });

    const marks = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.hokm-seat')]
        .map((seat) => ({
            seat: Number(seat.dataset.seat),
            crown: seat.querySelector('.table-plate-marker svg.text-gold') !== null,
            dealer: seat.querySelector('.table-plate-marker .hokm-dealer') !== null
        }))
        .sort((one, other) => one.seat - other.seat);

    const marked = (seats: number, hakem: number, dealer: number) =>
        Array.from({ length: seats }, (_, seat) => ({ seat, crown: seat === hakem, dealer: seat !== hakem && seat === dealer }));

    it('puts the crown on the Hâkem and the hand on the dealer, at two, three and four, whoever the Hâkem is', () =>
    {
        for (const seats of [2, 3, 4])
        {
            for (let hakem = 0; hakem < seats; hakem += 1)
            {
                const dealer = dealerOf(hakem, seats);
                const { container, unmount } = renderTest(() => HokmBoard({ match: seated(seats, { hakem, dealer }, 0) }) as Rendered);

                expect(marks(container), `${ seats } players, Hâkem ${ hakem }`).toEqual(marked(seats, hakem, dealer));
                unmount();
            }
        }
    });

    it('reads the dealer off the board it was sent, and never draws both marks on one plate', () =>
    {
        const moved = renderTest(() => HokmBoard({ match: seated(4, { hakem: 0, dealer: 2 }, 0) }) as Rendered);

        expect(marks(moved.container)).toEqual(marked(4, 0, 2));
        moved.unmount();

        const same = renderTest(() => HokmBoard({ match: seated(4, { hakem: 1, dealer: 1 }, 0) }) as Rendered);

        expect(marks(same.container)).toEqual(marked(4, 1, 1));
        expect(same.container.querySelectorAll('.hokm-dealer').length).toBe(0);
    });

    it('moves both marks when the next hand has another Hâkem', () =>
    {
        const [current, setCurrent] = createSignal(seated(4, { hakem: 0, dealer: 3 }, 0));
        const { container } = renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);

        expect(marks(container)).toEqual(marked(4, 0, 3));

        setCurrent(seated(4, { hakem: 1, dealer: 0, round: 2 }, 0));

        expect(marks(container)).toEqual(marked(4, 1, 0));

        setCurrent(seated(4, { hakem: 2, dealer: 1, round: 3 }, 0));

        expect(marks(container)).toEqual(marked(4, 2, 1));
    });

    it('keeps the hand on the seat that draws second through every phase of the two-handed game', () =>
    {
        for (const phase of ['trump', 'discard', 'draw', 'tricks'] as const)
        {
            const board = seated(2, {
                phase,
                hakem: 1,
                dealer: 0,
                turn: 1,
                ...(phase === 'trump' ? { trump: undefined } : {}),
                ...(phase === 'tricks' ? {} : { stock: 30 })
            }, 0);
            const { container, unmount } = renderTest(() => HokmBoard({ match: board }) as Rendered);

            expect(marks(container), phase).toEqual(marked(2, 1, 0));
            unmount();
        }
    });

    it('names the dealer mark for a pointer and for a screen reader, in the reader\'s language', () =>
    {
        const english = renderTest(() => HokmBoard({ match: seated(4, { hakem: 0, dealer: 3 }, 0) }) as Rendered);
        const facts = (container: HTMLElement, seat: number) =>
            container.querySelector(`.hokm-seat[data-seat="${ seat }"] .table-plate-facts`)?.textContent ?? '';

        expect(english.container.querySelector('.hokm-seat[data-seat="3"] .hokm-dealer')?.getAttribute('title')).toBe('Dealer');
        expect(facts(english.container, 3)).toContain('Dealer');
        expect([0, 1, 2].some((seat) => facts(english.container, seat).includes('Dealer'))).toBe(false);
        english.unmount();

        useLocale().setLocale('fa');

        const persian = renderTest(() => HokmBoard({ match: seated(4, { hakem: 0, dealer: 3 }, 0) }) as Rendered);

        expect(persian.container.querySelector('.hokm-seat[data-seat="3"] .hokm-dealer')?.getAttribute('title')).toBe('دیلر');
        expect(facts(persian.container, 3)).toContain('دیلر');
    });

    it('says in the middle of the table that seven tricks take the hand, at two players and at four', () =>
    {
        for (const seats of [2, 4])
        {
            const { container, unmount } = renderTest(() => HokmBoard({ match: seated(seats, {}, 0) }) as Rendered);
            const line = container.querySelector('.hokm-centre .hokm-needed');

            expect(line?.querySelector('.tally')?.textContent, `${ seats } players`).toBe('7');
            expect(line?.textContent, `${ seats } players`).toBe('7 tricks take the hand');
            unmount();
        }
    });

    it('says at three players that a lead nobody can catch takes the hand, and puts no number on it', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: seated(3, {}, 0) }) as Rendered);
        const line = container.querySelector('.hokm-centre .hokm-needed');

        expect(line?.textContent).toBe('A lead nobody can catch takes the hand');
        expect(line?.querySelector('.tally')).toBeNull();
        expect(container.querySelector('.hokm-side')?.textContent).not.toContain('tricks take');
    });

    it('counts the tricks in the reader\'s own digits', () =>
    {
        useLocale().setLocale('fa');

        const { container } = renderTest(() => HokmBoard({ match: seated(4, {}, 0) }) as Rendered);
        const line = container.querySelector('.hokm-centre .hokm-needed');

        expect(line?.querySelector('.tally')?.textContent).toBe('۷');
        expect(line?.textContent).toContain('دور را');
        expect(line?.textContent).not.toContain('tricks');
    });

    it('keeps the line and the crest children of the caption itself, so a short table can drop the crest and a short stage all but the line', () =>
    {
        for (const seats of [2, 3, 4])
        {
            const { container, unmount } = renderTest(() => HokmBoard({ match: seated(seats, {}, 0) }) as Rendered);
            const caption = container.querySelector('.hokm-centre');

            expect(caption?.querySelectorAll(':scope > .hokm-needed').length, `${ seats } players`).toBe(1);
            expect(caption?.querySelectorAll(':scope > .hokm-crest').length, `${ seats } players`).toBe(2);
            expect(caption?.children.length, `${ seats } players`).toBeGreaterThan(4);
            unmount();
        }
    });

    it('seats two plates in the top corners at three players and at no other count, each over its own pile, so an upright table can tell when the crest and those piles have to go', () =>
    {
        for (const seats of [2, 3, 4])
        {
            for (const mine of [0, undefined])
            {
                const { container, unmount } = renderTest(() => HokmBoard({ match: seated(seats, {}, mine) }) as Rendered);
                const corners = [...container.querySelectorAll<HTMLElement>('.hokm-table > .hokm-seat[data-side^="top-"]')];
                const told = `${ seats } players read by ${ mine }`;

                expect(corners.map((seat) => seat.dataset.side).sort(), told).toEqual(seats === 3 ? ['top-left', 'top-right'] : []);
                expect(corners.filter((seat) => seat.querySelector(':scope > .hokm-pile') === null), told).toEqual([]);
                expect(container.querySelectorAll('.hokm-table .hokm-centre > .hokm-crest').length, told).toBe(2);
                unmount();
            }
        }
    });

    it('gives a screen reader the same sentence in the summary, with a card on the table or without, playing or watching', () =>
    {
        const cases = [
            [2, '7 tricks take the hand'],
            [3, 'A lead nobody can catch takes the hand'],
            [4, '7 tricks take the hand']
        ] as const;

        for (const [seats, says] of cases)
        {
            for (const mine of [0, undefined])
            {
                for (const trick of [[], [12]])
                {
                    const { container, unmount } = renderTest(() => HokmBoard({ match: seated(seats, { trick }, mine) }) as Rendered);
                    const told = `${ seats } players read by ${ mine } with ${ trick.length } on the table`;

                    expect(container.querySelector('.hokm-centre') === null, told).toBe(trick.length > 0);
                    expect(container.querySelector('.hokm-side')?.textContent, told).toContain(says);
                    unmount();
                }
            }
        }
    });
});
