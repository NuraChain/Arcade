import { bankOf } from '../chess/clock.ts';
import { SEATS, apply, autoplay, create, endingOf, legalActions, placesOf, tallyOf } from '../chess/engine.ts';
import { turnSeat, type ChessAction, type ChessEvent, type ChessState } from '../chess/state.ts';
import { sideOf } from '../sides.ts';
import type { Draws, Engine, ForfeitReason, Moment, TableConfig, Tally } from '../engine.ts';
import type { MatchBoard, MatchLog, MatchPlay } from '../../../schemas.ts';

const XP_CAP = 25;

const XP_PROMOTION = 2;

const XP_MATE = 3;

export const chessEngine: Engine<ChessState, ChessAction> = {
    id: 'chess',

    formats: SEATS.map((seats) => ({ seats, variant: 'standard' })),

    /** The colours are drawn for every game, as a die is, so at a table played for NURA they come from the fair seed. */
    create: (_seats: readonly number[], draws: Draws, table: TableConfig) => create(draws.die(2) - 1, table.clock ?? null),

    parse: (play: MatchPlay, seat: number): ChessAction | null =>
    {
        if (play.kind !== 'chess')
        {
            return null;
        }

        if (play.verb !== 'move')
        {
            return play.from === undefined && play.to === undefined && play.promotion === undefined ? { kind: play.verb, seat } : null;
        }

        if (play.from === undefined || play.to === undefined)
        {
            return null;
        }

        return { kind: 'move', seat, from: play.from, to: play.to, ...(play.promotion === undefined ? {} : { promotion: play.promotion }) };
    },

    forfeit: (seat: number, reason: ForfeitReason): ChessAction => ({ kind: 'forfeit', seat, reason }),

    apply: (state: ChessState, action: ChessAction, _draws: Draws, moment?: Moment) => apply(state, action, moment),

    bank: (state: ChessState) => bankOf(state),

    concede: (seat: number): ChessAction => ({ kind: 'resign', seat }),

    legal: (state: ChessState, seat: number) => legalActions(state, seat),

    turnOf: (state: ChessState) => (state.over === null ? turnSeat(state) : null),

    autoplay: (state: ChessState, seat: number) => autoplay(state, seat),

    finish: (state: ChessState) => endingOf(state),

    standings: (state: ChessState) => placesOf(state),

    sideOf,

    engagement: () => ({ verbs: ['move'], after: 1 }),

    turnKey: (state: ChessState) => String(state.ply),

    view: (state: ChessState): MatchBoard =>
    {
        const { position } = state;

        return {
            kind: 'chess',
            white: state.white,
            board: position.board,
            turn: position.turn,
            castling: position.castling,
            ...(position.ep === null ? {} : { ep: position.ep }),
            halfmove: position.halfmove,
            fullmove: position.fullmove,
            ply: state.ply,
            ...(state.last === null ? {} : { last: { ...state.last } }),
            ...(state.clock === null ? {} : { clock: { base: state.clock.base, increment: state.clock.increment, left: [...state.clock.left] } }),
            moved: [...state.moved],
            ...(state.offer === null ? {} : { offer: state.offer }),
            offered: [...state.offered],
            ...(state.over === null ? {} : { over: state.over.winner === null ? { reason: state.over.reason } : { reason: state.over.reason, winner: state.over.winner } })
        };
    },

    log: (events: readonly unknown[]): MatchLog => ({
        kind: 'chess',
        moves: (events as ChessEvent[]).map((event) => ({ ...event }))
    }),

    tally: (events: readonly unknown[]) => tallyOf(events as ChessEvent[]),

    points: (tally: Tally) =>
        Math.min(XP_CAP, (tally.captures ?? 0) + XP_PROMOTION * (tally.promotions ?? 0) + XP_MATE * (tally.checkmates ?? 0))
};
