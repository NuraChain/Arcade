import type { Suit } from './cards.ts';

/**
 * One hokm match, which is a SEQUENCE of hands rather than a single game.
 *
 * `matches` gets one row for the whole match to seven points and the hands are events in the
 * ledger, exactly as the seam doc argues: one rating move, one history line, one row somebody's
 * profile counts. A row per hand would make a table flicker between ready and playing all evening.
 *
 * **`hands` is the only private thing in here and it never leaves through `view`.** Everything else
 * - the trick on the table, who took what, the trump, the score - is face up at a real table and is
 * face up here. That is why the log needs no filtering: the deal is not an event, so there is
 * nothing private in the event stream to redact.
 */

export type HokmPhase = 'trump' | 'tricks';

/**
 * The trick that was just gathered, which is the only part of a hokm table that exists for a moment
 * and then does not.
 *
 * A physical trick sits face up until the winner picks it up, and every player reads it in that
 * window. Here the fourth card and the resolution land in one response, so without this the losing
 * three see their own card leave the table and nothing else - the trick they lost is information
 * they are entitled to and never get. Keeping it on the STATE rather than remembering it in a
 * browser is what makes it survive a reload, a reconnect and a spectator arriving late.
 */
export interface HokmTrick
{
    /** The seat that led it, so the cards have an owner each the way `lead` gives the live trick one. */
    lead: number;

    cards: number[];

    /** The seat that took it. */
    seat: number;
}

export interface HokmState
{
    v: 1;

    /** The discriminant a registry dispatches on, named as ludo names its own. */
    game: 'hokm';

    rev: number;

    seats: number;

    /** Points that win the match. Seven is the canonical game; the catalogue also offers thirteen. */
    target: number;

    round: number;

    /**
     * The seat that names trump, receives the first cards and leads the first trick.
     *
     * Pagat selects it by flipping cards until somebody takes an ace. That ceremony exists to pick a
     * seat at a physical table and its only outcome is a random one, so `create` draws the seat
     * directly - there is no deck to flip before a deal that has not happened. The partner it also
     * selects is already decided here, because the table seated everybody before the match began.
     */
    hakem: number;

    phase: HokmPhase;

    trump: Suit | null;

    /** Per seat, and the reason `view` takes a viewer. */
    hands: number[][];

    turn: number;

    /** The seat that led the trick in progress, so the cards on the table have an owner each. */
    lead: number;

    trick: number[];

    /** The trick before this one, face up until the next card is led. Null at the start of a hand. */
    took: HokmTrick | null;

    /** Tricks taken in the CURRENT hand, per seat. Reset every deal. */
    tricks: number[];

    /** Match points, per SIDE - a team at four players, a seat at two and three. */
    points: number[];

    out: boolean[];

    /** The side that won the match, or null while it is still being played. */
    winner: number | null;
}

export type HokmAction =
    | { kind: 'trump'; seat: number; suit: Suit }
    | { kind: 'card'; seat: number; card: number }
    | { kind: 'forfeit'; seat: number; reason: string };

export type HokmEvent =
    | { e: 'trump'; seat: number; suit: Suit }
    | { e: 'card'; seat: number; card: number }
    | { e: 'trick'; seat: number }
    /**
     * `seats` rides along beside `side` because a TALLY is per seat and a side is not: a hand won by
     * a team at four players was won by two people, and the ledger is the only place that knows
     * which. Reading it back from the seat count would mean the fold had to know the game.
     */
    | { e: 'hand'; side: number; seats: number[]; points: number; kot: boolean }
    | { e: 'deal'; hakem: number }
    | { e: 'forfeit'; seat: number; reason: string }
    | { e: 'finish'; side: number };

/**
 * Refusals, as values over a closed set. `apply` never throws, so the service can map these onto
 * statuses in one place and the timeout sweep can fold actions over a state.
 */
export type HokmRefusal =
    | 'not-your-turn'
    | 'not-playing'
    | 'trump-already-set'
    | 'not-the-hakem'
    | 'must-follow-suit'
    | 'no-such-card'
    | 'game-over';

/**
 * Four players are two teams sitting opposite; two and three players are their own sides.
 *
 * Every score, every hand result and every match win is counted per SIDE, so this is the only place
 * that knows whether a game has teams in it - and it is why the same scoring functions serve the
 * two-handed game and the four-handed one without a branch.
 */
export function sideOf(seat: number, seats: number): number
{
    return seats === 4 ? seat % 2 : seat;
}

export function sideCount(seats: number): number
{
    return seats === 4 ? 2 : seats;
}

export function seatsOfSide(side: number, seats: number): number[]
{
    return Array.from({ length: seats }, (_, seat) => seat).filter((seat) => sideOf(seat, seats) === side);
}
