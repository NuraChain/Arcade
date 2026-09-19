import { deckFor, legalCards, suitOf, trickWinner, SUITS, type Suit } from './cards.ts';
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
 * **Two phases, not eight.** The plan sketched a seven-state enum walking the deal round by round;
 * what a caller can actually DO is name trump or play a card, so those are the phases. Rounds of
 * four and five are a dealing ritual with no decision in them, and a state nobody can act in is a
 * state that only exists to be stepped past.
 */

/**
 * The player counts this engine actually plays, and it is not all of them.
 *
 * All three are one game with a different deck: deal the Hâkem five, pause for trump, fill every
 * hand, play tricks until a side has more than half of them.
 *
 * The two-handed game is the house rule rather than Pagat's. Pagat deals five each and then runs a
 * keep-or-reject draw over a face-down stock; what is played is simpler and is what this implements
 * - **drop two of the twos, deal all fifty cards, twenty-five each.** Nothing else moves, because
 * every number downstream is derived from the deck: the hand is the deck over the seats, and the
 * tricks that win it are more than half of that. `hokm-engine.spec.ts` asserts the catalogue never
 * offers a count this list does not hold.
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

function shuffled(cards: number[], deal: Deal): number[]
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
 * The Hâkem's five, and NOBODY else's anything.
 *
 * Pagat pauses the deal so the Hâkem's partner cannot signal what they hold before trump is named.
 * Dealing only the Hâkem satisfies that and more: during `trump` there is no other hand in the
 * state at all, so no view, no snapshot and no event can leak one even if somebody later writes a
 * careless projection. A pause that left three hands lying in the state would be a pause that
 * depended on every reader being careful.
 */
const OPENING = 5;

function dealHand(state: HokmState, deal: Deal): HokmState
{
    const order = shuffled(deckFor(state.seats), deal);

    const hands = Array.from({ length: state.seats }, () => [] as number[]);

    hands[state.hakem] = order.slice(0, OPENING).sort((a, b) => a - b);

    return {
        ...state,
        phase: 'trump',
        trump: null,
        hands,
        turn: state.hakem,
        lead: state.hakem,
        trick: [],
        took: null,
        tricks: Array.from({ length: state.seats }, () => 0)
    };
}

/**
 * The rest of the deal, once trump is named: everybody up to a full hand, the Hâkem included.
 *
 * The remaining cards are taken in the same shuffled order the opening five came from, so a hand is
 * a deterministic function of one shuffle rather than of two.
 */
function dealRest(state: HokmState, deal: Deal): number[][]
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

export function create(seats: number, target: number, deal: Deal): HokmState
{
    const hakem = deal(seats) - 1;

    return dealHand({
        v: 1,
        game: 'hokm',
        rev: 0,
        seats,
        target,
        hakem,
        phase: 'trump',
        trump: null,
        hands: [],
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

export function dealerSeat(state: HokmState): number
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

        return {
            ok: true,
            state: {
                ...state,
                rev: state.rev + 1,
                phase: 'tricks',
                trump: action.suit,
                hands: dealRest(state, deal),
                turn: state.hakem,
                lead: state.hakem
            },
            events: [{ e: 'trump', seat: action.seat, suit: action.suit }]
        };
    }

    if (state.phase !== 'tricks')
    {
        return { ok: false, reason: 'must-follow-suit' };
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

    let next: HokmState = { ...state, rev: state.rev + 1, hands, trick };

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
 * taught; a card is the lowest legal one, which loses the trick without throwing away a winner.
 */
export function autoplay(state: HokmState, seat: number, deal: Deal): HokmAction | null
{
    const moves = legalMoves(state, seat);

    if (moves.length === 0)
    {
        return null;
    }

    if (state.phase === 'trump')
    {
        const counts = SUITS.map((suit) => state.hands[seat].filter((card) => suitOf(card) === suit).length);
        const best = counts.indexOf(Math.max(...counts));

        return { kind: 'trump', seat, suit: SUITS[best] };
    }

    void deal;

    return moves.reduce((low, move) =>
        ((move as { card: number }).card < (low as { card: number }).card ? move : low), moves[0]);
}
