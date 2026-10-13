import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire } from '@azerothjs/testing';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { POT_WON } from '../src/game/poker-beats.ts';
import { BLINDS, EVERYBODY, elapse, heard, match, places, rows, seated, stack, told } from './poker-mounted.ts';

const sounds = vi.hoisted(() => ({ heard: [] as string[], felt: [] as string[] }));

vi.mock('../src/game/sound.ts', async (original) =>
{
    const real = await original<typeof import('../src/game/sound.ts')>();

    return {
        ...real,
        createSound: () => ({
            play: (cue: string) =>
            {
                sounds.heard.push(cue);
            },
            setEnabled: () => undefined,
            dispose: () => undefined
        })
    };
});

vi.mock('../src/lib/haptics.ts', async (original) =>
{
    const real = await original<typeof import('../src/lib/haptics.ts')>();

    return {
        ...real,
        haptic: (kind: string) =>
        {
            sounds.felt.push(kind);

            return true;
        }
    };
});

const LONG = 8000;

const folded = { folded: true };

const alone = () => match({ turn: 1, seats: rows({ 2: folded, 3: { stack: 1490, bet: 10, ...folded }, 4: { stack: 1480, bet: 20, ...folded }, 5: folded }) });

const next = () => match(
    { hand: 2, button: 3, hole: [4, 17], blinds: { small: 10, big: 20, level: 1, next: 9 }, seats: rows({ 0: { stack: 1530 }, 3: { stack: 1490 }, 4: { stack: 1470, bet: 10 }, 5: { stack: 1480, bet: 20 } }) },
    { rev: 8 }
);

const won = () => heard(1, told(
    8,
    1,
    { e: 'fold', seat: 1, amount: 0 },
    { e: 'pot', amount: 30, winners: [0] },
    { e: 'end', hand: 1, dealt: EVERYBODY },
    { e: 'deal', hand: 2, button: 3, small: 10, big: 20 },
    { e: 'blind', seat: 4, amount: 10 },
    { e: 'blind', seat: 5, amount: 20 }
));

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useSettings().reset();
    sounds.heard.length = 0;
    sounds.felt.length = 0;
    places();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('what a poker table sounds like', () =>
{
    it('is heard in the order things happen: the fold, the pot and its winner, the shuffle and the deal, a chip for each blind as it lands', async () =>
    {
        const { read } = await seated(alone());

        await read(next(), won());
        await elapse(LONG);

        expect(sounds.heard).toEqual(['card-gather', 'chips-stack', 'hand-won', 'card-shuffle', ...Array.from({ length: 8 }, () => 'card-slide'), 'chip-lay', 'chip-lay']);
        expect(sounds.felt).toEqual(['hand']);
    });

    it('is heard in the same order by somebody who asked for less motion', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { read } = await seated(alone());

        await read(next(), won());
        await elapse(LONG);

        expect(sounds.heard).toEqual(['card-gather', 'chips-stack', 'hand-won', 'card-shuffle', ...Array.from({ length: 8 }, () => 'card-slide'), 'chip-lay', 'chip-lay']);
    });

    it('pays a pot to the sound of its chips, and tells the reader they won it a beat after, not on top of them', async () =>
    {
        const { container, read } = await seated(alone());

        await read(next(), won());

        for (let waited = 0; waited < LONG && stack(container, 0) !== '1,530'; waited += 10)
        {
            expect(sounds.heard, 'the pot was heard before it was paid').toEqual(['card-gather']);
            await elapse(10);
        }

        expect(stack(container, 0)).toBe('1,530');
        expect(sounds.heard, 'the pot was paid in silence, or its winner was told on top of its chips').toEqual(['card-gather', 'chips-stack']);
        expect(sounds.felt).toEqual(['hand']);

        await elapse(POT_WON - 10);

        expect(sounds.heard).toEqual(['card-gather', 'chips-stack']);

        await elapse(10);

        expect(sounds.heard).toEqual(['card-gather', 'chips-stack', 'hand-won']);
    });

    it('is heard by somebody watching, who is buzzed for nothing', async () =>
    {
        const { read } = await seated({ ...alone(), mine: undefined });

        await read({ ...next(), mine: undefined }, won());
        await elapse(LONG);

        expect(sounds.heard.slice(0, 2)).toEqual(['card-gather', 'chips-stack']);
        expect(sounds.heard).not.toContain('hand-won');
        expect(sounds.felt).toEqual([]);
    });

    it('knocks for a check, lays a chip for a call and stacks them for an all-in, each when it is seen', async () =>
    {
        const { read } = await seated(match({ turn: 1 }));
        const after = match(
            { turn: 5, pot: 1570, pots: [{ amount: 1570, eligible: EVERYBODY }], seats: rows({ ...BLINDS, 1: { stack: 1480, bet: 20 }, 2: { stack: 0, bet: 1500, allIn: true }, 3: { stack: 1490, bet: 10, ...folded } }) },
            { rev: 11, turn: 5 }
        );

        await read(after, heard(
            1,
            told(8, 1, { e: 'call', seat: 1, amount: 20 }),
            told(9, 2, { e: 'allin', seat: 2, amount: 1500 }),
            told(10, 3, { e: 'fold', seat: 3, amount: 0 }),
            told(11, 4, { e: 'check', seat: 4, amount: 0 })
        ));
        await elapse(LONG);

        expect(sounds.heard).toEqual(['chip-lay', 'chips-stack', 'card-gather', 'tick']);
    });

    it('is not played for a table that has fallen a long way behind: that table is set down as it stands', async () =>
    {
        const { read } = await seated(alone());
        const dealt = (hand: number): Parameters<typeof told>[2] => ({ e: 'deal', hand, button: 3, small: 10, big: 20 });

        await read(
            match({ hand: 9, button: 3, hole: [4, 17], blinds: { small: 10, big: 20, level: 1, next: 2 } }, { rev: 15 }),
            { ...heard(1, ...Array.from({ length: 8 }, (_, at) => told(8 + at, 1, { e: 'end', hand: 1 + at, dealt: EVERYBODY }, dealt(2 + at)))), live: false }
        );
        await elapse(LONG);

        expect(sounds.heard, 'eight hands the reader missed were played out one after another').toEqual([]);
    });

    it('lays the reader’s chip once: at the press, and not again when the server says the same', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container, read } = await seated(match({ turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 }, { turn: 0 }));
        const call = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Call 20') as HTMLButtonElement;

        fire(call, 'click');
        await elapse(600);

        expect(sounds.heard).toEqual(['chip-lay']);

        await read(
            match({ turn: 1, pot: 50, pots: [{ amount: 50, eligible: EVERYBODY }], seats: rows({ ...BLINDS, 0: { stack: 1480, bet: 20 } }) }, { rev: 8, turn: 1 }),
            heard(1, told(8, 0, { e: 'call', seat: 0, amount: 20 }))
        );
        await elapse(LONG);

        expect(sounds.heard, 'the call was laid a second time for the server’s answer').toEqual(['chip-lay']);
    });

    it('says no to a press the server refuses, and lays nothing more', async () =>
    {
        let answer: (outcome: 'failed') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const { container } = await seated(match({ turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 }, { turn: 0 }));
        const call = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Call 20') as HTMLButtonElement;

        fire(call, 'click');
        await elapse(600);
        answer('failed');
        await elapse(LONG);

        expect(sounds.heard).toEqual(['chip-lay', 'deny']);
    });

    it('is not heard at all for a table that is set down as it stands', async () =>
    {
        const { read } = await seated(alone());

        await read(next(), { ...won(), jump: true });
        await elapse(LONG);

        expect(sounds.heard).toEqual([]);
    });
});
