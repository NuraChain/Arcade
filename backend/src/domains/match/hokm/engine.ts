import { SUITS, suitOf, type Suit } from '../cards/cards.ts';
import { autoCard, deckFor, legalCards, putAway, trickWinner, worthKeeping } from './cards.ts';
import { dealerOf, duelResult, matchWinner, nextHakem, trickCount, tripleResult, winningTricks } from './scoring.ts';
import { sideCount, sideOf, seatsOfSide, type HokmAction, type HokmEvent, type HokmRefusal, type HokmState } from './state.ts';

/**
 * The hokm state machine, pure and import-free beyond this directory.
 *
 * `apply` never throws - a refusal is `{ ok: false, reason }` over a closed union - because the
 * timeout sweep folds actions over a state and a function that throws for ordinary control flow is
 * one nothing can fold. Randomness arrives as a `deal` argument rather than being taken, so there
 * is nothing in here to subvert and the same state with the same shuffle always plays the same.
 *
 * **A phase is a decision somebody makes.** Naming trump, putting cards face down, keeping or
 * passing a drawn card, and playing a card. Rounds of four and five are a dealing ritual with no
 * decision in them, and a state nobody can act in is a state that only exists to be stepped past.
 */

/**
 * The player counts this engine plays.
 *
 * Three and four are one game with a different deck: deal the Hâkem five, pause for trump, fill
 * every hand, play tricks until a side has more than half of them. Two is Pagat's draw game: five
 * each, trump, three face down from the Hâkem and two from the dealer, then twenty-one draws from
 * the stock until each holds thirteen. `hokm-engine.spec.ts` asserts the catalogue never offers a
 * count this list does not hold.
 */
export const SEATS: readonly number[] = [2, 3, 4];

export interface Applied
{
    state: HokmState;
    events: HokmEvent[];
}

export type Outcome = { ok: true; state: HokmState; events: HokmEvent[] } | { ok: false; reason: HokmRefusal };

/** A shuffle, drawn from the server's generator so the engine holds no randomness of its own. */
export type Deal = (sides: number) => number;

function shuffled(cards: number[], deal: Deal)
{
    const order = [...cards];

    for (let index = order.length - 1; index > 0; index -= 1)
    {
        const pick = deal(index + 1) - 1;

        [order[index], order[pick]] = [order[pick], order[index]];
    }

    return order;
}

/**
 * The Hâkem's five, and at three and four players NOBODY else's anything.
 *
 * Pagat pauses the deal so the Hâkem's partner cannot signal what they hold before trump is named.
 * Dealing only the Hâkem satisfies that and more: during `trump` there is no other hand in the
 * state at all, so no view, no snapshot and no event can leak one even if somebody later writes a
 * careless projection. At two there is no partner, and Pagat deals the dealer five at once.
 */
const OPENING = 5;

const byNumber = (a: number, b: number) => a - b;

function dealHand(state: HokmState, deal: Deal): HokmState
{
    const order = shuffled(deckFor(state.seats), deal);
    const duel = state.seats === 2;

    const hands = Array.from({ length: state.seats }, () => [] as number[]);

    hands[state.hakem] = order.slice(0, OPENING).sort(byNumber);

    if (duel)
    {
        hands[dealerOf(state.hakem, state.seats)] = order.slice(OPENING, OPENING * 2).sort(byNumber);
    }

    return {
        ...state,
        round: state.round + 1,
        phase: 'trump',
        trump: null,
        hands,
        stock: duel ? order.slice(OPENING * 2).sort(byNumber) : [],
        offer: null,
        glimpse: Array.from({ length: state.seats }, () => null),
        turn: state.hakem,
        lead: state.hakem,
        trick: [],
        took: null,
        tricks: Array.from({ length: state.seats }, () => 0)
    };
}

export function discardDue(state: HokmState, seat: number)
{
    return seat === state.hakem ? 3 : 2;
}

function lift(stock: readonly number[], deal: Deal)
{
    const pick = Math.min(stock.length, Math.max(1, Math.floor(deal(stock.length))));

    return { card: stock[pick - 1], stock: stock.filter((_, index) => index !== pick - 1) };
}

function offerTo(state: HokmState, seat: number, deal: Deal): HokmState
{
    const { card, stock } = lift(state.stock, deal);

    return { ...state, turn: seat, offer: card, stock };
}

function subsets(cards: readonly number[], size: number): number[][]
{
    if (size === 0)
    {
        return [[]];
    }

    return cards.flatMap((card, index) =>
        subsets(cards.slice(index + 1), size - 1).map((rest) => [card, ...rest]));
}

/**
 * The rest of the deal at three and four players, once trump is named: everybody up to a full hand,
 * the Hâkem included.
 *
 * The remaining cards are taken in the same shuffled order the opening five came from, so a hand is
 * a deterministic function of one shuffle rather than of two.
 */
function dealRest(state: HokmState, deal: Deal)
{
    const held = new Set(state.hands.flat());
    const rest = shuffled(deckFor(state.seats).filter((card) => !held.has(card)), deal);
    const size = trickCount(state.seats);

    const hands = state.hands.map((hand) => [...hand]);

    let next = 0;

    for (let step = 0; step < state.seats; step += 1)
    {
        const seat = (state.hakem + step) % state.seats;

        while (hands[seat].length < size)
        {
            hands[seat].push(rest[next]);
            next += 1;
        }

        hands[seat].sort((a, b) => a - b);
    }

    return hands;
}

export function create(seats: number, target: number, deal: Deal)
{
    const hakem = deal(seats) - 1;

    return dealHand({
        v: 1,
        game: 'hokm',
        rev: 0,
        seats,
        target,
        round: 0,
        hakem,
        phase: 'trump',
        trump: null,
        hands: [],
        stock: [],
        offer: null,
        glimpse: [],
        turn: hakem,
        lead: hakem,
        trick: [],
        took: null,
        tricks: [],
        points: Array.from({ length: sideCount(seats) }, () => 0),
        out: Array.from({ length: seats }, () => false),
        winner: null
    }, deal);
}

export function dealerSeat(state: HokmState)
{
    return dealerOf(state.hakem, state.seats);
}

export function legalMoves(state: HokmState, seat: number): HokmAction[]
{
    if (state.winner !== null || state.out[seat] === true)
    {
        return [];
    }

    if (state.phase === 'trump')
    {
        return seat === state.hakem
            ? SUITS.map((suit) => ({ kind: 'trump', seat, suit } as HokmAction))
            : [];
    }

    if (seat !== state.turn)
    {
        return [];
    }

    if (state.phase === 'discard')
    {
        return subsets(state.hands[seat], discardDue(state, seat)).map((cards) => ({ kind: 'discard', seat, cards } as HokmAction));
    }

    if (state.phase === 'draw')
    {
        return [{ kind: 'keep', seat }, { kind: 'reject', seat }];
    }

    const led = state.trick.length === 0 ? null : suitOf(state.trick[0]);

    return legalCards(state.hands[seat], led).map((card) => ({ kind: 'card', seat, card } as HokmAction));
}

/**
 * The hand is over when the scoring rules say so, which is not the same as "every card is played".
 *
 * Two sides race to seven tricks and stop there with cards still in hand; three players stop the
 * moment a lead cannot be equalled. Playing on to the last card would be a different game and would
 * change what a kot is.
 */
function handOver(state: HokmState, played: number): { side: number; points: number; kot: boolean } | null
{
    if (state.seats === 3)
    {
        const result = tripleResult(state.tricks, state.hakem, played);

        return result === null ? null : { ...result, kot: result.points > 1 };
    }

    const sides = Array.from({ length: sideCount(state.seats) }, () => 0);

    for (let seat = 0; seat < state.seats; seat += 1)
    {
        sides[sideOf(seat, state.seats)] += state.tricks[seat];
    }

    const result = duelResult(sides, sideOf(state.hakem, state.seats), winningTricks(state.seats));

    return result === null ? null : { ...result, kot: result.points > 1 };
}

/**
 * A forfeit ends the MATCH, not the hand.
 *
 * Four-handed hokm cannot be played three-handed and seventeen-card hands cannot be dealt to two
 * people, so there is nothing to continue with - and a game that limped on a player short would be
 * a variant nobody asked for. The side with the most points is named so the board can stop, and
 * `finish` reports it as abandoned rather than won, which is what keeps it out of the rating.
 */
function abandon(state: HokmState): HokmState
{
    const live = Array.from({ length: sideCount(state.seats) }, (_, side) => side)
        .filter((side) => !state.out.some((gone, seat) => gone && sideOf(seat, state.seats) === side));

    const standing = live.length > 0 ? live : [0];

    const best = standing.reduce((top, side) => (state.points[side] > state.points[top] ? side : top), standing[0]);

    return { ...state, winner: best };
}

function discard(state: HokmState, seat: number, cards: readonly number[], deal: Deal): Outcome
{
    if (state.phase !== 'discard')
    {
        return { ok: false, reason: 'not-discarding' };
    }

    if (seat !== state.turn)
    {
        return { ok: false, reason: 'not-your-turn' };
    }

    const due = discardDue(state, seat);

    if (cards.length !== due || new Set(cards).size !== due)
    {
        return { ok: false, reason: 'discard-count' };
    }

    if (!cards.every((card) => state.hands[seat].includes(card)))
    {
        return { ok: false, reason: 'no-such-card' };
    }

    const hands = state.hands.map((held, index) => (index === seat ? held.filter((card) => !cards.includes(card)) : held));
    const next: HokmState = { ...state, rev: state.rev + 1, hands };
    const events: HokmEvent[] = [{ e: 'discard', seat }];

    return seat === state.hakem
        ? { ok: true, state: { ...next, turn: dealerOf(state.hakem, state.seats) }, events }
        : { ok: true, state: offerTo({ ...next, phase: 'draw' }, state.hakem, deal), events };
}

function draw(state: HokmState, seat: number, keep: boolean, deal: Deal): Outcome
{
    if (state.phase !== 'draw' || state.offer === null)
    {
        return { ok: false, reason: 'not-drawing' };
    }

    if (seat !== state.turn)
    {
        return { ok: false, reason: 'not-your-turn' };
    }

    const { card: second, stock } = lift(state.stock, deal);
    const taken = keep ? state.offer : second;
    const hands = state.hands.map((held, index) => (index === seat ? [...held, taken].sort(byNumber) : held));
    const glimpse = state.glimpse.map((card, index) => (index === seat ? (keep ? second : null) : card));
    const next: HokmState = { ...state, rev: state.rev + 1, hands, stock, glimpse, offer: null };
    const events: HokmEvent[] = [{ e: 'draw', seat }];

    if (stock.length > 0)
    {
        return { ok: true, state: offerTo(next, (seat + 1) % state.seats, deal), events };
    }

    return {
        ok: true,
        state: {
            ...next,
            phase: 'tricks',
            turn: state.hakem,
            lead: state.hakem
        },
        events
    };
}

export function apply(state: HokmState, action: HokmAction, deal: Deal): Outcome
{
    if (state.winner !== null)
    {
        return { ok: false, reason: 'game-over' };
    }

    if (action.seat < 0 || action.seat >= state.seats || state.out[action.seat] === true)
    {
        return { ok: false, reason: 'not-playing' };
    }

    if (action.kind === 'forfeit')
    {
        const out = [...state.out];

        out[action.seat] = true;

        const next = abandon({ ...state, out, rev: state.rev + 1 });

        return {
            ok: true,
            state: next,
            events: [
                { e: 'forfeit', seat: action.seat, reason: action.reason },
                { e: 'finish', side: next.winner ?? 0 }
            ]
        };
    }

    if (action.kind === 'trump')
    {
        if (state.phase !== 'trump')
        {
            return { ok: false, reason: 'trump-already-set' };
        }

        if (action.seat !== state.hakem)
        {
            return { ok: false, reason: 'not-the-hakem' };
        }

        const called = { ...state, rev: state.rev + 1, trump: action.suit, turn: state.hakem, lead: state.hakem };

        return {
            ok: true,
            state: state.seats === 2
                ? { ...called, phase: 'discard' }
                : { ...called, phase: 'tricks', hands: dealRest(state, deal) },
            events: [{ e: 'trump', seat: action.seat, suit: action.suit }]
        };
    }

    if (action.kind === 'discard')
    {
        return discard(state, action.seat, action.cards, deal);
    }

    if (action.kind === 'keep' || action.kind === 'reject')
    {
        return draw(state, action.seat, action.kind === 'keep', deal);
    }

    if (state.phase !== 'tricks')
    {
        return { ok: false, reason: 'tricks-not-started' };
    }

    if (action.seat !== state.turn)
    {
        return { ok: false, reason: 'not-your-turn' };
    }

    const hand = state.hands[action.seat];

    if (!hand.includes(action.card))
    {
        return { ok: false, reason: 'no-such-card' };
    }

    const led = state.trick.length === 0 ? null : suitOf(state.trick[0]);

    if (!legalCards(hand, led).includes(action.card))
    {
        return { ok: false, reason: 'must-follow-suit' };
    }

    const events: HokmEvent[] = [{ e: 'card', seat: action.seat, card: action.card }];

    const hands = state.hands.map((held, seat) =>
        (seat === action.seat ? held.filter((card) => card !== action.card) : held));

    const trick = [...state.trick, action.card];

    let next: HokmState = { ...state, rev: state.rev + 1, hands, trick, glimpse: state.glimpse.map(() => null) };

    if (trick.length < state.seats)
    {
        return { ok: true, state: { ...next, turn: (state.turn + 1) % state.seats }, events };
    }

    const took = (state.lead + trickWinner(trick, state.trump as Suit)) % state.seats;
    const tricks = [...state.tricks];

    tricks[took] += 1;
    events.push({ e: 'trick', seat: took });

    next = { ...next, tricks, trick: [], took: { lead: state.lead, cards: trick, seat: took }, lead: took, turn: took };

    const played = tricks.reduce((total, count) => total + count, 0);
    const result = handOver(next, played);

    if (result === null)
    {
        return { ok: true, state: next, events };
    }

    const points = [...next.points];

    points[result.side] += result.points;
    events.push({
        e: 'hand',
        side: result.side,
        seats: seatsOfSide(result.side, next.seats),
        points: result.points,
        kot: result.kot
    });

    const won = matchWinner(points, next.target);

    if (won !== null)
    {
        events.push({ e: 'finish', side: won });

        return { ok: true, state: { ...next, points, winner: won }, events };
    }

    const held = result.side === sideOf(next.hakem, next.seats);
    const hakem = nextHakem(next.hakem, next.seats, held);

    events.push({ e: 'deal', hakem });

    return { ok: true, state: dealHand({ ...next, points, hakem }, deal), events };
}

/**
 * What the sweep plays for somebody who walked away, and it must never be a forfeit - three missed
 * turns ends a seat elsewhere, and this is only ever "take their turn for them".
 *
 * Trump goes to the suit they hold most of, which is the one decision in the game a beginner is
 * taught; the cards put face down are `putAway`'s, a drawn card is kept when `worthKeeping` says so,
 * and a card played is `autoCard`'s, which plays low by rank and keeps trumps back. Every answer is
 * one of `legalMoves`, so the sweep cannot play anything a person could not.
 */
export function autoplay(state: HokmState, seat: number, deal: Deal): HokmAction | null
{
    const moves = legalMoves(state, seat);

    if (moves.length === 0)
    {
        return null;
    }

    void deal;

    if (state.phase === 'trump')
    {
        const counts = SUITS.map((suit) => state.hands[seat].filter((card) => suitOf(card) === suit).length);
        const best = SUITS[counts.indexOf(Math.max(...counts))];

        return moves.find((move) => move.kind === 'trump' && move.suit === best) ?? null;
    }

    const trump = state.trump as Suit;

    if (state.phase === 'discard')
    {
        const cards = putAway(state.hands[seat], discardDue(state, seat), trump).join();

        return moves.find((move) => move.kind === 'discard' && move.cards.join() === cards) ?? null;
    }

    if (state.phase === 'draw')
    {
        const kind = state.offer !== null && worthKeeping(state.offer, trump) ? 'keep' : 'reject';

        return moves.find((move) => move.kind === kind) ?? null;
    }

    const card = autoCard(state.hands[seat], state.trick, trump);

    return moves.find((move) => move.kind === 'card' && move.card === card) ?? null;
}
