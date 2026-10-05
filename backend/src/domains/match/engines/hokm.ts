import { suitOf, type Suit } from '../cards/cards.ts';
import { legalCards } from '../hokm/cards.ts';
import { apply, autoplay, create, dealerSeat, discardDue, legalMoves, SEATS } from '../hokm/engine.ts';
import { TRIPLE_SWEEP, trickCount, winningTricks } from '../hokm/scoring.ts';
import { seatsOfSide, sideCount, sideOf, type HokmAction, type HokmEvent, type HokmState } from '../hokm/state.ts';
import type { Draws, Ending, Engine, ForfeitReason, Placement, TableConfig, Tally } from '../engine.ts';
import type { MatchBoard, MatchLog, MatchPlay } from '../../../schemas.ts';

const sidesOf = (state: HokmState) => Array.from({ length: sideCount(state.seats) }, (_, side) => side);

const gone = (state: HokmState, side: number) => seatsOfSide(side, state.seats).some((seat) => state.out[seat] === true);

/**
 * Hokm, behind the seam every game sits behind.
 *
 * An adapter and nothing more: not one rule lives here, and `hokm/` is untouched by it. It sits
 * outside that directory for the reason ludo's does - the purity spec reads `hokm/` as text and
 * refuses an import from anywhere else, correctly, because the rule is about keeping the RULES pure
 * and an adapter is plumbing.
 *
 * **`view` is the reason this game needed the seam at all.** Ludo could have shipped with one
 * payload for everybody because a ludo board is face up; a hokm hand is not, the trump pause at three
 * and four means that for the first action of every hand exactly one player is entitled to see
 * anything, and the two-handed draw adds an offer and a glimpse only the drawer may see. That is
 * composed here, per seat, and never filtered after the fact.
 */
export const hokmEngine: Engine<HokmState, HokmAction> = {
    id: 'hokm',

    seats: SEATS,

    create: (seats: readonly number[], draws: Draws, table: TableConfig) =>
        create(seats.length, table.target > 0 ? table.target : 7, (sides) => draws.die(sides)),

    /**
     * A play addressed to another game, or one missing the thing its verb needs, is null - the
     * route answers both the same way because both mean the same to whoever sent it.
     *
     * The wire bounds a card to the deck and a suit to the four; whether this player HOLDS that card
     * is the engine's question and is asked inside `apply`, where the hand is.
     */
    parse: (play: MatchPlay, seat: number): HokmAction | null =>
    {
        if (play.kind !== 'hokm')
        {
            return null;
        }

        if (play.verb === 'trump')
        {
            return play.suit === undefined ? null : { kind: 'trump', seat, suit: play.suit as Suit };
        }

        if (play.verb === 'discard')
        {
            return play.cards === undefined || play.card !== undefined ? null : { kind: 'discard', seat, cards: [...play.cards] };
        }

        if (play.verb === 'keep' || play.verb === 'reject')
        {
            return play.card !== undefined || play.cards !== undefined ? null : { kind: play.verb, seat };
        }

        return play.card === undefined ? null : { kind: 'card', seat, card: play.card };
    },

    forfeit: (seat: number, reason: ForfeitReason): HokmAction => ({ kind: 'forfeit', seat, reason }),

    apply: (state: HokmState, action: HokmAction, draws: Draws) =>
        apply(state, action, (sides) => draws.die(sides)),

    legal: (state: HokmState, seat: number) => legalMoves(state, seat),

    /**
     * During the pause the Hâkem is on turn even though nobody has played a card, which is what puts
     * a clock on the trump call rather than leaving a table waiting on one person forever.
     */
    turnOf: (state: HokmState): number | null =>
    {
        if (state.winner !== null)
        {
            return null;
        }

        return state.phase === 'trump' ? state.hakem : state.turn;
    },

    autoplay: (state: HokmState, seat: number, draws: Draws) =>
        autoplay(state, seat, (sides) => draws.die(sides)),

    finish: (state: HokmState): Ending | null =>
    {
        if (state.winner === null)
        {
            return null;
        }

        const winners = seatsOfSide(state.winner, state.seats);

        if (state.points[state.winner] >= state.target)
        {
            return { winners, unsettled: [], trailing: [] };
        }

        const unsettled = Array.from({ length: state.seats }, (_, seat) => seat).filter((seat) => state.out[seat] !== true);
        const live = sidesOf(state).filter((side) => !gone(state, side));
        const tricksOf = (side: number) => seatsOfSide(side, state.seats).reduce((total, seat) => total + (state.tricks[seat] ?? 0), 0);
        const behind = (side: number, than: number) =>
            state.points[side] < state.points[than] || (state.points[side] === state.points[than] && tricksOf(side) < tricksOf(than));
        const trails = (seat: number) => live.some((side) => side !== sideOf(seat, state.seats) && behind(sideOf(seat, state.seats), side));

        return { winners, unsettled, trailing: unsettled.filter(trails) };
    },

    standings: (state: HokmState): Placement[] =>
    {
        const better = (side: number, than: number) =>
            gone(state, side) !== gone(state, than) ? !gone(state, side) : state.points[side] > state.points[than];

        return Array.from({ length: state.seats }, (_, seat) =>
        {
            const side = sideOf(seat, state.seats);

            return { seat, place: 1 + sidesOf(state).filter((other) => better(other, side)).length };
        });
    },

    sideOf: (seat: number, seats: number) => sideOf(seat, seats),

    engagement: (seats: number) => ({ verbs: ['card'], after: seats === 3 ? TRIPLE_SWEEP : winningTricks(seats) }),

    turnKey: (state: HokmState) =>
    {
        const played = `${ state.round }.${ state.tricks.reduce((total, count) => total + count, 0) }`;

        return state.seats === 2 && state.phase !== 'tricks' ? `${ played }.${ state.phase }.${ state.stock.length }` : played;
    },

    view: (state: HokmState, seat: number | null): MatchBoard =>
    {
        const mine = seat === null ? [] : (state.hands[seat] ?? []);

        const led = state.trick.length === 0 ? null : suitOf(state.trick[0]);

        const plays = seat === null || state.phase !== 'tricks' || seat !== state.turn
            ? []
            : legalCards(mine, led);

        const board: MatchBoard = {
            kind: 'hokm',
            phase: state.phase,
            hakem: state.hakem,
            dealer: dealerSeat(state),
            turn: state.phase === 'trump' ? state.hakem : state.turn,
            lead: state.lead,
            hand: [...mine],
            plays,
            trick: [...state.trick],
            seats: state.hands.map((held, index) => ({
                seat: index,
                side: sideOf(index, state.seats),
                held: held.length,
                tricks: state.tricks[index] ?? 0,
                out: state.out[index] === true
            })),
            points: [...state.points],
            target: state.target,
            round: state.round,
            needed: state.seats === 3 ? trickCount(3) : winningTricks(state.seats),
            full: trickCount(state.seats)
        };

        const drawing = seat !== null && seat === state.turn;
        const due = state.phase === 'discard' && drawing ? { discard: discardDue(state, seat) } : {};
        const offer = state.phase === 'draw' && drawing && state.offer !== null ? { offer: state.offer } : {};
        const glimpse = seat === null || (state.glimpse[seat] ?? null) === null ? {} : { glimpse: state.glimpse[seat] as number };
        const stock = state.seats === 2 && state.phase !== 'tricks' ? { stock: state.stock.length } : {};
        const composed: MatchBoard = { ...board, ...due, ...offer, ...glimpse, ...stock };

        const gathered = state.took === null
            ? composed
            : { ...composed, took: { lead: state.took.lead, cards: [...state.took.cards], seat: state.took.seat } };

        return state.trump === null ? gathered : { ...gathered, trump: state.trump };
    },

    /**
     * Every event, to everybody, and here that is a fact about the LEDGER rather than a filter.
     *
     * A card is played face up, a trump is called out loud, a trick is taken in front of the table
     * and a hand is written on a score sheet. The private things in hokm are the deal, the draw and
     * the cards put face down, and none of them is an event - a discard or a draw names only the
     * seat - so there is nothing in this stream to withhold from anybody, and
     * `hokm-seam.spec.ts` asserts a whole match's log holds no card its player did not play.
     */
    log: (events: readonly unknown[]): MatchLog => ({
        kind: 'hokm',
        moves: (events as HokmEvent[]).map((event) => ({ ...event }))
    }),

    /**
     * Tricks are what a hokm player counts, so tricks are what the profile shows - and hands and
     * kots are what it PAYS for, because a trick is a step rather than an achievement. Thirteen a
     * hand over seven hands would be a hundred of them, which would make one hokm match worth five
     * ludo games.
     */
    tally: (events: readonly unknown[]) =>
    {
        const bySeat = new Map<number, Tally>();

        const bump = (seat: number, name: string) =>
        {
            const tally = bySeat.get(seat) ?? {};

            tally[name] = (tally[name] ?? 0) + 1;
            bySeat.set(seat, tally);
        };

        for (const event of events as HokmEvent[])
        {
            if (event.e === 'trick')
            {
                bump(event.seat, 'tricks');
            }

            if (event.e === 'trump')
            {
                bump(event.seat, 'trumps');
            }

            if (event.e === 'hand')
            {
                for (const seat of event.seats)
                {
                    bump(seat, 'hands');

                    if (event.kot)
                    {
                        bump(seat, 'kots');
                    }
                }
            }
        }

        return bySeat;
    },

    points: (tally: Tally) => (tally.hands ?? 0) * XP_HAND + (tally.kots ?? 0) * XP_KOT
};

/** Taking a hand is the unit of progress in hokm, the way a token coming home is in ludo. */
const XP_HAND = 3;

/** A sweep, which is rare enough to be worth noticing and not so rare it never pays. */
const XP_KOT = 5;
