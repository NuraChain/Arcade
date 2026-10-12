import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import { dealerOf } from '../../backend/src/domains/match/hokm/scoring.ts';
import HokmBoard from '../src/components/games/hokm-board.component.azeroth';
import { PLUS, gatherLength } from '../src/game/hokm-beats.ts';
import { TIMING } from '../src/game/motion.ts';
import { HASTE } from '../src/game/stage/director.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { NO_EVENTS, useBoard } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';
import { act, card, elapse, flush, mounted, type Hokm } from './hokm-mounted.ts';

type Rendered = HTMLElement;

const LONG = 20_000;

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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: match({ hand: [0, 14, 30] }, 0) }) as Rendered);

        expect(teams(container)).toEqual(['0:', '1:Opponent', '0:Partner', '1:Opponent']);
    });

    it('numbers the sides for somebody watching, and says it in Persian too', () =>
    {
        const { mine: _mine, ...watched } = match({});
        const english = renderTest(() => HokmBoard({ events: NO_EVENTS, match: watched as MatchView }) as Rendered);

        expect(teams(english.container)).toEqual(['0:Team 1', '1:Team 2', '0:Team 1', '1:Team 2']);
        english.unmount();

        useLocale().setLocale('fa');

        const persian = renderTest(() => HokmBoard({ events: NO_EVENTS, match: match({}, 1) }) as Rendered);

        expect(teams(persian.container)).toEqual([`0:${ useLocale().t('card.opponent') }`, '1:', `0:${ useLocale().t('card.opponent') }`, `1:${ useLocale().t('card.partner') }`]);
        expect(useLocale().t('card.partner')).not.toBe('Partner');
    });

    it('marks no sides where every seat plays for itself', () =>
    {
        const three = match({ seats: [0, 1, 2].map((seat) => ({ seat, side: seat, held: 0, tricks: 0, out: false })), points: [0, 0, 0] });
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: { ...three, seats: 3, players: three.players.slice(0, 3) } }) as Rendered);

        expect(container.querySelector('.table-plate-team')).toBeNull();
    });

    it('draws no hand at all while the reader is waiting for trump with nothing dealt to them', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: match({}) }) as Rendered);

        expect(container.querySelector('.hokm-table')).not.toBeNull();
        expect(container.querySelector('.hokm-hand')).toBeNull();
        expect(container.querySelector('[aria-label="Your hand"]')).toBeNull();
    });

    it('still draws the hand once there are cards in it', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: match({ hand: [0, 14, 30] }, 0) }) as Rendered);

        expect(container.querySelectorAll('.hokm-hand').length).toBe(1);
        expect(container.querySelectorAll('.hokm-hand .card-hold').length).toBe(3);
    });

    it('says which hand of the match is being played beside the score', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: match({ round: 4 }) }) as Rendered);

        expect(container.querySelector('.hokm-side')?.textContent).toContain('Hand 4');
    });

    it('writes nothing in the middle of the felt, in either language', () =>
    {
        for (const language of ['fa', 'en'] as const)
        {
            useLocale().setLocale(language);

            const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: match({}) }) as Rendered);

            expect(container.querySelector('.hokm-centre'), language).toBeNull();
            expect(written(container), `${ language }: these words are drawn on the felt`).toEqual([]);
            unmount();
        }
    });

    it('lets a sentence with a name in it follow the page, and only a bare name follow its own script', () =>
    {
        const { container } = renderTest(() => HokmBoard({
            events: NO_EVENTS,
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
    const five = () => [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: 5, tricks: 0, out: false }));

    const playing = (view: Partial<Hokm> = {}): MatchView => ({
        ...match({ phase: 'tricks', trump: 'spades', turn: 1, lead: 1, hand: [40, 41], plays: [], seats: five(), ...view }, 0),
        remainingMs: 20_000
    });

    const TRICK = [card(4, 1, 1), card(5, 2, 2), card(6, 3, 3), act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 })];

    const TOOK = 3 * TIMING.SEQ_GAP + TIMING.FLY + TIMING.SETTLE;

    const onTurn = (container: HTMLElement) => [...container.querySelectorAll('.hokm-clock')].map((one) => one.closest('.hokm-seat')?.getAttribute('data-seat') ?? 'nowhere');

    const taken = (container: HTMLElement, seat: number) => container.querySelector(`.hokm-seat[data-seat="${ seat }"] .table-plate-facts .tally`)?.textContent;

    it('flies a card in from the seat that played it, and shows the real card only once it lands', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(playing());

        send([card(4, 1, 12)]);
        await flush();

        const real = container.querySelector('.hokm-trick[data-card="12"]');

        expect(real?.getAttribute('data-landing')).toBe('true');
        expect(animate).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(animate.mock.calls[0][0])).toContain('translate');
        expect(container.querySelector('.board-flight > .flight .card-face'), 'no card was in the air').not.toBeNull();

        await elapse(TIMING.FLY_THEIRS - 1);

        expect(real?.getAttribute('data-landing'), 'the card was shown before its flight was over').toBe('true');

        await elapse(1);

        expect(container.querySelector('.hokm-trick[data-card="12"]'), 'the card that landed is not the node that was waiting for it').toBe(real);
        expect(real?.hasAttribute('data-landing')).toBe(false);
        expect(container.querySelector('.board-flight > .flight'), 'the copy that flew was left on the table').toBeNull();
    });

    it('only fades a card in at its place under reduced motion', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');

        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { send } = await mounted(playing());

        send([card(4, 1, 12)]);
        await flush();

        const frames = JSON.stringify(animate.mock.calls[0][0]);

        expect(frames).toContain('opacity');
        expect(frames).not.toContain('translate');
    });

    it('shows a card at its place after only the fade under reduced motion', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { container, send } = await mounted(playing());

        send([card(4, 1, 12)]);
        await elapse(TIMING.FADE);

        expect(container.querySelector('.hokm-trick[data-card="12"]')?.hasAttribute('data-landing')).toBe(false);
    });

    it('takes a back off the pile of whoever played when the card leaves, and the turn on round the table only as each card lands', async () =>
    {
        const backs = (container: HTMLElement, seat: number) => container.querySelectorAll(`.hokm-seat[data-seat="${ seat }"] .hokm-pile .card-back`).length;
        const { container, send } = await mounted(playing());

        expect(onTurn(container)).toEqual(['1']);
        expect(backs(container, 1)).toBe(5);

        send([card(4, 1, 1), card(5, 2, 2)]);
        await flush();

        expect(backs(container, 1), 'the card in the air is still counted in the hand it left').toBe(4);
        expect(onTurn(container), 'the turn left a seat whose card is still in the air').toEqual(['1']);

        await elapse(TIMING.FLY_THEIRS);

        expect(backs(container, 2)).toBe(4);
        expect(onTurn(container), 'the turn ran ahead of the second card').toEqual(['2']);

        await elapse(TIMING.SEQ_GAP);

        expect(onTurn(container)).toEqual(['3']);
    });

    it('holds a finished trick where everybody can read it, then gathers it to the winner', async () =>
    {
        const { container, send } = await mounted(playing());

        send(TRICK);
        await elapse(TOOK - 1);

        expect(container.querySelector('.hokm-trick[data-took="true"]'), 'the trick was called before its last card had settled').toBeNull();

        await elapse(1);

        expect(container.querySelector('.hokm-trick[data-took="true"]')?.getAttribute('data-card')).toBe('2');
        expect(onTurn(container), 'the turn did not go to whoever took the trick').toEqual(['2']);

        await elapse(TIMING.HOLD - 1);

        expect(container.querySelectorAll('.hokm-trick').length).toBe(4);

        await elapse(1);

        expect(container.querySelectorAll('.hokm-trick').length).toBe(0);
        expect(container.querySelectorAll('.board-flight > .flight').length, 'the four cards did not leave for the winner').toBe(4);
    });

    it('counts a trick on the plate of whoever took it when the cards get there, and floats the one it added over that plate', async () =>
    {
        const { container, send } = await mounted(playing());

        send(TRICK);
        await elapse(TOOK + TIMING.HOLD + gatherLength(4) - 1);

        expect(taken(container, 2), 'the trick was counted before its cards arrived').toBe('0');
        expect(container.querySelector('.hokm-last-tile'), 'the trick was filed before its cards arrived').toBeNull();
        expect(container.querySelector('.hokm-plus')).toBeNull();

        await elapse(1);

        expect(taken(container, 2)).toBe('1');
        expect(container.querySelectorAll('.hokm-last li').length).toBe(4);
        expect(container.querySelector('.board-flight > .hokm-plus')?.textContent).toBe('+1');
        expect(container.querySelector('.board-flight')?.getAttribute('aria-hidden')).toBe('true');

        await elapse(PLUS);

        expect(container.querySelector('.hokm-plus'), 'the plus one was left on the table').toBeNull();
        expect(container.querySelector('.hokm-stage')?.hasAttribute('data-presenting')).toBe(false);
    });

    it('floats the one a trick added off the seat towards the middle of the felt, clear of its plate and the pile under it', async () =>
    {
        const at = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;
        const animate = vi.spyOn(Element.prototype, 'animate');

        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
        {
            if (this.classList.contains('hokm-table'))
            {
                return at(0, 0, 400, 600);
            }

            if (this.classList.contains('hokm-seat'))
            {
                return this.getAttribute('data-seat') === '2' ? at(150, 10, 100, 40) : at(150, 550, 100, 40);
            }

            if (this.classList.contains('table-plate'))
            {
                return at(150, 10, 100, 12);
            }

            return at(0, 0, 0, 0);
        });

        const drift = (plus: HTMLElement | null) => (animate.mock.calls[animate.mock.contexts.findIndex((one) => one === plus)]?.[0] as Keyframe[] | undefined)?.at(-1)?.translate;
        const across = await mounted(playing());

        across.send(TRICK);
        await elapse(TOOK + TIMING.HOLD + gatherLength(4));

        const below = across.container.querySelector<HTMLElement>('.hokm-plus');

        expect([below?.style.left, below?.style.top], 'the seat across was not given its one under its plate').toEqual(['200px', '64px']);
        expect(drift(below)).toBe('calc(-50% + 0px) calc(-50% + 22px)');

        cleanup();

        const mine = await mounted(playing());

        mine.send([...TRICK.slice(0, 3), act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 0 })]);
        await elapse(TOOK + TIMING.HOLD + gatherLength(4));

        const above = mine.container.querySelector<HTMLElement>('.hokm-plus');

        expect([above?.style.left, above?.style.top], 'the reader was not given their one over their plate').toEqual(['200px', '536px']);
        expect(drift(above)).toBe('calc(-50% + 0px) calc(-50% + -22px)');
    });

    it('writes the one a trick added in the reader\'s own digits, and floats nothing for somebody who asked for less motion', async () =>
    {
        useLocale().setLocale('fa');

        const persian = await mounted(playing());

        persian.send(TRICK);
        await elapse(TOOK + TIMING.HOLD + gatherLength(4));

        expect(persian.container.querySelector('.hokm-plus')?.textContent).toBe('+۱');
        expect(persian.container.querySelector<HTMLElement>('.hokm-plus')?.dir).toBe('ltr');

        cleanup();
        useLocale().setLocale('en');
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const still = await mounted(playing());
        let most = 0;
        let floated = false;

        still.send(TRICK);

        for (let passed = 0; passed < 4000; passed += 20)
        {
            await elapse(20, 5);
            most = Math.max(most, still.container.querySelectorAll('.board-flight > .flight').length);
            floated = floated || still.container.querySelector('.hokm-plus') !== null;
        }

        expect(taken(still.container, 2)).toBe('1');
        expect(most, 'a trick was flown to its winner for a reader who asked for less motion').toBeLessThanOrEqual(1);
        expect(floated, 'the one a trick added was floated for a reader who asked for less motion').toBe(false);
        expect(still.container.querySelector('.board-flight')?.children.length).toBe(0);
    });

    it('gathers a held trick after the short hold when the next lead arrives in a later batch', async () =>
    {
        const { container, send } = await mounted(playing());

        send(TRICK);
        await elapse(TOOK);
        send([card(8, 2, 30)]);
        await elapse(TIMING.HOLD_MIN - 1);

        expect(container.querySelectorAll('.hokm-trick').length, 'the trick was swept away before anybody could read it').toBe(4);

        await elapse(1);

        expect(container.querySelectorAll('.hokm-trick:not([data-card="30"])').length).toBe(0);

        await elapse(gatherLength(4));

        expect(container.querySelector('.hokm-trick[data-card="30"]')?.getAttribute('data-landing'), 'the next lead did not wait for the felt to be cleared').toBe('true');
    });

    it('holds a trick only briefly when the next lead is already known', async () =>
    {
        const { container, send } = await mounted(playing());

        send([...TRICK, card(8, 2, 30)]);
        await elapse(TOOK + TIMING.HOLD_MIN - 1);

        expect(container.querySelectorAll('.hokm-trick').length).toBe(4);

        await elapse(1);

        expect(container.querySelectorAll('.hokm-trick').length).toBe(0);

        await elapse(gatherLength(4));

        expect([...container.querySelectorAll<HTMLElement>('.hokm-trick')].map((one) => one.dataset.card), 'the gathered trick came back onto the felt under the next lead').toEqual(['30']);
        expect(taken(container, 2), 'the trick was not counted before the next lead was played').toBe('1');
        expect(onTurn(container), 'the turn left whoever led while their card was in the air').toEqual(['2']);
    });

    it('lets the trick that ends a hand be read for the whole hold, then says what the hand paid when it has been gathered', async () =>
    {
        const { container, send } = await mounted(playing());

        send([...TRICK.slice(0, 3), act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }, { e: 'hand', side: 0, points: 1, kot: false }, { e: 'deal', hakem: 0 })]);
        await elapse(TOOK + TIMING.HOLD - 1);

        expect(container.querySelectorAll('.hokm-trick').length).toBe(4);
        expect(container.querySelector('.hokm-banner')).toBeNull();

        await elapse(1 + gatherLength(4) - 1);

        expect(container.querySelector('.hokm-banner'), 'the hand was called while its last trick was still on its way').toBeNull();
        expect(container.querySelector('.hokm-bar-score .tally')?.textContent, 'the score moved before the hand was called').toBe('0');

        await elapse(1);

        expect(container.querySelector('.hokm-banner')?.textContent).toContain('+1');
        expect(container.querySelector('.hokm-bar-score .tally')?.textContent).toBe('1');

        await elapse(TIMING.BANNER);

        expect(container.querySelector('.hokm-banner')).toBeNull();
    });

    it('keeps the result, who won and the row under the table back until the last trick has been played out', async () =>
    {
        const { container, send } = await mounted(playing());
        const ended: Partial<MatchView> = {
            finishedAt: new Date(900_000).toISOString(),
            outcome: 'won',
            winner: 0,
            players: [0, 1, 2, 3].map((seat) => ({ seat, who: `سارا${ seat }`, timeouts: 0, result: seat % 2 === 0 ? 'won' : 'lost' })) as MatchView['players']
        };

        send([...TRICK.slice(0, 3), act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }, { e: 'hand', side: 0, points: 1, kot: false }, { e: 'finish', side: 0 })], { plays: [40, 41] }, ended);
        await elapse(TOOK);

        expect(container.querySelector('.table-result'), 'the result covered a trick that had not been played out').toBeNull();
        expect(container.querySelector('.hokm-foot'), 'the table changed size under the cards in the air').not.toBeNull();
        expect([...container.querySelectorAll<HTMLButtonElement>('.card-hold')].map((one) => one.getAttribute('aria-disabled')), 'the cards left over went, or could still be played, while the last trick was on the table').toEqual(['true', 'true']);
        expect(container.querySelector('.table-plate-tag'), 'a plate said who had won before the last trick was played out').toBeNull();
        expect(onTurn(container), 'the turn was taken off the table before the game was over on it').toEqual(['2']);
        expect(container.querySelector('.hokm-stage')?.getAttribute('data-presenting')).toBe('true');

        await elapse(LONG, 5);

        expect(container.querySelector('.table-result')).not.toBeNull();
        expect(container.querySelector('.hokm-foot')).toBeNull();
        expect(container.querySelector('.card-hold')).toBeNull();
        expect(container.querySelectorAll('.table-plate-tag').length).toBe(4);
        expect(onTurn(container)).toEqual([]);
        expect(container.querySelector('.hokm-stage')?.hasAttribute('data-presenting')).toBe(false);
    });

    it('shows the result at once when the board has to jump to the end of the game', async () =>
    {
        const { container, send } = await mounted(playing());

        send([act(9, 1, { e: 'forfeit', seat: 1 }, { e: 'finish', side: 0 })], {}, { finishedAt: new Date(900_000).toISOString(), outcome: 'won', winner: 0 });
        await flush();

        expect(container.querySelector('.table-result')).not.toBeNull();
        expect(container.querySelector('.hokm-foot')).toBeNull();
    });

    it('tells whoever seated the board while it is still showing what happened, and when it has caught up', async () =>
    {
        const told: boolean[] = [];
        const { container, send } = await mounted(playing(), NO_EVENTS, (busy) => told.push(busy));

        expect(told, 'a board with nothing to show said it was busy').toEqual([]);
        expect(container.querySelector('.hokm-stage')?.hasAttribute('data-presenting')).toBe(false);

        send([card(4, 1, 12)]);
        await flush();

        expect(told).toEqual([true]);
        expect(container.querySelector('.hokm-stage')?.getAttribute('data-presenting')).toBe('true');

        await elapse(TIMING.FLY_THEIRS);

        expect(told).toEqual([true, false]);
        expect(container.querySelector('.hokm-stage')?.hasAttribute('data-presenting')).toBe(false);
    });

    it('animates a rematch at the same table from its first card', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, read, send } = await mounted(playing());

        read({ ...playing(), id: 'match-2', rev: 0 });
        send([card(1, 1, 12)]);
        await flush();

        expect(animate).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.hokm-trick[data-card="12"]')).not.toBeNull();
    });

    it('never replays the batch that was already there when the board mounted', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(playing(), { ...NO_EVENTS, seq: 7, id: 'match-1', events: [card(3, 1, 12)] });

        await elapse(2000, 5);

        expect(animate).not.toHaveBeenCalled();
        expect(container.querySelector('.hokm-trick')).toBeNull();
    });

    it('jumps straight to the board when the log has a gap in it', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(playing());

        send([card(9, 1, 12)]);
        await elapse(2000, 5);

        const down = container.querySelector('.hokm-trick[data-card="12"]');

        expect(animate).not.toHaveBeenCalled();
        expect(down, 'the board did not jump to where the game is').not.toBeNull();
        expect(down?.hasAttribute('data-landing')).toBe(false);
    });

    it('follows a board that moved with nothing said about how, quietly', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, read } = await mounted(playing());

        read({ ...playing({ turn: 2, trick: [12] }), rev: 4 });
        await flush();

        expect(animate).not.toHaveBeenCalled();
        expect(container.querySelector('.hokm-trick[data-card="12"]')?.hasAttribute('data-landing')).toBe(false);
        expect(onTurn(container)).toEqual(['2']);
    });

    it('follows a board that was read again and found different, though its revision had not moved', async () =>
    {
        const { container, read } = await mounted(playing());

        read(playing({ turn: 2, trick: [12] }));
        await flush();

        expect(container.querySelector('.hokm-trick[data-card="12"]')).not.toBeNull();
        expect(onTurn(container)).toEqual(['2']);
    });

    it('leaves nothing waiting on the clock when it is taken away with cards in the air', async () =>
    {
        const clock = runtime().clock as ManualClock;
        const idle = clock.pending();
        const { send } = await mounted(playing());

        send(TRICK);
        await elapse(TIMING.SEQ_GAP);

        expect(clock.pending()).toBeGreaterThan(idle);

        cleanup();

        expect(clock.pending(), 'a table that is gone is still waiting to move its cards').toBe(idle);
    });

    it('takes what was in the air off the table when the page is left for another tab', async () =>
    {
        const { container, send } = await mounted(playing());

        send([card(4, 1, 12)]);
        await flush();

        expect(container.querySelectorAll('.board-flight > .flight').length).toBe(1);

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();

        expect(container.querySelector('.board-flight')?.children.length).toBe(0);
        expect(container.querySelector('.hokm-trick[data-card="12"]')?.hasAttribute('data-landing'), 'a card was left waiting for a flight that was called off').toBe(false);
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);

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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);

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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);

        fire(cardButton(container, 0), 'click');

        expect(play).toHaveBeenCalledWith({ kind: 'hokm', verb: 'card', card: 0 });
    });
});

describe('playing ahead of the server', () =>
{
    const five = () => [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: 5, tricks: 0, out: false }));

    const turn = (view: Partial<Hokm> = {}): MatchView => ({
        ...match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14], seats: five(), ...view }, 0),
        remainingMs: 20_000
    });

    const press = (container: HTMLElement, card: number) =>
        fire(container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!, 'click');

    const unanswered = () => vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

    beforeEach(() =>
    {
        useDevice().overrideCoarse(false);
    });

    it('takes the card out of the hand and flies it to the felt at the press, before the server has answered', async () =>
    {
        unanswered();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(turn());

        press(container, 14);

        expect(container.querySelector('.card-hold[data-card="14"]')).toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')?.getAttribute('data-landing')).toBe('true');
        expect(animate).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.hokm-stage')?.getAttribute('data-presenting')).toBe('true');
    });

    it('leaves the card where it landed while the server has still not answered', async () =>
    {
        unanswered();

        const { container } = await mounted(turn());

        press(container, 14);
        await elapse(TIMING.FLY + 2000, 5);

        expect(container.querySelector('.hokm-trick[data-card="14"]')?.hasAttribute('data-landing')).toBe(false);
        expect(container.querySelector('.card-hold[data-card="14"]'), 'the card went back to the hand with nobody having refused it').toBeNull();
        expect(container.querySelector('.hokm-seat[data-seat="1"] > .hokm-clock'), 'the turn did not pass with the card').not.toBeNull();
    });

    it('does not fly the card a second time when the server says it was played', async () =>
    {
        unanswered();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(turn());

        press(container, 14);
        send([card(4, 0, 14)]);
        await elapse(TIMING.FLY + 100);

        expect(animate).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll('.hokm-trick[data-card="14"]').length).toBe(1);
        expect(container.querySelector('.hokm-trick[data-card="14"]')?.hasAttribute('data-landing')).toBe(false);
    });

    it('plays what the server adds to the reader\'s card, and not the card again', async () =>
    {
        unanswered();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(turn({ lead: 1, trick: [1, 2, 3] }));

        press(container, 14);
        send([act(4, 0, { e: 'card', seat: 0, card: 14 }, { e: 'trick', seat: 2 })]);
        await elapse(TIMING.FLY + TIMING.SETTLE);

        expect(animate).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.hokm-trick[data-took="true"]')?.getAttribute('data-card')).toBe('2');
        expect(container.querySelectorAll('.hokm-trick').length).toBe(4);
    });

    it('answers a press on a felt that is still showing the card before it, by hurrying that card down and lifting the reader\'s own until it is', async () =>
    {
        unanswered();

        const { container, send } = await mounted(turn({ turn: 3, lead: 1, trick: [1, 2], plays: [] }));

        send([card(4, 3, 3)], { plays: [0, 14] });
        await flush();
        press(container, 14);

        const lifted = container.querySelector('.card-hold[data-card="14"]');

        expect(lifted?.getAttribute('data-picked'), 'the card the reader pressed was left lying in the hand').toBe('true');
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="3"]')?.getAttribute('data-landing')).toBe('true');

        await elapse(Math.ceil(TIMING.FLY_THEIRS / HASTE) - 1);

        expect(container.querySelector('.hokm-trick[data-card="3"]')?.getAttribute('data-landing'), 'the card in front was dropped where it was, not hurried down').toBe('true');

        await elapse(1);

        expect(container.querySelector('.hokm-trick[data-card="3"]')?.hasAttribute('data-landing')).toBe(false);
        expect(container.querySelector('.card-hold[data-card="14"]')).toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')?.getAttribute('data-landing')).toBe('true');

        await elapse(TIMING.FLY - 1);

        expect(container.querySelector('.hokm-trick[data-card="14"]')?.getAttribute('data-landing'), 'the reader\'s own card was hurried with what it had hurried').toBe('true');

        await elapse(1);

        expect(container.querySelector('.hokm-trick[data-card="14"]')?.hasAttribute('data-landing')).toBe(false);
    });

    it('puts a refused card back in the hand, and takes it off the felt', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('stale');

        const { container } = await mounted(turn());

        press(container, 14);
        await elapse(TIMING.FLY);

        expect(container.querySelector('.card-hold[data-card="14"]')).not.toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
        expect(container.querySelector('.board-flight')?.children.length).toBe(0);
        expect(container.querySelector('.hokm-seat[data-seat="0"] > .hokm-clock'), 'the turn was not given back with the card').not.toBeNull();
    });

    it('puts back a card the server could not be asked about', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('failed');

        const { container } = await mounted(turn());

        press(container, 14);
        await elapse(TIMING.FLY);

        expect(container.querySelector('.card-hold[data-card="14"]')).not.toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
    });

    it('takes a refused card off the felt before what happened instead is played over it', async () =>
    {
        let answer: (outcome: 'stale') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const { container, send } = await mounted(turn());
        const laid = () => [...container.querySelectorAll<HTMLElement>('.hokm-trick')].map((one) => one.dataset.card);

        press(container, 14);
        await elapse(10);
        answer('stale');
        await flush();
        send([card(4, 0, 0)]);
        await flush();

        expect(laid(), 'the refused card was dropped where it was instead of being hurried down').toEqual(['14']);

        await elapse(Math.ceil((TIMING.FLY - 10) / HASTE) + 1);

        expect(laid(), 'the card that was played instead was laid beside the one that was refused, or twice').toEqual(['0']);
        expect(container.querySelector('.card-hold[data-card="14"]'), 'the refused card was not given back').not.toBeNull();

        await elapse(LONG, 5);

        expect(laid()).toEqual(['0']);
        expect(container.querySelector('.hokm-trick[data-card="0"]')?.hasAttribute('data-landing')).toBe(false);
    });

    it('lets a card that was refused before it had left lie back in the hand, and does not play it', async () =>
    {
        let answer: (outcome: 'stale') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(turn({ turn: 3, lead: 1, trick: [1, 2], plays: [] }));

        send([card(4, 3, 3)], { plays: [0, 14] });
        await flush();
        press(container, 14);

        expect(container.querySelector('.card-hold[data-card="14"]')?.getAttribute('data-picked')).toBe('true');

        answer('stale');
        await flush();

        expect(container.querySelector('.card-hold[data-card="14"]')?.hasAttribute('data-picked'), 'a refused card was left lifted').toBe(false);

        await elapse(LONG, 5);

        expect(animate, 'a refused card was played all the same').toHaveBeenCalledTimes(1);
        expect(container.querySelector('.card-hold[data-card="14"]')).not.toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
    });

    it('takes the card back when something else happened at the table first', async () =>
    {
        unanswered();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(turn());

        press(container, 14);
        send([act(4, 2, { e: 'forfeit', seat: 2 })], { plays: [0, 14] });
        await flush();

        expect(container.querySelector('.card-hold[data-card="14"]'), 'the card was not given back').not.toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
        expect(container.querySelector('.hokm-seat[data-seat="2"] .table-plate')?.getAttribute('data-dim')).toBe('true');
        expect(animate).toHaveBeenCalledTimes(1);

        await elapse(TIMING.FLY + 100, 5);

        expect(container.querySelector('.hokm-trick[data-card="14"]'), 'the card that was taken back landed all the same').toBeNull();
    });

    it('plays a card the server took after all, when the answer to the press was lost', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('failed');

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(turn());

        press(container, 14);
        await elapse(TIMING.FLY);

        expect(container.querySelector('.card-hold[data-card="14"]')).not.toBeNull();

        send([card(4, 0, 14)]);
        await flush();

        expect(animate, 'the card the server took was not played on the felt').toHaveBeenCalledTimes(2);
        expect(container.querySelector('.hokm-trick[data-card="14"]')?.getAttribute('data-landing')).toBe('true');

        await elapse(TIMING.FLY);

        expect(container.querySelector('.hokm-trick[data-card="14"]')?.hasAttribute('data-landing')).toBe(false);
        expect(container.querySelector('.card-hold[data-card="14"]')).toBeNull();
    });

    it('plays the reader\'s card once, from what the server says, when the answer comes before the felt has got to it', async () =>
    {
        unanswered();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(turn({ turn: 3, lead: 1, trick: [1, 2], plays: [] }));

        const held = () => [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card);

        send([card(4, 3, 3)], { plays: [0, 14] });
        await flush();
        press(container, 14);
        send([card(5, 0, 14)]);
        await flush();

        expect(held(), 'the card left the hand when the server answered, with nothing yet flown from it').toEqual(['0', '14', '30']);
        expect(container.querySelector('.card-hold[data-card="14"]')?.getAttribute('data-picked')).toBe('true');
        expect(container.querySelector('.card-hold[data-card="14"]')?.getAttribute('aria-disabled'), 'a card on its way could be pressed again').toBe('true');
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();

        await elapse(LONG, 5);

        expect(animate, 'the card was flown twice, or never').toHaveBeenCalledTimes(2);
        expect(container.querySelectorAll('.hokm-trick[data-card="14"]').length).toBe(1);
        expect(held()).toEqual(['0', '30']);
        expect(container.querySelectorAll('.hokm-trick').length).toBe(4);
    });

    it('lets a card that was waiting lie back in the hand when something else happened at the table first', async () =>
    {
        unanswered();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, send } = await mounted(turn({ turn: 3, lead: 1, trick: [1, 2], plays: [] }));

        send([card(4, 3, 3)], { plays: [0, 14] });
        await flush();
        press(container, 14);

        expect(container.querySelector('.card-hold[data-card="14"]')?.getAttribute('data-picked')).toBe('true');

        send([act(5, 2, { e: 'forfeit', seat: 2 })], { plays: [0, 14] });
        await flush();

        expect(container.querySelector('.card-hold[data-card="14"]')?.hasAttribute('data-picked'), 'a card nobody is waiting for was left lifted').toBe(false);

        await elapse(LONG, 5);

        expect(animate, 'a card that was taken back was played all the same').toHaveBeenCalledTimes(1);
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
    });

    it('keeps a card that has left the hand on the felt when the page is left for another tab before the server answers', async () =>
    {
        unanswered();

        const { container } = await mounted(turn());

        press(container, 14);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();

        expect(container.querySelector('.board-flight')?.children.length).toBe(0);
        expect(container.querySelector('.card-hold[data-card="14"]')).toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="14"]')?.hasAttribute('data-landing'), 'the card is neither in the hand nor on the felt').toBe(false);
    });

    it('leaves a card that had not left the hand yet in it when the page is left for another tab', async () =>
    {
        unanswered();

        const { container, send } = await mounted(turn({ turn: 3, lead: 1, trick: [1, 2], plays: [] }));

        send([card(4, 3, 3)], { plays: [0, 14] });
        await flush();
        press(container, 14);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();

        expect(container.querySelector('.card-hold[data-card="14"]'), 'a card that never left the hand is not in it').not.toBeNull();
        expect(container.querySelector('.card-hold[data-card="14"]')?.hasAttribute('data-picked')).toBe(false);
        expect(container.querySelector('.hokm-trick[data-card="14"]')).toBeNull();
        expect(container.querySelector('.hokm-trick[data-card="3"]')?.hasAttribute('data-landing')).toBe(false);
    });

    it('forgets a card it sent in one match when the next match comes to the same point', async () =>
    {
        unanswered();

        const { container, read, send } = await mounted(turn());

        press(container, 14);
        send([card(4, 0, 14)]);
        await elapse(TIMING.FLY + 100);
        read({ ...turn(), id: 'match-2' });
        await flush();

        expect(container.querySelector('.card-hold[data-card="14"]'), 'a card played in the last match is missing from the hand in this one').not.toBeNull();
        expect(container.querySelector('.hokm-trick')).toBeNull();
    });

    it('flies the reader\'s card from where it lay in the hand', async () =>
    {
        unanswered();

        const at = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;

        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
        {
            if (this.classList.contains('card-face') && this.closest('.card-hold[data-card="14"]') !== null)
            {
                return at(300, 500, 40, 56);
            }

            if (this.classList.contains('hokm-trick'))
            {
                return at(200, 200, 40, 56);
            }

            return at(0, 0, 0, 0);
        });

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(turn());

        press(container, 14);

        const [first, last] = animate.mock.calls[0][0] as Keyframe[];

        expect(first.translate).toBe('100px 300px');
        expect(first.opacity, 'the reader\'s own card faded in as if it had come from nowhere').toBe(1);
        expect(last.rotate, 'the copy did not land at the tilt its card lies at').toBe(container.querySelector<HTMLElement>('.hokm-trick[data-card="14"]')?.style.getPropertyValue('--tilt'));
        expect(last.rotate, 'a card that lies askew was flown in straight').not.toBe('0deg');
        expect(container.querySelector('.board-flight > .flight .card-face')).not.toBeNull();
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: following() }) as Rendered);

        expect(cardButton(container, 38).dataset.legal).toBe('true');
        expect(cardButton(container, 0).dataset.legal).toBe('false');

        useSettings().update({ hintMoves: false });

        expect([38, 0, 40].map((card) => cardButton(container, card).dataset.legal)).toEqual(['hidden', 'hidden', 'hidden']);
        expect(cardButton(container, 0).getAttribute('aria-disabled')).toBe('true');

        fire(cardButton(container, 0), 'click');

        expect(play).not.toHaveBeenCalled();
    });

    it('says in the card\'s own name whether it would take the trick, draws no sentence about it, and stops when the helper is off', () =>
    {
        useDevice().overrideCoarse(false);
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: following() }) as Rendered);

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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: following() }) as Rendered);

        fire(cardButton(container, 38), 'click');

        expect(cardButton(container, 38).dataset.go).toBe('true');
        expect(cardButton(container, 38).getAttribute('aria-label')).toBe('Play the A of Hearts. Takes the trick so far.');
        expect([...container.querySelectorAll('button')].some((one) => one.textContent?.trim().startsWith('Play the'))).toBe(false);
    });

    it('coaches the rule that binds this play from a lamp, and with the coach off keeps the rule for a screen reader alone', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: following() }) as Rendered);
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: match({ hand: [38, 37, 30, 0, 14] }, 0) }) as Rendered);

        expect(container.querySelector('[role="note"]')?.textContent).toContain('You hold more hearts than any other suit.');
    });

    it('gives somebody watching neither tips nor outcomes', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: watching() }) as Rendered);

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
        const drawer = renderTest(() => HokmBoard({ events: NO_EVENTS, match: drawing(0) }) as Rendered);

        expect(offer(drawer.container)?.querySelector('.card-face')).not.toBeNull();
        expect(offer(drawer.container)?.getAttribute('aria-label')).toBe('Keep the A of Clubs');
        expect(stock(drawer.container)?.getAttribute('aria-label')).toBe('Take the next card');
        expect(drawer.container.querySelector('.hokm-stock')?.getAttribute('data-live')).toBe('true');
        expect(beside(drawer.container)).toEqual(['Take the next card', 'Keep the A of Clubs', 'Sort']);
        expect(drawer.container.querySelector('.hokm-choose')).toBeNull();
        drawer.unmount();

        for (const other of [drawing(1), watching()])
        {
            const seen = renderTest(() => HokmBoard({ events: NO_EVENTS, match: other }) as Rendered);

            expect(offer(seen.container), `reader ${ other.mine }`).toBeNull();
            expect(stock(seen.container), `reader ${ other.mine }`).toBeNull();
            expect(seen.container.querySelector('.hokm-stock')?.getAttribute('data-live'), `reader ${ other.mine }`).toBeNull();
            seen.unmount();
        }
    });

    it('keeps the drawn card when it is pressed, and passes it when the stock is', () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: drawing(0) }) as Rendered);

        fire(offer(container)!, 'click');
        fire(stock(container)!, 'click');

        expect(play.mock.calls.map(([body]) => body)).toEqual([
            { kind: 'hokm', verb: 'keep' },
            { kind: 'hokm', verb: 'reject' }
        ]);
    });

    it('shows the stock as a count to everybody, counts a hand being filled on its plate and nowhere else, and gives a watcher nothing to press', () =>
    {
        const drawer = renderTest(() => HokmBoard({ events: NO_EVENTS, match: drawing(0) }) as Rendered);

        expect(drawer.container.querySelector('.hokm-stock')?.textContent).toContain('39');
        expect(drawer.container.querySelector('.hokm-filled')).toBeNull();
        expect(drawer.container.textContent).not.toContain('7/13');
        expect(drawer.container.querySelector('.hokm-seat[data-seat="0"]')?.textContent).toContain('5 cards');
        drawer.unmount();

        const watcher = renderTest(() => HokmBoard({ events: NO_EVENTS, match: watching() }) as Rendered);

        expect(watcher.container.querySelector('.hokm-stock')?.textContent).toContain('39');
        expect(beside(watcher.container)).toEqual([]);
    });

    it('lets the seat putting cards down lift them, and takes them at the stock only at the exact count', () =>
    {
        useDevice().overrideCoarse(false);
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: two({ phase: 'discard', turn: 0, discard: 3, stock: 42, hand: [3, 14, 27, 40, 51] }, 0) }) as Rendered);
        const hold = (card: number) => container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!;
        const due = () => container.querySelector('.hokm-stock-due');

        expect(hold(3).getAttribute('aria-disabled')).toBeNull();
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: two({ phase: 'discard', turn: 0, stock: 42, hand: [3, 14, 27, 40, 51] }, 1) }) as Rendered);

        expect([...container.querySelectorAll('.card-hold')].every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true);
        expect(stock(container)).toBeNull();
        expect(container.querySelector('.hokm-stock-due')).toBeNull();
        expect(beside(container)).toEqual(['Sort']);
    });

    it('shows the drawer the card their keep put face down, beside the stock and in words for a screen reader, and draws nothing else about the cards put down', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: two({ phase: 'draw', turn: 1, stock: 37, glimpse: 9, hand: [1, 15, 27, 40, 41, 50] }, 0) }) as Rendered);

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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn({ remainingMs: 20_000 }) }) as Rendered);
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);
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

        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);
        const lamp = container.querySelector('.hokm-rail-end:last-of-type [role="note"]')!;

        expect(lamp.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
        expect(lamp.closest('[dir]')?.classList.contains('contents'), 'the wrapper that carries the direction takes a place of its own in the row').toBe(true);
        expect(container.querySelector('.hokm-rail-end:first-of-type .hokm-sort')).not.toBeNull();
    });

    it('keeps room for the two whether or not there is a tip, so the table does not change size with the turn', () =>
    {
        const [current, setCurrent] = createSignal(turn());
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, get match()
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, get match()
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn({}, { seats: [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: 13 - seat, tricks: seat, out: seat === 3 })) }) }) as Rendered);
        const plate = (seat: number) => container.querySelector(`.hokm-seat[data-seat="${ seat }"] .table-plate`)!;

        expect([0, 1, 2, 3].map((seat) => [...plate(seat).querySelectorAll('.table-plate-facts .tally')].map((one) => one.textContent))).toEqual([['0', '13'], ['1', '12'], ['2', '11'], ['3', '10']]);
        expect([0, 1, 2, 3].map((seat) => plate(seat).querySelector('.table-plate-facts svg')?.getAttribute('class'))).toEqual(['text-accent', 'text-gold', 'text-accent', 'text-gold']);
        expect([0, 1, 2, 3].map((seat) => plate(seat).getAttribute('data-dim'))).toEqual([null, null, null, 'true']);
        expect(plate(2).querySelector('.table-plate-facts .sr-only')?.textContent).toContain('2 tricks');
    });

    it('puts it on the Hâkem while trump is being named', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn({ remainingMs: 20_000 }, { phase: 'trump', trump: undefined, hakem: 2, turn: 2, lead: 2, hand: [], plays: [] }) }) as Rendered);

        expect(clocks(container)).toEqual(['2']);
    });

    it('speaks the turn to a screen reader alone, and prints it nowhere', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);
        const live = container.querySelector('[aria-live="polite"]')!;

        expect(live.textContent).toBe('Your turn.');
        expect(live.classList.contains('sr-only')).toBe(true);
        expect(live.closest('.hokm-rail')).not.toBeNull();
        expect(written(container)).toEqual([]);
    });

    it('sorts the hand when Sort is pressed, trump first, and says so on the button', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn() }) as Rendered);
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
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: { ...seen, mine: undefined, remainingMs: undefined } }) as Rendered);

        expect(container.querySelector('.table-grid > .hokm-foot > .hokm-rail')).not.toBeNull();
        expect(container.querySelector('.hokm-foot')!.hasAttribute('data-tools')).toBe(false);
        expect(container.querySelectorAll('button').length).toBe(0);
        expect(container.querySelector('[role="note"]')).toBeNull();
        expect(container.querySelector('.hokm-clock')).toBeNull();
    });

    it('keeps the row, and what a screen reader is told, for a reader who holds nothing yet', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn({}, { phase: 'trump', trump: undefined, hakem: 2, turn: 2, lead: 2, hand: [], plays: [] }) }) as Rendered);

        expect(container.querySelector('.hokm-hands')).toBeNull();
        expect(container.querySelector('.hokm-foot > .hokm-rail [aria-live="polite"]')?.textContent).toContain('is choosing trump');
        expect(container.querySelector('.hokm-foot')!.getAttribute('data-tools')).toBe('true');
    });

    it('takes the row away with the game', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: turn({ remainingMs: 20_000, finishedAt: new Date(900_000).toISOString(), outcome: 'won', winner: 0 }) }) as Rendered);

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
                const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(seats, { hakem, dealer }, 0) }) as Rendered);

                expect(marks(container), `${ seats } players, Hâkem ${ hakem }`).toEqual(marked(seats, hakem, dealer));
                unmount();
            }
        }
    });

    it('reads the dealer off the board it was sent, and never draws both marks on one plate', () =>
    {
        const moved = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(4, { hakem: 0, dealer: 2 }, 0) }) as Rendered);

        expect(marks(moved.container)).toEqual(marked(4, 0, 2));
        moved.unmount();

        const same = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(4, { hakem: 1, dealer: 1 }, 0) }) as Rendered);

        expect(marks(same.container)).toEqual(marked(4, 1, 1));
        expect(same.container.querySelectorAll('.hokm-dealer').length).toBe(0);
    });

    it('moves both marks when the next hand has another Hâkem', () =>
    {
        const [current, setCurrent] = createSignal(seated(4, { hakem: 0, dealer: 3 }, 0));
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, get match()
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
            const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: board }) as Rendered);

            expect(marks(container), phase).toEqual(marked(2, 1, 0));
            unmount();
        }
    });

    it('names the dealer mark for a pointer and for a screen reader, in the reader\'s language', () =>
    {
        const english = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(4, { hakem: 0, dealer: 3 }, 0) }) as Rendered);
        const facts = (container: HTMLElement, seat: number) =>
            container.querySelector(`.hokm-seat[data-seat="${ seat }"] .table-plate-facts`)?.textContent ?? '';

        expect(english.container.querySelector('.hokm-seat[data-seat="3"] .hokm-dealer')?.getAttribute('title')).toBe('Dealer');
        expect(facts(english.container, 3)).toContain('Dealer');
        expect([0, 1, 2].some((seat) => facts(english.container, seat).includes('Dealer'))).toBe(false);
        english.unmount();

        useLocale().setLocale('fa');

        const persian = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(4, { hakem: 0, dealer: 3 }, 0) }) as Rendered);

        expect(persian.container.querySelector('.hokm-seat[data-seat="3"] .hokm-dealer')?.getAttribute('title')).toBe('دیلر');
        expect(facts(persian.container, 3)).toContain('دیلر');
    });

    it('says to a screen reader that seven tricks take the hand, at two players and at four, and writes it nowhere', () =>
    {
        for (const seats of [2, 4])
        {
            const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(seats, {}, 0) }) as Rendered);
            const summary = container.querySelector('.hokm-side')!;

            expect(summary.classList.contains('sr-only'), `${ seats } players`).toBe(true);
            expect(summary.textContent, `${ seats } players`).toContain('7 tricks take the hand');
            expect(written(container), `${ seats } players`).toEqual([]);
            unmount();
        }
    });

    it('says at three players that a lead nobody can catch takes the hand, and puts no number on it', () =>
    {
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(3, {}, 0) }) as Rendered);
        const summary = container.querySelector('.hokm-side')!;

        expect(summary.textContent).toContain('A lead nobody can catch takes the hand');
        expect(summary.textContent).not.toContain('tricks take');
        expect(written(container)).toEqual([]);
    });

    it('counts the tricks in the reader\'s own digits', () =>
    {
        useLocale().setLocale('fa');

        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(4, {}, 0) }) as Rendered);
        const summary = container.querySelector('.hokm-side')!;

        expect(summary.textContent).toContain('۷');
        expect(summary.textContent).toContain('دور را');
        expect(summary.textContent).not.toContain('tricks');
    });

    it('sets the suit that is trump in a medal in the middle of the felt, red or black as the suit is', () =>
    {
        for (const [suit, ink] of [['hearts', 'text-danger-fill'], ['diamonds', 'text-danger-fill'], ['spades', 'text-bright-ink'], ['clubs', 'text-bright-ink']] as const)
        {
            const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(4, { trump: suit }, 0) }) as Rendered);
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
            const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(4, { phase: 'trump', trump: undefined, hand: mine === 0 ? [0, 14, 30, 45, 50] : [] }, mine) }) as Rendered);
            const medal = container.querySelector('.hokm-table > .hokm-medal')!;

            expect(medal.hasAttribute('data-set'), `read by ${ mine }`).toBe(false);
            expect(medal.querySelector('svg')?.getAttribute('class'), `read by ${ mine }`).toBe('text-gold');
            unmount();
        }
    });

    it('keeps the medal the node it is when trump is named and when a card is played over it', () =>
    {
        const [current, setCurrent] = createSignal(seated(4, { phase: 'trump', trump: undefined }, 1));
        const { container } = renderTest(() => HokmBoard({ events: NO_EVENTS, get match()
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
                const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(seats, {}, mine) }) as Rendered);
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
                    const { container, unmount } = renderTest(() => HokmBoard({ events: NO_EVENTS, match: seated(seats, { trick }, mine) }) as Rendered);
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

    const shown = async (first: MatchView) =>
    {
        const { container, read, send } = await mounted(first);

        return { container, read, send };
    };

    const under = (container: HTMLElement) => [...container.querySelectorAll<Element>('.hokm-stage *')];

    const gone = (nodes: readonly Element[]) => nodes
        .filter((one) => !document.contains(one))
        .map((one) => `${ one.tagName.toLowerCase() }.${ (one.getAttribute('class') ?? '').split(' ')[0] }`);

    it('draws nothing again for an answer it already had', async () =>
    {
        const { container, read } = await shown(table());
        const before = under(container);

        read(table());

        expect(before.length, 'the table was not drawn at all').toBeGreaterThan(60);
        expect(gone(before), 'these were drawn again though nothing had changed').toEqual([]);
    });

    it('draws nothing again on a felt with nothing lying on it', async () =>
    {
        const bare = () => table({ trick: [], turn: 3, lead: 3, plays: [] });
        const { container, read } = await shown(bare());
        const before = under(container);

        read(bare());

        expect(container.querySelector('.hokm-medal'), 'an empty felt has no medal').not.toBeNull();
        expect(gone(before)).toEqual([]);
    });

    it('draws nothing again at a table for two with a card drawn and waiting', async () =>
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
        const { container, read } = await shown(drawing());
        const before = under(container);

        read(drawing());

        expect(container.querySelector('.hokm-offer'), 'the drawn card is not on the felt').not.toBeNull();
        expect(container.querySelector('.hokm-stock-press')).not.toBeNull();
        expect(gone(before)).toEqual([]);
    });

    it('says which piles have nothing in them, the reader\'s own among them, and fills one a back at a time', async () =>
    {
        const empty = (container: HTMLElement) => [0, 1, 2, 3].map((seat) => container.querySelector(`.hokm-seat[data-seat="${ seat }"] .hokm-pile`)?.getAttribute('data-empty') ?? null);
        const held = (three: number) => [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: seat === 3 ? three : (seat === 1 ? 0 : 4), tricks: 0, out: false }));
        const { container, read } = await shown(table({ seats: held(0) }));
        const pile = container.querySelector('.hokm-seat[data-seat="3"] .hokm-pile')!;

        expect(empty(container)).toEqual(['true', 'true', null, 'true']);

        read(table({ seats: held(2) }, { rev: 4 }));

        expect(empty(container)).toEqual(['true', 'true', null, null]);
        expect(container.querySelector('.hokm-seat[data-seat="3"] .hokm-pile'), 'the pile was made again to take its first card').toBe(pile);
        expect(pile.querySelectorAll('.card-back').length).toBe(2);
    });

    it('keeps every card, plate and chip when somebody else plays, and takes one back off their pile', async () =>
    {
        const { container, read } = await shown(table({ turn: 3, lead: 2, plays: [] }));
        const before = under(container);

        read(table({ turn: 0, lead: 2, trick: [12, 20], seats: chairs(2) }, { rev: 4 }));

        expect(container.querySelectorAll('.hokm-trick').length).toBe(2);
        expect(container.querySelectorAll('.card-hold').length).toBe(4);
        expect(gone(before), 'a card played by one seat took more off the table than the back it left with').toEqual(['span.card-back']);
    });

    it('leaves the reader on the card they were on', async () =>
    {
        const { container, read } = await shown(table({}, { remainingMs: 20_000 }));
        const card = container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!;

        card.focus();
        expect(document.activeElement).toBe(card);

        read(table({}, { remainingMs: 20_000 }));
        expect(document.activeElement, 'a re-read took the card out from under the keyboard').toBe(card);

        read(table({}, { remainingMs: 12_000 }));
        expect(document.activeElement, 'the clock moving on took the card out from under the keyboard').toBe(card);
    });

    it('keeps the four suits under a Hâkem who is still choosing', async () =>
    {
        const choosing = () => match({ phase: 'trump', hakem: 0, turn: 0, hand: [0, 14, 30, 45, 50] }, 0);
        const { container, read } = await shown(choosing());
        const suits = [...container.querySelectorAll<HTMLButtonElement>('.hokm-choose button')];

        suits[2].focus();
        read(choosing());

        expect(suits.length).toBe(4);
        expect(gone(suits)).toEqual([]);
        expect(document.activeElement).toBe(suits[2]);
    });

    it('moves the cards when the hand is sorted, and makes none of them again', async () =>
    {
        const { container } = await shown(table({ hand: [0, 2, 14, 16, 30, 45] }));
        const hand = [...container.querySelectorAll<HTMLElement>('.card-hold')];
        const order = () => [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card);
        const dealt = order();

        fire(container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!, 'click');

        expect(order()).not.toEqual(dealt);
        expect(gone(hand)).toEqual([]);
    });

    it('takes only the card that was played out of the hand, at the press and when the server says so', async () =>
    {
        useDevice().overrideCoarse(false);
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container, read } = await shown(table());
        const hand = [...container.querySelectorAll<HTMLElement>('.card-hold')];
        const plates = [...container.querySelectorAll<HTMLElement>('.table-plate')];

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');

        expect(gone(hand)).toEqual(['button.card-hold']);

        read(table({ turn: 1, lead: 3, trick: [12, 14], hand: [0, 30, 45], plays: [] }, { rev: 4 }));

        expect(gone(hand)).toEqual(['button.card-hold']);
        expect(gone(plates)).toEqual([]);
    });

    it('keeps the crown where it is while the Hâkem is the Hâkem, and moves it without drawing the plates again', async () =>
    {
        const { container, read } = await shown(table());
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

    it('throws a card from a plate when the pile beside it is not drawn', async () =>
    {
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

        const { container, send } = await shown(table({ turn: 3, lead: 2, plays: [] }));

        measured.length = 0;
        send([card(4, 3, 20)]);
        await flush();

        expect(boxes).toHaveBeenCalled();
        expect(measured.some((one) => one.classList.contains('hokm-pile')), 'a pile with no box was asked where it is').toBe(false);
        expect(measured).toContain(container.querySelector('.hokm-seat[data-seat="3"] .table-plate'));
        expect(container.querySelector('.hokm-trick[data-card="20"]')?.getAttribute('data-landing')).toBe('true');
    });
});

const SEVENTEEN = [0, 1, 2, 3, 4, 13, 14, 15, 16, 26, 27, 28, 29, 39, 40, 41, 42];

const roomOf = (width: number, height: number) => vi.stubGlobal('ResizeObserver', class
{
    private readonly told: ResizeObserverCallback;

    constructor(told: ResizeObserverCallback)
    {
        this.told = told;
    }

    observe(target: Element)
    {
        if (target.classList.contains('hokm-stage'))
        {
            this.told([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
    }

    unobserve()
    {
        return undefined;
    }

    disconnect()
    {
        return undefined;
    }
});

describe('the fan a hand is held in', () =>
{
    const chairs = (seats: number, held: number) => Array.from({ length: seats }, (_, seat) => ({ seat, side: seats === 4 ? seat % 2 : seat, held, tricks: 0, out: false }));

    const holding = (hand: number[], seats = 4): MatchView => ({
        ...match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand, plays: hand, seats: chairs(seats, hand.length), points: seats === 4 ? [0, 0] : chairs(seats, 0).map(() => 0) }, 0),
        seats,
        players: Array.from({ length: seats }, (_, seat) => ({ seat, who: `سارا${ seat }`, timeouts: 0 })) as MatchView['players']
    });

    const rowsOf = (container: HTMLElement) => [...container.querySelectorAll('.hokm-hand')].map((row) => row.querySelectorAll('.card-hold').length);

    const lie = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
    {
        const row = this.closest('.hokm-hand');
        const across = this.tagName === 'LI' && this.parentElement !== null ? [...this.parentElement.children].indexOf(this) : 0;
        const down = row === null ? 0 : [...document.querySelectorAll('.hokm-hand')].indexOf(row);
        const left = this.tagName === 'LI' ? across * 30 : 0;
        const top = this.tagName === 'LI' ? down * 100 : 0;
        const width = this.tagName === 'LI' ? 20 : 0;
        const height = this.tagName === 'LI' ? 28 : 0;

        return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect;
    });

    const slid = (animate: ReturnType<typeof vi.spyOn>, container: HTMLElement) => new Map([...container.querySelectorAll<HTMLElement>('.hokm-hand > li')].flatMap((slot) =>
    {
        const at = animate.mock.contexts.lastIndexOf(slot);
        const frames = at === -1 ? null : animate.mock.calls[at][0] as Keyframe[];

        return frames === null ? [] : [[slot.querySelector<HTMLElement>('.card-hold')?.dataset.card ?? '', frames] as const];
    }));

    afterEach(() =>
    {
        vi.unstubAllGlobals();
    });

    it('keeps thirteen cards in one row on a phone, and breaks seventeen into two', async () =>
    {
        roomOf(358, 778);

        const thirteen = await mounted(holding([0, 1, 2, 3, 13, 14, 15, 26, 27, 28, 39, 40, 41]));

        expect(rowsOf(thirteen.container)).toEqual([13]);
        expect(thirteen.container.querySelector<HTMLElement>('.hokm-hands')?.style.getPropertyValue('--rows')).toBe('1');

        cleanup();

        const seventeen = await mounted(holding(SEVENTEEN, 3));

        expect(rowsOf(seventeen.container)).toEqual([9, 8]);
        expect(seventeen.container.querySelector<HTMLElement>('.hokm-hands')?.style.getPropertyValue('--rows')).toBe('2');
    });

    it('keeps thirteen in one row however narrow the phone, where a second row would cost the table more than it gives the cards', async () =>
    {
        roomOf(300, 520);

        const { container } = await mounted(holding([0, 1, 2, 3, 13, 14, 15, 26, 27, 28, 39, 40, 41]));

        expect(rowsOf(container)).toEqual([13]);
    });

    it('keeps seventeen in one row where each card still shows enough of itself', async () =>
    {
        roomOf(1144, 657);

        const { container } = await mounted(holding(SEVENTEEN, 3));

        expect(rowsOf(container)).toEqual([17]);
    });

    it('keeps seventeen in one row on a stage too short to spare a second row, such as a phone with the chat open over its lower half', async () =>
    {
        roomOf(358, 479);

        const short = await mounted(holding(SEVENTEEN, 3));

        expect(rowsOf(short.container)).toEqual([17]);

        cleanup();
        roomOf(358, 480);

        const tall = await mounted(holding(SEVENTEEN, 3));

        expect(rowsOf(tall.container)).toEqual([9, 8]);
    });

    it('does not break a hand in two before it knows how much room there is', async () =>
    {
        const { container } = await mounted(holding(SEVENTEEN, 3));

        expect(rowsOf(container)).toEqual([17]);
    });

    it('slides each card from where it lay to where it lies when the hand is sorted, and leaves a card that did not move alone', async () =>
    {
        lie();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(holding([0, 2, 14, 16, 30, 45]));
        const dealt = [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card ?? '');

        fire(container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!, 'click');

        const sorted = [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card ?? '');
        const moved = slid(animate, container);

        expect(sorted).not.toEqual(dealt);

        for (const card of sorted)
        {
            const from = (dealt.indexOf(card) - sorted.indexOf(card)) * 30;
            const frames = moved.get(card);

            if (from === 0)
            {
                expect(frames, `card ${ card } did not move and was slid all the same`).toBeUndefined();
                continue;
            }

            expect(frames?.[0], `card ${ card } did not start where it lay`).toMatchObject({ translate: `${ from }px 0px`, composite: 'add' });
            expect(frames?.at(-1), `card ${ card } did not end where it lies`).toMatchObject({ translate: '0px 0px', rotate: '0deg', composite: 'add' });
        }

        expect([...moved.keys()].length, 'no card was slid').toBeGreaterThan(1);
        expect(container.querySelector('.hokm-hands')?.getAttribute('data-sliding'), 'the stylesheet was left to move the cards under the slide as well').toBe('true');

        await elapse(319);

        expect(container.querySelector('.hokm-hands')?.getAttribute('data-sliding')).toBe('true');

        await elapse(1);

        expect(container.querySelector('.hokm-hands')?.hasAttribute('data-sliding'), 'the stylesheet was never given the cards back').toBe(false);
    });

    it('keeps the cards for the whole of the last slide when the hand is sorted twice in a row', async () =>
    {
        lie();

        const { container } = await mounted(holding([0, 2, 14, 16, 30, 45]));
        const sort = container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!;

        fire(sort, 'click');
        await elapse(200);
        fire(sort, 'click');
        await elapse(200);

        expect(container.querySelector('.hokm-hands')?.getAttribute('data-sliding'), 'the first slide\'s end gave the cards back in the middle of the second').toBe('true');

        await elapse(120);

        expect(container.querySelector('.hokm-hands')?.hasAttribute('data-sliding')).toBe(false);
    });

    it('turns each card from the tilt it had to the tilt of its new place', async () =>
    {
        lie();

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(holding([0, 2, 14, 16, 30, 45]));
        const tilted = () => new Map([...container.querySelectorAll<HTMLElement>('.hokm-hand > li')].map((slot) => [slot.querySelector<HTMLElement>('.card-hold')?.dataset.card ?? '', Number(slot.style.getPropertyValue('--t'))] as const));
        const before = tilted();

        fire(container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!, 'click');

        const after = tilted();

        for (const [card, frames] of slid(animate, container))
        {
            expect(Number.parseFloat(String(frames[0].rotate)), `card ${ card }`).toBeCloseTo(((before.get(card) ?? 0) - (after.get(card) ?? 0)) * 6, 6);
        }
    });

    it('reckons a tilted card by where it stands, not by the corner its tilt swings out', async () =>
    {
        lie();
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(holding([0, 2, 14, 16, 30, 45]));
        const standing = () => new Map([...container.querySelectorAll<HTMLElement>('.hokm-hand > li')].map((slot, nth) => [slot.querySelector<HTMLElement>('.card-hold')?.dataset.card ?? '', { nth, tilt: Number(slot.style.getPropertyValue('--t')) }] as const));
        const swing = (tilt: number) => Math.sin(tilt * 6 * Math.PI / 180) * 0.9 * 100;
        const before = standing();

        fire(container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!, 'click');

        const after = standing();
        const moved = slid(animate, container);

        expect(moved.size).toBeGreaterThan(1);

        for (const [card, frames] of moved)
        {
            const was = before.get(card) ?? { nth: 0, tilt: 0 };
            const now = after.get(card) ?? { nth: 0, tilt: 0 };

            expect(Number.parseFloat(String(frames[0].translate)), `card ${ card }`).toBeCloseTo((was.nth - now.nth) * 30 - swing(was.tilt) + swing(now.tilt), 6);
        }
    });

    it('leaves the cards that stay to close the gap by themselves when one is played and no row goes', async () =>
    {
        lie();
        useDevice().overrideCoarse(false);
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(holding([0, 2, 14, 16, 30, 45]));

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="0"]')!, 'click');

        expect(rowsOf(container)).toEqual([5]);
        expect(animate.mock.contexts.filter((one) => (one as Element).tagName === 'LI'), 'a card that only had to close up was slid by hand').toEqual([]);
        expect(container.querySelector('.hokm-hands')?.hasAttribute('data-sliding'), 'the stylesheet was stopped from closing the gap').toBe(false);
    });

    it('moves the cards in one step, with nothing slid, for a reader who asked for less motion', async () =>
    {
        lie();
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(holding([0, 2, 14, 16, 30, 45]));
        const dealt = [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card);

        fire(container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!, 'click');

        expect([...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card)).not.toEqual(dealt);
        expect(animate).not.toHaveBeenCalled();
    });

    it('brings the second row up beside the first when a card played leaves room for one row', async () =>
    {
        roomOf(358, 778);
        lie();
        useDevice().overrideCoarse(false);
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const fifteen = [0, 1, 2, 3, 4, 13, 14, 15, 16, 26, 27, 28, 39, 40, 41];
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await mounted(holding(fifteen, 3));

        expect(rowsOf(container)).toEqual([8, 7]);

        const lower = [...container.querySelectorAll<HTMLElement>('.hokm-hand')][1];
        const below = [...lower.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card ?? '');

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="0"]')!, 'click');

        expect(rowsOf(container)).toEqual([14]);
        expect(container.querySelector('.hokm-hands')?.getAttribute('data-sliding')).toBe('true');

        const moved = slid(animate, container);

        for (const [nth, card] of below.entries())
        {
            const now = [...container.querySelectorAll<HTMLElement>('.card-hold')].map((one) => one.dataset.card).indexOf(card);

            expect(moved.get(card)?.[0], `card ${ card } was not brought up from the row it lay in`).toMatchObject({ translate: `${ (nth - now) * 30 }px 100px`, composite: 'add' });
        }
    });
});

describe('the hand under a keyboard', () =>
{
    const chairs = (held: number) => [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held, tricks: 0, out: false }));

    const turn = (view: Partial<Hokm> = {}): MatchView => ({
        ...match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 1, hand: [0, 14, 30, 45], plays: [14, 30], seats: chairs(4), ...view }, 0),
        remainingMs: 20_000
    });

    const hold = (container: HTMLElement, card: number) => container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!;

    const stops = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('.card-hold')].filter((one) => one.tabIndex === 0).map((one) => one.dataset.card);

    const focused = () => (document.activeElement as HTMLElement | null)?.dataset.card;

    const key = (target: Element, which: string, more: KeyboardEventInit = {}) =>
    {
        const event = new KeyboardEvent('keydown', { key: which, bubbles: true, cancelable: true, ...more });

        target.dispatchEvent(event);

        return event.defaultPrevented;
    };

    const enter = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));

    const unanswered = () => vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

    beforeEach(() =>
    {
        useDevice().overrideCoarse(false);
    });

    afterEach(() =>
    {
        vi.unstubAllGlobals();
    });

    it('puts one card in the order of the Tab key: the first that may be played', async () =>
    {
        const { container } = await mounted(turn());

        expect(stops(container)).toEqual(['14']);
    });

    it('keeps one card there when none may be played, so the hand can still be read', async () =>
    {
        const { container } = await mounted(turn({ turn: 1, plays: [] }));

        expect(stops(container)).toEqual(['0']);
    });

    it('says a card cannot be played without taking it away from the keyboard', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await mounted(turn());
        const dead = hold(container, 0);

        expect(dead.disabled, 'a disabled button cannot be given the keyboard, and loses it when it is disabled').toBe(false);
        expect(dead.getAttribute('aria-disabled')).toBe('true');
        expect(hold(container, 14).getAttribute('aria-disabled')).toBeNull();

        dead.focus();
        fire(dead, 'click');

        expect(focused()).toBe('0');
        expect(play).not.toHaveBeenCalled();
    });

    it('walks the hand with the arrows, round and round, and to its ends with Home and End', async () =>
    {
        const { container } = await mounted(turn());

        hold(container, 14).focus();

        expect(key(hold(container, 14), 'ArrowRight'), 'the page was left to scroll under the arrow').toBe(true);
        expect(focused()).toBe('30');

        key(hold(container, 30), 'ArrowRight');
        expect(focused(), 'a card that cannot be played was stepped over, and cannot be read').toBe('45');

        key(hold(container, 45), 'ArrowRight');
        expect(focused(), 'the last card did not lead round to the first').toBe('0');

        key(hold(container, 0), 'ArrowLeft');
        expect(focused()).toBe('45');

        key(hold(container, 45), 'Home');
        expect(focused()).toBe('0');

        key(hold(container, 0), 'End');
        expect(focused()).toBe('45');
    });

    it('leaves a key it has no use for to the page', async () =>
    {
        const { container } = await mounted(turn());

        hold(container, 14).focus();

        expect(key(hold(container, 14), 'Tab')).toBe(false);
        expect(key(hold(container, 14), 'a')).toBe(false);
        expect(key(hold(container, 14), 'ArrowRight', { ctrlKey: true }), 'a chord that is the browser\'s was taken').toBe(false);
        expect(key(hold(container, 14), 'ArrowLeft', { altKey: true }), 'a chord that is the browser\'s was taken').toBe(false);
        expect(key(hold(container, 14), 'ArrowRight', { metaKey: true }), 'a chord that is the browser\'s was taken').toBe(false);
        expect(key(hold(container, 14), 'ArrowUp'), 'one row has nothing over it').toBe(false);
        expect(key(hold(container, 14), 'ArrowDown'), 'one row has nothing under it').toBe(false);
        expect(focused()).toBe('14');
    });

    it('keeps the Tab key on the card the keyboard last stood on', async () =>
    {
        const { container } = await mounted(turn());

        hold(container, 14).focus();
        key(hold(container, 14), 'ArrowRight');

        expect(stops(container)).toEqual(['30']);

        hold(container, 0).focus();

        expect(stops(container), 'a card focused by a pointer did not take the stop').toEqual(['0']);
    });

    it('goes between two rows with up and down, to the card over or under', async () =>
    {
        roomOf(358, 778);

        const { container } = await mounted(turn({ hand: SEVENTEEN, plays: SEVENTEEN }));

        expect([...container.querySelectorAll('.hokm-hand')].map((row) => row.querySelectorAll('.card-hold').length)).toEqual([9, 8]);

        hold(container, 2).focus();
        key(hold(container, 2), 'ArrowDown');
        expect(focused()).toBe('28');

        key(hold(container, 28), 'ArrowUp');
        expect(focused()).toBe('2');

        hold(container, 16).focus();
        key(hold(container, 16), 'ArrowDown');
        expect(focused(), 'the longer row\'s last card has none under it, and went nowhere').toBe('42');

        expect(key(hold(container, 42), 'ArrowDown'), 'the lower row has nothing under it').toBe(false);
        expect(focused()).toBe('42');

        key(hold(container, 16), 'ArrowRight');
        expect(focused(), 'the end of one row did not lead to the start of the next').toBe('26');
    });

    it('passes the keyboard to the next card when the one under it is played', async () =>
    {
        unanswered();

        const { container } = await mounted(turn());

        hold(container, 14).focus();
        enter(hold(container, 14));

        expect(container.querySelector('.card-hold[data-card="14"]')).toBeNull();
        expect(focused(), 'the keyboard was left on nothing when its card flew').toBe('30');
        expect(stops(container)).toEqual(['30']);
    });

    it('passes it to the card before when the one played was the last in the hand', async () =>
    {
        unanswered();

        const { container } = await mounted(turn({ plays: [45] }));

        hold(container, 45).focus();
        enter(hold(container, 45));

        expect(focused()).toBe('30');
    });

    it('gives a card a pointer played no keyboard to hand on, and brings no other card to the front of the fan for it', async () =>
    {
        unanswered();

        const { container } = await mounted(turn());

        hold(container, 14).focus();
        hold(container, 14).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

        expect(container.querySelector('.card-hold[data-card="14"]')).toBeNull();
        expect(focused(), 'a card nobody asked for was given the focus, and the fan draws a focused card over its neighbours').toBeUndefined();
        expect(stops(container), 'the Tab key was left on a card that is gone').toEqual(['30']);
    });

    it('does not take the keyboard from wherever it is when a card it is not on is played', async () =>
    {
        unanswered();

        const { container } = await mounted(turn());
        const sort = container.querySelector<HTMLButtonElement>('.hokm-rail .hokm-sort')!;

        hold(container, 14).focus();
        sort.focus();
        enter(hold(container, 14));

        expect(document.activeElement, 'the keyboard was pulled back into the hand').toBe(sort);
        expect(stops(container), 'the Tab key was left on a card that is gone').toEqual(['30']);
    });

    it('finds the Tab key a card again when the one it was on leaves by another road', async () =>
    {
        const { container, read, match: shown } = await mounted(turn());

        hold(container, 30).focus();
        read({ ...shown(), view: { ...(shown().view as Hokm), hand: [0, 14, 45], plays: [14] } });
        await flush();

        expect(stops(container)).toEqual(['14']);
    });

    it('takes no second card while the first is still with the server, and says so on every card', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');

        vi.spyOn(useBoard(), 'busy').mockReturnValue(true);

        const { container } = await mounted(turn());

        expect([...container.querySelectorAll('.card-hold')].map((one) => one.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true', 'true']);

        fire(hold(container, 14), 'click');

        expect(play, 'a second play went out, which the board refuses and the table would take back').not.toHaveBeenCalled();
        expect(hold(container, 14).getAttribute('data-picked'), 'a card was lifted that could not be sent').toBeNull();
    });

    it('lifts no card for the stock while the board is busy either', async () =>
    {
        vi.spyOn(useBoard(), 'busy').mockReturnValue(true);

        const { container } = await mounted(match({ phase: 'discard', turn: 0, discard: 2, stock: 42, hand: [3, 14, 27], plays: [] }, 0));

        fire(hold(container, 14), 'click');

        expect(hold(container, 14).getAttribute('aria-pressed')).toBe('false');
        expect(hold(container, 14).getAttribute('aria-disabled')).toBe('true');
    });
});
