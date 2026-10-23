import { describe, it, expect } from 'vitest';

import { replayOf } from '../src/game/chess-replay.ts';
import { START, fenOf, squareNamed } from '../../backend/src/domains/match/chess/board.ts';

const sq = (name: string) => squareNamed(name)!;

describe('a finished game read back from its moves', () =>
{
    it('reaches every position from the start, the check and mate marks aside, with the move that led to each', () =>
    {
        const replay = replayOf(['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#']);

        expect(replay).toHaveLength(14);
        expect(replay[0]).toEqual({ position: START, move: null, legal: [] });
        expect(replay[3].move).toMatchObject({ from: sq('g1'), to: sq('f3'), piece: 'N' });
        expect(replay[3].legal.length).toBe(29);
        expect(replay[11].move).toMatchObject({ from: sq('c4'), to: sq('f7'), captured: 'p' });
        expect(fenOf(replay[13].position).startsWith('rn1q1bnr/ppp1kB1p/3p2p1/3NN3/4P3/8/PPPP1PPP/R1BbK2R b ')).toBe(true);
    });

    it('reads a pawn taken in passing, a promotion that takes, castling and a knight named by its file', () =>
    {
        const passing = replayOf(['e4', 'd5', 'e5', 'f5', 'exf6', 'Nc6', 'fxg7', 'Nf6', 'gxh8=Q']);

        expect(passing).toHaveLength(10);
        expect(passing[5].move).toMatchObject({ from: sq('e5'), to: sq('f6'), enPassant: true });
        expect(passing[9].move).toMatchObject({ from: sq('g7'), to: sq('h8'), promotion: 'q', captured: 'r' });

        expect(replayOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']).at(-1)?.move).toMatchObject({ from: sq('e1'), to: sq('g1'), castle: 'k' });
        expect(replayOf(['Nf3', 'd5', 'd3', 'e5', 'Nbd2']).at(-1)?.move).toMatchObject({ from: sq('b1'), to: sq('d2') });
    });

    it('stops at a move the position before it could not have played', () =>
    {
        expect(replayOf(['e4', 'e5', 'Ke3', 'Nf3'])).toHaveLength(3);
        expect(replayOf([])).toHaveLength(1);
    });
});
