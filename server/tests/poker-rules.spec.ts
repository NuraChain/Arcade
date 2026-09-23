import { describe, expect, it } from 'vitest';

import { legalMoves, apply, chipsInPlay, create, handsToNextLevel, levelOf, standings } from '../src/domains/match/poker/engine.ts';
import { evaluate } from '../src/domains/match/poker/evaluator.ts';
import { layers, leftOf, split, standing, uncalled } from '../src/domains/match/poker/pots.ts';
import { blindsAt, type PokerEvent, type PokerState } from '../src/domains/match/poker/state.ts';
import { hand, play, seated, seeded } from './poker-table.ts';

const strength = (names: string) => evaluate(hand(names));

const beats = (winner: string, loser: string): void =>
{
    expect(strength(winner).score, `${ winner } should beat ${ loser }`).toBeGreaterThan(strength(loser).score);
};

describe('the evaluator names every category', () =>
{
    it.each([
        ['AS KD 9C 7H 4S 3D 2C', 'high-card'],
        ['AS AD 9C 7H 4S 3D 2C', 'pair'],
        ['AS AD 9C 9H 4S 3D 2C', 'two-pair'],
        ['AS AD AC 9H 4S 3D 2C', 'trips'],
        ['9S 8D 7C 6H 5S 2D 2C', 'straight'],
        ['AS JS 9S 6S 3S 2D 2C', 'flush'],
        ['AS AD AC 9H 9S 3D 2C', 'full-house'],
        ['AS AD AC AH 9S 3D 2C', 'quads'],
        ['9S 8S 7S 6S 5S 2D 2C', 'straight-flush'],
        ['AS KS QS JS TS 2D 2C', 'straight-flush']
    ])('%s is %s', (cards, category) =>
    {
        expect(strength(cards).category).toBe(category);
    });

    it('ranks the categories in order', () =>
    {
        const ladder = [
            'AS KD 9C 7H 4S 3D 2C',
            'AS AD 9C 7H 4S 3D 2C',
            'AS AD 9C 9H 4S 3D 2C',
            'AS AD AC 9H 4S 3D 2C',
            '9S 8D 7C 6H 5S 2D 2C',
            'AS JS 9S 6S 3S 2D 2C',
            'AS AD AC 9H 9S 3D 2C',
            'AS AD AC AH 9S 3D 2C',
            '9S 8S 7S 6S 5S 2D 2C'
        ];

        for (let index = 1; index < ladder.length; index += 1)
        {
            beats(ladder[index], ladder[index - 1]);
        }
    });
});

describe('the wheel', () =>
{
    it('is a straight, five high, below six high', () =>
    {
        expect(strength('AS 2D 3C 4H 5S').category).toBe('straight');
        beats('2D 3C 4H 5S 6S', 'AS 2D 3C 4H 5S');
        beats('AS 2D 3C 4H 5S', 'AS AD KC QH JS');
    });

    it('is a straight flush when suited, still the lowest one', () =>
    {
        expect(strength('AS 2S 3S 4S 5S').category).toBe('straight-flush');
        beats('2S 3S 4S 5S 6S', 'AS 2S 3S 4S 5S');
        beats('AS 2S 3S 4S 5S', 'AS AD AC AH KS');
    });

    it('does not wrap round the ace', () =>
    {
        expect(strength('QS KD AC 2H 3S').category).toBe('high-card');
    });

    it('lets the ace play high as well', () =>
    {
        beats('AS KD QC JH TS', '9S KD QC JH TS');
    });
});

describe('ties and kickers', () =>
{
    it('decides a pair on its kickers', () =>
    {
        beats('AS AD KC 7H 4S 3D 2C', 'AH AC QC 7H 4S 3D 2C');
        beats('AS AD KC 8H 4S 3D 2C', 'AH AC KD 7H 4S 3D 2C');
    });

    it('compares two pair high pair first, then low pair, then kicker', () =>
    {
        beats('AS AD 2C 2H 5S', 'KS KD QC QH JS');
        beats('AS AD KC KH 2S', 'AH AC QC QH KS');
        beats('AS AD KC KH 3S', 'AH AC KD KS 2S');
    });

    it('compares a full house by its trips first', () =>
    {
        beats('KS KD KC 2H 2S', 'QS QD QC AH AS');
        beats('KS KD KC AH AS', 'KH KD KC QH QS');
    });

    it('compares quads by the kicker when the board holds them', () =>
    {
        beats('AS AD AC AH KS 2D 3C', 'AS AD AC AH QS 2D 3C');
    });

    it('compares a flush on all five cards', () =>
    {
        beats('AS KS 9S 6S 3S', 'AD KD 9D 6D 2D');
    });

    it('plays the board when the board is best', () =>
    {
        const board = 'AS KS QS JS TS';

        expect(strength(`${ board } 2D 3C`).score).toBe(strength(`${ board } 4H 5D`).score);
    });

    it('calls the same ranks in different suits an exact tie', () =>
    {
        expect(strength('AS KD 9C 7H 4S').score).toBe(strength('AD KC 9H 7S 4D').score);
    });

    it('takes the best five of seven', () =>
    {
        expect(strength('2S 3S 9S JD QS KS 4D').category).toBe('flush');
        beats('2S 3S 9S JD QS KS AS', '2S 3S 9S JD QS KS 4D');
    });
});

describe('the pots', () =>
{
    it('layers three all-ins of different sizes, conserving every chip', () =>
    {
        const pots = layers([100, 300, 500, 500], [false, false, false, false]);

        expect(pots).toEqual([
            { amount: 400, eligible: [0, 1, 2, 3] },
            { amount: 600, eligible: [1, 2, 3] },
            { amount: 400, eligible: [2, 3] }
        ]);
        expect(pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(1400);
    });

    it('keeps a folded player in the pot and out of the running', () =>
    {
        expect(layers([200, 500, 500], [true, false, false])).toEqual([{ amount: 1200, eligible: [1, 2] }]);
    });

    it('puts dead chips above every live one into the last pot', () =>
    {
        const pots = layers([500, 300, 300], [true, false, false]);

        expect(pots).toEqual([{ amount: 1100, eligible: [1, 2] }]);
    });

    it('shows one pot while bets are merely uneven, because only an all-in splits one', () =>
    {
        expect(standing([10, 20, 20, 90], [false, false, false, false], [false, false, false, false]))
            .toEqual([{ amount: 140, eligible: [0, 1, 2, 3] }]);
    });

    it('splits the pot a player shows at exactly what their all-in covers', () =>
    {
        const pots = standing([100, 300, 250], [false, false, false], [true, false, false]);

        expect(pots).toEqual([
            { amount: 300, eligible: [0, 1, 2] },
            { amount: 350, eligible: [1, 2] }
        ]);
        expect(pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(650);
    });

    it('agrees with the settlement layers once the betting is complete', () =>
    {
        const put = [100, 300, 500, 500];
        const folded = [false, false, false, false];

        expect(standing(put, folded, [true, true, false, false])).toEqual(layers(put, folded));
    });

    it('returns an uncalled bet to whoever made it, and never to somebody who folded', () =>
    {
        expect(uncalled([1000, 200], [false, false])).toEqual({ seat: 0, amount: 800 });
        expect(uncalled([500, 300, 300], [true, false, false])).toBeNull();
        expect(uncalled([300, 300], [false, false])).toBeNull();
    });

    it('gives the odd chip to the first winner left of the button', () =>
    {
        const order = leftOf(0, 3);

        expect(split(101, [0, 2], order)).toEqual(new Map([[2, 51], [0, 50]]));
        expect(split(100, [0, 2], order)).toEqual(new Map([[2, 50], [0, 50]]));
        expect(split(11, [0, 1, 2], order)).toEqual(new Map([[1, 4], [2, 4], [0, 3]]));
    });
});

function conserved(state: PokerState, total: number): void
{
    expect(chipsInPlay(state)).toBe(total);
    expect(state.stacks.every((chips) => chips >= 0)).toBe(true);
}

describe('side pots at the table', () =>
{
    it('pays three pots to three different players and conserves the chips after every action', () =>
    {
        const total = 1500 + 300 + 800 + 1500;
        const dealt = seated([1500, 300, 800, 1500], 0, ['3D 5D', 'AS AH', 'KS KH', 'QS QH'], '2C 7D 9H JS 4C');
        const die = dealt.die;
        let state = dealt.state;
        const events: PokerEvent[] = [];

        conserved(state, total);
        expect(state.turn).toBe(3);

        for (const seat of [3, 0, 1, 2])
        {
            const step = play(state, { kind: 'allin', seat }, die);

            state = step.state;
            events.push(...step.events);
            conserved(state, total);
        }

        const pots = events.filter((event) => event.e === 'pot');

        expect(pots).toEqual([
            { e: 'pot', amount: 1200, winners: [1] },
            { e: 'pot', amount: 1500, winners: [2] },
            { e: 'pot', amount: 1400, winners: [3] }
        ]);
        expect(events.filter((event) => event.e === 'board')).toHaveLength(3);
        expect(events).toContainEqual({ e: 'bust', seat: 0, place: 4, by: [3] });
        expect(state.start).toEqual([0, 1200, 1500, 1400]);
        expect(state.out).toEqual([true, false, false, false]);
    });

    it('conserves every chip through random games at every table size', () =>
    {
        for (const seats of [2, 6, 9])
        {
            for (let game = 0; game < 8; game += 1)
            {
                const die = seeded(seats * 1000 + game);
                let state = create(seats, 'low', die);
                let actions = 0;

                while (state.winner === null && actions < 20_000)
                {
                    const legal = legalMoves(state, state.turn);
                    const chosen = die.next() < 0.01
                        ? { kind: 'forfeit' as const, seat: state.turn, reason: 'timeout' as const }
                        : legal[Math.floor(die.next() * legal.length)];
                    const applied = apply(state, chosen, die);

                    expect(applied.ok).toBe(true);

                    if (!applied.ok)
                    {
                        break;
                    }

                    state = applied.state;
                    conserved(state, seats * 1500);

                    const held = [...state.holes.flat(), ...state.board];

                    expect(new Set(held).size, 'a card was dealt twice').toBe(held.length);
                    expect(state.board.length).toBe({ preflop: 0, flop: 3, turn: 4, river: 5 }[state.street]);
                    actions += 1;
                }

                expect(state.winner).not.toBeNull();
            }
        }
    });
});

describe('an all-in short of a full raise', () =>
{
    const opened = () => seated([1500, 150, 1500], 0, ['AS AH', 'KS KH', 'QS QH']);

    it('does not reopen the betting to a player who has already acted', () =>
    {
        const dealt = opened();
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'raise', seat: 0, amount: 100 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;

        expect(state.current).toBe(150);
        expect(legalMoves(state, 2)).toContainEqual({ kind: 'raise', seat: 2, amount: 230 });

        state = play(state, { kind: 'call', seat: 2 }, die).state;

        expect(state.turn).toBe(0);
        expect(legalMoves(state, 0)).toEqual([{ kind: 'fold', seat: 0 }, { kind: 'call', seat: 0 }]);
        expect(apply(state, { kind: 'raise', seat: 0, amount: 400 }, die)).toEqual({ ok: false, reason: 'cannot-raise' });
        expect(apply(state, { kind: 'allin', seat: 0 }, die)).toEqual({ ok: false, reason: 'cannot-raise' });

        state = play(state, { kind: 'call', seat: 0 }, die).state;

        expect(state.street).toBe('flop');
    });

    it('is reopened by a full raise behind it', () =>
    {
        const dealt = opened();
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'raise', seat: 0, amount: 100 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;
        state = play(state, { kind: 'raise', seat: 2, amount: 300 }, die).state;

        expect(legalMoves(state, 0)).toContainEqual({ kind: 'raise', seat: 0, amount: 450 });
    });

    it('is reopened by short all-ins that add up to a full raise since the player last acted', () =>
    {
        const dealt = seated([150, 200, 1500, 1500], 0, ['AS AH', 'KS KH', 'QS QH', 'JS JH']);
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'raise', seat: 3, amount: 100 }, die).state;
        state = play(state, { kind: 'allin', seat: 0 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;
        state = play(state, { kind: 'call', seat: 2 }, die).state;

        expect(state.turn).toBe(3);
        expect(legalMoves(state, 3)).toContainEqual({ kind: 'raise', seat: 3, amount: 280 });
    });

    it('sets the minimum raise to the last full raise, not to the short one', () =>
    {
        const dealt = opened();
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'raise', seat: 0, amount: 100 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;

        expect(apply(state, { kind: 'raise', seat: 2, amount: 229 }, die)).toEqual({ ok: false, reason: 'raise-too-small' });
        expect(apply(state, { kind: 'raise', seat: 2, amount: 230 }, die).ok).toBe(true);
    });
});

describe('heads-up', () =>
{
    it('puts the button on the small blind, first to act preflop and last after the flop', () =>
    {
        const dealt = seated([1500, 1500], 0, ['AS AH', '2C 7D'], '3S 8H 9D JC KD');
        const die = dealt.die;
        let state = dealt.state;

        expect(state.bets).toEqual([10, 20]);
        expect(state.turn).toBe(0);

        state = play(state, { kind: 'call', seat: 0 }, die).state;

        expect(state.turn).toBe(1);

        state = play(state, { kind: 'check', seat: 1 }, die).state;

        for (const street of ['flop', 'turn', 'river'])
        {
            expect(state.street).toBe(street);
            expect(state.turn, `the big blind opens the ${ street }`).toBe(1);
            state = play(state, { kind: 'check', seat: 1 }, die).state;
            expect(state.turn).toBe(0);

            if (street === 'river')
            {
                break;
            }

            state = play(state, { kind: 'check', seat: 0 }, die).state;
        }

        const last = play(state, { kind: 'check', seat: 0 }, die);

        state = last.state;

        expect(last.events).toContainEqual({ e: 'pot', amount: 40, winners: [0] });
        expect(state.hand).toBe(2);
        expect(state.button).toBe(1);
        expect(state.start).toEqual([1520, 1480]);
        expect(state.bets).toEqual([20, 10]);
        expect(state.turn).toBe(1);
    });

    it('is a different order from a full table, where the seat after the big blind opens', () =>
    {
        const dealt = seated([1500, 1500, 1500, 1500], 0, ['AS AH', 'KS KH', 'QS QH', 'JS JH'], '2C 7D 9H 3S 4C');
        const die = dealt.die;
        let state = dealt.state;

        expect(state.turn).toBe(3);

        for (const seat of [3, 0, 1])
        {
            state = play(state, { kind: 'call', seat }, die).state;
        }

        state = play(state, { kind: 'check', seat: 2 }, die).state;

        expect(state.street).toBe('flop');
        expect(state.turn).toBe(1);
    });
});

describe('the odd chip', () =>
{
    it('goes to the first winner left of the button when a pot splits unevenly', () =>
    {
        const dealt = seated([1500, 1500, 1500], 0, ['2D 3D', '4H 5H', '2H 3H'], 'AS KS QS JS TS', 'mid');
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'call', seat: 0 }, die).state;
        state = play(state, { kind: 'fold', seat: 1 }, die).state;
        state = play(state, { kind: 'check', seat: 2 }, die).state;

        const events: PokerEvent[] = [];

        for (let street = 0; street < 3; street += 1)
        {
            state = play(state, { kind: 'check', seat: 2 }, die).state;

            const step = play(state, { kind: 'check', seat: 0 }, die);

            state = step.state;
            events.push(...step.events);
        }

        expect(events).toContainEqual({ e: 'pot', amount: 125, winners: [2, 0] });
        expect(state.start).toEqual([1512, 1475, 1513]);
    });
});

describe('the blinds', () =>
{
    it('rise every ten hands through the schedule', () =>
    {
        const die = seeded(3);
        let state = create(2, 'low', die);
        const seen: [number, number, number][] = [];

        while (state.hand <= 21)
        {
            seen.push([state.hand, blindsAt(levelOf(state)).small, handsToNextLevel(state)]);
            state = play(state, { kind: 'fold', seat: state.turn }, die).state;
        }

        expect(seen.slice(0, 3)).toEqual([[1, 10, 10], [2, 10, 9], [3, 10, 8]]);
        expect(seen[9]).toEqual([10, 10, 1]);
        expect(seen[10]).toEqual([11, 15, 10]);
        expect(seen[20]).toEqual([21, 25, 10]);
    });

    it('start where the table asked', () =>
    {
        expect(create(2, 'low', seeded(1)).bets.filter((chips) => chips > 0).sort((a, b) => a - b)).toEqual([10, 20]);
        expect(create(2, 'mid', seeded(1)).bets.filter((chips) => chips > 0).sort((a, b) => a - b)).toEqual([25, 50]);
        expect(create(2, 'high', seeded(1)).bets.filter((chips) => chips > 0).sort((a, b) => a - b)).toEqual([50, 100]);
    });

    it('follow the published schedule and then double', () =>
    {
        const schedule = Array.from({ length: 16 }, (_, level) => blindsAt(level));

        expect(schedule.map((blinds) => blinds.small)).toEqual([10, 15, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1000, 2000, 4000, 8000]);
        expect(schedule.map((blinds) => blinds.big)).toEqual([20, 30, 50, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2000, 4000, 8000, 16000]);
        expect(blindsAt(500).big).toBe(1_000_000);
    });
});

describe('placements', () =>
{
    it('follow elimination order', () =>
    {
        const later = hand('2D KS 3C KH AD 9C 8H 6D JH');
        const dealt = seated([1500, 100, 1500], 0, ['7C 7D', '2C 3D', 'AS AH'], 'KD QC 9S 5H 4S', 'low', later);
        const die = dealt.die;
        let state = dealt.state;

        state = play(state, { kind: 'call', seat: 0 }, die).state;
        state = play(state, { kind: 'allin', seat: 1 }, die).state;
        state = play(state, { kind: 'call', seat: 2 }, die).state;
        state = play(state, { kind: 'call', seat: 0 }, die).state;

        for (let street = 0; street < 3; street += 1)
        {
            state = play(state, { kind: 'check', seat: 2 }, die).state;
            state = play(state, { kind: 'check', seat: 0 }, die).state;
        }

        expect(state.out).toEqual([false, true, false]);
        expect(state.places[1]).toBe(3);
        expect(state.button).toBe(2);
        expect(state.turn).toBe(2);

        state = play(state, { kind: 'allin', seat: 2 }, die).state;
        state = play(state, { kind: 'allin', seat: 0 }, die).state;

        expect(state.winner).toBe(2);
        expect(standings(state)).toEqual([{ seat: 0, place: 2 }, { seat: 1, place: 3 }, { seat: 2, place: 1 }]);
    });

    it('place two players busted in the same hand by the stack they started it with', () =>
    {
        const dealt = seated([1000, 400, 600], 0, ['AS AH', 'KS KH', 'QS QH'], '2C 7D 9H JS 4C');
        const die = dealt.die;
        let state = dealt.state;

        for (const seat of [0, 1, 2])
        {
            state = play(state, { kind: 'allin', seat }, die).state;
        }

        expect(state.winner).toBe(0);
        expect(standings(state)).toEqual([{ seat: 0, place: 1 }, { seat: 1, place: 3 }, { seat: 2, place: 2 }]);
    });

    it('share a place on an exact tie', () =>
    {
        const dealt = seated([1000, 500, 500], 0, ['AS AH', 'KS KH', 'QS QH'], '2C 7D 9H JS 4C');
        const die = dealt.die;
        let state = dealt.state;

        for (const seat of [0, 1, 2])
        {
            state = play(state, { kind: 'allin', seat }, die).state;
        }

        expect(standings(state)).toEqual([{ seat: 0, place: 1 }, { seat: 1, place: 2 }, { seat: 2, place: 2 }]);
    });
});
