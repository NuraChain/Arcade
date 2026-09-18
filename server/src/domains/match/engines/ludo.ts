import { FINISHED } from '../ludo/board.ts';
import { apply, create, indexOfSeat, legalMoves } from '../ludo/engine.ts';
import { placementsOf } from '../ludo/standings.ts';
import type { EngineAction, LudoState } from '../ludo/state.ts';
import type { Draws, Ending, Engine, Placement } from '../engine.ts';

/**
 * Ludo, behind the seam every game sits behind.
 *
 * An adapter and nothing more: not one rule moved to get here, and `ludo/` is untouched.
 *
 * It lives HERE rather than in `ludo/` because `ludo-purity.spec.ts` reads that directory as text
 * and refuses an import from outside it - correctly. The rule exists to keep the RULES pure, and an
 * adapter is plumbing: it names the seam, the seam names nothing, and putting the two in one
 * directory would have meant relaxing the test that makes the purity real. What this file does is answer the four questions the service used to answer for itself
 * by reaching into ludo's own types - whose turn it is, what a seat may do, whether the game is
 * over, and where everybody came.
 *
 * `finish` is the one with an argument behind it. The engine declares a winner in two quite
 * different situations - somebody brought four tokens home, or everybody else walked out and the
 * last player standing is all that is left - and until `record.ts` learned to tell them apart both
 * were recorded identically, which is a rating farm: three accounts sit down, two leave, the third
 * is handed the win. The test is the board, not the winner field, and it belongs to the engine
 * because only the engine knows what a finished board looks like.
 */
export const ludoEngine: Engine<LudoState, EngineAction> = {
    id: 'ludo',

    create: (seats: readonly number[], draws: Draws): LudoState =>
        create(seats, draws.die(seats.length) - 1),

    apply: (state: LudoState, action: EngineAction) => apply(state, action),

    legal: (state: LudoState, seat: number): EngineAction[] =>
    {
        if (state.winner !== null || indexOfSeat(state, seat) !== state.turn)
        {
            return [];
        }

        if (state.die === null)
        {
            return [{ kind: 'roll', seat, die: 0 }];
        }

        return legalMoves(state).map((piece) => ({ kind: 'move', seat, piece }));
    },

    turnOf: (state: LudoState): number | null =>
        state.winner === null ? (state.players[state.turn]?.seat ?? null) : null,

    autoplay: (state: LudoState, seat: number, draws: Draws): EngineAction | null =>
    {
        if (state.winner !== null)
        {
            return null;
        }

        if (state.die === null)
        {
            return { kind: 'roll', seat, die: draws.die(6) };
        }

        const piece = legalMoves(state)[0];

        return piece === undefined ? null : { kind: 'move', seat, piece };
    },

    finish: (state: LudoState): Ending | null =>
    {
        if (state.winner === null)
        {
            return null;
        }

        const champion = state.players[state.winner];
        const played = champion !== undefined && champion.pieces.every((piece) => piece >= FINISHED);

        return {
            winners: champion === undefined ? [] : [champion.seat],
            outcome: played ? 'won' : 'abandoned'
        };
    },

    standings: (state: LudoState): Placement[] => placementsOf(state)
};
