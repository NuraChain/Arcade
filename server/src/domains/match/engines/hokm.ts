import { legalCards, suitOf, type Suit } from '../hokm/cards.ts';
import { apply, autoplay, create, dealerSeat, legalMoves, SEATS } from '../hokm/engine.ts';
import { trickCount, winningTricks } from '../hokm/scoring.ts';
import { sideCount, sideOf, type HokmAction, type HokmEvent, type HokmState } from '../hokm/state.ts';
import type { Draws, Ending, Engine, ForfeitReason, Placement, TableConfig, Tally } from '../engine.ts';
import type { MatchBoard, MatchLog, MatchPlay } from '../../../schemas.ts';

/**
 * Hokm, behind the seam every game sits behind.
 *
 * An adapter and nothing more: not one rule lives here, and `hokm/` is untouched by it. It sits
 * outside that directory for the reason ludo's does - the purity spec reads `hokm/` as text and
 * refuses an import from anywhere else, correctly, because the rule is about keeping the RULES pure
 * and an adapter is plumbing.
 *
 * **`view` is the reason this game needed the seam at all.** Ludo could have shipped with one
 * payload for everybody because a ludo board is face up; a hokm hand is not, and the trump pause
 * means that for the first action of every hand there is exactly one player in the world entitled
 * to see anything. That is composed here, per seat, and never filtered after the fact.
 */
export const hokmEngine: Engine<HokmState, HokmAction> = {
    id: 'hokm',

    seats: SEATS,

    create: (seats: readonly number[], draws: Draws, table: TableConfig): HokmState =>
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

        return play.card === undefined ? null : { kind: 'card', seat, card: play.card };
    },

    forfeit: (seat: number, reason: ForfeitReason): HokmAction => ({ kind: 'forfeit', seat, reason }),

    apply: (state: HokmState, action: HokmAction, draws: Draws) =>
        apply(state, action, (sides) => draws.die(sides)),

    legal: (state: HokmState, seat: number): HokmAction[] => legalMoves(state, seat),

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

    autoplay: (state: HokmState, seat: number, draws: Draws): HokmAction | null =>
        autoplay(state, seat, (sides) => draws.die(sides)),

    /**
     * A match that reached its target was WON; one that stopped because somebody walked out was not,
     * whoever is left holding the most points. That is the same distinction ludo draws by looking at
     * the board, and it is what keeps a walkout out of the rating.
     */
    finish: (state: HokmState): Ending | null =>
    {
        if (state.winner === null)
        {
            return null;
        }

        const winners = Array.from({ length: state.seats }, (_, seat) => seat)
            .filter((seat) => sideOf(seat, state.seats) === state.winner);

        const played = state.points[state.winner] >= state.target;

        return { winners, outcome: played ? 'won' : 'abandoned' };
    },

    /**
     * Placed by match points, which is the only ranking hokm produces - a side either got there
     * first or did not. Partners share a place because they shared the match.
     */
    standings: (state: HokmState): Placement[] =>
    {
        const order = Array.from({ length: sideCount(state.seats) }, (_, side) => side)
            .sort((a, b) => state.points[b] - state.points[a]);

        return Array.from({ length: state.seats }, (_, seat) =>
            ({ seat, place: order.indexOf(sideOf(seat, state.seats)) + 1 }));
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
            needed: state.seats === 3 ? trickCount(3) : winningTricks(state.seats)
        };

        const gathered = state.took === null
            ? board
            : { ...board, took: { lead: state.took.lead, cards: [...state.took.cards], seat: state.took.seat } };

        return state.trump === null ? gathered : { ...gathered, trump: state.trump };
    },

    /**
     * Every event, to everybody, and here that is a fact about the LEDGER rather than a filter.
     *
     * A card is played face up, a trump is called out loud, a trick is taken in front of the table
     * and a hand is written on a score sheet. The one private thing in hokm is the deal, and the
     * deal is not an event - so there is nothing in this stream to withhold from anybody, and
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
    tally: (events: readonly unknown[]): Map<number, Tally> =>
    {
        const bySeat = new Map<number, Tally>();

        const bump = (seat: number, name: string): void =>
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

    points: (tally: Tally): number => (tally.hands ?? 0) * XP_HAND + (tally.kots ?? 0) * XP_KOT
};

/** Taking a hand is the unit of progress in hokm, the way a token coming home is in ludo. */
const XP_HAND = 3;

/** A sweep, which is rare enough to be worth noticing and not so rare it never pays. */
const XP_KOT = 5;
