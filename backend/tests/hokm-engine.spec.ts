import { describe, expect, it } from 'vitest';

import { cardOf, rankOf, suitOf } from '../src/domains/match/cards/cards.ts';
import { autoCard, deckFor } from '../src/domains/match/hokm/cards.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { SEATS, apply, autoplay, create, dealerSeat, legalMoves } from '../src/domains/match/hokm/engine.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { trickCount } from '../src/domains/match/hokm/scoring.ts';
import { sideCount, sideOf, type HokmEvent, type HokmState } from '../src/domains/match/hokm/state.ts';

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
    const seen = state.hands.flat().concat(state.trick);

    if (new Set(seen).size !== seen.length)
    {
        return 'a card is in two places at once';
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

        if (dealt.some((size, seat) => (seat === state.hakem ? size !== 5 : size !== 0)))
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
    it('gives the Hâkem five cards and everybody else none', () =>
    {
        for (const seats of SEATS)
        {
            const state = create(seats, 7, seeded(seats));

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

    it('offers the trump call to the Hâkem and to nobody else', () =>
    {
        const state = create(4, 7, seeded(9));

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
        const opened = create(4, 7, seeded(3));
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
        const state = create(4, 7, seeded(11));

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

                let state = create(seats, 7, deal);
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

                let state = create(seats, 7, deal);

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
            ...create(4, 7, seeded(5)),
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
            ...create(4, 7, seeded(5)),
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

        let state = create(4, 7, deal);

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

        let state = create(4, 7, deal);

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

        let state = create(4, 7, deal);

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

        let state = create(4, 7, deal);

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
    const opened = () => create(4, 7, seeded(5));

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

        let state = create(4, 7, deal);

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

describe('walking away', () =>
{
    it('ends the whole match, not the hand', () =>
    {
        const state = create(4, 7, seeded(13));
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
                const state = create(seats, 7, seeded(13 + seats));
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

            let state = create(seats, 7, deal);

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
        expect([0, 1, 2, 3].map((seat) => hokmEngine.sideOf(seat, 4))).toEqual([0, 1, 0, 1]);
        expect([0, 1, 2].map((seat) => hokmEngine.sideOf(seat, 3))).toEqual([0, 1, 2]);
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
        const ended = forfeited({ ...create(3, 7, seeded(5)), points: [1, 5, 2] }, 1);

        expect(placesOf(ended)).toEqual([2, 3, 1]);
    });

    it('lets two sides level on points share a place', () =>
    {
        const ended: HokmState = { ...create(3, 7, seeded(5)), points: [7, 3, 3], winner: 0 };

        expect(placesOf(ended)).toEqual([1, 2, 2]);
    });

    it('names both partners at the target and leaves nobody unsettled', () =>
    {
        const ended: HokmState = { ...create(4, 7, seeded(5)), points: [7, 4], winner: 0 };

        expect(hokmEngine.finish(ended)).toEqual({ winners: [0, 2], unsettled: [], trailing: [] });
        expect(placesOf(ended)).toEqual([1, 2, 1, 2]);
    });

    it('leaves everybody still at the table unsettled when a forfeit stopped it', () =>
    {
        const four = forfeited({ ...create(4, 7, seeded(5)), points: [2, 4] }, 1);
        const three = forfeited({ ...create(3, 7, seeded(5)), points: [1, 5, 2] }, 1);

        expect(hokmEngine.finish(four)).toEqual({ winners: [0, 2], unsettled: [0, 2, 3], trailing: [] });
        expect(placesOf(four)).toEqual([1, 2, 1, 2]);
        expect(hokmEngine.finish(three)).toEqual({ winners: [2], unsettled: [0, 2], trailing: [0] });
    });

    it('names the seats still at the table whose side trailed a side still in play', () =>
    {
        const behind = forfeited({ ...create(4, 7, seeded(5)), points: [4, 2] }, 1);
        const onTricks = forfeited({ ...create(4, 7, seeded(5)), points: [3, 3], tricks: [1, 2, 0, 2] }, 0);
        const level = forfeited({ ...create(4, 7, seeded(5)), points: [3, 3], tricks: [1, 1, 1, 1] }, 3);
        const threeOnTricks = forfeited({ ...create(3, 7, seeded(5)), points: [2, 0, 2], tricks: [1, 4, 3] }, 1);

        expect(hokmEngine.finish(behind)?.trailing).toEqual([3]);
        expect(hokmEngine.finish(onTricks)?.trailing).toEqual([2]);
        expect(hokmEngine.finish(level)?.trailing).toEqual([]);
        expect(hokmEngine.finish(threeOnTricks)?.trailing).toEqual([0]);
    });

    it('counts a hand of cards as engagement: seven at three and four, a whole hand at two', () =>
    {
        expect(hokmEngine.engagement(4)).toEqual({ verbs: ['card'], after: 7 });
        expect(hokmEngine.engagement(3)).toEqual({ verbs: ['card'], after: 7 });
        expect(hokmEngine.engagement(2)).toEqual({ verbs: ['card'], after: 13 });
    });
});

describe('one turn on the clock', () =>
{
    it('keeps the trump call and the lead on one key, and gives every trick a fresh one', () =>
    {
        let state = create(4, 7, seeded(21));
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
});

describe('what the catalogue may offer', () =>
{
    /**
     * The rule that stops the gap above becoming a lie on a screen.
     *
     * A seat count in `game_rules.seats` is a promise the create form makes and `table.create`
     * enforces - open a table at it and Start is expected to deal. Two-handed hokm has a draw phase
     * this engine does not implement, so offering `2` would seat two people at a table that can
     * never begin, or worse, deal them a game that is not hokm.
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
