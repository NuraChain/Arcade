import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import HokmBoard from '../src/components/games/hokm-board.component.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS, useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';

const told = vi.hoisted(() => ({ heard: [] as string[], felt: [] as string[] }));

vi.mock('../src/game/sound.ts', async (original) =>
{
    const real = await original<typeof import('../src/game/sound.ts')>();

    return {
        ...real,
        createSound: () => ({
            play: (cue: string) =>
            {
                told.heard.push(cue);
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
            told.felt.push(kind);

            return true;
        }
    };
});

type Rendered = HTMLElement;

type Hokm = Extract<MatchView['view'], { kind: 'hokm' }>;

type Move = Extract<MatchEvent['log'], { kind: 'hokm' }>['moves'][number];

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

const act = (rev: number, seat: number, ...moves: Move[]): MatchEvent => ({ rev, seat, at: '', log: { kind: 'hokm', moves } });

const card = (rev: number, seat: number, at: number) => act(rev, seat, { e: 'card', seat, card: at });

const clock = () => runtime().clock as ManualClock;

const drive = (): ((events: MatchEvent[]) => void) =>
{
    const [batch, setBatch] = createSignal<EventBatch>({ ...NO_EVENTS, seq: 0, events: [] });

    vi.spyOn(useBoard(), 'events').mockImplementation(batch);

    return (events) => setBatch((held) => ({ ...NO_EVENTS, seq: held.seq + 1, events }));
};

const settle = async () =>
{
    for (let turn = 0; turn < 6; turn += 1)
    {
        await Promise.resolve();
    }
};

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
});

afterEach(() =>
{
    cleanup();
    useDevice().overrideCoarse(null);
    vi.restoreAllMocks();
});

describe('what a hokm table is heard to do', () =>
{
    it('lets every card be heard leaving and landing, then the trick taken and gathered, each once and in that order', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        send(TRICK(2));
        clock().advance(LONG);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 1, 1]);
        expect(told.heard.indexOf('card-slide'), 'a card was heard landing before any had left').toBeLessThan(told.heard.indexOf('card-place'));
        expect(told.heard.lastIndexOf('card-place'), 'the trick was taken before its last card was down').toBeLessThan(told.heard.indexOf('trick'));
        expect(order('trick', 'card-gather'), 'the trick was gathered before it was taken').toBe(true);
        expect(told.felt).toEqual(['select']);
    });

    it('keeps the sound of taking a trick for the side that took it', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        send(TRICK(1));
        clock().advance(LONG);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 0, 1]);
        expect(told.felt).toEqual([]);
    });

    it('gives somebody watching the cards and the gather, and none of what is said to a player', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({}, null) }) as Rendered);
        await settle();
        send(TRICK(2));
        clock().advance(LONG);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 0, 1]);
        expect(told.felt).toEqual([]);
    });

    it('is heard in full by somebody who asked for less motion', async () =>
    {
        const send = drive();

        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);
        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        send(TRICK(2));
        clock().advance(LONG);

        expect([count('card-slide'), count('card-place'), count('trick'), count('card-gather')]).toEqual([4, 4, 1, 1]);
    });

    it('says a hand was won after its last trick is gathered, shows what it paid for a while, then shuffles and deals the next', async () =>
    {
        const send = drive();
        const { container } = renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();

        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }, { e: 'hand', side: 0, points: 1, kot: false }, { e: 'deal', hakem: 0 })
        ]);

        let shown = false;

        for (let passed = 0; passed < LONG; passed += 50)
        {
            clock().advance(50);
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
        const send = drive();
        const { container } = renderTest(() => HokmBoard({ match: match({}) }) as Rendered);

        await settle();
        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 1 }, { e: 'hand', side: 1, points: 1, kot: false }, { e: 'deal', hakem: 1 })
        ]);

        let shown = false;

        for (let passed = 0; passed < LONG; passed += 50)
        {
            clock().advance(50);
            shown = shown || container.querySelector('.hokm-banner') !== null;
        }

        expect(shown, 'no banner said what the hand paid').toBe(true);
        expect([count('hand-won'), count('win'), count('trick')]).toEqual([0, 0, 0]);
        expect(order('card-gather', 'card-shuffle'), 'the next hand was dealt before the last trick was gathered').toBe(true);
        expect(told.felt).toEqual([]);
    });

    it('marks a hand won without the other side taking a trick with the sound of a win', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        send([
            card(4, 1, 1),
            card(5, 2, 2),
            card(6, 3, 3),
            act(7, 0, { e: 'card', seat: 0, card: 4 }, { e: 'trick', seat: 2 }, { e: 'hand', side: 0, points: 2, kot: true }, { e: 'deal', hakem: 0 })
        ]);
        clock().advance(LONG);

        expect([count('win'), count('hand-won')]).toEqual([1, 0]);
        expect(told.felt).toContain('kot');
    });

    it('lets trump be heard when it is named, and at four the rest of the deal going round to every seat', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({ phase: 'trump', trump: undefined, turn: 0, lead: 0 }) }) as Rendered);
        await settle();
        send([act(4, 0, { e: 'trump', seat: 0, suit: 'spades' })]);
        clock().advance(LONG);

        expect(count('trump')).toBe(1);
        expect(order('trump', 'card-slide')).toBe(true);
        expect(count('card-slide'), 'the rest of the deal did not go round to all four').toBe(4);
    });

    it('lets a card drawn from the stock and a card put down be heard at a table for two', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({ phase: 'draw', turn: 1, lead: 0, stock: 20 }, 0, 2) }) as Rendered);
        await settle();
        send([act(4, 1, { e: 'draw', seat: 1 }), act(5, 0, { e: 'discard', seat: 0 })]);
        clock().advance(LONG);

        expect([count('card-slide'), count('card-place')]).toEqual([1, 1]);
    });

    it('is silent when the board has to jump to where the game is', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        send([card(9, 1, 12)]);
        clock().advance(LONG);

        expect(told.heard).toEqual([]);
    });

    it('is silent in a tab nobody is looking at', async () =>
    {
        const send = drive();

        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        send(TRICK(2));
        clock().advance(LONG);

        expect(told.heard).toEqual([]);
        expect(told.felt).toEqual([]);
    });

    it('lets the reader\'s own card be heard leaving at the press and landing once, whatever the server says after', async () =>
    {
        const send = drive();
        const [current, setCurrent] = createSignal(match({ turn: 0, lead: 0, hand: [0, 14, 30], plays: [0, 14] }));

        useDevice().overrideCoarse(false);
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container } = renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);

        await settle();
        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="14"]')!, 'click');

        expect([count('card-slide'), count('card-place')], 'the card was not heard leaving at the press').toEqual([1, 0]);

        setCurrent({ ...match({ turn: 1, lead: 0, trick: [14], hand: [0, 30], plays: [] }), rev: 4 });
        send([card(4, 0, 14)]);
        clock().advance(LONG);

        expect([count('card-slide'), count('card-place')], 'the server\'s word for the same card was played as another').toEqual([1, 1]);
        expect(told.felt).toEqual(['select']);
    });

    it('chimes once when the turn comes round to the reader, and never for somebody watching', async () =>
    {
        const turned = (mine: number | null) => ({ ...match({ turn: 0, lead: 1, trick: [1, 2, 3], hand: mine === null ? [] : [40, 41], plays: mine === null ? [] : [40, 41] }, mine), rev: 6 });
        const [current, setCurrent] = createSignal(match({}));

        drive();
        renderTest(() => HokmBoard({ get match()
        {
            return current();
        } }) as Rendered);
        await settle();
        setCurrent(turned(0));
        clock().advance(LONG);

        expect(count('turn')).toBe(1);
        expect(told.felt).toEqual(['ready']);

        cleanup();
        told.heard.length = 0;
        told.felt.length = 0;

        const [watched, setWatched] = createSignal(match({}, null));

        drive();
        renderTest(() => HokmBoard({ get match()
        {
            return watched();
        } }) as Rendered);
        await settle();
        setWatched(turned(null));
        clock().advance(LONG);

        expect(count('turn')).toBe(0);
        expect(told.felt).toEqual([]);
    });

    it('ends on the sound of a win for the side that won the match, and on nothing for the side that lost', async () =>
    {
        const won = drive();

        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        won([act(4, 1, { e: 'forfeit', seat: 1 }, { e: 'finish', side: 0 })]);
        clock().advance(LONG);

        expect(count('win')).toBe(1);

        cleanup();
        told.heard.length = 0;

        const lost = drive();

        renderTest(() => HokmBoard({ match: match({}) }) as Rendered);
        await settle();
        lost([act(4, 0, { e: 'forfeit', seat: 0 }, { e: 'finish', side: 1 })]);
        clock().advance(LONG);

        expect(count('win')).toBe(0);
    });
});
