import { describe, it, expect } from 'vitest';

import { cardOf, rankOf, RANKS, type Rank, type Suit } from '../../server/src/domains/match/cards/cards.ts';
import { pokerEngine } from '../../server/src/domains/match/engines/poker.ts';
import { toCall } from '../../server/src/domains/match/poker/betting.ts';
import { evaluate } from '../../server/src/domains/match/poker/evaluator.ts';
import type { PokerAction, PokerState } from '../../server/src/domains/match/poker/state.ts';
import { coachOf, namedHand, outcomeOf } from '../src/game/helpers/poker.ts';
import type { PokerBoard } from '../src/data/match.ts';

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

type Row = PokerBoard['seats'][number];

const table = (view: Partial<PokerBoard> = {}, rows: Partial<Row>[] = []): PokerBoard => ({
    kind: 'poker',
    street: 'preflop',
    hand: 3,
    button: 1,
    board: [],
    pot: 60,
    pots: [{ amount: 60, eligible: [0, 1, 2] }],
    seats: [0, 1, 2].map((seat) => ({ seat, stack: 1400, bet: 0, folded: false, allIn: false, out: false, ...rows[seat] })),
    blinds: { small: 10, big: 20, level: 1, next: 8 },
    hole: cards('AS KD'),
    ...view
});

describe('namedHand', () =>
{
    it.each([
        ['AS AH', '', 'pair'],
        ['AS KH', '', 'high-card'],
        ['7C 2D', '', 'high-card'],
        ['AS KH', 'AD KC 2S', 'two-pair'],
        ['7C 7D', '7H 2S 9D', 'trips'],
        ['AS 2H', '3D 4C 5S', 'straight'],
        ['9C 10D', 'JH QS KD 2C', 'straight'],
        ['2H 9H', 'KH 4H JH 3C', 'flush'],
        ['7C 7D', '7H 2S 2D', 'full-house'],
        ['7C 7D', '7H 7S 2D', 'quads'],
        ['AS KS', 'QS JS 10S', 'straight-flush'],
        ['2C 3D', 'KH KS 9D 8C 7H', 'pair'],
        ['AC 2D', 'KH QS 9D 7C 4H', 'high-card']
    ])('holding %s over [%s] is %s', (hole, board, expected) =>
    {
        expect(namedHand(cards(hole), cards(board))?.category).toBe(expected);
    });

    it.each([
        ['KS KH', '', { category: 'pair', top: 11, second: null, board: false }],
        ['7C 2D', '', { category: 'high-card', top: 5, second: null, board: false }],
        ['AS KH', 'AD KC 2S', { category: 'two-pair', top: 12, second: 11, board: false }],
        ['7C 7D', '7H 2S 2D', { category: 'full-house', top: 5, second: 0, board: false }],
        ['AS 2H', '3D 4C 5S', { category: 'straight', top: 3, second: null, board: false }],
        ['2C 3D', 'KH KS 9D 8C 7H', { category: 'pair', top: 11, second: null, board: true }],
        ['KC 3D', 'KH QS 9D 8C 7H', { category: 'pair', top: 11, second: null, board: false }]
    ])('names %s over [%s] by its ranks, and says when the board is the whole hand', (hole, board, expected) =>
    {
        expect(namedHand(cards(hole), cards(board))).toEqual(expected);
    });

    it('names nothing for a reader holding no cards', () =>
    {
        expect(namedHand([], cards('AS KS QS'))).toBeNull();
    });
});

describe('outcomeOf', () =>
{
    it.each([
        ['a spectator', table({ turn: 0, toCall: 20, hole: [] }), undefined],
        ['a folded seat', table({ turn: 1 }, [{ folded: true }]), 0],
        ['a seat that is out', table({ turn: 1, hole: [] }, [{ out: true, stack: 0 }]), 0],
        ['a finished match', table({ winner: 0 }), 0]
    ])('says nothing to %s', (_, view, mine) =>
    {
        expect(outcomeOf(view, mine)).toBeNull();
    });

    it('names the hand and prices the call against the pot on the reader\'s turn', () =>
    {
        const view = table({ street: 'flop', board: cards('AD 7C 2S'), turn: 0, toCall: 40, pot: 110, minRaiseTo: 80, maxRaiseTo: 1400 });

        expect(outcomeOf(view, 0)).toMatchObject({ hand: { category: 'pair' }, call: { chips: 40, pot: 110 } });
    });

    it('prices nothing when there is nothing to call', () =>
    {
        expect(outcomeOf(table({ turn: 0, toCall: 0 }), 0)).toMatchObject({ hand: { category: 'high-card' }, call: null });
    });

    it('still names the hand while somebody else acts', () =>
    {
        const view = table({ street: 'turn', board: cards('QS JS 10S 3D'), turn: 2 });

        expect(outcomeOf(view, 0)).toMatchObject({ hand: { category: 'straight' }, call: null });
    });
});

describe('coachOf', () =>
{
    it.each([
        ['a spectator', table({ turn: 0, toCall: 0, hole: [] }), undefined, null],
        ['a folded seat', table({ turn: 0, toCall: 0 }, [{ folded: true }]), 0, null],
        ['a finished match', table({ winner: 0, turn: 0, toCall: 0 }), 0, null],
        ['somebody else\'s turn', table({ turn: 2 }), 0, null],
        ['nothing to call', table({ turn: 0, toCall: 0, minRaiseTo: 20, maxRaiseTo: 1400 }), 0, { key: 'helpers.poker.free' }],
        ['a bet to meet', table({ turn: 0, toCall: 40, minRaiseTo: 80, maxRaiseTo: 1400 }), 0, { key: 'helpers.poker.facing', params: { chips: 40 } }],
        ['a bet with no raise open', table({ turn: 0, toCall: 40 }), 0, { key: 'helpers.poker.facing.noRaise', params: { chips: 40 } }],
        ['an all-in seat', table({ turn: 2 }, [{ allIn: true, stack: 0, bet: 1500 }]), 0, { key: 'helpers.poker.allIn' }]
    ])('with %s', (_, view, mine, expected) =>
    {
        expect(coachOf(view, mine)).toEqual(expected);
    });
});

const seeded = (seed: number): { die: (sides: number) => number; next: () => number } =>
{
    let value = (seed * 2654435761) >>> 0 || 1;

    const next = (): number =>
    {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;

        return (value >>> 0) / 4294967296;
    };

    return { die: (sides) => 1 + Math.floor(next() * sides), next };
};

const boardOf = (state: PokerState, seat: number | null): PokerBoard =>
    pokerEngine.view(state, seat) as PokerBoard;

function falsehoods(state: PokerState, seat: number, draws: { die: (sides: number) => number }): string[]
{
    const view = boardOf(state, seat);
    const tip = coachOf(view, seat);
    const outcome = outcomeOf(view, seat);
    const legal = pokerEngine.legal(state, seat).map((move) => move.kind);
    const holding = !state.out[seat] && !state.folded[seat];
    const acting = pokerEngine.turnOf(state) === seat;
    const faults: string[] = [];
    const wrong = (what: string): void =>
    {
        faults.push(`seat ${ seat }: ${ what }`);
    };

    if (!holding || state.winner !== null)
    {
        if (tip !== null || outcome !== null)
        {
            wrong('spoke to a seat with no cards in play');
        }

        return faults;
    }

    const expected = state.board.length === 0
        ? (rankOf(state.holes[seat][0]) === rankOf(state.holes[seat][1]) ? 'pair' : 'high-card')
        : evaluate([...state.holes[seat], ...state.board]).category;

    if (outcome?.hand?.category !== expected)
    {
        wrong(`named ${ outcome?.hand?.category } for ${ expected }`);
    }

    const owe = acting ? toCall(state, seat) : 0;
    const priced = owe > 0 ? { chips: owe, pot: state.put.reduce((sum, chips) => sum + chips, 0) } : null;

    if (JSON.stringify(outcome?.call ?? null) !== JSON.stringify(priced))
    {
        wrong(`priced the call at ${ JSON.stringify(outcome?.call) } against ${ JSON.stringify(priced) }`);
    }

    const accepts = (action: PokerAction): boolean => pokerEngine.apply(state, action, draws).ok;

    if (tip === null)
    {
        if (acting)
        {
            wrong('said nothing on the reader\'s own turn');
        }
    }
    else if (tip.key === 'helpers.poker.allIn')
    {
        if (state.stacks[seat] !== 0 || acting)
        {
            wrong('called a seat all in that still has chips or a turn');
        }
    }
    else if (tip.key === 'helpers.poker.free')
    {
        if (!acting || owe !== 0 || !accepts({ kind: 'check', seat }))
        {
            wrong('offered a free check the server refuses');
        }
    }
    else if (tip.key === 'helpers.poker.facing' || tip.key === 'helpers.poker.facing.noRaise')
    {
        const raising = legal.includes('raise') || legal.includes('allin');

        if (!acting || owe === 0 || tip.params?.chips !== owe || !accepts({ kind: 'call', seat }) || !accepts({ kind: 'fold', seat }))
        {
            wrong(`priced staying in at ${ tip.params?.chips } against ${ owe }`);
        }

        if (raising !== (tip.key === 'helpers.poker.facing'))
        {
            wrong(`said raising is ${ tip.key === 'helpers.poker.facing' ? 'open' : 'shut' } while the server says ${ legal.join(',') }`);
        }

        if (tip.key === 'helpers.poker.facing.noRaise' && accepts({ kind: 'raise', seat, amount: state.current + state.raise }))
        {
            wrong('said raising is shut while the server takes a raise');
        }
    }
    else
    {
        wrong(`gave a tip nobody wrote: ${ tip.key }`);
    }

    return faults;
}

describe('every word against the server\'s own table', () =>
{
    it.each([2, 6, 9])('tells no seat at a %i-seat Sit & Go anything the engine disagrees with', (seats) =>
    {
        const { die, next } = seeded(seats * 31);
        const draws = { die };
        let state = pokerEngine.create(Array.from({ length: seats }, (_, seat) => seat), draws, { target: 0, cube: false, blinds: 'low' });
        const faults: string[] = [];
        const seen = new Set<string>();
        let actions = 0;

        while (pokerEngine.finish(state) === null && actions < 4000 && faults.length === 0)
        {
            for (let seat = 0; seat < seats; seat += 1)
            {
                faults.push(...falsehoods(state, seat, draws));

                const tip = coachOf(boardOf(state, seat), seat);

                if (tip !== null)
                {
                    seen.add(tip.key);
                }
            }

            if (coachOf(boardOf(state, null), undefined) !== null || outcomeOf(boardOf(state, null), undefined) !== null)
            {
                faults.push('spoke to a spectator');
            }

            const turn = pokerEngine.turnOf(state)!;
            const legal = pokerEngine.legal(state, turn);
            const passive = legal.filter((move) => move.kind === 'check' || move.kind === 'call');
            const measured = legal.filter((move) => move.kind !== 'allin');
            const roll = next();
            const pool = roll < 0.8 && passive.length > 0 ? passive : (roll < 0.97 ? measured : legal);
            const applied = pokerEngine.apply(state, pool[Math.floor(next() * pool.length)], draws);

            if (!applied.ok)
            {
                faults.push(`the engine refused a legal move: ${ applied.reason }`);
                break;
            }

            state = applied.state;
            actions += 1;
        }

        expect(faults).toEqual([]);
        expect([...seen].sort()).toEqual(['helpers.poker.allIn', 'helpers.poker.facing', 'helpers.poker.facing.noRaise', 'helpers.poker.free']);
    });
});
