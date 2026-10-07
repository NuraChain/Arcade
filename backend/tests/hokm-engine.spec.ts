import { describe, expect, it } from 'vitest';

import { cardOf, rankOf, suitOf } from '../src/domains/match/cards/cards.ts';
import { autoCard, deckFor, putAway, worthKeeping } from '../src/domains/match/hokm/cards.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { SEATS, apply, autoplay, create, dealerSeat, legalMoves } from '../src/domains/match/hokm/engine.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { trickCount } from '../src/domains/match/hokm/scoring.ts';
import { sideCount, sideOf, type HokmAction, type HokmEvent, type HokmState } from '../src/domains/match/hokm/state.ts';

/**
 * The state machine, exercised the way `ludo-purity.spec.ts` exercises ludo's: thousands of real
 * turns under a seeded shuffle, with every invariant checked after EVERY action rather than at the
 * end. Random play is the only thing that visits the states nobody thought to write down - a hand
 * ending on the seventh trick with six cards still held, a kot, a 7-7-3, a Hâkem who keeps the rank
 * five hands running.
 *
 * The deal pause has its own test at the top, because it is the one thing here that is a security
 * property rather than a rule: during `trump` there is no hand in the state but the Hâkem's, so
 * there is nothing for a careless projection to leak.
 */

function seeded(seed: number): (sides: number) => number
{
    let value = seed;

    return (sides: number) =>
    {
        value |= 0;
        value = (value + 0x6d2b79f5) | 0;
        let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return 1 + Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * sides);
    };
}

function wrong(state: HokmState): string | null
{
    const offered = state.offer === null ? [] : [state.offer];
    const glimpsed = state.glimpse.filter((card): card is number => card !== null);
    const seen = state.hands.flat().concat(state.trick, state.stock, offered, glimpsed);

    if (new Set(seen).size !== seen.length)
    {
        return 'a card is in two places at once';
    }

    if ((state.offer !== null) !== (state.phase === 'draw'))
    {
        return `an offer of ${ state.offer } during ${ state.phase }`;
    }

    const opening = state.phase === 'tricks' && state.trick.length === 0 && state.tricks.every((count) => count === 0);

    if (state.phase !== 'draw' && !opening && glimpsed.length > 0)
    {
        return `a glimpse during ${ state.phase }`;
    }

    if (state.stock.length > 0 && (state.seats !== 2 || state.phase === 'tricks'))
    {
        return `a stock of ${ state.stock.length } at ${ state.seats } players during ${ state.phase }`;
    }

    if (state.phase === 'draw')
    {
        const held = state.hands.flat().length;
        const draws = held - 5;
        const putDown = deckFor(2).length - held - state.stock.length - 1;

        if (putDown !== 5 + draws)
        {
            return `${ putDown } cards face down after ${ draws } draws`;
        }
    }

    for (const card of seen)
    {
        if (!deckFor(state.seats).includes(card))
        {
            return `card ${ card } is not in this deck`;
        }
    }

    if (state.trick.length >= state.seats)
    {
        return `a trick of ${ state.trick.length } was left on the table`;
    }

    if (state.phase === 'trump')
    {
        const dealt = state.hands.map((hand) => hand.length);

        if (dealt.some((size, seat) => (seat === state.hakem || state.seats === 2 ? size !== 5 : size !== 0)))
        {
            return `the pause dealt ${ dealt.join('/') }`;
        }
    }

    if (state.phase === 'tricks' && state.trump === null)
    {
        return 'playing with no trump';
    }

    if (state.tricks.reduce((total, count) => total + count, 0) > trickCount(state.seats))
    {
        return 'more tricks than the hand holds';
    }

    if (state.points.some((total) => total < 0))
    {
        return 'a negative score';
    }

    return null;
}

describe('the deal pauses before trump is named', () =>
{
    /**
     * *"the deal must be paused during the first round, and no cards given to Hâkem's partner until
     * Hâkem has declared the trump suit."* Dealing only the Hâkem is stronger than the letter of
     * that and simpler: there is no partner hand to withhold because there is no partner hand.
     */
    it('gives the Hâkem five cards and everybody else none, at three and four players', () =>
    {
        for (const seats of [3, 4])
        {
            const state = create(seats, 7, seeded(seats)).state;

            expect(state.phase, `${ seats } players`).toBe('trump');
            expect(state.hands[state.hakem], `${ seats } players`).toHaveLength(5);

            for (let seat = 0; seat < seats; seat += 1)
            {
                if (seat !== state.hakem)
                {
                    expect(state.hands[seat], `${ seats } players, seat ${ seat }`).toEqual([]);
                }
            }
        }
    });

    it('deals five to each of two players and leaves the other forty-two in the stock', () =>
    {
        const state = create(2, 7, seeded(2)).state;

        expect(state.phase).toBe('trump');
        expect(state.hands.map((hand) => hand.length)).toEqual([5, 5]);
        expect(state.stock).toHaveLength(42);
        expect(state.offer).toBeNull();
        expect(new Set([...state.hands.flat(), ...state.stock]).size).toBe(52);
    });

    it('offers the trump call to the Hâkem and to nobody else', () =>
    {
        const state = create(4, 7, seeded(9)).state;

        expect(legalMoves(state, state.hakem)).toHaveLength(4);

        for (let seat = 0; seat < 4; seat += 1)
        {
            if (seat !== state.hakem)
            {
                expect(legalMoves(state, seat), `seat ${ seat }`).toEqual([]);
            }
        }
    });

    it('fills every hand once trump is named, and only then', () =>
    {
        const opened = create(4, 7, seeded(3)).state;
        const called = apply(opened, { kind: 'trump', seat: opened.hakem, suit: 'hearts' }, seeded(4));

        expect(called.ok).toBe(true);

        if (!called.ok)
        {
            return;
        }

        expect(called.state.phase).toBe('tricks');
        expect(called.state.trump).toBe('hearts');
        expect(called.state.hands.map((hand) => hand.length)).toEqual([13, 13, 13, 13]);
        expect(called.state.turn).toBe(opened.hakem);
    });

    it('seats the dealer to the Hâkem left', () =>
    {
        const state = create(4, 7, seeded(11)).state;

        expect(dealerSeat(state)).toBe((state.hakem + 3) % 4);
    });
});

describe('a hokm match always ends', () =>
{
    for (const seats of SEATS)
    {
        it(`plays ${ seats } to a winner, over and over, without ever going wrong`, () =>
        {
            const faults: string[] = [];
            let longest = 0;

            for (let match = 0; match < 12; match += 1)
            {
                const deal = seeded(match * 7919 + seats);

                let state = create(seats, 7, deal).state;
                let actions = 0;

                while (state.winner === null && actions < 20000)
                {
                    const seat = state.phase === 'trump' ? state.hakem : state.turn;
                    const move = autoplay(state, seat, deal);

                    if (move === null)
                    {
                        faults.push(`match ${ match }: nothing to play at action ${ actions }`);
                        break;
                    }

                    const before = state.rev;
                    const outcome = apply(state, move, deal);

                    if (!outcome.ok)
                    {
                        faults.push(`match ${ match } action ${ actions }: ${ outcome.reason }`);
                        break;
                    }

                    state = outcome.state;

                    if (state.rev !== before + 1)
                    {
                        faults.push(`match ${ match }: revision went ${ before } -> ${ state.rev }`);
                        break;
                    }

                    const fault = wrong(state);

                    if (fault !== null)
                    {
                        faults.push(`match ${ match } action ${ actions }: ${ fault }`);
                        break;
                    }

                    actions += 1;
                }

                longest = Math.max(longest, actions);

                if (state.winner === null)
                {
                    faults.push(`match ${ match } never ended, after ${ actions } actions`);
                }
                else if (state.points[state.winner] < 7)
                {
                    faults.push(`match ${ match } was won on ${ state.points[state.winner] } points`);
                }
            }

            expect(faults).toEqual([]);
            expect(longest).toBeGreaterThan(100);
        }, 30_000);
    }
});

describe('what the sweep plays for an absent seat', () =>
{
    for (const seats of SEATS)
    {
        it(`plays autoCard's choice from the legal moves at ${ seats } players, over whole matches`, () =>
        {
            const faults: string[] = [];

            for (let match = 0; match < 20; match += 1)
            {
                const deal = seeded(match * 104729 + seats * 31);

                let state = create(seats, 7, deal).state;

                for (let action = 0; state.winner === null && action < 20000; action += 1)
                {
                    const seat = hokmEngine.turnOf(state)!;
                    const move = autoplay(state, seat, deal);
                    const legal = legalMoves(state, seat);

                    if (move === null || !legal.some((one) => JSON.stringify(one) === JSON.stringify(move)))
                    {
                        faults.push(`match ${ match } action ${ action }: ${ JSON.stringify(move) } is not legal`);
                        break;
                    }

                    if (move.kind === 'card' && move.card !== autoCard(state.hands[seat], state.trick, state.trump!))
                    {
                        faults.push(`match ${ match } action ${ action }: played ${ move.card }, not autoCard's choice`);
                        break;
                    }

                    const due = seat === state.hakem ? 3 : 2;

                    if (move.kind === 'discard' && JSON.stringify(move.cards) !== JSON.stringify(putAway(state.hands[seat], due, state.trump!)))
                    {
                        faults.push(`match ${ match } action ${ action }: put ${ move.cards.join(',') } down, not putAway's choice`);
                        break;
                    }

                    const drawn = worthKeeping(state.offer ?? 0, state.trump ?? 'clubs') ? 'keep' : 'reject';

                    if ((move.kind === 'keep' || move.kind === 'reject') && move.kind !== drawn)
                    {
                        faults.push(`match ${ match } action ${ action }: chose ${ move.kind } over ${ drawn }`);
                        break;
                    }

                    const step = apply(state, move, deal);

                    if (!step.ok)
                    {
                        faults.push(`match ${ match } action ${ action }: ${ step.reason }`);
                        break;
                    }

                    state = step.state;
                }
            }

            expect(faults).toEqual([]);
        }, 30_000);
    }

    it('leads low from a long plain suit rather than the lowest card in suit order', () =>
    {
        const state: HokmState = {
            ...create(4, 7, seeded(5)).state,
            phase: 'tricks',
            trump: 'hearts',
            hakem: 0,
            turn: 0,
            lead: 0,
            trick: [],
            hands: [
                [cardOf('clubs', '2'), cardOf('diamonds', '5'), cardOf('diamonds', '9'), cardOf('diamonds', '4'), cardOf('hearts', 'A')],
                [cardOf('spades', '2')],
                [cardOf('spades', '3')],
                [cardOf('spades', '4')]
            ]
        };

        expect(autoplay(state, 0, seeded(1))).toEqual({ kind: 'card', seat: 0, card: cardOf('diamonds', '4') });
    });

    it('keeps its trumps when void and holding a plain card', () =>
    {
        const state: HokmState = {
            ...create(4, 7, seeded(5)).state,
            phase: 'tricks',
            trump: 'clubs',
            hakem: 0,
            turn: 1,
            lead: 0,
            trick: [cardOf('hearts', '5')],
            hands: [
                [cardOf('spades', '2')],
                [cardOf('clubs', '2'), cardOf('diamonds', '9'), cardOf('spades', '4')],
                [cardOf('spades', '3')],
                [cardOf('spades', '5')]
            ]
        };

        expect(autoplay(state, 1, seeded(1))).toEqual({ kind: 'card', seat: 1, card: cardOf('spades', '4') });
    });
});

describe('a trick is taken by the rules', () =>
{
    /**
     * Played out rather than asserted over a fixture: the seat that took the trick has to be the
     * seat that PLAYED the winning card, and an off-by-one against the leader is the mistake that
     * makes every score wrong while every hand stays legal.
     */
    it('credits the seat that played the winning card', () =>
    {
        const deal = seeded(21);

        let state = create(4, 7, deal).state;

        const called = apply(state, { kind: 'trump', seat: state.hakem, suit: 'spades' }, deal);

        expect(called.ok).toBe(true);

        if (!called.ok)
        {
            return;
        }

        state = called.state;

        const cards: number[] = [];
        const seatsPlayed: number[] = [];

        for (let step = 0; step < 4; step += 1)
        {
            const seat = state.turn;
            const move = autoplay(state, seat, deal);
            const outcome = apply(state, move!, deal);

            expect(outcome.ok).toBe(true);

            if (!outcome.ok)
            {
                return;
            }

            cards.push((move as { card: number }).card);
            seatsPlayed.push(seat);
            state = outcome.state;
        }

        const led = suitOf(cards[0]);

        const best = cards.reduce((top, card, index) =>
        {
            const beats = suitOf(card) === 'spades'
                ? (suitOf(cards[top]) !== 'spades' || rankOf(card) > rankOf(cards[top]))
                : (suitOf(cards[top]) !== 'spades' && suitOf(card) === led && rankOf(card) > rankOf(cards[top]));

            return beats ? index : top;
        }, 0);

        expect(state.tricks[seatsPlayed[best]]).toBe(1);
        expect(state.tricks.reduce((total, count) => total + count, 0)).toBe(1);
        expect(state.lead).toBe(seatsPlayed[best]);

        expect(state.took).not.toBeNull();
        expect(state.took!.cards).toEqual(cards);
        expect(state.took!.lead).toBe(seatsPlayed[0]);
        expect(state.took!.seat).toBe(seatsPlayed[best]);
    });

    /**
     * The gathered trick is the one thing on this table that exists for a moment and then does not,
     * and the fourth card resolves it in the same response - so without it everybody who did not
     * take the trick watches their own card leave and never learns what beat it. It has to name the
     * seat that LED as well as the seat that took, because a list of cards nobody owns is a pile.
     */
    it('leaves the gathered trick face up until the next card is led, then replaces it', () =>
    {
        const deal = seeded(64);

        let state = create(4, 7, deal).state;

        expect(state.took).toBeNull();

        const called = apply(state, { kind: 'trump', seat: state.hakem, suit: 'hearts' }, deal);

        expect(called.ok).toBe(true);

        if (!called.ok)
        {
            return;
        }

        state = called.state;

        const play = () =>
        {
            const outcome = apply(state, autoplay(state, state.turn, deal)!, deal);

            expect(outcome.ok).toBe(true);

            if (outcome.ok)
            {
                state = outcome.state;
            }
        };

        for (let step = 0; step < 3; step += 1)
        {
            play();
            expect(state.took, 'a trick was gathered before it was complete').toBeNull();
        }

        play();

        const first = state.took;

        expect(first).not.toBeNull();
        expect(first!.cards).toHaveLength(4);

        play();

        expect(state.took, 'the gathered trick vanished the moment somebody led').toEqual(first);

        for (let step = 0; step < 3; step += 1)
        {
            play();
        }

        expect(state.took).not.toEqual(first);
        expect(state.took!.seat).toBe(state.lead);
    });

    /**
     * A hand that ends deals the next one in the same action, and the trick that ended it belongs to
     * the hand that is over. Carrying it into the new deal would put four cards on a table where
     * nobody has played yet.
     */
    it('clears the gathered trick when the next hand is dealt', () =>
    {
        const deal = seeded(9);

        let state = create(4, 7, deal).state;

        for (let step = 0; step < 4000 && state.winner === null; step += 1)
        {
            const move = autoplay(state, state.phase === 'trump' ? state.hakem : state.turn, deal);

            if (move === null)
            {
                break;
            }

            const outcome = apply(state, move, deal);

            if (!outcome.ok)
            {
                break;
            }

            const dealt = outcome.events.some((event) => event.e === 'deal');

            state = outcome.state;

            if (dealt)
            {
                expect(state.phase, 'a deal left the table mid-hand').toBe('trump');
                expect(state.took, 'the new hand opened with the old hand’s last trick on the table').toBeNull();

                return;
            }
        }

        throw new Error('no hand ever ended');
    });

    it('counts the hands, starting at one, and every deal is the next', () =>
    {
        const deal = seeded(4);

        let state = create(4, 7, deal).state;

        expect(state.round).toBe(1);

        let deals = 0;

        for (let step = 0; step < 4000 && state.winner === null; step += 1)
        {
            const move = autoplay(state, state.phase === 'trump' ? state.hakem : state.turn, deal);

            if (move === null)
            {
                break;
            }

            const outcome = apply(state, move, deal);

            if (!outcome.ok)
            {
                break;
            }

            deals += outcome.events.filter((event) => event.e === 'deal').length;
            state = outcome.state;

            expect(state.round).toBe(1 + deals);
        }

        expect(deals).toBeGreaterThan(0);
    });
});

describe('refusing what is not a move', () =>
{
    const opened = () => create(4, 7, seeded(5)).state;

    it('refuses a trump call from anybody but the Hâkem', () =>
    {
        const state = opened();
        const other = (state.hakem + 1) % 4;

        expect(apply(state, { kind: 'trump', seat: other, suit: 'clubs' }, seeded(1)))
            .toEqual({ ok: false, reason: 'not-the-hakem' });
    });

    it('refuses a card before trump is named, as the tricks not having started', () =>
    {
        const state = opened();
        const other = (state.hakem + 1) % state.seats;

        expect(apply(state, { kind: 'card', seat: state.hakem, card: state.hands[state.hakem][0] }, seeded(1)))
            .toEqual({ ok: false, reason: 'tricks-not-started' });
        expect(apply(state, { kind: 'card', seat: other, card: state.hands[state.hakem][0] }, seeded(1)))
            .toEqual({ ok: false, reason: 'tricks-not-started' });
    });

    it('refuses a card the player does not hold', () =>
    {
        const state = opened();
        const called = apply(state, { kind: 'trump', seat: state.hakem, suit: 'clubs' }, seeded(2));

        expect(called.ok).toBe(true);

        if (!called.ok)
        {
            return;
        }

        const mine = called.state.hands[called.state.turn];
        const theirs = deckFor(4).find((card) => !mine.includes(card)) as number;

        expect(apply(called.state, { kind: 'card', seat: called.state.turn, card: theirs }, seeded(3)))
            .toEqual({ ok: false, reason: 'no-such-card' });
    });

    /**
     * The rule that makes the game a game. A player holding the led suit and playing something else
     * has to be refused, or trumps become optional and every trick is a free choice.
     */
    it('refuses a discard while the player can follow suit', () =>
    {
        const deal = seeded(31);

        let state = create(4, 7, deal).state;

        const called = apply(state, { kind: 'trump', seat: state.hakem, suit: 'spades' }, deal);

        expect(called.ok).toBe(true);

        if (!called.ok)
        {
            return;
        }

        state = called.state;

        const opening = autoplay(state, state.turn, deal) as { card: number };
        const first = apply(state, { kind: 'card', seat: state.turn, card: opening.card }, deal);

        expect(first.ok).toBe(true);

        if (!first.ok)
        {
            return;
        }

        state = first.state;

        const led = suitOf(opening.card);
        const hand = state.hands[state.turn];
        const offSuit = hand.find((card) => suitOf(card) !== led);

        if (offSuit === undefined || !hand.some((card) => suitOf(card) === led))
        {
            return;
        }

        expect(apply(state, { kind: 'card', seat: state.turn, card: offSuit }, deal))
            .toEqual({ ok: false, reason: 'must-follow-suit' });
    });

    it('refuses everything once the match is won', () =>
    {
        const state = { ...opened(), winner: 0 };

        expect(apply(state, { kind: 'trump', seat: state.hakem, suit: 'clubs' }, seeded(1)))
            .toEqual({ ok: false, reason: 'game-over' });
    });
});

function stepOf(state: HokmState, action: HokmAction, deal: (sides: number) => number)
{
    const outcome = apply(state, action, deal);

    if (!outcome.ok)
    {
        throw new Error(`${ action.kind }: ${ outcome.reason }`);
    }

    return outcome;
}

function twoHanded(seed: number)
{
    const deal = seeded(seed);
    const opened = create(2, 7, deal).state;

    return { state: stepOf(opened, { kind: 'trump', seat: opened.hakem, suit: 'spades' }, deal).state, deal };
}

function drawing(seed: number)
{
    const { state, deal } = twoHanded(seed);
    const discarded = stepOf(state, legalMoves(state, state.hakem)[0], deal).state;

    return { state: stepOf(discarded, legalMoves(discarded, discarded.turn)[0], deal).state, deal };
}

const ascending = (cards: readonly number[]) => cards.every((card, index) => index === 0 || cards[index - 1] < card);

describe('the two-handed draw', () =>
{
    it('asks the Hâkem to put three face down, then the dealer two', () =>
    {
        const { state, deal } = twoHanded(3);
        const hakem = state.hakem;
        const dealer = dealerSeat(state);

        expect(state.phase).toBe('discard');
        expect(state.turn).toBe(hakem);
        expect(state.hands.map((hand) => hand.length)).toEqual([5, 5]);

        const first = legalMoves(state, hakem);

        expect(first).toHaveLength(10);
        expect(first.every((move) => move.kind === 'discard' && move.cards.length === 3 && ascending(move.cards)
            && move.cards.every((card) => state.hands[hakem].includes(card)))).toBe(true);
        expect(legalMoves(state, dealer)).toEqual([]);

        const put = stepOf(state, first[0], deal);

        expect(put.events).toEqual([{ e: 'discard', seat: hakem }]);
        expect(put.state.phase).toBe('discard');
        expect(put.state.turn).toBe(dealer);
        expect(put.state.hands[hakem]).toHaveLength(2);

        const second = legalMoves(put.state, dealer);

        expect(second).toHaveLength(10);
        expect(second.every((move) => move.kind === 'discard' && move.cards.length === 2 && ascending(move.cards))).toBe(true);

        const drawn = stepOf(put.state, second[0], deal);

        expect(drawn.events).toEqual([{ e: 'discard', seat: dealer }]);
        expect(drawn.state.phase).toBe('draw');
        expect(drawn.state.turn).toBe(hakem);
        expect(drawn.state.hands[dealer]).toHaveLength(3);
        expect(drawn.state.stock).toHaveLength(41);
        expect(drawn.state.offer).not.toBeNull();
        expect(drawn.state.stock).not.toContain(drawn.state.offer);
        expect(legalMoves(drawn.state, hakem)).toEqual([{ kind: 'keep', seat: hakem }, { kind: 'reject', seat: hakem }]);
        expect(legalMoves(drawn.state, dealer)).toEqual([]);
    });

    it('keeps the offer and puts the next card face down, having looked at it', () =>
    {
        const { state, deal } = drawing(5);
        const seat = state.turn;
        const offer = state.offer!;
        const kept = stepOf(state, { kind: 'keep', seat }, deal);
        const after = kept.state;
        const glimpse = after.glimpse[seat]!;

        expect(kept.events).toEqual([{ e: 'draw', seat }]);
        expect(after.hands[seat]).toEqual([...state.hands[seat], offer].sort((a, b) => a - b));
        expect(state.stock.length - after.stock.length).toBe(2);
        expect(glimpse).not.toBeNull();
        expect(state.stock).toContain(glimpse);
        expect(after.stock).not.toContain(glimpse);
        expect(after.hands.flat()).not.toContain(glimpse);
        expect(after.turn).toBe(1 - seat);
        expect(state.stock).toContain(after.offer);
        expect(after.stock).not.toContain(after.offer);
    });

    it('passes the offer face down and takes the next card instead', () =>
    {
        const { state, deal } = drawing(5);
        const seat = state.turn;
        const offer = state.offer!;
        const after = stepOf(state, { kind: 'reject', seat }, deal).state;
        const added = after.hands[seat].filter((card) => !state.hands[seat].includes(card));

        expect(added).toHaveLength(1);
        expect(added[0]).not.toBe(offer);
        expect(state.stock).toContain(added[0]);
        expect([...after.hands.flat(), ...after.stock, after.offer]).not.toContain(offer);
        expect(after.glimpse[seat]).toBeNull();
        expect(state.stock.length - after.stock.length).toBe(2);
    });

    it('alternates twenty-one draws, eleven to the Hâkem, and ends on thirteen each with the Hâkem to lead', () =>
    {
        let { state, deal } = drawing(7);
        const hakem = state.hakem;
        const drawsBy = [0, 0];
        let taken = 0;

        while (state.phase === 'draw')
        {
            const seat = state.turn;
            const step = stepOf(state, { kind: taken % 3 === 2 ? 'reject' : 'keep', seat }, deal);

            drawsBy[seat] += step.events.filter((event) => event.e === 'draw').length;
            state = step.state;
            taken += 1;

            expect(taken).toBeLessThan(30);
        }

        expect(taken).toBe(21);
        expect(drawsBy[hakem]).toBe(11);
        expect(drawsBy[1 - hakem]).toBe(10);
        expect(state.phase).toBe('tricks');
        expect(state.hands.map((hand) => hand.length)).toEqual([13, 13]);
        expect(state.stock).toEqual([]);
        expect(state.offer).toBeNull();
        expect(state.glimpse[hakem]).toBeNull();
        expect(state.glimpse[1 - hakem]).not.toBeNull();

        const led = stepOf(state, legalMoves(state, hakem)[0], deal).state;

        expect(led.glimpse).toEqual([null, null]);
        expect(state.turn).toBe(hakem);
        expect(state.lead).toBe(hakem);
        expect(legalMoves(state, hakem)).toHaveLength(13);
    });

    it('leaves none of the twenty-six cards put face down anywhere, for the rest of the hand', () =>
    {
        let { state, deal } = twoHanded(11);

        while (state.phase !== 'tricks')
        {
            state = stepOf(state, autoplay(state, state.turn, deal)!, deal).state;
        }

        const round = state.round;
        const down = deckFor(2).filter((card) => !state.hands.flat().includes(card));

        expect(down).toHaveLength(26);

        while (state.round === round && state.winner === null)
        {
            const step = stepOf(state, autoplay(state, state.turn, deal)!, deal);
            const fields = [
                ...step.state.hands.flat(),
                ...step.state.trick,
                ...(step.state.took?.cards ?? []),
                ...step.state.stock,
                ...step.events.flatMap((event) => (event.e === 'card' ? [event.card] : []))
            ];

            if (step.state.round === round)
            {
                expect(fields.filter((card) => down.includes(card))).toEqual([]);
            }

            state = step.state;
        }
    });
});

describe('refusing a discard or a draw', () =>
{
    it('refuses a discard outside the discard', () =>
    {
        const opened = create(2, 7, seeded(41)).state;
        const fourDeal = create(4, 7, seeded(41)).state;
        const four = stepOf(fourDeal, { kind: 'trump', seat: fourDeal.hakem, suit: 'clubs' }, seeded(2)).state;
        const { state } = drawing(41);

        expect(apply(opened, { kind: 'discard', seat: opened.hakem, cards: opened.hands[opened.hakem].slice(0, 3) }, seeded(1)))
            .toEqual({ ok: false, reason: 'not-discarding' });
        expect(apply(four, { kind: 'discard', seat: four.turn, cards: four.hands[four.turn].slice(0, 3) }, seeded(1)))
            .toEqual({ ok: false, reason: 'not-discarding' });
        expect(apply(state, { kind: 'discard', seat: state.turn, cards: state.hands[state.turn].slice(0, 2) }, seeded(1)))
            .toEqual({ ok: false, reason: 'not-discarding' });
    });

    it('refuses a discard from the seat not on turn', () =>
    {
        const { state } = twoHanded(43);
        const dealer = dealerSeat(state);

        expect(apply(state, { kind: 'discard', seat: dealer, cards: state.hands[dealer].slice(0, 2) }, seeded(1)))
            .toEqual({ ok: false, reason: 'not-your-turn' });
    });

    it('refuses the wrong number of cards, or one card twice', () =>
    {
        const { state, deal } = twoHanded(45);
        const hand = state.hands[state.hakem];
        const refuse = (one: HokmState, cards: number[]) => apply(one, { kind: 'discard', seat: one.turn, cards }, seeded(1));

        expect(refuse(state, hand.slice(0, 2))).toEqual({ ok: false, reason: 'discard-count' });
        expect(refuse(state, hand.slice(0, 4))).toEqual({ ok: false, reason: 'discard-count' });
        expect(refuse(state, [hand[0], hand[0], hand[1]])).toEqual({ ok: false, reason: 'discard-count' });

        const dealerTurn = stepOf(state, legalMoves(state, state.hakem)[0], deal).state;

        expect(refuse(dealerTurn, dealerTurn.hands[dealerTurn.turn].slice(0, 3))).toEqual({ ok: false, reason: 'discard-count' });
    });

    it('refuses a card the player does not hold', () =>
    {
        const { state } = twoHanded(47);
        const hand = state.hands[state.hakem];
        const theirs = state.hands[dealerSeat(state)][0];

        expect(apply(state, { kind: 'discard', seat: state.hakem, cards: [hand[0], hand[1], theirs] }, seeded(1)))
            .toEqual({ ok: false, reason: 'no-such-card' });
    });

    it('refuses a keep or a pass with nothing on offer', () =>
    {
        const { state } = twoHanded(49);
        const opened = create(2, 7, seeded(49)).state;
        const fourDeal = create(4, 7, seeded(49)).state;
        const four = stepOf(fourDeal, { kind: 'trump', seat: fourDeal.hakem, suit: 'hearts' }, seeded(3)).state;

        expect(apply(state, { kind: 'keep', seat: state.hakem }, seeded(1))).toEqual({ ok: false, reason: 'not-drawing' });
        expect(apply(opened, { kind: 'reject', seat: opened.hakem }, seeded(1))).toEqual({ ok: false, reason: 'not-drawing' });
        expect(apply(four, { kind: 'keep', seat: four.turn }, seeded(1))).toEqual({ ok: false, reason: 'not-drawing' });
    });

    it('refuses a keep or a pass from the seat not on turn', () =>
    {
        const { state } = drawing(51);

        expect(apply(state, { kind: 'keep', seat: 1 - state.turn }, seeded(1))).toEqual({ ok: false, reason: 'not-your-turn' });
        expect(apply(state, { kind: 'reject', seat: 1 - state.turn }, seeded(1))).toEqual({ ok: false, reason: 'not-your-turn' });
    });

    it('refuses a card in the discard and in the draw', () =>
    {
        const discarding = twoHanded(53).state;
        const { state } = drawing(53);

        expect(apply(discarding, { kind: 'card', seat: discarding.turn, card: discarding.hands[discarding.turn][0] }, seeded(1)))
            .toEqual({ ok: false, reason: 'tricks-not-started' });
        expect(apply(state, { kind: 'card', seat: state.turn, card: state.hands[state.turn][0] }, seeded(1)))
            .toEqual({ ok: false, reason: 'tricks-not-started' });
    });

    it('refuses a second trump call during the discard', () =>
    {
        const { state } = twoHanded(55);

        expect(apply(state, { kind: 'trump', seat: state.hakem, suit: 'clubs' }, seeded(1)))
            .toEqual({ ok: false, reason: 'trump-already-set' });
    });

    it('never offers a discard or a draw at three or four players', () =>
    {
        for (const seats of [3, 4])
        {
            const deal = seeded(57 + seats);
            let state = create(seats, 7, deal).state;

            for (let action = 0; action < 400 && state.winner === null; action += 1)
            {
                const seat = hokmEngine.turnOf(state)!;

                expect(legalMoves(state, seat).every((move) => move.kind === 'trump' || move.kind === 'card'), `${ seats } players`).toBe(true);

                state = stepOf(state, autoplay(state, seat, deal)!, deal).state;
            }
        }
    });
});

describe('a kot at two players', () =>
{
    const seventh = (tricks: number[], winner: number) =>
    {
        const loser = 1 - winner;
        const hands: number[][] = [[], []];

        hands[winner] = [cardOf('spades', 'A'), cardOf('clubs', '4'), cardOf('clubs', '5')];
        hands[loser] = [cardOf('hearts', '3'), cardOf('hearts', '4'), cardOf('hearts', '5')];

        const state: HokmState = {
            ...create(2, 7, seeded(9)).state,
            phase: 'tricks',
            trump: 'spades',
            hakem: 0,
            turn: winner,
            lead: winner,
            trick: [],
            stock: [],
            offer: null,
            glimpse: [null, null],
            hands,
            tricks
        };

        const led = stepOf(state, { kind: 'card', seat: winner, card: cardOf('spades', 'A') }, seeded(1));

        return stepOf(led.state, { kind: 'card', seat: loser, card: cardOf('hearts', '3') }, seeded(1)).events.find((event) => event.e === 'hand');
    };

    it('pays the Hâkem two for the first seven, the other player three, and one otherwise, with cards still in hand', () =>
    {
        expect(seventh([6, 0], 0)).toEqual({ e: 'hand', side: 0, seats: [0], points: 2, kot: true });
        expect(seventh([0, 6], 1)).toEqual({ e: 'hand', side: 1, seats: [1], points: 3, kot: true });
        expect(seventh([6, 1], 0)).toEqual({ e: 'hand', side: 0, seats: [0], points: 1, kot: false });
    });
});

describe('walking away', () =>
{
    it('ends the whole match, not the hand', () =>
    {
        const state = create(4, 7, seeded(13)).state;
        const quit = apply(state, { kind: 'forfeit', seat: (state.hakem + 1) % 4, reason: 'resign' }, seeded(1));

        expect(quit.ok).toBe(true);

        if (!quit.ok)
        {
            return;
        }

        expect(quit.state.winner).not.toBeNull();
        expect(sideOf((state.hakem + 1) % 4, 4)).not.toBe(quit.state.winner);
        expect(quit.state.out[(state.hakem + 1) % 4]).toBe(true);
    });

    for (const reason of ['resign', 'left', 'timeout'] as const)
    {
        it(`logs who stopped and how (${ reason }) in the action that ends the match`, () =>
        {
            for (const seats of SEATS)
            {
                const state = create(seats, 7, seeded(13 + seats)).state;
                const seat = (state.hakem + 1) % seats;
                const quit = apply(state, hokmEngine.forfeit(seat, reason), seeded(1));

                expect(quit.ok).toBe(true);

                if (!quit.ok)
                {
                    return;
                }

                expect(quit.events, `${ seats } players`).toEqual([
                    { e: 'forfeit', seat, reason },
                    { e: 'finish', side: quit.state.winner }
                ]);
            }
        });
    }

    it('finishes a played-out match with no forfeit anywhere in its log', () =>
    {
        for (const seats of SEATS)
        {
            const deal = seeded(77 + seats);
            const log: HokmEvent[][] = [];

            let state = create(seats, 7, deal).state;

            for (let action = 0; state.winner === null && action < 20000; action += 1)
            {
                const step = apply(state, autoplay(state, hokmEngine.turnOf(state)!, deal)!, deal);

                if (!step.ok)
                {
                    throw new Error(step.reason);
                }

                log.push(step.events);
                state = step.state;
            }

            expect(state.winner, `${ seats } players`).not.toBeNull();
            expect(log.flat().filter((event) => event.e === 'forfeit'), `${ seats } players`).toEqual([]);
            expect(log.at(-1)?.at(-1), `${ seats } players`).toEqual({ e: 'finish', side: state.winner });
        }
    });

    it('counts two sides at four players and one per seat otherwise', () =>
    {
        expect(sideCount(4)).toBe(2);
        expect(sideCount(3)).toBe(3);
        expect(sideCount(2)).toBe(2);
        expect([0, 1, 2, 3].map((seat) => sideOf(seat, 4))).toEqual([0, 1, 0, 1]);
        expect([0, 1, 2, 3].map((seat) => hokmEngine.sideOf(seat, { seats: 4, variant: 'teams' }))).toEqual([0, 1, 0, 1]);
        expect([0, 1, 2].map((seat) => hokmEngine.sideOf(seat, { seats: 3, variant: 'standard' }))).toEqual([0, 1, 2]);
    });

    it('plays four as two against two and never as a free-for-all, and two and three as the standard game', () =>
    {
        expect(hokmEngine.formats).toEqual([
            { seats: 2, variant: 'standard' },
            { seats: 3, variant: 'standard' },
            { seats: 4, variant: 'teams' }
        ]);
    });
});

describe('what a finished match reports', () =>
{
    const forfeited = (state: HokmState, seat: number) =>
    {
        const quit = apply(state, { kind: 'forfeit', seat, reason: 'resign' }, seeded(1));

        if (!quit.ok)
        {
            throw new Error(quit.reason);
        }

        return quit.state;
    };

    const placesOf = (state: HokmState) =>
        hokmEngine.standings(state).sort((a, b) => a.seat - b.seat).map((one) => one.place);

    it('places a side that walked out last, however many points it had', () =>
    {
        const ended = forfeited({ ...create(3, 7, seeded(5)).state, points: [1, 5, 2] }, 1);

        expect(placesOf(ended)).toEqual([2, 3, 1]);
    });

    it('lets two sides level on points share a place', () =>
    {
        const ended: HokmState = { ...create(3, 7, seeded(5)).state, points: [7, 3, 3], winner: 0 };

        expect(placesOf(ended)).toEqual([1, 2, 2]);
    });

    it('names both partners at the target and leaves nobody unsettled', () =>
    {
        const ended: HokmState = { ...create(4, 7, seeded(5)).state, points: [7, 4], winner: 0 };

        expect(hokmEngine.finish(ended)).toEqual({ winners: [0, 2], unsettled: [], trailing: [] });
        expect(placesOf(ended)).toEqual([1, 2, 1, 2]);
    });

    it('leaves everybody still at the table unsettled when a forfeit stopped it', () =>
    {
        const four = forfeited({ ...create(4, 7, seeded(5)).state, points: [2, 4] }, 1);
        const three = forfeited({ ...create(3, 7, seeded(5)).state, points: [1, 5, 2] }, 1);

        expect(hokmEngine.finish(four)).toEqual({ winners: [0, 2], unsettled: [0, 2, 3], trailing: [] });
        expect(placesOf(four)).toEqual([1, 2, 1, 2]);
        expect(hokmEngine.finish(three)).toEqual({ winners: [2], unsettled: [0, 2], trailing: [0] });
    });

    it('names the seats still at the table whose side trailed a side still in play', () =>
    {
        const behind = forfeited({ ...create(4, 7, seeded(5)).state, points: [4, 2] }, 1);
        const onTricks = forfeited({ ...create(4, 7, seeded(5)).state, points: [3, 3], tricks: [1, 2, 0, 2] }, 0);
        const level = forfeited({ ...create(4, 7, seeded(5)).state, points: [3, 3], tricks: [1, 1, 1, 1] }, 3);
        const threeOnTricks = forfeited({ ...create(3, 7, seeded(5)).state, points: [2, 0, 2], tricks: [1, 4, 3] }, 1);

        expect(hokmEngine.finish(behind)?.trailing).toEqual([3]);
        expect(hokmEngine.finish(onTricks)?.trailing).toEqual([2]);
        expect(hokmEngine.finish(level)?.trailing).toEqual([]);
        expect(hokmEngine.finish(threeOnTricks)?.trailing).toEqual([0]);
    });

    it('counts seven cards played as engagement, at every player count', () =>
    {
        for (const seats of SEATS)
        {
            const format = hokmEngine.formats.find((one) => one.seats === seats)!;

            expect(hokmEngine.engagement(format), `${ seats } players`).toEqual({ verbs: ['card'], after: 7 });
        }
    });
});

describe('one turn on the clock', () =>
{
    it('keeps the trump call and the lead on one key, and gives every trick a fresh one', () =>
    {
        let state = create(4, 7, seeded(21)).state;
        const keys: string[] = [hokmEngine.turnKey(state)];
        const deal = seeded(3);

        for (let action = 0; action < 40 && state.winner === null; action += 1)
        {
            const seat = hokmEngine.turnOf(state)!;
            const before = state;
            const step = apply(state, autoplay(state, seat, deal)!, deal);

            if (!step.ok)
            {
                throw new Error(step.reason);
            }

            state = step.state;

            const played = (one: HokmState) => one.tricks.reduce((total, count) => total + count, 0);
            const fresh = state.round !== before.round || played(state) !== played(before);

            expect(hokmEngine.turnKey(state) !== hokmEngine.turnKey(before), `action ${ action }`).toBe(fresh);
            keys.push(hokmEngine.turnKey(state));
        }

        expect(keys[1]).toBe(keys[0]);
    });

    it('gives the trump call, each discard, each draw and the opening lead a turn each at two players', () =>
    {
        let state = create(2, 7, seeded(23)).state;
        const deal = seeded(4);
        let actions = 0;

        while (state.phase !== 'tricks' || state.trick.length === 0)
        {
            const before = state;
            const step = apply(state, autoplay(state, hokmEngine.turnOf(state)!, deal)!, deal);

            if (!step.ok)
            {
                throw new Error(step.reason);
            }

            state = step.state;
            actions += 1;

            const moved = hokmEngine.turnOf(state) !== hokmEngine.turnOf(before) || hokmEngine.turnKey(state) !== hokmEngine.turnKey(before);

            expect(moved, `action ${ actions } stayed on one turn`).toBe(true);
            expect(actions).toBeLessThan(30);
        }

        expect(actions).toBe(25);
    });
});

describe('what the catalogue may offer', () =>
{
    /**
     * A seat count in `game_rules.seats` is a promise the create form makes and `table.create`
     * enforces - open a table at it and Start is expected to deal.
     */
    it('never offers a seat count the hokm engine cannot play', () =>
    {
        const hokm = GAME_SEEDS.find((game) => game.id === 'hokm');

        expect(hokm, 'hokm is not in the catalogue').toBeDefined();

        for (const seats of hokm!.seats)
        {
            expect(SEATS, `the catalogue offers ${ seats } players`).toContain(seats);
        }
    });
});
