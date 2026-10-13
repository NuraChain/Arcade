import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire } from '@azerothjs/testing';

import { CHIP_FLY, DISC_GAP, GATHER, GATHER_GAP } from '../src/game/poker-beats.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { BLINDS, EVERYBODY, bet, elapse, flights, heard, match, places, pot, presenting, rows, seated, stack, told, turns } from './poker-mounted.ts';

const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === label) as HTMLButtonElement | undefined;

const called = (seat: number, chips: number, turn: number) => match(
    { turn, pot: 30 + chips, pots: [{ amount: 30 + chips, eligible: EVERYBODY }], seats: rows({ ...BLINDS, [seat]: { stack: 1500 - chips, bet: chips } }) },
    { rev: 8, turn }
);

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

describe('chips that travel on a poker table', () =>
{
    it('leave the stack when they are put in, and are counted by the bet and by the pot only when they land', async () =>
    {
        const { container, read } = await seated(match());

        await read(called(1, 60, 2), heard(1, told(8, 1, { e: 'raise', seat: 1, amount: 60 })));

        expect(stack(container, 1), 'the chips were still in the stack while they flew').toBe('1,440');
        expect(bet(container, 1), 'the bet was shown before its chips had landed').toBe('60 (landing)');
        expect(pot(container), 'the pot counted chips that were in the air').toBe('Total pot 30');
        expect(flights(container).length, 'nothing flew').toBe(3);
        expect(presenting(container)).toBe('true');

        await elapse(CHIP_FLY + 2 * DISC_GAP - 10);

        expect(pot(container)).toBe('Total pot 30');

        await elapse(10);

        expect([stack(container, 1), bet(container, 1), pot(container)]).toEqual(['1,440', '60', 'Total pot 90']);
        expect(flights(container)).toHaveLength(0);
        expect(presenting(container)).toBeNull();
    });

    it('keep a bet saying what it said while more chips are on their way to it', async () =>
    {
        const { container, read } = await seated(match({ turn: 4 }, { turn: 4 }));
        const raised = match(
            { turn: 5, pot: 110, pots: [{ amount: 110, eligible: EVERYBODY }], seats: rows({ ...BLINDS, 4: { stack: 1400, bet: 100 } }) },
            { rev: 8, turn: 5 }
        );
        const pill = container.querySelector('.poker-seat[data-seat="4"] .poker-bet');

        await read(raised, heard(1, told(8, 4, { e: 'raise', seat: 4, amount: 100 })));

        expect([stack(container, 4), bet(container, 4), pot(container)]).toEqual(['1,400', '20', 'Total pot 30']);
        expect(container.querySelector('.poker-seat[data-seat="4"] .poker-bet'), 'the bet was drawn again for its raise').toBe(pill);

        await elapse(CHIP_FLY + 4 * DISC_GAP);

        expect([stack(container, 4), bet(container, 4), pot(container)]).toEqual(['1,400', '100', 'Total pot 110']);
        expect(container.querySelector('.poker-seat[data-seat="4"] .poker-bet')).toBe(pill);
    });

    it('are gathered to the pot when a street closes, without one number changing, before the cards come', async () =>
    {
        const before = match({ turn: 4, pot: 80, pots: [{ amount: 80, eligible: EVERYBODY }], seats: rows({ 0: { stack: 1480, bet: 20 }, 3: { stack: 1480, bet: 20 }, 4: { stack: 1480, bet: 20 }, 5: { stack: 1480, bet: 20 }, 1: { folded: true }, 2: { folded: true } }) }, { turn: 4 });
        const { container, read } = await seated(before);
        const flop = match(
            { street: 'flop', board: [5, 18, 31], turn: 3, pot: 80, pots: [{ amount: 80, eligible: [0, 3, 4, 5] }], seats: rows({ 0: { stack: 1480 }, 3: { stack: 1480 }, 4: { stack: 1480 }, 5: { stack: 1480 }, 1: { folded: true }, 2: { folded: true } }) },
            { rev: 8, turn: 3 }
        );

        await read(flop, heard(1, told(8, 4, { e: 'check', seat: 4, amount: 0 }, { e: 'board', street: 'flop', cards: [5, 18, 31] })));
        await elapse(200);

        expect(container.querySelectorAll('.poker-bet'), 'the bets stayed in front of the seats while their chips went to the middle').toHaveLength(0);
        expect(flights(container).length).toBe(4);
        expect(pot(container)).toBe('Total pot 80');
        expect(container.querySelectorAll('.poker-board .card-face'), 'the flop came before the bets were in').toHaveLength(0);

        await elapse(GATHER + 3 * GATHER_GAP + 400);

        expect(flights(container)).toHaveLength(0);
        expect(pot(container)).toBe('Total pot 80');
        expect(container.querySelectorAll('.poker-board .card-face')).toHaveLength(3);
    });

    it('fly from the reader’s own stack at the press, and are not flown again when the server answers', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container, read } = await seated(match({ turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 }, { turn: 0 }));

        fire(button(container, 'Call 20')!, 'click');

        expect([stack(container, 0), bet(container, 0), pot(container)]).toEqual(['1,480', '20 (landing)', 'Total pot 30']);
        expect(flights(container).length).toBe(1);

        await elapse(CHIP_FLY);

        expect([stack(container, 0), bet(container, 0), pot(container)]).toEqual(['1,480', '20', 'Total pot 50']);

        await read(called(0, 20, 1), heard(1, told(8, 0, { e: 'call', seat: 0, amount: 20 })));

        expect(flights(container), 'the call was flown a second time for the server’s answer').toHaveLength(0);
        expect([stack(container, 0), bet(container, 0), pot(container)]).toEqual(['1,480', '20', 'Total pot 50']);
    });

    it('come back to the stack when the press is refused', async () =>
    {
        let answer: (outcome: 'failed') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const { container } = await seated(match({ turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 }, { turn: 0 }));

        fire(button(container, 'Call 20')!, 'click');
        await elapse(CHIP_FLY);
        answer('failed');
        await turns();

        expect([stack(container, 0), bet(container, 0), pot(container)], 'the stack had its chips back before they had flown home').toEqual(['1,480', '', 'Total pot 30']);
        expect(flights(container).length).toBe(1);

        await elapse(CHIP_FLY);

        expect([stack(container, 0), bet(container, 0), pot(container)]).toEqual(['1,500', '', 'Total pot 30']);
        expect(flights(container)).toHaveLength(0);
    });

    it('are set down where the server says they are when the table is read afresh in the middle of a flight', async () =>
    {
        const { container, read } = await seated(match());

        await read(called(1, 60, 2), heard(1, told(8, 1, { e: 'raise', seat: 1, amount: 60 })));
        await elapse(100);
        await read(called(1, 60, 2), { ...heard(2), jump: true });

        expect(flights(container), 'a disc was left in the air over a table that had been set down').toHaveLength(0);
        expect([stack(container, 1), bet(container, 1), pot(container)]).toEqual(['1,440', '60', 'Total pot 90']);
    });

    it('still land for somebody who asked for less motion, as a fade and not a flight', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { container, read } = await seated(match());

        await read(called(1, 60, 2), heard(1, told(8, 1, { e: 'raise', seat: 1, amount: 60 })));

        expect(pot(container)).toBe('Total pot 30');

        await elapse(140 + 2 * DISC_GAP);

        expect([stack(container, 1), bet(container, 1), pot(container)]).toEqual(['1,440', '60', 'Total pot 90']);
        expect(flights(container)).toHaveLength(0);
    });
});
