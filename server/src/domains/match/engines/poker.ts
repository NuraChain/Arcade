import { allInTo, inHand, mayRaise, minRaiseTo, toCall } from '../poker/betting.ts';
import { apply, autoplay, create, handsToNextLevel, legalMoves, levelOf, standings, type Die } from '../poker/engine.ts';
import { standing } from '../poker/pots.ts';
import { SEATS, blindsAt, type PokerAction, type PokerEvent, type PokerState } from '../poker/state.ts';
import type { Draws, Ending, Engine, ForfeitReason, Placement, TableConfig, Tally } from '../engine.ts';
import type { MatchBoard, MatchLog, MatchPlay } from '../../../schemas.ts';

const XP_CAP = 25;

const XP_KNOCKOUT = 3;

const RATED_AFTER = 2;

type PokerBoard = Extract<MatchBoard, { kind: 'poker' }>;

const dieOf = (draws: Draws): Die => (sides) => draws.die(sides);

function readerOf(state: PokerState, seat: number | null): number | null
{
    return seat !== null && Number.isInteger(seat) && seat >= 0 && seat < state.seats ? seat : null;
}

export const pokerEngine: Engine<PokerState, PokerAction> = {
    id: 'poker',

    seats: SEATS,

    create: (seats: readonly number[], draws: Draws, table: TableConfig): PokerState =>
        create(seats.length, table.blinds, dieOf(draws)),

    parse: (play: MatchPlay, seat: number): PokerAction | null =>
    {
        if (play.kind !== 'poker')
        {
            return null;
        }

        if (play.verb === 'raise')
        {
            return play.amount === undefined ? null : { kind: 'raise', seat, amount: play.amount };
        }

        return play.amount === undefined ? { kind: play.verb, seat } : null;
    },

    forfeit: (seat: number, reason: ForfeitReason): PokerAction => ({ kind: 'forfeit', seat, reason }),

    apply: (state: PokerState, action: PokerAction, draws: Draws) => apply(state, action, dieOf(draws)),

    legal: (state: PokerState, seat: number): PokerAction[] => legalMoves(state, seat),

    turnOf: (state: PokerState): number | null => (state.winner === null && state.turn >= 0 ? state.turn : null),

    autoplay: (state: PokerState, seat: number): PokerAction | null => autoplay(state, seat),

    finish: (state: PokerState): Ending | null =>
    {
        if (state.winner === null)
        {
            return null;
        }

        const opponents = state.exits.filter((_, seat) => seat !== state.winner);

        const played = state.seats === 2
            ? opponents[0] === 'chips' || state.acts.every((count) => count >= RATED_AFTER)
            : opponents.some((exit) => exit !== 'timeout');

        return { winners: [state.winner], outcome: played ? 'won' : 'abandoned' };
    },

    standings: (state: PokerState): Placement[] => standings(state),

    view: (state: PokerState, seat: number | null): MatchBoard =>
    {
        const reader = readerOf(state, seat);
        const { small, big } = blindsAt(levelOf(state));

        const board: PokerBoard = {
            kind: 'poker',
            street: state.street,
            hand: Math.max(1, state.hand),
            button: state.button,
            board: [...state.board],
            pot: state.put.reduce((sum, chips) => sum + chips, 0),
            pots: standing(state.put, state.folded, state.stacks.map((stack, index) => inHand(state, index) && stack === 0)).map((pot) => ({ amount: pot.amount, eligible: [...pot.eligible] })),
            seats: state.stacks.map((stack, index) => ({
                seat: index,
                stack,
                bet: state.bets[index],
                folded: state.folded[index] && !state.out[index],
                allIn: inHand(state, index) && stack === 0,
                out: state.out[index]
            })),
            blinds: { small, big, level: levelOf(state) + 1, next: handsToNextLevel(state) },
            hole: reader === null || state.folded[reader] || state.out[reader] ? [] : [...state.holes[reader]]
        };

        const live = state.winner === null && state.turn >= 0;
        const acting = live && reader === state.turn;

        return {
            ...board,
            ...(live ? { turn: state.turn } : {}),
            ...(acting ? { toCall: toCall(state, state.turn) } : {}),
            ...(acting && mayRaise(state, state.turn)
                ? { minRaiseTo: minRaiseTo(state, state.turn), maxRaiseTo: allInTo(state, state.turn) }
                : {}),
            ...(state.last === null
                ? {}
                : {
                    last: {
                        board: [...state.last.board],
                        shown: state.last.shown.map((row) => ({ seat: row.seat, cards: [...row.cards], category: row.category })),
                        pots: state.last.pots.map((pot) => ({ amount: pot.amount, winners: [...pot.winners] }))
                    }
                }),
            ...(state.winner === null ? {} : { winner: state.winner })
        };
    },

    log: (events: readonly unknown[]): MatchLog => ({
        kind: 'poker',
        moves: (events as PokerEvent[])
            .flatMap((event) => (event.e === 'hole' ? [] : [{ ...event }]))
    }),

    tally: (events: readonly unknown[]): Map<number, Tally> =>
    {
        const bySeat = new Map<number, Tally>();

        const bump = (seat: number, name: string): void =>
        {
            const tally = bySeat.get(seat) ?? {};

            tally[name] = (tally[name] ?? 0) + 1;
            bySeat.set(seat, tally);
        };

        for (const event of events as PokerEvent[])
        {
            if (event.e === 'end')
            {
                event.dealt.forEach((seat) => bump(seat, 'hands'));
            }

            if (event.e === 'pot')
            {
                event.winners.forEach((seat) => bump(seat, 'pots'));
            }

            if (event.e === 'show')
            {
                bump(event.seat, 'showdowns');
            }

            if (event.e === 'bust')
            {
                event.by.forEach((seat) => bump(seat, 'knockouts'));
            }
        }

        return bySeat;
    },

    points: (tally: Tally): number => Math.min(XP_CAP, (tally.pots ?? 0) + XP_KNOCKOUT * (tally.knockouts ?? 0))
};
