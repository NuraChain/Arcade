import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

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
    const clock = (): ManualClock => runtime().clock as ManualClock;

    const playing = (): MatchView => match({ phase: 'tricks', trump: 'spades', turn: 1, lead: 1, hand: [40, 41], plays: [] }, 0);

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
            get match(): MatchView
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
    const turn = (): MatchView => match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }, 0);

    const cardButton = (container: HTMLElement, card: number): HTMLButtonElement =>
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
    const turn = (): MatchView => match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }, 0);

    const drive = (): ((events: MatchEvent[]) => void) =>
    {
        const [batch, setBatch] = createSignal<EventBatch>({ seq: 0, events: [] });

        vi.spyOn(useBoard(), 'events').mockImplementation(batch);

        return (events) => setBatch((held) => ({ seq: held.seq + 1, events }));
    };

    const press = (container: HTMLElement, card: number): void =>
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
    const following = (): MatchView => match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 3, trick: [34], hand: [38, 0, 40], plays: [38] }, 0);

    const watching = (): MatchView => ({ ...match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 3, trick: [34] }), mine: undefined });

    const cardButton = (container: HTMLElement, card: number): HTMLButtonElement =>
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
