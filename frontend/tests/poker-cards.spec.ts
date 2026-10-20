import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire } from '@azerothjs/testing';

import { BETWEEN_CAP, BOARD_GAP, BOARD_OUT, CARD_FLY, COLLECT, DEAL_LEAD, GATHER, GATHER_GAP, KNOCK, MUCK, MUCK_GAP, POT_SPAN, PUCK, TURN, collectGap, dealGap } from '../src/game/poker-beats.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard, type EventBatch } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { BLINDS, EVERYBODY, acts, backs, discs, elapse, faced, flown, heard, match, places, pocketed, presenting, rows, seated, stack, told, turns } from './poker-mounted.ts';

const LONG = 8000;

const GAP = dealGap(12);

const toAct = { turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 };

const folded = { folded: true };

const opening = (): EventBatch => ({
    ...heard(1, told(1, 0, { e: 'deal', hand: 1, button: 2, small: 10, big: 20 }, { e: 'blind', seat: 3, amount: 10 }, { e: 'blind', seat: 4, amount: 20 })),
    opens: () => true
});

const alone = () => match({ turn: 1, seats: rows({ 2: folded, 3: { stack: 1490, bet: 10, ...folded }, 4: { stack: 1480, bet: 20, ...folded }, 5: folded }) });

const next = () => match(
    { ...toAct, hand: 2, button: 3, hole: [4, 17], blinds: { small: 10, big: 20, level: 1, next: 9 }, seats: rows({ 0: { stack: 1530 }, 3: { stack: 1490 }, 4: { stack: 1470, bet: 10 }, 5: { stack: 1480, bet: 20 } }) },
    { rev: 8, turn: 0 }
);

const won = (...first: Parameters<typeof told>[2][]) => heard(1, told(
    8,
    1,
    ...first,
    { e: 'fold', seat: 1, amount: 0 },
    { e: 'pot', amount: 30, winners: [0] },
    { e: 'end', hand: 1, dealt: EVERYBODY },
    { e: 'deal', hand: 2, button: 3, small: 10, big: 20 },
    { e: 'blind', seat: 4, amount: 10 },
    { e: 'blind', seat: 5, amount: 20 }
));

const others = (container: HTMLElement) => [1, 2, 3, 4, 5].map((seat) => backs(container, seat));

const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === label) as HTMLButtonElement | undefined;

const placed = (clone: HTMLElement | undefined) => [clone?.style.left, clone?.style.top, clone?.style.width];

const frame = async () =>
{
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
};

const middle = (clone: HTMLElement) => [parseFloat(clone.style.left) + parseFloat(clone.style.width) / 2, parseFloat(clone.style.top) + parseFloat(clone.style.height) / 2];

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

describe('cards on a poker table', () =>
{
    it('are dealt one at a time, round the table twice from the left of the button, and the reader may act when their second card has been turned', async () =>
    {
        const { container } = await seated(match(toAct, { rev: 1, turn: 0 }), opening());

        expect(others(container), 'somebody had cards before any were dealt').toEqual([0, 0, 0, 0, 0]);
        expect([pocketed(container), acts(container)]).toEqual([0, []]);

        await elapse(DEAL_LEAD);

        expect(flown(container), 'the first card had not left the dealer').toHaveLength(1);

        await elapse(CARD_FLY - 10);

        expect(others(container)).toEqual([0, 0, 0, 0, 0]);

        await elapse(10);

        expect(others(container), 'the first card did not go to the seat on the left of the button').toEqual([0, 0, 1, 0, 0]);

        await elapse(2 * GAP);

        expect(others(container)).toEqual([0, 0, 1, 1, 1]);
        expect(pocketed(container)).toBe(0);

        await elapse(GAP + TURN - 10);

        expect(pocketed(container), 'the reader was shown a card that had not been turned').toBe(0);

        await elapse(10);

        expect(pocketed(container)).toBe(1);
        expect(acts(container), 'the reader was asked to act on one card').toEqual([]);

        await elapse(6 * GAP - 10);

        expect([pocketed(container), acts(container), presenting(container)]).toEqual([1, [], 'true']);

        await elapse(10);

        expect(pocketed(container)).toBe(2);
        expect(acts(container), 'the reader held both cards and was not asked').toEqual(['Fold', 'Call 20', 'Raise']);

        await elapse(LONG);

        expect(others(container)).toEqual([2, 2, 2, 2, 2]);
        expect([flown(container).length, presenting(container)]).toEqual([0, null]);
    });

    it('fly from the dealer to the place where each will lie, and the reader’s to the hand they hold', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container } = await seated(match({}, { rev: 1 }), opening());

        await elapse(DEAL_LEAD);

        const [first] = flown(container);
        const puck = (container.querySelector<HTMLElement>('.poker-puck')?.style.translate ?? '').split(' ').map(parseFloat);
        const frames = animate.mock.calls[animate.mock.contexts.indexOf(first)]?.[0] as Keyframe[];
        const [across, down] = String(frames[0].translate).split(' ').map(parseFloat);

        expect(placed(first), 'the card was not flown to the first of the two places in front of the seat').toEqual(['210px', '360px', '12px']);
        expect(puck.every(Number.isFinite), 'the dealer has no mark for the cards to leave from').toBe(true);
        expect(across, 'the card did not leave from the dealer’s mark').toBeCloseTo(puck[0] - 216, 5);
        expect(down).toBeCloseTo(puck[1] - 368.5, 5);
        expect(Number(frames[0].scale), 'the card left the dealer at its full size, over the mark').toBeCloseTo(0.7, 5);
        expect(animate.mock.calls.filter((_, at) => animate.mock.contexts[at] === first).map((call) => (call[0] as Keyframe[]).map((frame) => frame.opacity)), 'the card did not fade in as it left').toContainEqual([0, 1]);
        expect(animate.mock.contexts.some((one) => (one as Element).classList.contains('poker-puck')), 'the mark slid though it is where it was').toBe(false);

        await elapse(3 * GAP);

        expect(placed(flown(container).at(-1)), 'the reader’s card was not flown to their hand').toEqual(['170px', '740px', '36px']);
    });

    it('are swept to the dealer when the next hand begins, and the mark slides to whoever deals it', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const { container, read } = await seated(alone());
        const puck = container.querySelector<HTMLElement>('.poker-puck')!;

        await frame();

        expect(puck.dataset.placed, 'the mark was not laid on the dealer').toBe('true');

        await read(next(), won());
        await elapse(GATHER + GATHER_GAP + POT_SPAN);

        expect(pocketed(container), 'the hand that was over stayed in the reader’s hand when the next was dealt').toBe(0);
        expect(flown(container).map((one) => [one.style.width, one.querySelector('.card-face') !== null]), 'the old hand did not leave for the dealer face up, at the size it had').toEqual([['36px', true], ['36px', true]]);

        await elapse(COLLECT + collectGap(2) + DEAL_LEAD + CARD_FLY - 10);

        expect(others(container), 'a card of the new hand was out before the old hand had been gathered').toEqual([0, 0, 0, 0, 0]);

        await elapse(10);

        expect(others(container), 'the first card did not go to the left of the new button').toEqual([0, 0, 0, 1, 0]);

        await elapse(LONG);

        const slid = animate.mock.calls.filter((_, at) => animate.mock.contexts[at] === puck);
        const frames = slid[0]?.[0] as Keyframe[];

        expect(slid, 'the mark did not slide once to the new dealer').toHaveLength(1);
        expect(frames.map((frame) => frame.translate)).toEqual([expect.stringMatching(/px .+px$/), puck.style.translate]);
        expect(frames[0].translate, 'the mark slid from where it already was').not.toBe(frames[1].translate);
        expect((slid[0]?.[1] as KeyframeAnimationOptions).duration).toBe(PUCK);
        expect(puck.dataset.seat).toBe('3');
        expect([pocketed(container), others(container), flown(container).length]).toEqual([2, [2, 2, 2, 2, 2], 0]);
    });

    it('wait for the cards no longer than the reader can be kept from their turn: after that they are shown and the reader is asked', async () =>
    {
        const checks = Array.from({ length: 8 }, (): Parameters<typeof told>[2] => ({ e: 'check', seat: 1, amount: 0 }));
        const { container, read } = await seated(alone());

        await read(next(), won(...checks));
        await elapse(BETWEEN_CAP - 10);

        expect([acts(container), presenting(container)], 'the reader was asked before the table had shown them their hand').toEqual([[], 'true']);

        await elapse(10);

        expect(acts(container), 'the reader was kept from their turn by a table that was still showing the last hand').toEqual(['Fold', 'Call 20', 'Raise']);
        expect([pocketed(container), presenting(container)]).toEqual([2, 'true']);

        await elapse(LONG);

        expect([pocketed(container), acts(container), presenting(container)]).toEqual([2, ['Fold', 'Call 20', 'Raise'], null]);
    });

    it('leave for the dealer when a seat folds, and are gone when they get there', async () =>
    {
        const { container, read } = await seated(match());

        await read(match({ turn: 2, seats: rows({ ...BLINDS, 1: folded }) }, { rev: 8, turn: 2 }), heard(1, told(8, 1, { e: 'fold', seat: 1, amount: 0 })));

        const [pile] = flown(container);

        expect(container.querySelector('.poker-seat[data-seat="1"] .poker-backs'), 'the cards stayed in front of a seat that had folded them').toBeNull();
        expect(flown(container)).toHaveLength(1);
        expect(pile.classList.contains('stack')).toBe(true);
        expect(middle(pile).map(Math.round), 'the cards were not flown to the dealer').toEqual([200, 520]);

        await elapse(MUCK - 10);

        expect([flown(container).length, presenting(container)]).toEqual([1, 'true']);

        await elapse(10);

        expect([flown(container).length, presenting(container)]).toEqual([0, null]);
        expect(others(container)).toEqual([0, 2, 2, 2, 2]);
    });

    it('go to the dealer while the next seat puts its chips in: a fold does not hold up the move after it', async () =>
    {
        const { container, read } = await seated(match());
        const called = match(
            { turn: 3, pot: 50, pots: [{ amount: 50, eligible: [0, 2, 3, 4, 5] }], seats: rows({ ...BLINDS, 1: folded, 2: { stack: 1480, bet: 20 } }) },
            { rev: 8, turn: 3 }
        );

        await read(called, heard(1, told(8, 1, { e: 'fold', seat: 1, amount: 0 }, { e: 'call', seat: 2, amount: 20 })));

        expect([flown(container).length, discs(container).length], 'the call waited for the folded cards to reach the dealer').toEqual([1, 1]);

        await elapse(LONG);

        expect([flown(container).length, discs(container).length, presenting(container)]).toEqual([0, 0, null]);
    });

    it('turn face down and go at the press when the reader folds, and come back to the hand if the server will not have it', async () =>
    {
        let answer: (outcome: 'failed') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const { container } = await seated(match(toAct, { turn: 0 }));

        fire(button(container, 'Fold')!, 'click');

        expect(pocketed(container), 'the cards were still in the hand after the fold was pressed').toBe(0);
        expect(flown(container).map((one) => one.classList.contains('turning')), 'the reader’s cards were not turned face down where they lay').toEqual([true, true]);
        expect(flown(container).map(placed)).toEqual([['170px', '740px', '36px'], ['210px', '740px', '36px']]);

        await elapse(TURN);

        expect(flown(container).map((one) => one.classList.contains('turning')), 'the cards did not leave once they were face down').toEqual([false, false]);

        await elapse(MUCK + MUCK_GAP);

        expect(flown(container)).toHaveLength(0);

        answer('failed');
        await turns();

        expect(pocketed(container), 'the cards were in the hand again before they had flown back').toBe(0);
        expect(flown(container).map(placed)).toEqual([['170px', '740px', '36px'], ['210px', '740px', '36px']]);

        await elapse(CARD_FLY + MUCK_GAP);

        expect([pocketed(container), flown(container).length, presenting(container)]).toEqual([2, 0, null]);
    });

    it('come to the board face down, one after another, and are turned in the order they came, and the reader is asked when the last is up', async () =>
    {
        const before = match({ turn: 4, pot: 80, pots: [{ amount: 80, eligible: EVERYBODY }], seats: rows({ 0: { stack: 1480, bet: 20 }, 3: { stack: 1480, bet: 20 }, 4: { stack: 1480, bet: 20 }, 5: { stack: 1480, bet: 20 }, 1: folded, 2: folded }) }, { turn: 4 });
        const { container, read } = await seated(before);
        const flop = match(
            {
                street: 'flop',
                board: [5, 18, 31],
                turn: 0,
                toCall: 0,
                minRaiseTo: 20,
                maxRaiseTo: 1480,
                pot: 80,
                pots: [{ amount: 80, eligible: [0, 3, 4, 5] }],
                seats: rows({ 0: { stack: 1480 }, 3: { stack: 1480 }, 4: { stack: 1480 }, 5: { stack: 1480 }, 1: folded, 2: folded })
            },
            { rev: 8, turn: 0 }
        );
        const out = KNOCK + GATHER + 3 * GATHER_GAP;

        await read(flop, heard(1, told(8, 4, { e: 'check', seat: 4, amount: 0 }, { e: 'board', street: 'flop', cards: [5, 18, 31] })));
        await elapse(out + 2 * BOARD_OUT + CARD_FLY - 10);

        expect(faced(container), 'a card of the flop was shown before all three lay on the table').toBe(0);
        expect(flown(container).map(placed).sort(), 'the three cards do not lie on the first three places of the board').toEqual([['120px', '380px', '24px'], ['150px', '380px', '24px'], ['180px', '380px', '24px']]);

        await elapse(10 + TURN - 10);

        expect(faced(container)).toBe(0);

        await elapse(10);

        expect(faced(container)).toBe(1);

        await elapse(BOARD_GAP);

        expect(faced(container)).toBe(2);
        expect(acts(container), 'the reader was asked to act on a flop that was not all turned').toEqual([]);

        await elapse(BOARD_GAP);

        expect([faced(container), flown(container).length, presenting(container)]).toEqual([3, 0, null]);
        expect(acts(container)).toEqual(['Check', 'Bet']);
    });

    it('arrive at the same pace for somebody who asked for less motion, with nothing flown', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { container } = await seated(match(toAct, { rev: 1, turn: 0 }), opening());
        const seen: { at: number; flying: number; held: number; mine: number }[] = [];

        for (let at = 0; at <= DEAL_LEAD + 12 * GAP; at += 10)
        {
            seen.push({ at, flying: flown(container).length, held: others(container).reduce((sum, cards) => sum + cards, 0), mine: pocketed(container) });
            await elapse(10);
        }

        const second = seen.find((one) => one.mine === 2)?.at ?? 0;

        expect(Math.max(...seen.map((one) => one.flying)), 'a card was flown for somebody who asked for less motion').toBe(0);
        expect(seen.find((one) => one.at === DEAL_LEAD - 10)?.held, 'cards were out before the dealer had begun').toBe(0);
        expect(second, 'the reader’s second card came before its turn in the deal').toBeGreaterThanOrEqual(DEAL_LEAD + 9 * GAP);
        expect(second).toBeLessThanOrEqual(DEAL_LEAD + 9 * GAP + 40);
        expect([others(container), pocketed(container), acts(container)]).toEqual([[2, 2, 2, 2, 2], 2, ['Fold', 'Call 20', 'Raise']]);
    });

    it('are all where they belong at once when the table is set down in the middle of a deal', async () =>
    {
        const { container, read } = await seated(match(toAct, { rev: 1, turn: 0 }), opening());

        await elapse(DEAL_LEAD + 5 * GAP);

        expect(flown(container).length).toBeGreaterThan(0);

        await read(match(toAct, { rev: 1, turn: 0 }), { ...heard(2), jump: true });

        expect(flown(container), 'a card was left in the air over a table that had been set down').toHaveLength(0);
        expect([others(container), pocketed(container), acts(container), presenting(container)]).toEqual([[2, 2, 2, 2, 2], 2, ['Fold', 'Call 20', 'Raise'], null]);
    });

    it('are dealt to every seat for somebody watching, who holds none and waits for none', async () =>
    {
        const { container } = await seated({ ...match({}, { rev: 1 }), mine: undefined }, opening());
        const everybody = () => [0, 1, 2, 3, 4, 5].map((seat) => backs(container, seat));

        expect(everybody()).toEqual([0, 0, 0, 0, 0, 0]);

        await elapse(DEAL_LEAD + 3 * GAP + CARD_FLY);

        expect(everybody(), 'the seat at the foot of the table was dealt no card').toEqual([1, 0, 0, 1, 1, 1]);

        await elapse(LONG);

        expect(everybody()).toEqual([2, 2, 2, 2, 2, 2]);
        expect([container.querySelector('.poker-hand'), stack(container, 0), presenting(container)]).toEqual([null, '1,500', null]);
    });
});
