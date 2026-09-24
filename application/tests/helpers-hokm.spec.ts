import { describe, it, expect } from 'vitest';

import { cardOf, RANKS, suitOf, type Rank, type Suit } from '../../server/src/domains/match/cards/cards.ts';
import { apply, create, legalMoves } from '../../server/src/domains/match/hokm/engine.ts';
import type { HokmEvent, HokmState } from '../../server/src/domains/match/hokm/state.ts';
import { coachOf, outcomeOf } from '../src/game/helpers/hokm.ts';
import type { HokmBoard } from '../src/data/match.ts';

const SUIT_OF: Record<string, Suit> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

const card = (name: string): number =>
{
    const rank = name.slice(0, -1) as Rank;

    if (!RANKS.includes(rank))
    {
        throw new Error(`no such rank in ${ name }`);
    }

    return cardOf(SUIT_OF[name.slice(-1)], rank);
};

const cards = (names: string): number[] => (names === '' ? [] : names.split(' ').map(card));

type Seen = Parameters<typeof coachOf>[0];

const seen = (view: Partial<Seen> = {}): Seen => ({
    phase: 'tricks',
    hakem: 0,
    turn: 1,
    trump: 'spades',
    hand: cards('AH 2C'),
    trick: [],
    ...view
});

function seeded(seed: number): (sides: number) => number
{
    let value = seed;

    return (sides: number) =>
    {
        value = (value * 1103515245 + 12345) & 0x7fffffff;

        return 1 + Math.floor(value / 0x80000000 * sides);
    };
}

describe('outcomeOf', () =>
{
    it.each([
        ['', 'QH', 'helpers.hokm.lead'],
        ['', '2S', 'helpers.hokm.lead.trump'],
        ['10H', 'QH', 'helpers.hokm.ahead'],
        ['10H', '9H', 'helpers.hokm.loses'],
        ['10H', 'AC', 'helpers.hokm.loses'],
        ['10H', '2S', 'helpers.hokm.ahead.trump'],
        ['10H 3S', 'AH', 'helpers.hokm.loses'],
        ['10H 3S', '4S', 'helpers.hokm.ahead.trump'],
        ['10H 3S', '2S', 'helpers.hokm.loses.trump'],
        ['5S', '4S', 'helpers.hokm.loses.trump'],
        ['5S', 'AS', 'helpers.hokm.ahead.trump'],
        ['10H 3C JH', 'KH', 'helpers.hokm.wins'],
        ['10H 3C JH', '2S', 'helpers.hokm.wins.trump'],
        ['10H 3C JH', '9H', 'helpers.hokm.loses'],
        ['10H QS JH', 'KS', 'helpers.hokm.wins.trump']
    ])('on %s under spades, the %s says %s', (trick, played, key) =>
    {
        expect(outcomeOf(card(played), { trick: cards(trick), trump: 'spades' }, 4)?.key).toBe(key);
    });

    it('calls the second card of a two-handed trick the last one', () =>
    {
        expect(outcomeOf(card('QH'), { trick: cards('10H'), trump: 'spades' }, 2)?.key).toBe('helpers.hokm.wins');
        expect(outcomeOf(card('QH'), { trick: cards('10H 3C'), trump: 'spades' }, 3)?.key).toBe('helpers.hokm.wins');
        expect(outcomeOf(card('QH'), { trick: cards('10H'), trump: 'spades' }, 3)?.key).toBe('helpers.hokm.ahead');
    });

    it('says nothing before trump is named', () =>
    {
        expect(outcomeOf(card('QH'), { trick: [], trump: undefined }, 4)).toBeNull();
    });
});

describe('coachOf', () =>
{
    it.each([
        ['AH KH 2H 9C 3D', 'helpers.hokm.tip.name.hearts'],
        ['AS KS QS 9C 3D', 'helpers.hokm.tip.name.spades'],
        ['4C 5C 6C 9D 3H', 'helpers.hokm.tip.name.clubs'],
        ['4D 5D 6D 9D 3H', 'helpers.hokm.tip.name.diamonds'],
        ['4C 5C 9D 3H 7S', 'helpers.hokm.tip.name.clubs'],
        ['AH KH 2S 9S 3D', 'helpers.hokm.tip.name'],
        ['', 'helpers.hokm.tip.name']
    ])('tells the hakem holding %s: %s', (hand, key) =>
    {
        expect(coachOf(seen({ phase: 'trump', hakem: 1, trump: undefined, hand: cards(hand) }), 1)?.key).toBe(key);
    });

    it('tells everybody else what the pause in the deal is', () =>
    {
        expect(coachOf(seen({ phase: 'trump', hakem: 0, trump: undefined, hand: [] }), 2)?.key).toBe('helpers.hokm.tip.wait');
    });

    it.each([
        ['', 'AH 2C 3D', 'helpers.hokm.tip.lead'],
        ['10H', 'AH 2C 3D', 'hokm.follow'],
        ['10H', 'AH 2H', null],
        ['10H', '2C 3D 4S', 'helpers.hokm.tip.trump'],
        ['10H', '2C 3D', 'helpers.hokm.tip.discard'],
        ['10S', '2S 3D', 'hokm.follow'],
        ['10S', '2C 3D', 'helpers.hokm.tip.discard']
    ])('on %s holding %s says %s', (trick, hand, key) =>
    {
        expect(coachOf(seen({ trick: cards(trick), hand: cards(hand) }), 1)?.key ?? null).toBe(key);
    });

    it('says nothing while it is somebody else\'s turn', () =>
    {
        expect(coachOf(seen({ turn: 2, trick: cards('10H') }), 1)).toBeNull();
    });

    it('says nothing at all to somebody watching', () =>
    {
        expect(coachOf(seen({ phase: 'trump' }), undefined)).toBeNull();
        expect(coachOf(seen(), undefined)).toBeNull();
    });
});

describe('against the engine', () =>
{
    const viewOf = (state: HokmState): Pick<HokmBoard, 'trick' | 'trump'> => ({ trick: state.trick, trump: state.trump ?? undefined });

    it.each([2, 3, 4])('agrees with who really took every trick of whole hands at %i players', (seats) =>
    {
        let checked = 0;

        for (let match = 0; match < 6; match += 1)
        {
            const deal = seeded(match * 7919 + seats);
            const pick = seeded(match * 104_729 + seats);

            let state = create(seats, 7, deal);
            let losers: number[] = [];

            for (let step = 0; step < 400 && state.winner === null; step += 1)
            {
                const seat = state.phase === 'trump' ? state.hakem : state.turn;
                const moves = legalMoves(state, seat);
                const move = moves[pick(moves.length) - 1];

                if (move.kind === 'card')
                {
                    const says = outcomeOf(move.card, viewOf(state), seats)!.key;
                    const trump = suitOf(move.card) === state.trump;
                    const last = state.trick.length === seats - 1;

                    expect(says.endsWith('.trump')).toBe(trump);

                    if (says.startsWith('helpers.hokm.loses'))
                    {
                        losers = [...losers, seat];
                    }

                    const coached = coachOf({ phase: state.phase, hakem: state.hakem, turn: state.turn, trump: state.trump ?? undefined, hand: state.hands[seat], trick: state.trick }, seat);

                    expect(coached?.key === 'hokm.follow').toBe(moves.length < state.hands[seat].length);

                    if (coached?.key === 'helpers.hokm.tip.discard')
                    {
                        losers = [...losers, seat];
                    }

                    const outcome = apply(state, move, deal);

                    expect(outcome.ok).toBe(true);

                    if (!outcome.ok)
                    {
                        return;
                    }

                    const took = outcome.events.find((event): event is Extract<HokmEvent, { e: 'trick' }> => event.e === 'trick');

                    if (last)
                    {
                        expect(took).toBeDefined();
                        expect(took!.seat === seat).toBe(says.startsWith('helpers.hokm.wins'));
                        expect(losers).not.toContain(took!.seat);
                        losers = [];
                        checked += 1;
                    }

                    state = outcome.state;
                    continue;
                }

                const outcome = apply(state, move, deal);

                expect(outcome.ok).toBe(true);
                state = outcome.ok ? outcome.state : state;
            }
        }

        expect(checked).toBeGreaterThan(50);
    });
});
