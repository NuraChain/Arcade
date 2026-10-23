import { describe, it, expect } from 'vitest';

import { boardOf, feltOf, leadOf, rookOf, step, takenBy, type Felt, type Told } from '../src/game/chess-felt.ts';
import { seeded } from '../src/game/stage/curves.ts';
import { parseFen, squareNamed } from '../../backend/src/domains/match/chess/board.ts';
import type { ChessState } from '../../backend/src/domains/match/chess/state.ts';
import { chessEngine } from '../../backend/src/domains/match/engines/chess.ts';
import type { Draws } from '../../backend/src/domains/match/engine.ts';

type Board = Extract<ReturnType<typeof chessEngine.view>, { kind: 'chess' }>;

const sq = (name: string) => squareNamed(name)!;

const ONE: Draws = { die: () => 1 };

const viewOf = (state: ChessState, seat: number | null) => chessEngine.view(state, seat) as Board;

const toldOf = (events: readonly unknown[]) => (chessEngine.log(events, null) as { moves: Told[] }).moves;

const at = (fen: string): ChessState =>
{
    const { state } = chessEngine.create([0, 1], ONE, { target: 0, cube: false, blinds: 'low', variant: 'standard' });

    return { ...state, position: parseFen(fen)!, moved: [true, true] };
};

/** Plays one move by its squares and hands back what the log said and the state after. */
const played = (state: ChessState, from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') =>
{
    const applied = chessEngine.apply(state, { kind: 'move', seat: chessEngine.turnOf(state)!, from: sq(from), to: sq(to), ...(promotion === undefined ? {} : { promotion }) }, ONE);

    if (!applied.ok)
    {
        throw new Error(`${ from }${ to } refused: ${ applied.reason }`);
    }

    return { state: applied.state, told: toldOf(applied.events) };
};

const shown = (felt: Felt, told: readonly Told[]) => told.reduce(step, felt);

describe('the chess table as a board says it stands', () =>
{
    it('keys every piece by its letter and how many of it came before, from a1', () =>
    {
        const felt = feltOf(viewOf(chessEngine.create([0, 1], ONE, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state, null));

        expect(felt.men).toHaveLength(32);
        expect(felt.men.find((man) => man.square === sq('a1'))).toEqual({ key: 'R1', piece: 'R', square: sq('a1') });
        expect(felt.men.find((man) => man.square === sq('h8'))).toEqual({ key: 'r2', piece: 'r', square: sq('h8') });
        expect(new Set(felt.men.map((man) => man.key)).size).toBe(32);
        expect(felt.turn).toBe('w');
        expect(felt.last).toBeNull();
    });
});

describe('the chess table once a move is shown', () =>
{
    it('moves the piece that moved, keeping its key, and hands the move on', () =>
    {
        const start = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        const felt = feltOf(viewOf(start, null));
        const { told } = played(start, 'g1', 'f3');
        const after = shown(felt, told);
        const knight = after.men.find((man) => man.square === sq('f3'));

        expect(knight?.key).toBe(felt.men.find((man) => man.square === sq('g1'))?.key);
        expect(after.last).toEqual({ from: sq('g1'), to: sq('f3') });
        expect(after.turn).toBe('b');
    });

    it('takes a captured piece off, and the pawn passed by en passant from the square behind', () =>
    {
        const captureAt = at('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
        const taken = shown(feltOf(viewOf(captureAt, null)), played(captureAt, 'e4', 'd5').told);

        expect(boardOf(taken.men)).toBe(viewOf(played(captureAt, 'e4', 'd5').state, null).board);
        expect(taken.men).toHaveLength(3);

        const passing = at('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
        const passed = shown(feltOf(viewOf(passing, null)), played(passing, 'e5', 'd6').told);

        expect(passed.men.some((man) => man.square === sq('d5'))).toBe(false);
        expect(passed.men.find((man) => man.square === sq('d6'))?.piece).toBe('P');
    });

    it('carries the rook round the king on either side', () =>
    {
        const castling = at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
        const short = shown(feltOf(viewOf(castling, null)), played(castling, 'e1', 'g1').told);
        const long = shown(feltOf(viewOf(castling, null)), played(castling, 'e1', 'c1').told);

        expect(short.men.find((man) => man.square === sq('f1'))?.key).toBe('R2');
        expect(long.men.find((man) => man.square === sq('d1'))?.key).toBe('R1');
        expect(rookOf(sq('g8'), 'k')).toEqual({ from: sq('h8'), to: sq('f8') });
        expect(rookOf(sq('c8'), 'q')).toEqual({ from: sq('a8'), to: sq('d8') });
    });

    it('turns a pawn on the last rank into its piece under the same key', () =>
    {
        const promoting = at('8/4P2k/8/8/8/8/8/4K3 w - - 0 1');
        const felt = feltOf(viewOf(promoting, null));
        const after = shown(felt, played(promoting, 'e7', 'e8', 'n').told);

        expect(after.men.find((man) => man.square === sq('e8'))).toEqual({ key: 'P1', piece: 'N', square: sq('e8') });
    });

    it('moves nothing for an offer, an answer, a flag or an ending', () =>
    {
        const felt = feltOf(viewOf(at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), null));

        for (const told of [{ e: 'offer', seat: 0 }, { e: 'decline', seat: 1 }, { e: 'flag', seat: 0 }, { e: 'finish', reason: 'flag' }] as Told[])
        {
            expect(step(felt, told)).toBe(felt);
        }
    });
});

describe('the chess table, shown move by move, against the engine', () =>
{
    it('stands where the engine\'s own board stands after every move of whole games, for every reader', () =>
    {
        let moves = 0;
        let captures = 0;
        let castles = 0;

        for (let game = 0; game < 24; game += 1)
        {
            const pick = seeded(500 + game);
            let { state, events } = chessEngine.create([0, 1], { die: () => 1 + (game % 2) }, { target: 0, cube: false, blinds: 'low', variant: 'standard' });
            let felt = feltOf(viewOf(state, 0));

            expect(toldOf(events).every((told) => told.e === 'colours')).toBe(true);

            for (let ply = 0; ply < 300 && chessEngine.finish(state) === null; ply += 1)
            {
                const seat = chessEngine.turnOf(state)!;
                const legal = chessEngine.legal(state, seat);
                const applied = chessEngine.apply(state, legal[Math.floor(pick() * legal.length)], ONE);

                if (!applied.ok)
                {
                    throw new Error(applied.reason);
                }

                ({ state, events } = applied);

                const told = toldOf(events);

                felt = shown(felt, told);
                moves += 1;
                captures += told.filter((one) => one.captured !== undefined).length;
                castles += told.filter((one) => one.castle !== undefined).length;

                for (const reader of [0, 1, null])
                {
                    const board = viewOf(state, reader);

                    expect(boardOf(felt.men), `game ${ game } ply ${ ply }`).toBe(board.board);
                    expect(felt.last).toEqual(board.last);
                    expect(felt.turn).toBe(board.turn);
                }
            }
        }

        expect(moves).toBeGreaterThan(2000);
        expect(captures).toBeGreaterThan(200);
        expect(castles).toBeGreaterThan(0);
    });
});

describe('what each side has taken, and who is ahead', () =>
{
    it('counts the pieces missing from the other side\'s set, queens first', () =>
    {
        const felt = feltOf(viewOf(at('r3k3/8/8/8/8/8/8/4K2R w - - 0 1'), null));

        expect(takenBy(felt.men, 'w')).toEqual(['q', 'r', 'b', 'b', 'n', 'n', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']);
        expect(takenBy(felt.men, 'b')).toEqual(['Q', 'R', 'B', 'B', 'N', 'N', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P']);
        expect(leadOf(felt.men)).toBe(0);
    });

    it('does not count a pawn that became a queen as taken', () =>
    {
        const felt = feltOf(viewOf(at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNQ w Qkq - 0 1'), null));

        expect(takenBy(felt.men, 'b')).toEqual(['R']);
        expect(leadOf(felt.men)).toBe(3);
    });

    it('says how far ahead White is, below nothing when Black leads', () =>
    {
        expect(leadOf(feltOf(viewOf(at('4k3/8/8/8/8/8/8/3QK3 w - - 0 1'), null)).men)).toBe(9);
        expect(leadOf(feltOf(viewOf(at('4k3/3r4/8/8/8/8/8/4K3 w - - 0 1'), null)).men)).toBe(-5);
    });
});
