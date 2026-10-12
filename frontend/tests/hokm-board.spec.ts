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
import { NO_EVENTS, useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';

type Rendered = HTMLElement;

type Hokm = Extract<MatchView['view'], { kind: 'hokm' }>;

const written = (container: HTMLElement) => [...container.querySelectorAll('.hokm-table *')]
    .filter((one) => one.children.length === 0 && one.closest('.sr-only, .table-plate, .hokm-chip, .hokm-clock, .hokm-stock, .hokm-last-tile, .hokm-choose, .hokm-banner') === null)
    .map((one) => (one.textContent ?? '').trim())
    .filter((said) => said !== '');

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
    const teams = (container: HTMLElement) => [0, 1, 2, 3].map((seat) =>
    {
        const mark = container.querySelector<HTMLElement>(`.hokm-seat[data-seat="${ seat }"] .table-plate-team`);

        return mark === null ? null : `${ mark.dataset.side }:${ mark.querySelector('.sr-only')?.textContent ?? '' }`;
    });

    it('marks each plate with its side at a table two sides play at, and says who is with the reader', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: match({ hand: [0, 14, 30] }, 0) }) as Rendered);

        expect(teams(container)).toEqual(['0:', '1:Opponent', '0:Partner', '1:Opponent']);
    });

    it('numbers the sides for somebody watching, and says it in Persian too', () =>
    {
        const { mine: _mine, ...watched } = match({});
        const english = renderTest(() => HokmBoard({ match: watched as MatchView }) as Rendered);

        expect(teams(english.container)).toEqual(['0:Team 1', '1:Team 2', '0:Team 1', '1:Team 2']);
        english.unmount();

        useLocale().setLocale('fa');

        const persian = renderTest(() => HokmBoard({ match: match({}, 1) }) as Rendered);

        expect(teams(persian.container)).toEqual([`0:${ useLocale().t('card.opponent') }`, '1:', `0:${ useLocale().t('card.opponent') }`, `1:${ useLocale().t('card.partner') }`]);
        expect(useLocale().t('card.partner')).not.toBe('Partner');
    });

    it('marks no sides where every seat plays for itself', () =>
    {
        const three = match({ seats: [0, 1, 2].map((seat) => ({ seat, side: seat, held: 0, tricks: 0, out: false })), points: [0, 0, 0] });
        const { container } = renderTest(() => HokmBoard({ match: { ...three, seats: 3, players: three.players.slice(0, 3) } }) as Rendered);

        expect(container.querySelector('.table-plate-team')).toBeNull();
    });

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

    it('writes nothing in the middle of the felt, in either language', () =>
    {
        for (const language of ['fa', 'en'] as const)
        {
            useLocale().setLocale(language);

            const { container, unmount } = renderTest(() => HokmBoard({ match: match({}) }) as Rendered);

            expect(container.querySelector('.hokm-centre'), language).toBeNull();
            expect(written(container), `${ language }: these words are drawn on the felt`).toEqual([]);
            unmount();
        }
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
        const [batch, setBatch] = createSignal<EventBatch>({ ...NO_EVENTS, seq: 0, events: [] });

        vi.spyOn(useBoard(), 'events').mockImplementation(batch);

        return (events) => setBatch((held) => ({ ...NO_EVENTS, seq: held.seq + 1, events }));
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
        const [batch] = createSignal<EventBatch>({ ...NO_EVENTS, seq: 7, events: [card(3, 1, 12)] });

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

    it('moves the lift when another card is tapped, and marks the lifted card as the one a second tap plays', () =>
    {
        useDevice().overrideCoarse(true);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);

        fire(cardButton(container, 0), 'click');

        expect(cardButton(container, 0).dataset.go).toBe('true');

        fire(cardButton(container, 14), 'click');

        expect(cardButton(container, 0).dataset.picked).toBeUndefined();
        expect(cardButton(container, 0).dataset.go).toBeUndefined();
        expect(cardButton(container, 14).dataset.picked).toBe('true');
        expect(cardButton(container, 14).dataset.go).toBe('true');
        expect(play).not.toHaveBeenCalled();

        fire(cardButton(container, 14), 'click');

        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith({ kind: 'hokm', verb: 'card', card: 14 });
    });

    it('offers no button that plays a card but the card: none in the page, with a card lifted or not', () =>
    {
        useDevice().overrideCoarse(true);
        vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);
        const beside = () => [...container.querySelectorAll('button')]
            .filter((one) => !one.classList.contains('card-hold'))
            .map((one) => one.getAttribute('aria-label') ?? one.textContent?.trim() ?? '');

        expect(beside()).toEqual(['Sort']);

        fire(cardButton(container, 14), 'click');

        expect(beside()).toEqual(['Sort']);
        expect(container.querySelector('.hokm-play')).toBeNull();
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
        const [batch, setBatch] = createSignal<EventBatch>({ ...NO_EVENTS, seq: 0, events: [] });

        vi.spyOn(useBoard(), 'events').mockImplementation(batch);

        return (events) => setBatch((held) => ({ ...NO_EVENTS, seq: held.seq + 1, events }));
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

    it('says in the card\'s own name whether it would take the trick, draws no sentence about it, and stops when the helper is off', () =>
    {
        useDevice().overrideCoarse(false);
        const { container } = renderTest(() => HokmBoard({ match: following() }) as Rendered);

        cardButton(container, 38).focus();

        expect(cardButton(container, 38).getAttribute('aria-label')).toBe('Play the A of Hearts. Takes the trick so far.');
        expect(container.querySelector('.hokm-outcome')).toBeNull();
        expect(container.textContent).not.toContain('Takes the trick so far.');

        useSettings().update({ hintOutcome: false });

        expect(cardButton(container, 38).getAttribute('aria-label')).toBe('Play the A of Hearts');
    });

    it('keeps the outcome on the lifted card itself, where the second tap is made', () =>
    {
        useDevice().overrideCoarse(true);
        const { container } = renderTest(() => HokmBoard({ match: following() }) as Rendered);

        fire(cardButton(container, 38), 'click');

        expect(cardButton(container, 38).dataset.go).toBe('true');
        expect(cardButton(container, 38).getAttribute('aria-label')).toBe('Play the A of Hearts. Takes the trick so far.');
        expect([...container.querySelectorAll('button')].some((one) => one.textContent?.trim().startsWith('Play the'))).toBe(false);
    });

    it('coaches the rule that binds this play from a lamp, and with the coach off keeps the rule for a screen reader alone', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: following() }) as Rendered);
        const said = () => [...container.querySelectorAll('.hokm-rail > p.sr-only')].map((one) => one.textContent ?? '');

        expect(container.querySelector('[role="note"]')?.textContent).toContain('You have to follow the suit that was led.');
        expect(container.querySelector('[role="note"]')?.getAttribute('data-lamp')).toBe('true');
        expect(said()).toEqual(['Your turn.']);

        useSettings().update({ hintRules: false });

        expect(container.querySelector('[role="note"]')).toBeNull();
        expect(said()).toEqual(['Your turn.', 'You have to follow the suit that was led.']);
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

    const watching = () =>
    {
        const seen = drawing(null);

        return { ...seen, view: { ...seen.view, hand: [] } } as MatchView;
    };

    const offer = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button.hokm-offer');

    const stock = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button.hokm-stock-press');

    const beside = (container: HTMLElement) => [...container.querySelectorAll('button')]
        .filter((one) => !one.classList.contains('card-hold'))
        .map((one) => one.getAttribute('aria-label') ?? one.textContent?.trim() ?? '');

    it('lays the drawn card on the felt for the drawer alone, and makes the card and the stock the two choices', () =>
    {
        const drawer = renderTest(() => HokmBoard({ match: drawing(0) }) as Rendered);

        expect(offer(drawer.container)?.querySelector('.card-face')).not.toBeNull();
        expect(offer(drawer.container)?.getAttribute('aria-label')).toBe('Keep the A of Clubs');
        expect(stock(drawer.container)?.getAttribute('aria-label')).toBe('Take the next card');
        expect(drawer.container.querySelector('.hokm-stock')?.getAttribute('data-live')).toBe('true');
        expect(beside(drawer.container)).toEqual(['Take the next card', 'Keep the A of Clubs', 'Sort']);
        expect(drawer.container.querySelector('.hokm-choose')).toBeNull();
        drawer.unmount();

        for (const other of [drawing(1), watching()])
        {
            const seen = renderTest(() => HokmBoard({ match: other }) as Rendered);

            expect(offer(seen.container), `reader ${ other.mine }`).toBeNull();
            expect(stock(seen.container), `reader ${ other.mine }`).toBeNull();
            expect(seen.container.querySelector('.hokm-stock')?.getAttribute('data-live'), `reader ${ other.mine }`).toBeNull();
            seen.unmount();
        }
    });

    it('keeps the drawn card when it is pressed, and passes it when the stock is', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: drawing(0) }) as Rendered);

        fire(offer(container)!, 'click');
        fire(stock(container)!, 'click');

        expect(play.mock.calls.map(([body]) => body)).toEqual([
            { kind: 'hokm', verb: 'keep' },
            { kind: 'hokm', verb: 'reject' }
        ]);
    });

    it('shows the stock as a count to everybody, counts a hand being filled on its plate and nowhere else, and gives a watcher nothing to press', () =>
    {
        const drawer = renderTest(() => HokmBoard({ match: drawing(0) }) as Rendered);

        expect(drawer.container.querySelector('.hokm-stock')?.textContent).toContain('39');
        expect(drawer.container.querySelector('.hokm-filled')).toBeNull();
        expect(drawer.container.textContent).not.toContain('7/13');
        expect(drawer.container.querySelector('.hokm-seat[data-seat="0"]')?.textContent).toContain('5 cards');
        drawer.unmount();

        const watcher = renderTest(() => HokmBoard({ match: watching() }) as Rendered);

        expect(watcher.container.querySelector('.hokm-stock')?.textContent).toContain('39');
        expect(beside(watcher.container)).toEqual([]);
    });

    it('lets the seat putting cards down lift them, and takes them at the stock only at the exact count', () =>
    {
        useDevice().overrideCoarse(false);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ match: two({ phase: 'discard', turn: 0, discard: 3, stock: 42, hand: [3, 14, 27, 40, 51] }, 0) }) as Rendered);
        const hold = (card: number) => container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!;
        const due = () => container.querySelector('.hokm-stock-due');

        expect(hold(3).disabled).toBe(false);
        expect(hold(3).getAttribute('aria-pressed')).toBe('false');
        expect(due()?.textContent?.trim()).toBe('0/3');
        expect(stock(container)).toBeNull();

        [51, 3, 27].forEach((card) => fire(hold(card), 'click'));

        expect(hold(3).getAttribute('aria-pressed')).toBe('true');
        expect(hold(3).dataset.go).toBeUndefined();
        expect(due()?.textContent?.trim()).toBe('3/3');
        expect(due()?.getAttribute('data-full')).toBe('true');
        expect(stock(container)?.getAttribute('aria-label')).toBe('Put these 3 face down');

        fire(hold(40), 'click');

        expect(hold(40).getAttribute('aria-pressed')).toBe('false');
        expect(due()?.textContent?.trim()).toBe('3/3');

        fire(hold(27), 'click');

        expect(stock(container)).toBeNull();
        expect(due()?.textContent?.trim()).toBe('2/3');
        expect(due()?.getAttribute('data-full')).toBeNull();

        fire(hold(40), 'click');
        fire(stock(container)!, 'click');

        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith({ kind: 'hokm', verb: 'discard', cards: [3, 40, 51] });
    });

    it('gives the seat waiting on a discard nothing to press', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: two({ phase: 'discard', turn: 0, stock: 42, hand: [3, 14, 27, 40, 51] }, 1) }) as Rendered);

        expect([...container.querySelectorAll<HTMLButtonElement>('.card-hold')].every((button) => button.disabled)).toBe(true);
        expect(stock(container)).toBeNull();
        expect(container.querySelector('.hokm-stock-due')).toBeNull();
        expect(beside(container)).toEqual(['Sort']);
    });

    it('shows the drawer the card their keep put face down, beside the stock and in words for a screen reader, and draws nothing else about the cards put down', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: two({ phase: 'draw', turn: 1, stock: 37, glimpse: 9, hand: [1, 15, 27, 40, 41, 50] }, 0) }) as Rendered);

        expect(container.querySelector('.hokm-glimpse .card-face')).not.toBeNull();
        expect(container.querySelector('.hokm-glimpse')?.getAttribute('aria-hidden')).toBe('true');
        expect([...container.querySelectorAll('.hokm-rail > p.sr-only')].map((one) => one.textContent)).toContain('The J of Clubs went face down.');
        expect(container.querySelector('[class*="discard"], [class*="burn"]')).toBeNull();
    });
});

describe('the clock on a plate, and the two things beside the hand', () =>
{
    const turn = (extra: Partial<MatchView> = {}, view: Partial<Hokm> = {}): MatchView => ({
        ...match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30, 45], plays: [0, 14, 30, 45], ...view }, 0),
        ...extra
    });

    const clocks = (container: HTMLElement) => [...container.querySelectorAll('.hokm-clock')].map((one) => one.closest('.hokm-seat')?.getAttribute('data-seat') ?? 'nowhere');

    afterEach(() =>
    {
        useSettings().reset();
    });

    it('lays the stage out as the table and a row under it, and puts nothing of its own over the table', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn({ remainingMs: 20_000 }) }) as Rendered);
        const foot = container.querySelector('.table-grid > .hokm-foot')!;

        expect(container.querySelector('.table-grid')!.classList.contains('hokm-grid')).toBe(true);
        expect(container.querySelector('.table-grid > .table-bar')).toBeNull();
        expect(container.querySelector('.table-fit')!.children.length, 'something lies in the table\'s cell beside the table').toBe(1);
        expect(foot.classList.contains('table-hand')).toBe(true);
        expect([...foot.children].map((one) => one.classList[one.classList.length - 1])).toEqual(['hokm-rail', 'hokm-hands']);
        expect(container.querySelector('.hokm-table button'), 'a tool is drawn on the felt').toBeNull();
    });

    it('puts Sort at one end of that row and the tip\'s lamp at the other', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);
        const ends = [...container.querySelectorAll('.hokm-rail > .hokm-rail-end')];

        expect(ends.length).toBe(2);
        expect(ends[0].querySelector('button')?.getAttribute('aria-label')).toBe('Sort');
        expect(ends[0].querySelector('[role="note"]')).toBeNull();
        expect(ends[1].querySelector('[role="note"]')?.getAttribute('data-lamp')).toBe('true');
        expect(ends[1].querySelector('button')).toBeNull();
    });

    it('lets the tip be read in the reader\'s own direction, in a row that does not mirror', () =>
    {
        useLocale().setLocale('fa');

        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);
        const lamp = container.querySelector('.hokm-rail-end:last-of-type [role="note"]')!;

        expect(lamp.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
        expect(lamp.closest('[dir]')?.classList.contains('contents'), 'the wrapper that carries the direction takes a place of its own in the row').toBe(true);
        expect(container.querySelector('.hokm-rail-end:first-of-type .hokm-sort')).not.toBeNull();
    });

    it('keeps room for the two whether or not there is a tip, so the table does not change size with the turn', () =>
    {
        const [current, setCurrent] = createSignal(turn());
        const { container } = renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);
        const foot = container.querySelector('.hokm-foot')!;

        expect(container.querySelector('.hokm-rail [role="note"]'), 'the reader on turn has no tip to start from').not.toBeNull();
        expect(foot.getAttribute('data-tools')).toBe('true');

        setCurrent(turn({ rev: 4 }, { turn: 1, plays: [] }));

        expect(container.querySelector('.hokm-rail [role="note"]')).toBeNull();
        expect(container.querySelector('.hokm-foot')).toBe(foot);
        expect(foot.getAttribute('data-tools')).toBe('true');
    });

    it('puts the clock on the plate of whoever is to play, and moves it when the turn does', () =>
    {
        const [current, setCurrent] = createSignal(turn({ remainingMs: 20_000 }));
        const { container } = renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);
        const mine = container.querySelector('.hokm-seat[data-seat="0"] > .hokm-clock')!;

        expect(clocks(container)).toEqual(['0']);
        expect([...mine.querySelectorAll('span')].map((one) => one.textContent?.trim())).toEqual(expect.arrayContaining(['20s', 'About 20s left']));
        expect(mine.previousElementSibling?.classList.contains('table-plate')).toBe(true);

        setCurrent(turn({ remainingMs: 30_000, rev: 4 }, { turn: 1, plays: [] }));

        expect(clocks(container)).toEqual(['1']);
        expect(container.querySelector('.hokm-seat[data-seat="1"] > .hokm-clock')?.textContent).toContain('30s');
    });

    it('writes on each plate what that seat has taken and holds, in its side\'s colour, and dims a seat that has left', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn({}, { seats: [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: 13 - seat, tricks: seat, out: seat === 3 })) }) }) as Rendered);
        const plate = (seat: number) => container.querySelector(`.hokm-seat[data-seat="${ seat }"] .table-plate`)!;

        expect([0, 1, 2, 3].map((seat) => [...plate(seat).querySelectorAll('.table-plate-facts .tally')].map((one) => one.textContent))).toEqual([['0', '13'], ['1', '12'], ['2', '11'], ['3', '10']]);
        expect([0, 1, 2, 3].map((seat) => plate(seat).querySelector('.table-plate-facts svg')?.getAttribute('class'))).toEqual(['text-accent', 'text-gold', 'text-accent', 'text-gold']);
        expect([0, 1, 2, 3].map((seat) => plate(seat).getAttribute('data-dim'))).toEqual([null, null, null, 'true']);
        expect(plate(2).querySelector('.table-plate-facts .sr-only')?.textContent).toContain('2 tricks');
    });

    it('puts it on the Hâkem while trump is being named', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn({ remainingMs: 20_000 }, { phase: 'trump', trump: undefined, hakem: 2, turn: 2, lead: 2, hand: [], plays: [] }) }) as Rendered);

        expect(clocks(container)).toEqual(['2']);
    });

    it('speaks the turn to a screen reader alone, and prints it nowhere', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);
        const live = container.querySelector('[aria-live="polite"]')!;

        expect(live.textContent).toBe('Your turn.');
        expect(live.classList.contains('sr-only')).toBe(true);
        expect(live.closest('.hokm-rail')).not.toBeNull();
        expect(written(container)).toEqual([]);
    });

    it('sorts the hand when Sort is pressed, trump first, and says so on the button', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn() }) as Rendered);
        const order = () => [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => Number(one.dataset.card));
        const sort = () => container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!;

        expect(order()).toEqual([0, 14, 30, 45]);
        expect(sort().getAttribute('aria-pressed')).toBe('false');

        fire(sort(), 'click');

        expect(order()[0]).toBe(45);
        expect(sort().getAttribute('aria-pressed')).toBe('true');
    });

    it('gives somebody watching no tool, no tip, no clock and no room kept for any', () =>
    {
        const seen = match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0 });
        const { container } = renderTest(() => HokmBoard({ match: { ...seen, mine: undefined, remainingMs: undefined } }) as Rendered);

        expect(container.querySelector('.table-grid > .hokm-foot > .hokm-rail')).not.toBeNull();
        expect(container.querySelector('.hokm-foot')!.hasAttribute('data-tools')).toBe(false);
        expect(container.querySelectorAll('button').length).toBe(0);
        expect(container.querySelector('[role="note"]')).toBeNull();
        expect(container.querySelector('.hokm-clock')).toBeNull();
    });

    it('keeps the row, and what a screen reader is told, for a reader who holds nothing yet', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn({}, { phase: 'trump', trump: undefined, hakem: 2, turn: 2, lead: 2, hand: [], plays: [] }) }) as Rendered);

        expect(container.querySelector('.hokm-hands')).toBeNull();
        expect(container.querySelector('.hokm-foot > .hokm-rail [aria-live="polite"]')?.textContent).toContain('is choosing trump');
        expect(container.querySelector('.hokm-foot')!.getAttribute('data-tools')).toBe('true');
    });

    it('takes the row away with the game', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: turn({ remainingMs: 20_000, finishedAt: new Date(900_000).toISOString(), outcome: 'won', winner: 0 }) }) as Rendered);

        expect(container.querySelector('.hokm-foot')).toBeNull();
        expect(container.querySelector('.hokm-rail')).toBeNull();
        expect(container.querySelector('.hokm-clock')).toBeNull();
        expect(container.querySelector('.table-result')).not.toBeNull();
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

    it('says to a screen reader that seven tricks take the hand, at two players and at four, and writes it nowhere', () =>
    {
        for (const seats of [2, 4])
        {
            const { container, unmount } = renderTest(() => HokmBoard({ match: seated(seats, {}, 0) }) as Rendered);
            const summary = container.querySelector('.hokm-side')!;

            expect(summary.classList.contains('sr-only'), `${ seats } players`).toBe(true);
            expect(summary.textContent, `${ seats } players`).toContain('7 tricks take the hand');
            expect(written(container), `${ seats } players`).toEqual([]);
            unmount();
        }
    });

    it('says at three players that a lead nobody can catch takes the hand, and puts no number on it', () =>
    {
        const { container } = renderTest(() => HokmBoard({ match: seated(3, {}, 0) }) as Rendered);
        const summary = container.querySelector('.hokm-side')!;

        expect(summary.textContent).toContain('A lead nobody can catch takes the hand');
        expect(summary.textContent).not.toContain('tricks take');
        expect(written(container)).toEqual([]);
    });

    it('counts the tricks in the reader\'s own digits', () =>
    {
        useLocale().setLocale('fa');

        const { container } = renderTest(() => HokmBoard({ match: seated(4, {}, 0) }) as Rendered);
        const summary = container.querySelector('.hokm-side')!;

        expect(summary.textContent).toContain('۷');
        expect(summary.textContent).toContain('دور را');
        expect(summary.textContent).not.toContain('tricks');
    });

    it('sets the suit that is trump in a medal in the middle of the felt, red or black as the suit is', () =>
    {
        for (const [suit, ink] of [['hearts', 'text-danger-fill'], ['diamonds', 'text-danger-fill'], ['spades', 'text-bright-ink'], ['clubs', 'text-bright-ink']] as const)
        {
            const { container, unmount } = renderTest(() => HokmBoard({ match: seated(4, { trump: suit }, 0) }) as Rendered);
            const medal = container.querySelector('.hokm-table > .hokm-medal')!;

            expect(medal.getAttribute('aria-hidden'), suit).toBe('true');
            expect(medal.getAttribute('data-set'), suit).toBe('true');
            expect(medal.querySelectorAll('svg').length, suit).toBe(1);
            expect(medal.querySelector('svg')?.getAttribute('class'), suit).toBe(ink);
            expect(medal.textContent?.trim(), suit).toBe('');
            unmount();
        }
    });

    it('wears a crown there while the Hâkem has not named one, for the Hâkem and for everybody else', () =>
    {
        for (const mine of [0, 1, undefined])
        {
            const { container, unmount } = renderTest(() => HokmBoard({ match: seated(4, { phase: 'trump', trump: undefined, hand: mine === 0 ? [0, 14, 30, 45, 50] : [] }, mine) }) as Rendered);
            const medal = container.querySelector('.hokm-table > .hokm-medal')!;

            expect(medal.hasAttribute('data-set'), `read by ${ mine }`).toBe(false);
            expect(medal.querySelector('svg')?.getAttribute('class'), `read by ${ mine }`).toBe('text-gold');
            unmount();
        }
    });

    it('keeps the medal the node it is when trump is named and when a card is played over it', () =>
    {
        const [current, setCurrent] = createSignal(seated(4, { phase: 'trump', trump: undefined }, 1));
        const { container } = renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);
        const medal = container.querySelector('.hokm-medal')!;

        setCurrent({ ...seated(4, { trump: 'hearts' }, 1), rev: 4 });

        expect(container.querySelector('.hokm-medal')).toBe(medal);
        expect(medal.getAttribute('data-set')).toBe('true');

        setCurrent({ ...seated(4, { trump: 'hearts', trick: [12], turn: 1 }, 1), rev: 5 });

        expect(container.querySelector('.hokm-medal')).toBe(medal);
        expect(container.querySelectorAll('.hokm-trick').length).toBe(1);
        expect(medal.hasAttribute('hidden'), 'the medal left the felt when a card was played').toBe(false);
    });

    it('seats two plates in the top corners at three players and at no other count, each over its own pile, so an upright table can tell when those piles have to go', () =>
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

                    expect(container.querySelector('.hokm-medal'), told).not.toBeNull();
                    expect(container.querySelector('.hokm-side')?.textContent, told).toContain(says);
                    unmount();
                }
            }
        }
    });
});

describe('a table that is read again', () =>
{
    const chairs = (held: number) => [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: seat === 3 ? held : 4, tricks: seat === 2 ? 1 : 0, out: false }));

    const table = (view: Partial<Hokm> = {}, more: Partial<MatchView> = {}): MatchView => ({
        ...match({
            phase: 'tricks',
            trump: 'spades',
            turn: 0,
            lead: 3,
            trick: [12],
            took: { lead: 1, cards: [1, 2, 3, 4], seat: 2 },
            hand: [0, 14, 30, 45],
            plays: [0, 14],
            seats: chairs(3),
            ...view
        }, 0),
        ...more
    });

    const shown = (first: MatchView) =>
    {
        const [current, setCurrent] = createSignal(first);
        const { container } = renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);

        return { container, read: (next: MatchView) => setCurrent(structuredClone(next)) };
    };

    const under = (container: HTMLElement) => [...container.querySelectorAll<Element>('.hokm-stage *')];

    const gone = (nodes: readonly Element[]) => nodes
        .filter((one) => !document.contains(one))
        .map((one) => `${ one.tagName.toLowerCase() }.${ (one.getAttribute('class') ?? '').split(' ')[0] }`);

    it('draws nothing again for an answer it already had', () =>
    {
        const { container, read } = shown(table());
        const before = under(container);

        read(table());

        expect(before.length, 'the table was not drawn at all').toBeGreaterThan(60);
        expect(gone(before), 'these were drawn again though nothing had changed').toEqual([]);
    });

    it('draws nothing again on a felt with nothing lying on it', () =>
    {
        const bare = () => table({ trick: [], turn: 3, lead: 3, plays: [] });
        const { container, read } = shown(bare());
        const before = under(container);

        read(bare());

        expect(container.querySelector('.hokm-medal'), 'an empty felt has no medal').not.toBeNull();
        expect(gone(before)).toEqual([]);
    });

    it('draws nothing again at a table for two with a card drawn and waiting', () =>
    {
        const drawing = (): MatchView => ({
            ...match({
                phase: 'draw',
                trump: 'hearts',
                hakem: 0,
                dealer: 1,
                turn: 0,
                lead: 0,
                hand: [0, 14, 30, 45, 50],
                offer: 33,
                glimpse: 21,
                stock: 20,
                seats: [0, 1].map((seat) => ({ seat, side: seat, held: 5, tricks: 0, out: false }))
            }, 0),
            seats: 2,
            players: [0, 1].map((seat) => ({ seat, who: `سارا${ seat }`, timeouts: 0 })) as MatchView['players']
        });
        const { container, read } = shown(drawing());
        const before = under(container);

        read(drawing());

        expect(container.querySelector('.hokm-offer'), 'the drawn card is not on the felt').not.toBeNull();
        expect(container.querySelector('.hokm-stock-press')).not.toBeNull();
        expect(gone(before)).toEqual([]);
    });

    it('says which piles have nothing in them, the reader\'s own among them, and fills one a back at a time', () =>
    {
        const empty = (container: HTMLElement) => [0, 1, 2, 3].map((seat) => container.querySelector(`.hokm-seat[data-seat="${ seat }"] .hokm-pile`)?.getAttribute('data-empty') ?? null);
        const held = (three: number) => [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: seat === 3 ? three : (seat === 1 ? 0 : 4), tricks: 0, out: false }));
        const { container, read } = shown(table({ seats: held(0) }));
        const pile = container.querySelector('.hokm-seat[data-seat="3"] .hokm-pile')!;

        expect(empty(container)).toEqual(['true', 'true', null, 'true']);

        read(table({ seats: held(2) }, { rev: 4 }));

        expect(empty(container)).toEqual(['true', 'true', null, null]);
        expect(container.querySelector('.hokm-seat[data-seat="3"] .hokm-pile'), 'the pile was made again to take its first card').toBe(pile);
        expect(pile.querySelectorAll('.card-back').length).toBe(2);
    });

    it('keeps every card, plate and chip when somebody else plays, and takes one back off their pile', () =>
    {
        const { container, read } = shown(table({ turn: 3, lead: 2, plays: [] }));
        const before = under(container);

        read(table({ turn: 0, lead: 2, trick: [12, 20], seats: chairs(2) }, { rev: 4 }));

        expect(container.querySelectorAll('.hokm-trick').length).toBe(2);
        expect(container.querySelectorAll('.card-hold').length).toBe(4);
        expect(gone(before), 'a card played by one seat took more off the table than the back it left with').toEqual(['span.card-back']);
    });

    it('leaves the reader on the card they were on', () =>
    {
        const { container, read } = shown(table({}, { remainingMs: 20_000 }));
        const card = container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!;

        card.focus();
        expect(document.activeElement).toBe(card);

        read(table({}, { remainingMs: 20_000 }));
        expect(document.activeElement, 'a re-read took the card out from under the keyboard').toBe(card);

        read(table({}, { remainingMs: 12_000 }));
        expect(document.activeElement, 'the clock moving on took the card out from under the keyboard').toBe(card);
    });

    it('keeps the four suits under a Hâkem who is still choosing', () =>
    {
        const choosing = () => match({ phase: 'trump', hakem: 0, turn: 0, hand: [0, 14, 30, 45, 50] }, 0);
        const { container, read } = shown(choosing());
        const suits = [...container.querySelectorAll<HTMLButtonElement>('.hokm-choose button')];

        suits[2].focus();
        read(choosing());

        expect(suits.length).toBe(4);
        expect(gone(suits)).toEqual([]);
        expect(document.activeElement).toBe(suits[2]);
    });

    it('moves the cards when the hand is sorted, and makes none of them again', () =>
    {
        const { container } = shown(table({ hand: [0, 2, 14, 16, 30, 45] }));
        const hand = [...container.querySelectorAll<HTMLElement>('.card-hold')];
        const order = () => [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card);
        const dealt = order();

        fire(container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!, 'click');

        expect(order()).not.toEqual(dealt);
        expect(gone(hand)).toEqual([]);
    });

    it('takes only the card that was played out of the hand, at the press and when the server says so', () =>
    {
        useDevice().overrideCoarse(false);
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container, read } = shown(table());
        const hand = [...container.querySelectorAll<HTMLElement>('.card-hold')];
        const plates = [...container.querySelectorAll<HTMLElement>('.table-plate')];

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');

        expect(gone(hand)).toEqual(['button.card-hold']);

        read(table({ turn: 1, lead: 3, trick: [12, 14], hand: [0, 30, 45], plays: [] }, { rev: 4 }));

        expect(gone(hand)).toEqual(['button.card-hold']);
        expect(gone(plates)).toEqual([]);
    });

    it('keeps the crown where it is while the Hâkem is the Hâkem, and moves it without drawing the plates again', () =>
    {
        const { container, read } = shown(table());
        const crown = container.querySelector('.hokm-seat[data-seat="0"] .table-plate-marker svg');
        const plates = [...container.querySelectorAll<HTMLElement>('.table-plate')];

        read(table({}, { rev: 4 }));

        expect(crown, 'the Hâkem wears no crown').not.toBeNull();
        expect(document.contains(crown), 'the crown was drawn again for a move that left the Hâkem alone').toBe(true);

        read(table({ hakem: 1, dealer: 0, round: 2 }, { rev: 5 }));

        expect(container.querySelector('.hokm-seat[data-seat="1"] .table-plate-marker svg.text-gold')).not.toBeNull();
        expect(container.querySelector('.hokm-seat[data-seat="0"] .table-plate-marker .hokm-dealer')).not.toBeNull();
        expect(gone(plates)).toEqual([]);
    });

    it('throws a card from a plate when the pile beside it is not drawn', () =>
    {
        const [batch, setBatch] = createSignal<EventBatch>({ ...NO_EVENTS, seq: 0, events: [] });

        vi.spyOn(useBoard(), 'events').mockImplementation(batch);

        const boxes = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element)
        {
            return (this.classList.contains('hokm-pile') ? [] : [{}]) as unknown as DOMRectList;
        });
        const measured: Element[] = [];

        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
        {
            measured.push(this);

            return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
        });

        const { container } = shown(table({ turn: 3, lead: 2, plays: [] }));

        measured.length = 0;
        setBatch({ ...NO_EVENTS, seq: 1, events: [{ rev: 4, seat: 3, at: '', log: { kind: 'hokm', moves: [{ e: 'card', seat: 3, card: 20 }] } }] });
        (runtime().clock as ManualClock).advance(0);

        expect(boxes).toHaveBeenCalled();
        expect(measured.some((one) => one.classList.contains('hokm-pile')), 'a pile with no box was asked where it is').toBe(false);
        expect(measured).toContain(container.querySelector('.hokm-seat[data-seat="3"] .table-plate'));
    });
});
