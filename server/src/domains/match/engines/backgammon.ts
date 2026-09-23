import { OFF, pips } from '../backgammon/board.ts';
import { mayDouble } from '../backgammon/cube.ts';
import { SEATS, apply, autoplay, create, legalMoves, type Die } from '../backgammon/engine.ts';
import type { BackgammonAction, BackgammonEvent, BackgammonState } from '../backgammon/state.ts';
import type { Draws, Ending, Engine, ForfeitReason, Placement, TableConfig, Tally } from '../engine.ts';
import type { MatchBoard, MatchLog, MatchPlay } from '../../../schemas.ts';

const XP_CAP = 25;

const XP_GAME = 3;

const XP_GAMMON = 3;

const RATED_AFTER = 2;

const roller = (draws: Draws): Die => (sides) => draws.die(sides);

export const backgammonEngine: Engine<BackgammonState, BackgammonAction> = {
    id: 'backgammon',

    seats: SEATS,

    create: (_seats: readonly number[], draws: Draws, table: TableConfig): BackgammonState =>
        create(table.target > 0 ? table.target : 1, table.cube, roller(draws)),

    parse: (play: MatchPlay, seat: number): BackgammonAction | null =>
    {
        if (play.kind !== 'backgammon')
        {
            return null;
        }

        if (play.verb !== 'move')
        {
            return play.hops === undefined ? { kind: play.verb, seat } : null;
        }

        if (play.hops === undefined || play.hops.some((hop) => hop.to >= hop.from))
        {
            return null;
        }

        return { kind: 'move', seat, hops: play.hops.map((hop) => ({ from: hop.from, to: hop.to })) };
    },

    forfeit: (seat: number, reason: ForfeitReason): BackgammonAction => ({ kind: 'forfeit', seat, reason }),

    apply: (state: BackgammonState, action: BackgammonAction, draws: Draws) =>
        apply(state, action, roller(draws)),

    legal: (state: BackgammonState, seat: number): BackgammonAction[] => legalMoves(state, seat),

    turnOf: (state: BackgammonState): number | null =>
    {
        if (state.winner !== null)
        {
            return null;
        }

        return state.phase === 'double' ? 1 - state.turn : state.turn;
    },

    autoplay: (state: BackgammonState, seat: number): BackgammonAction | null => autoplay(state, seat),

    finish: (state: BackgammonState): Ending | null =>
    {
        if (state.winner === null)
        {
            return null;
        }

        const played = state.score[state.winner] >= state.target
            || state.acted.every((count) => count >= RATED_AFTER);

        return { winners: [state.winner], outcome: played ? 'won' : 'abandoned' };
    },

    standings: (state: BackgammonState): Placement[] =>
        [0, 1].map((seat) => ({
            seat,
            place: state.winner === null
                ? (state.score[1 - seat] > state.score[seat] ? 2 : 1)
                : (seat === state.winner ? 1 : 2)
        })),

    view: (state: BackgammonState): MatchBoard =>
    {
        const board: MatchBoard = {
            kind: 'backgammon',
            phase: state.phase,
            turn: state.phase === 'double' ? 1 - state.turn : state.turn,
            dice: [...state.dice],
            seats: state.checkers.map((checkers, seat) => ({
                seat,
                checkers: [...checkers],
                pips: pips(checkers),
                score: state.score[seat]
            })),
            cubed: state.cubed,
            cube: state.cube,
            doubling: state.phase === 'roll' && mayDouble(state, state.turn),
            crawford: state.crawford === 'now',
            target: state.target,
            round: state.round
        };

        return state.owner === null ? board : { ...board, owner: state.owner };
    },

    log: (events: readonly unknown[]): MatchLog => ({
        kind: 'backgammon',
        moves: (events as BackgammonEvent[]).map((event) => ({ ...event }))
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

        for (const event of events as BackgammonEvent[])
        {
            if (event.e === 'move' && event.hit)
            {
                bump(event.seat, 'hits');
            }

            if (event.e === 'move' && event.to === OFF)
            {
                bump(event.seat, 'borneOff');
            }

            if (event.e === 'game')
            {
                bump(event.seat, 'games');

                if (event.how !== 'single')
                {
                    bump(event.seat, 'gammons');
                }

                if (event.how === 'backgammon')
                {
                    bump(event.seat, 'backgammons');
                }
            }
        }

        return bySeat;
    },

    points: (tally: Tally): number =>
        Math.min(XP_CAP, XP_GAME * (tally.games ?? 0) + XP_GAMMON * (tally.gammons ?? 0))
};
