import { describe, it, expect } from 'vitest';

import { coachOf, SHORT_MS } from '../src/game/helpers/chess.ts';
import { seeded } from '../src/game/stage/curves.ts';
import { kindOf, parseFen } from '../../backend/src/domains/match/chess/board.ts';
import { inCheck, legalMoves } from '../../backend/src/domains/match/chess/moves.ts';
import type { ChessState } from '../../backend/src/domains/match/chess/state.ts';
import { chessEngine } from '../../backend/src/domains/match/engines/chess.ts';
import type { Draws } from '../../backend/src/domains/match/engine.ts';
import { en } from '../src/locales/en/index.ts';
import { fa } from '../src/locales/fa/index.ts';

type Board = Extract<ReturnType<typeof chessEngine.view>, { kind: 'chess' }>;

const ONE: Draws = { die: () => 1 };

const viewOf = (state: ChessState) => chessEngine.view(state, null) as Board;

const fresh = () => chessEngine.create([0, 1], ONE, { target: 0, cube: false, blinds: 'low', variant: 'standard' }).state;

/** A position from FEN with both sides past their first move, White at seat 0, after a dozen moves. */
const at = (fen: string, over: Partial<ChessState> = {}): Board => viewOf({ ...fresh(), position: parseFen(fen)!, moved: [true, true], ply: 24, ...over });

const keyOf = (view: Board, mine: number | undefined, left: number | null = null) => coachOf(view, mine, left)?.key ?? null;

describe('the chess coach', () =>
{
    it('says nothing to somebody watching', () =>
    {
        expect(keyOf(at('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1'), undefined)).toBeNull();
    });

    it('tells the reader their clock waits for their first move, and the 30 seconds it has', () =>
    {
        const start = viewOf(fresh());

        expect(start.turn).toBe('w');
        expect(keyOf(start, start.white)).toBe('helpers.chess.tip.first');
        expect(keyOf(start, 1 - start.white)).toBe('helpers.chess.tip.waitFirst');
    });

    it('tells each side about the first move until that side has made one', () =>
    {
        const replied = at('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { moved: [true, false], ply: 1 });
        const both = at('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', { ply: 2 });

        expect(keyOf(replied, 0)).toBe('helpers.chess.tip.waitFirst');
        expect(keyOf(replied, 1)).toBe('helpers.chess.tip.first');
        expect(keyOf(both, 1)).toBeNull();
    });

    it('says how to get out of check, and that only the king can when nothing else does', () =>
    {
        expect(keyOf(at('4k3/8/8/4r3/R7/8/8/4K3 w - - 0 1'), 0)).toBe('helpers.chess.tip.check');
        expect(keyOf(at('4k3/8/8/8/8/8/3qr3/4K3 w - - 0 1'), 0)).toBe('helpers.chess.tip.checkKing');
    });

    it('names promotion and taking in passing while either can be played', () =>
    {
        expect(keyOf(at('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1'), 0)).toBe('helpers.chess.tip.promote');
        expect(keyOf(at('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), 0)).toBe('helpers.chess.tip.passant');
        expect(keyOf(at('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1'), 0)).toBeNull();
    });

    it('says what running out of time costs only under a minute', () =>
    {
        const quiet = at('4k3/8/8/8/8/8/8/4K3 w - - 0 1');

        expect(keyOf(quiet, 0, SHORT_MS - 1)).toBe('helpers.chess.tip.time');
        expect(keyOf(quiet, 0, SHORT_MS)).toBeNull();
        expect(keyOf(quiet, 0, null)).toBeNull();
    });

    it('mentions castling while the game is young and castling can be played', () =>
    {
        const ready = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

        expect(keyOf(at(ready, { ply: 10 }), 0)).toBe('helpers.chess.tip.castle');
        expect(keyOf(at(ready, { ply: 30 }), 0)).toBeNull();
        expect(keyOf(at('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1', { ply: 10 }), 0)).toBeNull();
    });

    it('warns that the fifty-move draw is near', () =>
    {
        expect(keyOf(at('4k3/8/8/8/8/8/8/R3K3 w - - 80 60'), 0)).toBe('helpers.chess.tip.fifty');
        expect(keyOf(at('4k3/8/8/8/8/8/8/R3K3 w - - 79 60'), 0)).toBeNull();
    });

    it('says nothing while it is the other side’s move after both have moved', () =>
    {
        expect(keyOf(at('4k3/8/8/8/8/8/4r3/R3K3 w Q - 0 1'), 1)).toBeNull();
    });

    it('never says what the engine would contradict, over whole games played at random', () =>
    {
        const random = seeded(23);

        for (let game = 0; game < 24; game += 1)
        {
            let state = fresh();

            for (let ply = 0; ply < 160 && state.over === null; ply += 1)
            {
                const seat = chessEngine.turnOf(state)!;
                const view = viewOf(state);
                const position = { board: view.board, turn: view.turn, castling: view.castling, ep: view.ep ?? null, halfmove: view.halfmove, fullmove: view.fullmove };
                const legal = legalMoves(position);
                const key = keyOf(view, seat);

                if (key === 'helpers.chess.tip.check' || key === 'helpers.chess.tip.checkKing')
                {
                    expect(inCheck(position)).toBe(true);
                    expect(key === 'helpers.chess.tip.checkKing').toBe(legal.every((move) => kindOf(move.piece) === 'k'));
                }
                else if (state.moved[seat])
                {
                    expect(inCheck(position)).toBe(false);
                }

                if (key === 'helpers.chess.tip.promote')
                {
                    expect(legal.some((move) => move.promotion !== undefined)).toBe(true);
                }

                if (key === 'helpers.chess.tip.passant')
                {
                    expect(legal.some((move) => move.enPassant === true)).toBe(true);
                }

                if (key === 'helpers.chess.tip.castle')
                {
                    expect(legal.some((move) => move.castle !== undefined)).toBe(true);
                }

                const actions = chessEngine.legal(state, seat).filter((action) => action.kind === 'move');
                const action = actions[Math.floor(random() * actions.length)];
                const applied = chessEngine.apply(state, action, ONE);

                if (!applied.ok)
                {
                    throw new Error(`refused: ${ applied.reason }`);
                }

                state = applied.state;
            }
        }
    });

    it('has a sentence in both languages for everything it says', () =>
    {
        const keys = ['first', 'waitFirst', 'check', 'checkKing', 'promote', 'passant', 'time', 'castle', 'fifty'].map((name) => `helpers.chess.tip.${ name }`);

        for (const key of keys)
        {
            expect(en[key as keyof typeof en]).toBeTruthy();
            expect(fa[key as keyof typeof fa]).toBeTruthy();
            expect(fa[key as keyof typeof fa]).not.toBe(en[key as keyof typeof en]);
        }
    });
});
