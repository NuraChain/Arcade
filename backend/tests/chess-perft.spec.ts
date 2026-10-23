import { describe, expect, it } from 'vitest';

import { START, fenOf, parseFen } from '../src/domains/match/chess/board.ts';
import { perft } from '../src/domains/match/chess/moves.ts';

/**
 * The move generator held to the counts every chess programmer checks against.
 *
 * Perft counts the move sequences of a given length from a position. A generator that lets a king
 * castle through check, takes en passant out of a pin or forgets an under-promotion is off by
 * thousands, so these numbers say more about the rules than any example can. The positions and
 * their counts are the chessprogramming wiki's (Perft Results), published and agreed by every
 * engine that has been checked against them.
 */

const at = (fen: string) =>
{
    const position = parseFen(fen);

    if (position === null)
    {
        throw new Error(`not a position: ${ fen }`);
    }

    return position;
};

const POSITIONS: readonly { name: string; fen: string; counts: readonly number[] }[] = [
    {
        name: 'the start',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        counts: [20, 400, 8902, 197_281]
    },
    {
        name: 'Kiwipete, every special move at once',
        fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
        counts: [48, 2039, 97_862]
    },
    {
        name: 'position 3, an en passant out of a pin along the rank',
        fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
        counts: [14, 191, 2812, 43_238]
    },
    {
        name: 'position 4, promotions and castling under fire',
        fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
        counts: [6, 264, 9467, 422_333]
    },
    {
        name: 'position 5, a promotion that captures and gives check',
        fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
        counts: [44, 1486, 62_379]
    },
    {
        name: 'position 6, a quiet middle game',
        fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
        counts: [46, 2079, 89_890]
    }
];

describe('the move generator, counted', () =>
{
    for (const { name, fen, counts } of POSITIONS)
    {
        it(`counts ${ name } to depth ${ counts.length }`, { timeout: 120_000 }, () =>
        {
            const position = at(fen);

            expect(counts.map((_, depth) => perft(position, depth + 1)), fen).toEqual(counts);
        });
    }

    it('reads and writes every one of those positions as it was given', () =>
    {
        for (const { fen } of POSITIONS)
        {
            expect(fenOf(at(fen))).toBe(fen);
        }

        expect(fenOf(START)).toBe(POSITIONS[0].fen);
    });

    it('refuses text that is not a position', () =>
    {
        for (const fen of [
            '',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1',
            'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            'rnbqkbnr/ppppxppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w QK - 0 1',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq z9 0 1',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - -1 1'
        ])
        {
            expect(parseFen(fen), fen).toBeNull();
        }
    });
});
