import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire } from '@azerothjs/testing';

import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { POT_FLY, POT_GAP, POT_SPAN } from '../src/game/poker-beats.ts';
import { BLINDS, EVERYBODY, elapse, heard, match, places, pot, rows, seated, stack, told } from './poker-mounted.ts';

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

const dealt = () =>
{
    const after = sounds.heard.slice(sounds.heard.indexOf('card-shuffle') + 1);

    return {
        slides: after.filter((cue) => cue === 'card-slide').length,
        chips: after.filter((cue) => cue === 'chip-lay').length,
        others: after.filter((cue) => cue !== 'card-slide' && cue !== 'chip-lay'),
        last: after.at(-1)
    };
};

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
    it('is heard in the order things happen: the fold, the pot leaving for its winner and landing, the shuffle, then the cards going out with a chip for each blind among them', async () =>
    {
        const { read } = await seated(alone());

        await read(next(), won());
        await elapse(LONG);

        expect(sounds.heard.slice(0, 4)).toEqual(['card-gather', 'hand-won', 'chips-stack', 'card-shuffle']);
        expect(dealt(), 'the cards waited for the blinds, or a blind for the cards').toEqual({ slides: 8, chips: 2, others: [], last: 'card-slide' });
        expect(sounds.felt).toEqual(['hand']);
    });

    it('is heard in the same order by somebody who asked for less motion', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { read } = await seated(alone());

        await read(next(), won());
        await elapse(LONG);

        expect(sounds.heard.slice(0, 4)).toEqual(['card-gather', 'hand-won', 'chips-stack', 'card-shuffle']);
        expect(dealt()).toEqual({ slides: 8, chips: 2, others: [], last: 'card-slide' });
    });

    it('slides a card out and lays it down for each card of a street, the three of a flop out before the first is laid', async () =>
    {
        const { read } = await seated(match({ turn: 4 }, { turn: 4 }));
        const flop = match({ street: 'flop', board: [5, 18, 31], turn: 3, seats: rows({ 3: { stack: 1490 }, 4: { stack: 1480 } }) }, { rev: 8, turn: 3 });

        await read(flop, heard(1, told(8, 4, { e: 'board', street: 'flop', cards: [5, 18, 31] })));
        await elapse(LONG);

        expect(sounds.heard).toEqual(['card-slide', 'card-slide', 'card-slide', 'card-place', 'card-place', 'card-place']);
    });

    it('plays the newest hand alone when two were dealt since it last looked: the one before is set down as it ended', async () =>
    {
        const { container, read } = await seated(alone());
        const fold = (seat: number): Parameters<typeof told>[2] => ({ e: 'fold', seat, amount: 0 });
        const third = match(
            { hand: 3, button: 4, hole: [4, 17], turn: 1, blinds: { small: 10, big: 20, level: 1, next: 8 }, seats: rows({ 0: { stack: 1510, bet: 20 }, 3: { stack: 1490 }, 4: { stack: 1470 }, 5: { stack: 1500, bet: 10 } }) },
            { rev: 13, turn: 1 }
        );

        await read(third, heard(
            1,
            told(8, 1, fold(1), { e: 'pot', amount: 30, winners: [0] }, { e: 'end', hand: 1, dealt: EVERYBODY }, { e: 'deal', hand: 2, button: 3, small: 10, big: 20 }, { e: 'blind', seat: 4, amount: 10 }, { e: 'blind', seat: 5, amount: 20 }),
            told(9, 0, fold(0)),
            told(10, 1, fold(1)),
            told(11, 2, fold(2)),
            told(12, 3, fold(3)),
            told(
                13,
                4,
                fold(4),
                { e: 'refund', seat: 5, amount: 10 },
                { e: 'pot', amount: 20, winners: [5] },
                { e: 'end', hand: 2, dealt: EVERYBODY },
                { e: 'deal', hand: 3, button: 4, small: 10, big: 20 },
                { e: 'blind', seat: 5, amount: 10 },
                { e: 'blind', seat: 0, amount: 20 }
            )
        ));

        expect([stack(container, 0), stack(container, 5)], 'the hand before the newest was not set down as it ended').toEqual(['1,530', '1,510']);

        await elapse(LONG);

        expect(sounds.heard.filter((cue) => cue !== 'card-slide'), 'a hand that was over was played out before the newest').toEqual(['card-shuffle', 'chip-lay', 'chip-lay']);
        expect(sounds.felt).toEqual([]);
        expect([stack(container, 0), stack(container, 5), pot(container)]).toEqual(['1,510', '1,500', 'Total pot 30']);
    });

    it('tells the reader a pot is theirs as it leaves for them, lands it to the sound of its chips, and lets both be heard before the next hand is shuffled', async () =>
    {
        const { container, read } = await seated(alone());

        await read(next(), won());

        for (let waited = 0; waited < LONG && pot(container) !== 'Total pot 0'; waited += 10)
        {
            expect(sounds.heard, 'the pot was heard before it left').toEqual(['card-gather']);
            await elapse(10);
        }

        expect([pot(container), stack(container, 0)]).toEqual(['Total pot 0', '1,500']);
        expect(sounds.heard, 'the reader was not told the pot was theirs as it left for them').toEqual(['card-gather', 'hand-won']);
        expect(sounds.felt, 'the reader was buzzed before the chips reached them').toEqual([]);

        await elapse(POT_FLY + POT_GAP - 10);

        expect([stack(container, 0), sounds.heard], 'the chips were counted, or heard, before they had landed').toEqual(['1,500', ['card-gather', 'hand-won']]);

        await elapse(10);

        expect(stack(container, 0)).toBe('1,530');
        expect(sounds.heard, 'the chips landed in silence').toEqual(['card-gather', 'hand-won', 'chips-stack']);
        expect(sounds.felt).toEqual(['hand']);

        await elapse(POT_SPAN - POT_FLY - POT_GAP - 10);

        expect(sounds.heard, 'the next hand was shuffled on top of the chips').toEqual(['card-gather', 'hand-won', 'chips-stack']);

        await elapse(10);

        expect(sounds.heard.at(-1)).toBe('card-shuffle');
    });

    it('is heard at a showdown as a fan for each hand that is turned over, after the chips of the call and before the chips of the pot', async () =>
    {
        const river = match(
            {
                street: 'river',
                board: [1, 15, 29, 43, 8],
                turn: 2,
                pot: 250,
                pots: [{ amount: 250, eligible: [1, 2] }],
                hole: [],
                seats: rows({ 0: folded, 1: { stack: 1360, bet: 60 }, 2: { stack: 1420 }, 3: { stack: 1490, ...folded }, 4: { stack: 1480, ...folded }, 5: folded })
            },
            { turn: 2 }
        );
        const after = match(
            { hand: 2, button: 3, turn: 1, hole: [4, 17], blinds: { small: 10, big: 20, level: 1, next: 9 }, seats: rows({ 1: { stack: 1360 }, 2: { stack: 1670 }, 3: { stack: 1490 }, 4: { stack: 1470, bet: 10 }, 5: { stack: 1480, bet: 20 } }) },
            { rev: 8, turn: 1 }
        );
        const { read } = await seated(river);

        await read(after, heard(1, told(
            8,
            2,
            { e: 'call', seat: 2, amount: 60 },
            { e: 'show', seat: 1, cards: [5, 18], category: 'pair' },
            { e: 'show', seat: 2, cards: [7, 20], category: 'two-pair' },
            { e: 'pot', amount: 310, winners: [2] },
            { e: 'end', hand: 1, dealt: EVERYBODY },
            { e: 'deal', hand: 2, button: 3, small: 10, big: 20 },
            { e: 'blind', seat: 4, amount: 10 },
            { e: 'blind', seat: 5, amount: 20 }
        )));
        await elapse(LONG);

        expect(sounds.heard.slice(0, 5)).toEqual(['chip-lay', 'card-fan', 'card-fan', 'chips-stack', 'card-shuffle']);
        expect(sounds.heard, 'somebody who was not in the hand was told they had won it').not.toContain('hand-won');
        expect(sounds.felt).toEqual([]);
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

    it('is not played hand after hand for a table that has fallen a long way behind: it is set down before the newest deal, and that one is dealt', async () =>
    {
        const { read } = await seated(alone());
        const dealt = (hand: number): Parameters<typeof told>[2] => ({ e: 'deal', hand, button: 3, small: 10, big: 20 });

        await read(
            match({ hand: 9, button: 3, hole: [4, 17], blinds: { small: 10, big: 20, level: 1, next: 2 } }, { rev: 15 }),
            { ...heard(1, ...Array.from({ length: 8 }, (_, at) => told(8 + at, 1, { e: 'end', hand: 1 + at, dealt: EVERYBODY }, dealt(2 + at)))), live: false }
        );
        await elapse(LONG);

        expect(sounds.heard, 'eight hands the reader missed were played out one after another').toEqual(['card-shuffle', ...Array.from({ length: 8 }, () => 'card-slide')]);
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

    it('says no to a fold the server refuses, as the cards come back', async () =>
    {
        let answer: (outcome: 'failed') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const { container } = await seated(match({ turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 }, { turn: 0 }));
        const fold = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Fold') as HTMLButtonElement;

        fire(fold, 'click');
        await elapse(800);

        expect(sounds.heard).toEqual(['card-gather']);

        answer('failed');
        await elapse(LONG);

        expect(sounds.heard, 'a fold that was refused came back in silence').toEqual(['card-gather', 'deny']);
    });

    it('is not heard at all for a table that is set down as it stands', async () =>
    {
        const { read } = await seated(alone());

        await read(next(), { ...won(), jump: true });
        await elapse(LONG);

        expect(sounds.heard).toEqual([]);
    });
});
