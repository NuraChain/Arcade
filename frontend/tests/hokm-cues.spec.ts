import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire } from '@azerothjs/testing';

import { LIFT, NAMING, SHUFFLE, TURN } from '../src/game/hokm-beats.ts';
import { TIMING } from '../src/game/motion.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';
import { act, card, elapse, mounted, type Hokm } from './hokm-mounted.ts';

const told = vi.hoisted(() => ({ heard: [] as string[], felt: [] as string[], games: [] as string[] }));

vi.mock('../src/game/sound.ts', async (original) =>
{
    const real = await original<typeof import('../src/game/sound.ts')>();

    return {
        ...real,
        createSound: (_on: boolean, game?: string) =>
        {
            told.games.push(game ?? 'none');

            return {
                play: (cue: string) =>
                {
                    told.heard.push(cue);
                },
                setEnabled: () => undefined,
                dispose: () => undefined
            };
        }
    };
});

vi.mock('../src/lib/haptics.ts', async (original) =>
{
    const real = await original<typeof import('../src/lib/haptics.ts')>();

    return {
        ...real,
        haptic: (kind: string) =>
        {
            told.felt.push(kind);

            return true;
        }
    };
});

const LONG = 20_000;

const match = (view: Partial<Hokm>, mine: number | null = 0, seats = 4): MatchView => ({
    id: 'match-1',
    tableId: 'table-1',
    game: 'hokm',
    rev: 3,
    seats,
    players: Array.from({ length: seats }, (_, seat) => ({ seat, who: `p${ seat }`, timeouts: 0 })) as MatchView['players'],
    turn: 0,
    ...(mine === null ? {} : { mine }),
    startedAt: new Date(400_000).toISOString(),
    view: {
        kind: 'hokm',
        phase: 'tricks',
        hakem: 0,
        dealer: seats - 1,
        trump: 'spades',
        turn: 1,
        lead: 1,
        hand: mine === null ? [] : [40, 41],
        plays: [],
        trick: [],
        seats: Array.from({ length: seats }, (_, seat) => ({ seat, side: seats === 4 ? seat % 2 : seat, held: 5, tricks: 0, out: false })),
        points: seats === 4 ? [0, 0] : Array.from({ length: seats }, () => 0),
        target: 7,
        round: 1,
        needed: 7,
        full: 13,
        ...view
    }
});

const CARRY = 420;

const clock = () => runtime().clock as ManualClock;

const count = (cue: string) => told.heard.filter((one) => one === cue).length;

const order = (...cues: string[]) =>
{
    let from = 0;

    for (const cue of cues)
    {
        const at = told.heard.indexOf(cue, from);

        if (at === -1)
        {
            return false;
        }

        from = at + 1;
    }

    return true;
};

const TRICK = (taker: number) => [
    card(4, 1, 1),
    card(5, 2, 2),
    card(6, 3, 3),
    act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: taker })
];

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    told.heard.length = 0;
    told.felt.length = 0;
    told.games.length = 0;
});

afterEach(() =>
{
    cleanup();
    useDevice().overrideCoarse(null);
    vi.restoreAllMocks();
});

describe('what a hokm table is heard to do', () =>
{
    it('plays from the card table\'s sounds and Hokm\'s own', async () =>
    {
        await mounted(match({}));

        expect(told.games.filter((game) => game !== 'none')).toEqual(['hokm']);
    });

    it('lets every card be heard leaving and landing, then the trick gathered and squared on the pile of the side that took it, each once and in that order', async () =>
    {
        const { send } = await mounted(match({}));

        send(TRICK(2));
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 1, 1]);
        expect(told.heard.indexOf('card-slide'), 'a card was heard landing before any had left').toBeLessThan(told.heard.indexOf('card-place'));
        expect(told.heard.lastIndexOf('card-place'), 'the trick was gathered before its last card was down').toBeLessThan(told.heard.indexOf('card-gather'));
        expect(order('card-gather', 'trick'), 'the trick was squared on its pile before it was gathered').toBe(true);
        expect(told.felt).toEqual(['select']);
    });

    it('squares a trick on its pile when its cards get there, not when it is taken or while they are in the air', async () =>
    {
        const { send } = await mounted(match({}));

        send(TRICK(2));

        for (let waited = 0; waited < LONG && count('card-gather') === 0; waited += 5)
        {
            await elapse(5);
        }

        expect(count('trick'), 'the trick was squared on its pile before its cards left the felt').toBe(0);

        await elapse(TIMING.GATHER - 10);

        expect(count('trick'), 'the trick was squared on its pile while its cards were still in the air').toBe(0);

        await elapse(LONG, 5);

        expect(count('trick')).toBe(1);
    });

    it('keeps the sound of taking a trick for the side that took it', async () =>
    {
        const { send } = await mounted(match({}));

        send(TRICK(1));
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 0, 1]);
        expect(told.felt).toEqual([]);
    });

    it('gives somebody watching the cards and the gather, and none of what is said to a player', async () =>
    {
        const { send } = await mounted(match({}, null));

        send(TRICK(2));
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 0, 1]);
        expect(told.felt).toEqual([]);
    });

    it('is heard in full by somebody who asked for less motion', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const { send } = await mounted(match({}));

        send(TRICK(2));
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 1, 1]);
    });

    it('says a hand was won after its last trick is gathered, shows what it paid for a while, then shuffles and deals the next', async () =>
    {
        const { container, send } = await mounted(match({}));

        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }, { e: 'hand', side: 0, points: 1, kot: false }, { e: 'deal', hakem: 0 })
        ]);

        let shown = false;

        for (let passed = 0; passed < LONG; passed += 50)
        {
            await elapse(50, 5);
            shown = shown || container.querySelector('.hokm-banner') !== null;
        }

        expect(shown, 'no banner said what the hand paid').toBe(true);
        expect(container.querySelector('.hokm-banner'), 'the banner never left').toBeNull();
        expect(order('card-gather', 'hand-won', 'card-shuffle'), 'the hand was called, or the next one dealt, out of turn').toBe(true);
        expect(count('hand-won')).toBe(1);
        expect(told.felt).toContain('hand');
    });

    it('does not call a hand the other side won, and still shows what it paid them', async () =>
    {
        const { container, send } = await mounted(match({}));

        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 1 }, { e: 'hand', side: 1, points: 1, kot: false }, { e: 'deal', hakem: 1 })
        ]);

        let shown = false;

        for (let passed = 0; passed < LONG; passed += 50)
        {
            await elapse(50, 5);
            shown = shown || container.querySelector('.hokm-banner') !== null;
        }

        expect(shown, 'no banner said what the hand paid').toBe(true);
        expect([count('hand-won'), count('win'), count('trick')]).toEqual([0, 0, 0]);
        expect(order('card-gather', 'card-shuffle'), 'the next hand was dealt before the last trick was gathered').toBe(true);
        expect(told.felt).toEqual([]);
    });

    it('marks a hand won without the other side taking a trick with the sound of a win', async () =>
    {
        const { send } = await mounted(match({}));

        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }, { e: 'hand', side: 0, points: 2, kot: true }, { e: 'deal', hakem: 0 })
        ]);
        await elapse(LONG, 5);

        expect([count('win'), count('hand-won')]).toEqual([1, 0]);
        expect(told.felt).toContain('kot');
    });

    it('lets trump be heard when it is named, and at four the rest of the deal leaving the deck packet by packet', async () =>
    {
        const { send } = await mounted(match({ phase: 'trump', trump: undefined, turn: 0, lead: 0 }));

        send([act(4, 0, { e: 'trump', seat: 0, suit: 'spades' })]);
        await elapse(LONG, 5);

        expect(count('trump')).toBe(1);
        expect(order('trump', 'card-slide')).toBe(true);
        expect(count('card-slide'), 'the rest of the deal is five to three seats and two rounds of four to all of them').toBe(11);
    });

    it('lets trump be heard when its suit reaches the medal, not when the answer comes', async () =>
    {
        const { send } = await mounted(match({ phase: 'trump', trump: undefined, turn: 0, lead: 0 }, 1));

        send([act(4, 0, { e: 'trump', seat: 0, suit: 'spades' })]);
        await elapse(NAMING - 5);

        expect(count('trump'), 'trump was heard while its suit was still crossing the table').toBe(0);

        await elapse(10);

        expect([count('trump'), count('card-slide')], 'the deal went on before the suit had been heard').toEqual([1, 0]);
        expect(count('card-place'), 'the slap that names trump was heard with a second card laid beside it').toBe(0);
    });

    it('says no, to the ear and to the hand, when the suit a Hâkem pressed is refused', async () =>
    {
        let answer: (outcome: 'stale') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const { container } = await mounted(match({ phase: 'trump', trump: undefined, turn: 0, lead: 0 }));

        fire(container.querySelector<HTMLButtonElement>('.hokm-choose button')!, 'click');
        await elapse(NAMING + 5);

        expect([count('trump'), count('deny')], 'the suit landed on the medal unheard').toEqual([1, 0]);
        expect(told.felt).toContain('select');

        answer('stale');
        await elapse(5);

        expect(count('deny')).toBe(1);
        expect(told.felt).toContain('deny');
    });

    it('says no, to the ear and to the hand, when a card that has reached the felt is refused', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('stale');
        useDevice().overrideCoarse(false);

        const { container } = await mounted(match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }));

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');
        await elapse(2 * TIMING.FLY + 20);

        expect([count('deny'), told.felt.filter((one) => one === 'deny').length], 'a card came back from the felt without a word').toEqual([1, 1]);
    });

    it('says no when a card is refused while it is still waiting in the hand', async () =>
    {
        let answer: (outcome: 'stale') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));
        useDevice().overrideCoarse(false);

        const { container, send } = await mounted(match({ phase: 'tricks', trump: 'spades', turn: 3, lead: 1, trick: [1, 2], hand: [0, 14, 30], plays: [] }));

        send([card(4, 3, 3)], { plays: [0, 14] });
        await elapse(5);
        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');
        answer('stale');
        await elapse(LONG, 5);

        expect([count('deny'), told.felt.filter((one) => one === 'deny').length], 'a card that was refused before it left was put down without a word').toEqual([1, 1]);
    });

    it('does not say no to a card the server had taken, when the press is said to have failed', async () =>
    {
        let answer: (outcome: 'failed') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));
        useDevice().overrideCoarse(false);

        const { container, send } = await mounted(match({ phase: 'tricks', trump: 'spades', turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }));

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');
        await elapse(TIMING.FLY + 20);
        send([card(4, 0, 14)]);
        await elapse(5);
        answer('failed');
        await elapse(TIMING.FLY + 20);

        expect([count('deny'), told.felt.filter((one) => one === 'deny').length], 'a card that lies on the felt for everybody was said no to').toEqual([0, 0]);
        expect(container.querySelector('.hokm-trick[data-card="14"]')).not.toBeNull();
    });

    it('lets the two cards of a draw be heard leaving the stock, and cards put down be heard going and landing', async () =>
    {
        const drawn = await mounted(match({ phase: 'draw', turn: 1, lead: 0, stock: 20 }, 0, 2));

        drawn.send([act(4, 1, { e: 'draw', seat: 1 })]);
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place')], 'a draw is two cards leaving the stock').toEqual([2, 0]);

        cleanup();
        told.heard.length = 0;

        const put = await mounted(match({ phase: 'discard', turn: 1, lead: 0, stock: 42 }, 0, 2));

        put.send([act(4, 1, { e: 'discard', seat: 1 })]);
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place')], 'cards put down go as one packet and land once').toEqual([1, 1]);
    });

    it('lets a card the reader keeps be heard leaving at the press and not again, and the one it puts down when the server names it', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container, send } = await mounted(match({ phase: 'draw', turn: 0, lead: 0, stock: 39, offer: 12, hand: [1, 15, 27] }, 0, 2));

        fire(container.querySelector<HTMLButtonElement>('button.hokm-offer')!, 'click');

        expect([count('card-slide'), told.felt], 'the card was not heard leaving at the press').toEqual([1, ['select']]);

        send([act(4, 0, { e: 'draw', seat: 0 })], { hand: [1, 12, 15, 27], offer: undefined, glimpse: 9 });
        await elapse(LONG, 5);

        expect([count('card-slide'), count('deny')], 'the kept card was heard twice, or the one put down not at all').toEqual([2, 0]);
    });

    it('lets cards the reader puts down be heard going and landing from the press, and not again when the server says they went', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));
        useDevice().overrideCoarse(false);

        const { container, send } = await mounted(match({ phase: 'discard', turn: 0, lead: 0, discard: 2, stock: 42, hand: [3, 14, 27] }, 0, 2));

        [3, 14].forEach((card) => fire(container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!, 'click'));
        told.heard.length = 0;
        fire(container.querySelector<HTMLButtonElement>('button.hokm-stock-press')!, 'click');
        await elapse(TURN + TIMING.DEAL_FLY + 10);

        expect([count('card-slide'), count('card-place')], 'the cards went and landed unheard').toEqual([1, 1]);

        send([act(4, 0, { e: 'discard', seat: 0 })], { hand: [27], discard: undefined });
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place')], 'they were heard again when the server said so').toEqual([1, 1]);
    });

    it('says nothing for a refusal that comes after the table has had to jump', async () =>
    {
        let answer: (outcome: 'failed') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockImplementation(() => new Promise((resolve) =>
        {
            answer = resolve;
        }));
        useDevice().overrideCoarse(false);

        const jump = () =>
        {
            const looking = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

            document.dispatchEvent(new Event('visibilitychange'));
            looking.mockReturnValue('visible');
        };
        const kept = await mounted(match({ phase: 'draw', turn: 0, lead: 0, stock: 39, offer: 12, hand: [1, 15, 27] }, 0, 2));

        fire(kept.container.querySelector<HTMLButtonElement>('button.hokm-offer')!, 'click');
        jump();
        answer('failed');
        await elapse(LONG, 5);

        expect([count('deny'), kept.container.querySelector('button.hokm-offer') === null], 'a card the jump had put back was refused aloud').toEqual([0, false]);

        cleanup();

        const put = await mounted(match({ phase: 'discard', turn: 0, lead: 0, discard: 2, stock: 42, hand: [3, 14, 27] }, 0, 2));

        [3, 14].forEach((card) => fire(put.container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!, 'click'));
        fire(put.container.querySelector<HTMLButtonElement>('button.hokm-stock-press')!, 'click');
        jump();
        answer('failed');
        await elapse(LONG, 5);

        expect([count('deny'), put.container.querySelectorAll('.hokm-hand > li:not([data-dealt="false"]) .card-hold').length], 'cards the jump had given back were refused aloud, or hidden again').toEqual([0, 3]);
    });

    it('says no, to the ear and to the hand, when a card cannot be kept, passed or put down', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('failed');
        useDevice().overrideCoarse(false);

        const kept = await mounted(match({ phase: 'draw', turn: 0, lead: 0, stock: 39, offer: 12, hand: [1, 15, 27] }, 0, 2));

        fire(kept.container.querySelector<HTMLButtonElement>('button.hokm-offer')!, 'click');
        await elapse(LONG, 5);

        expect([count('deny'), told.felt.filter((one) => one === 'deny').length], 'a card that could not be kept came back without a word').toEqual([1, 1]);

        cleanup();

        const passed = await mounted(match({ phase: 'draw', turn: 0, lead: 0, stock: 39, offer: 12, hand: [1, 15, 27] }, 0, 2));

        fire(passed.container.querySelector<HTMLButtonElement>('button.hokm-stock-press')!, 'click');
        await elapse(LONG, 5);

        expect(count('deny'), 'a card that could not be passed came back without a word').toBe(2);

        cleanup();

        const put = await mounted(match({ phase: 'discard', turn: 0, lead: 0, discard: 2, stock: 42, hand: [3, 14, 27] }, 0, 2));

        [3, 14].forEach((card) => fire(put.container.querySelector<HTMLButtonElement>(`.card-hold[data-card="${ card }"]`)!, 'click'));
        fire(put.container.querySelector<HTMLButtonElement>('button.hokm-stock-press')!, 'click');
        await elapse(LONG, 5);

        expect(count('deny'), 'cards that could not be put down came back without a word').toBe(3);
    });

    it('lets the card lifted for the reader be heard, and rings them in when it has landed and not while it is in the stock', async () =>
    {
        const { send } = await mounted(match({ phase: 'discard', turn: 1, lead: 0, stock: 42, hand: [14, 40] }, 0, 2));

        send([act(4, 1, { e: 'discard', seat: 1 })], { offer: 12 });
        await elapse(TIMING.DEAL_FLY + LIFT - 10);

        expect([count('card-slide'), count('turn')], 'the reader was rung in to a card they have not been shown').toEqual([2, 0]);

        await elapse(20);

        expect([count('turn'), told.felt.filter((one) => one === 'ready').length]).toEqual([1, 1]);
    });

    it('is silent when the board has to jump to where the game is', async () =>
    {
        const { send } = await mounted(match({}));

        send([card(9, 1, 12)]);
        await elapse(LONG, 5);

        expect(told.heard).toEqual([]);
    });

    it('is silent in a tab nobody is looking at', async () =>
    {
        const { send } = await mounted(match({}));

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        send(TRICK(2));
        await elapse(LONG, 5);

        expect(told.heard).toEqual([]);
        expect(told.felt).toEqual([]);
    });

    it('lets the reader\'s own card be heard leaving at the press and landing once, whatever the server says after', async () =>
    {
        useDevice().overrideCoarse(false);
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container, send } = await mounted(match({ turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }));

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');

        expect([count('card-slide'), count('card-place')], 'the card was not heard leaving at the press').toEqual([1, 0]);

        send([card(4, 0, 14)]);
        await elapse(LONG, 5);

        expect([count('card-slide'), count('card-place')], 'the server\'s word for the same card was played as another').toEqual([1, 1]);
        expect(told.felt).toEqual(['select']);
    });

    it('chimes once when the turn comes round to the reader, and never for somebody watching', async () =>
    {
        const turned = (mine: number | null) => ({ ...match({ turn: 0, lead: 1, trick: [1, 2, 3], hand: mine === null ? [] : [40, 41], plays: mine === null ? [] : [40, 41] }, mine), rev: 6 });
        const playing = await mounted(match({}));

        playing.read(turned(0));
        await elapse(LONG, 5);

        expect(count('turn')).toBe(1);
        expect(told.felt).toEqual(['ready']);

        cleanup();
        told.heard.length = 0;
        told.felt.length = 0;

        const watching = await mounted(match({}, null));

        watching.read(turned(null));
        await elapse(LONG, 5);

        expect(count('turn')).toBe(0);
        expect(told.felt).toEqual([]);
    });

    const NEXT_HAND = (taker = 1) => [
        act(4, 3, { e: 'card', seat: 3, card: 4 }, { e: 'trick', seat: taker }, { e: 'hand', side: taker % 2, points: 1, kot: false }, { e: 'deal', hakem: 3 }),
        act(5, 3, { e: 'trump', seat: 3, suit: 'hearts' }),
        act(6, 3, { e: 'card', seat: 3, card: 30 })
    ];

    const NEW_HAND = { hand: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26], plays: [14] };

    it.each([1, 0])('rings the reader in when the table shows the turn coming round, not while it still gathers up the last hand (its last trick taken by seat %i)', async (taker) =>
    {
        const { send } = await mounted(match({ turn: 3, lead: 0, trick: [1, 2, 3], hand: [40, 41] }));

        send(NEXT_HAND(taker), NEW_HAND, {}, true);
        await elapse(TIMING.BANNER, 5);

        expect(count('turn'), 'the reader was rung in while the last hand was still on the table').toBe(0);

        for (let waited = 0; waited < LONG && count('card-slide') < 14; waited += 5)
        {
            await elapse(5);
        }

        expect([count('trump'), count('turn')], 'the reader was rung in while the card led to them was in the air').toEqual([1, 0]);

        await elapse(LONG, 5);

        expect(count('turn')).toBe(1);
        expect(told.heard.slice(-2).sort(), 'the reader was rung in somewhere but where the card led to them came down').toEqual(['card-place', 'turn']);
    });

    it('rings the reader in as the server says it on a page nobody is looking at, which shows nothing until it is seen', async () =>
    {
        const { send } = await mounted(match({ turn: 3, lead: 1, trick: [1, 2], hand: [40, 41] }));

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        send([card(4, 3, 4)], { plays: [40, 41] }, {}, true);
        await elapse(50, 5);

        expect(told.heard).toEqual(['turn']);
    });

    it('counts down the reader\'s own last seconds aloud, and nobody else\'s', async () =>
    {
        const ticks = () => count('tick') + count('tick-hi');

        await mounted({ ...match({ turn: 0, lead: 0, plays: [40, 41] }), remainingMs: 7000 });

        for (let second = 0; second < 7; second += 1)
        {
            clock().advance(1000);
        }

        expect(ticks(), 'the reader\'s last five seconds were not counted').toBe(5);

        cleanup();
        told.heard.length = 0;
        await mounted({ ...match({ turn: 1, lead: 1 }), remainingMs: 7000 });

        for (let second = 0; second < 7; second += 1)
        {
            clock().advance(1000);
        }

        expect(ticks(), 'somebody else\'s clock was counted aloud').toBe(0);
    });

    it('ends on a win for the side that won the match, and on a falling phrase for the side that lost', async () =>
    {
        const won = await mounted(match({}));

        won.send([act(4, 1, { e: 'forfeit', seat: 1 }, { e: 'finish', side: 0 })]);
        await elapse(LONG, 5);

        expect([count('win'), count('lose')]).toEqual([1, 0]);

        cleanup();
        told.heard.length = 0;

        const lost = await mounted(match({}));

        lost.send([act(4, 0, { e: 'forfeit', seat: 0 }, { e: 'finish', side: 1 })]);
        await elapse(LONG, 5);

        expect([count('win'), count('lose')]).toEqual([0, 1]);
    });

    it('ends on a neutral close for somebody watching, whichever side won, and nothing felt', async () =>
    {
        const { send } = await mounted(match({}, null));

        send([act(4, 1, { e: 'forfeit', seat: 1 }, { e: 'finish', side: 0 })]);
        await elapse(LONG, 5);

        expect(told.heard).toEqual(['draw']);
        expect(told.felt).toEqual([]);
    });

    it('hears a kot as a win only on the side that made it', async () =>
    {
        const ours = await mounted(match({}));

        ours.send([act(4, 0, { e: 'hand', side: 0, points: 2, kot: true })]);
        await elapse(LONG, 5);

        expect(count('win')).toBe(1);

        cleanup();
        told.heard.length = 0;

        const theirs = await mounted(match({}));

        theirs.send([act(4, 0, { e: 'hand', side: 1, points: 2, kot: true })]);
        await elapse(LONG, 5);

        expect([count('win'), count('hand-won')], 'the side that lost a kot heard it as a win').toEqual([0, 0]);
    });

    it('hears a kot that ends the match as a hand won, so the match is won once', async () =>
    {
        const ours = await mounted(match({}));

        ours.send([act(4, 0, { e: 'hand', side: 0, points: 2, kot: true }, { e: 'finish', side: 0 })]);
        await elapse(LONG, 5);

        expect([count('hand-won'), count('win')], 'the match was won twice').toEqual([1, 1]);
        expect(order('hand-won', 'win')).toBe(true);

        cleanup();
        told.heard.length = 0;

        const theirs = await mounted(match({}));

        theirs.send([act(4, 0, { e: 'hand', side: 1, points: 2, kot: true }, { e: 'finish', side: 1 })]);
        await elapse(LONG, 5);

        expect([count('hand-won'), count('win'), count('lose')]).toEqual([0, 0, 1]);
    });

    it('shuffles, then deals the first five to the Hâkem alone at four, and to both players at a table for two', async () =>
    {
        const four = await mounted(match({}));

        four.send([act(4, 0, { e: 'hand', side: 1, points: 1, kot: false }, { e: 'deal', hakem: 1 })]);
        await elapse(TIMING.BANNER - 1);

        expect([count('card-gather'), count('card-shuffle')], 'the last hand was gathered up while it was still being called').toEqual([0, 0]);

        await elapse(TURN + TIMING.DEAL_FLY + CARRY);

        expect([count('card-gather'), count('card-shuffle')], 'the deck was shuffled before every hand was back in it and it had been passed on').toEqual([1, 0]);

        await elapse(SHUFFLE);

        expect([count('card-shuffle'), count('card-slide')], 'a card left the dealer while the deck was still being shuffled').toEqual([1, 0]);

        await elapse(LONG, 5);

        expect([count('card-shuffle'), count('card-slide')]).toEqual([1, 1]);
        expect(order('card-shuffle', 'card-slide'), 'a card left the dealer before the deck was shuffled').toBe(true);

        cleanup();
        told.heard.length = 0;

        const two = await mounted(match({}, 0, 2));

        two.send([act(4, 0, { e: 'hand', side: 1, points: 1, kot: false }, { e: 'deal', hakem: 1 })]);
        await elapse(LONG, 5);

        expect([count('card-shuffle'), count('card-slide')]).toEqual([1, 2]);
    });

    it('keeps the chime that calls the Hâkem to name trump until the five cards are up', async () =>
    {
        const opening = {
            ...match({ phase: 'trump', trump: undefined, turn: 0, lead: 0, hand: [1, 14, 27, 40, 50], seats: [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: seat === 0 ? 5 : 0, tricks: 0, out: false })) }, 0),
            rev: 1
        };

        await mounted(opening, { seq: 1, id: 'match-1', events: [act(1, 0, { e: 'deal', hakem: 0 })], live: true, jump: false, opens: () => true });
        await elapse(SHUFFLE + TIMING.DEAL_FLY);

        expect(count('turn'), 'the Hâkem was called to choose from cards that had not been turned up').toBe(0);

        await elapse(LONG, 5);

        expect(count('turn')).toBe(1);
        expect(told.felt).toContain('ready');
    });

    it('deals nothing more when trump is named at a table for two, where the rest is drawn', async () =>
    {
        const { send } = await mounted(match({ phase: 'trump', trump: undefined, turn: 0, lead: 0, stock: 42 }, 0, 2));

        send([act(4, 0, { e: 'trump', seat: 0, suit: 'hearts' })]);
        await elapse(LONG, 5);

        expect([count('trump'), count('card-slide')]).toEqual([1, 0]);
    });

    it('deals the opening hand in front of a reader who was sent it as it happened, and not for one who came to it later', async () =>
    {
        const opening = (): MatchView => ({ ...match({ phase: 'trump', trump: undefined, turn: 0, lead: 0 }), rev: 1 });
        const dealt = [act(1, 0, { e: 'deal', hakem: 0 })];

        await mounted(opening(), { seq: 1, id: 'match-1', events: dealt, live: true, jump: false, opens: () => true });
        await elapse(LONG, 5);

        expect([count('card-shuffle'), count('card-slide')]).toEqual([1, 1]);

        cleanup();
        told.heard.length = 0;

        await mounted(opening(), { seq: 1, id: 'match-1', events: dealt, live: false, jump: false });
        await elapse(LONG, 5);

        expect(told.heard, 'a deal that was over was dealt again').toEqual([]);
    });

    it('is silent when more was missed than a felt replays, and plays a single hand that was', async () =>
    {
        const hand = (rev: number) => act(rev, 0, { e: 'hand', side: 1, points: 1, kot: false }, { e: 'deal', hakem: 1 });
        const long = await mounted(match({}));

        long.send([hand(4), hand(5), hand(6)]);
        await elapse(LONG, 5);

        expect(told.heard).toEqual([]);

        cleanup();
        told.heard.length = 0;

        const short = await mounted(match({}));

        short.send([hand(4)]);
        await elapse(LONG, 5);

        expect(count('card-shuffle')).toBe(1);
    });

    it('lets a card that hurried what was in front of it be heard after it, never before', async () =>
    {
        useDevice().overrideCoarse(false);
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container, send } = await mounted(match({ turn: 3, lead: 1, trick: [1, 2], hand: [0, 14, 30], plays: [] }));

        send([card(4, 3, 3)], { plays: [0, 14] });
        await elapse(10);
        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');

        expect([count('card-slide'), count('card-place')], 'the reader\'s card left before the card in front of it was down').toEqual([1, 0]);

        await elapse(LONG, 5);

        expect(told.heard.filter((cue) => cue.startsWith('card-'))).toEqual(['card-slide', 'card-place', 'card-slide', 'card-place']);
    });
});
