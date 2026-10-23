import { describe, expect, it } from 'vitest';

import { START, parseFen, squareNamed, type Position } from '../src/domains/match/chess/board.ts';
import { inCheck, legalMoves, play, type Move } from '../src/domains/match/chess/moves.ts';
import { sanOf } from '../src/domains/match/chess/san.ts';
import { canMate, deadPosition, keyOf } from '../src/domains/match/chess/status.ts';

/**
 * The Laws of Chess as the engine plays them, an article at a time. The perft spec says the move
 * generator agrees with every other one; this says what each rule is, in positions a person can
 * read.
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

const sq = (name: string) => squareNamed(name)!;

const named = (position: Position) => legalMoves(position).map((move) => sanOf(move, legalMoves(position)));

const find = (position: Position, from: string, to: string, promotion?: Move['promotion']) =>
{
    const move = legalMoves(position).find((one) => one.from === sq(from) && one.to === sq(to) && one.promotion === promotion);

    if (move === undefined)
    {
        throw new Error(`no ${ from }${ to } here`);
    }

    return move;
};

const after = (position: Position, ...moves: string[]) =>
    moves.reduce((current, text) => play(current, find(current, text.slice(0, 2), text.slice(2, 4), (text[4] as Move['promotion']) ?? undefined)), position);

describe('castling (3.8.2)', () =>
{
    it('is open to both sides with the king and both rooks unmoved and nothing between them', () =>
    {
        expect(named(at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'))).toEqual(expect.arrayContaining(['O-O', 'O-O-O']));
        expect(named(at('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'))).toEqual(expect.arrayContaining(['O-O', 'O-O-O']));
    });

    it('is closed to a king in check, passing over an attacked square or landing on one', () =>
    {
        expect(named(at('r3k2r/8/8/8/8/8/4r3/R3K2R w KQ - 0 1')), 'in check').not.toContain('O-O');
        expect(named(at('r3k2r/8/8/8/8/8/4r3/R3K2R w KQ - 0 1')), 'in check').not.toContain('O-O-O');
        expect(named(at('5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1')), 'f1 attacked').not.toContain('O-O');
        expect(named(at('5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1')), 'the other side stays open').toContain('O-O-O');
        expect(named(at('6r1/8/8/8/8/8/8/R3K2R w KQ - 0 1')), 'landing on g1').not.toContain('O-O');
    });

    it('lets the queen side castle with b1 attacked, which the king never crosses', () =>
    {
        expect(named(at('1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'))).toContain('O-O-O');
    });

    it('is closed while a piece stands between the king and the rook', () =>
    {
        expect(named(at('r3k2r/8/8/8/8/8/8/RN2K2R w KQ - 0 1'))).not.toContain('O-O-O');
        expect(named(at('r3k2r/8/8/8/8/8/8/R3KB1R w KQ - 0 1'))).not.toContain('O-O');
    });

    it('moves the rook over the king, and spends both rights of that side', () =>
    {
        const castled = after(at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1g1');

        expect([castled.board[sq('g1')], castled.board[sq('f1')], castled.board[sq('h1')], castled.board[sq('e1')]]).toEqual(['K', 'R', '.', '.']);
        expect(castled.castling).toBe('kq');
        expect(after(at('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'), 'e8c8').board[sq('d8')]).toBe('r');
    });

    it('is lost for good once the king or that rook has moved, or the rook was taken where it stood', () =>
    {
        expect(after(at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1e2').castling).toBe('kq');
        expect(after(at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'a1a2').castling).toBe('Kkq');
        expect(after(at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'h1h8').castling, 'the black rook taken on h8').toBe('Qq');
        expect(named(after(at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1e2', 'e8e7', 'e2e1', 'e7e8')), 'the king back home').not.toContain('O-O');
    });
});

describe('en passant (3.7.3.1)', () =>
{
    it('takes a pawn that has just passed with its double step, and lifts it from its square', () =>
    {
        const ready = after(START, 'e2e4', 'a7a6', 'e4e5', 'd7d5');

        expect(named(ready)).toContain('exd6');

        const taken = after(ready, 'e5d6');

        expect([taken.board[sq('d6')], taken.board[sq('d5')]]).toEqual(['P', '.']);
    });

    it('is only open on the very next move', () =>
    {
        const late = after(START, 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'h2h3', 'h7h6');

        expect(named(late)).not.toContain('exd6');
    });

    it('is not open out of a pin along the rank, where both pawns leaving would expose the king', () =>
    {
        expect(named(at('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1'))).not.toContain('exd6');
        expect(named(at('8/8/8/3pP3/8/8/8/K6k w - d6 0 1'))).toContain('exd6');
    });
});

describe('promotion (3.7.3.3)', () =>
{
    it('offers a queen, a rook, a bishop and a knight, on a step and on a capture', () =>
    {
        const position = at('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1');

        expect(named(position)).toEqual(expect.arrayContaining(['b8=Q', 'b8=R', 'b8=B', 'b8=N', 'bxa8=Q', 'bxa8=R', 'bxa8=B', 'bxa8=N']));
        expect(after(position, 'b7b8n').board[sq('b8')]).toBe('N');
    });
});

describe('check, checkmate and stalemate (1.4, 5.1.1, 5.2.1)', () =>
{
    it('calls the fool’s mate a mate: in check with no legal move', () =>
    {
        const mated = after(START, 'f2f3', 'e7e5', 'g2g4', 'd8h4');

        expect(inCheck(mated)).toBe(true);
        expect(legalMoves(mated)).toEqual([]);
    });

    it('calls a king with no legal move and no check a stalemate', () =>
    {
        const stuck = at('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');

        expect(inCheck(stuck)).toBe(false);
        expect(legalMoves(stuck)).toEqual([]);
    });

    it('never lets a move leave its own king in check', () =>
    {
        const pinned = at('4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1');

        expect(legalMoves(pinned).some((move) => move.from === sq('e2')), 'the pinned knight').toBe(false);
    });
});

describe('a dead position (5.2.2)', () =>
{
    it('is king against king, a lone minor piece against a king, or bishops all on one colour', () =>
    {
        for (const fen of [
            '8/8/8/4k3/8/8/8/4K3 w - - 0 1',
            '8/8/8/4k3/8/8/8/4KB2 w - - 0 1',
            '8/8/8/4k3/8/8/8/4KN2 w - - 0 1',
            '8/8/8/4kb2/8/8/8/4KB2 w - - 0 1'
        ])
        {
            expect(deadPosition(at(fen).board), fen).toBe(true);
        }
    });

    it('is not a position somebody could still be mated from, however unlikely', () =>
    {
        for (const fen of [
            '8/8/8/4k3/8/8/8/4KBB1 w - - 0 1',
            '8/8/8/4kb2/8/8/8/2B1K3 w - - 0 1',
            '8/8/8/4kn2/8/8/8/4KN2 w - - 0 1',
            '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1',
            '4k3/4q3/8/8/8/8/8/4KN2 w - - 0 1',
            '4k3/4r3/8/8/8/8/8/4KB2 w - - 0 1'
        ])
        {
            expect(deadPosition(at(fen).board), fen).toBe(false);
        }
    });
});

describe('whether a side could ever mate (6.9)', () =>
{
    /** White's chances in each position: whether some series of legal moves ends with Black mated. */
    const white = (fen: string) => canMate(at(fen).board, 'w');

    it('says no for a bare king, and for a lone minor piece against a bare king', () =>
    {
        expect(canMate(at('8/8/8/4k3/8/8/8/4KN2 w - - 0 1').board, 'w')).toBe(false);
        expect(canMate(at('8/8/8/4k3/8/8/8/4KN2 w - - 0 1').board, 'b')).toBe(false);
        expect(canMate(at('8/8/8/4kq2/8/8/8/4K3 w - - 0 1').board, 'w')).toBe(false);
        expect(white('8/8/8/4k3/8/8/8/4KB2 w - - 0 1'), 'a bishop').toBe(false);
    });

    it('says yes for a pawn, a rook or a queen, whatever else is on the board', () =>
    {
        expect(canMate(at('8/8/8/4kq2/8/8/8/4K3 w - - 0 1').board, 'b')).toBe(true);
        expect(white('4k3/4q3/8/8/8/8/4P3/4K3 w - - 0 1'), 'a pawn against a queen').toBe(true);
        expect(white('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'a rook').toBe(true);
    });

    it('lets a knight and another minor piece mate a bare king', () =>
    {
        expect(white('8/8/8/4k3/8/8/8/4KNN1 w - - 0 1'), 'two knights').toBe(true);
        expect(white('8/8/8/4k3/8/8/8/4KNB1 w - - 0 1'), 'a knight and a bishop').toBe(true);
    });

    it('lets a lone knight mate a king that has a pawn, a knight, a bishop or a rook to be walled in by', () =>
    {
        expect(white('8/8/8/4kp2/8/8/8/4KN2 w - - 0 1'), 'a pawn').toBe(true);
        expect(white('4k3/4n3/8/8/8/8/8/4KN2 w - - 0 1'), 'a knight').toBe(true);
        expect(white('4k3/4b3/8/8/8/8/8/4KN2 w - - 0 1'), 'a bishop').toBe(true);
        expect(white('4k3/4r3/8/8/8/8/8/4KN2 w - - 0 1'), 'a rook').toBe(true);
        expect(white('4k3/4q3/8/8/8/8/p7/4KN2 w - - 0 1'), 'a queen and a pawn').toBe(true);
    });

    it('never lets a lone knight mate a king that has only queens', () =>
    {
        expect(white('4k3/4q3/8/8/8/8/8/4KN2 w - - 0 1'), 'a queen').toBe(false);
        expect(white('4k3/3qq3/8/8/8/8/8/4KN2 w - - 0 1'), 'two queens').toBe(false);
    });

    it('lets bishops on both colours mate a bare king', () =>
    {
        expect(white('8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1')).toBe(true);
    });

    it('lets bishops of one colour mate a king with a pawn, a knight or a bishop of the other colour', () =>
    {
        expect(white('4k3/4p3/8/8/8/8/8/4KB2 w - - 0 1'), 'a pawn').toBe(true);
        expect(white('4k3/4n3/8/8/8/8/8/4KB2 w - - 0 1'), 'a knight').toBe(true);
        expect(white('4k3/4b3/8/8/8/8/8/4KB2 w - - 0 1'), 'a bishop on e7, the other colour from f1').toBe(true);
        expect(white('4k3/4n3/8/8/8/3B4/8/4KB2 w - - 0 1'), 'two bishops of one colour, against a knight').toBe(true);
    });

    it('never lets bishops of one colour mate a king with only rooks, queens or bishops of their colour', () =>
    {
        expect(white('4k3/4r3/8/8/8/8/8/4KB2 w - - 0 1'), 'a rook').toBe(false);
        expect(white('4k3/4q3/8/8/8/8/8/4KB2 w - - 0 1'), 'a queen').toBe(false);
        expect(white('4k3/3b4/8/8/8/8/8/4KB2 w - - 0 1'), 'a bishop on d7, the colour of f1').toBe(false);
        expect(white('4k3/3br3/8/8/8/8/8/4KB2 w - - 0 1'), 'a rook and a bishop of that colour').toBe(false);
        expect(white('4k3/4r3/8/8/8/3B4/8/4KB2 w - - 0 1'), 'two bishops of one colour, against a rook').toBe(false);
    });
});

describe('the same position (9.2.2)', () =>
{
    it('counts an en passant square only where a capture on it can be made', () =>
    {
        const open = after(START, 'e2e4', 'a7a6', 'e4e5', 'd7d5');
        const shut = after(START, 'e2e4');

        expect(keyOf(open, legalMoves(open))).toContain(` ${ sq('d6') }`);
        expect(keyOf(shut, legalMoves(shut)).endsWith(' -')).toBe(true);
    });

    it('tells the castling rights apart', () =>
    {
        const both = at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
        const none = at('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');

        expect(keyOf(both, legalMoves(both))).not.toBe(keyOf(none, legalMoves(none)));
    });
});

describe('a move written down (standard algebraic notation)', () =>
{
    it('writes pawn steps, captures and the pieces by their letters', () =>
    {
        expect(named(START)).toEqual(expect.arrayContaining(['e4', 'e3', 'Nf3', 'Nc3']));
        expect(named(after(START, 'e2e4', 'd7d5'))).toContain('exd5');
    });

    it('names the file, then the rank, then both, of a piece another of its kind could replace', () =>
    {
        expect(named(at('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1'))).toEqual(expect.arrayContaining(['Nbd2', 'Nfd2']));
        expect(named(at('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1'))).toEqual(expect.arrayContaining(['R1a3', 'R5a3']));
        expect(named(at('1k6/8/8/8/4Q2Q/8/8/K6Q w - - 0 1'))).toContain('Qh4e1');
    });

    it('needs nothing of a twin that is pinned', () =>
    {
        expect(named(at('4k3/8/2b5/8/8/5N2/8/1N5K w - - 0 1'))).toEqual(expect.arrayContaining(['Nd2']));
        expect(named(at('4k3/8/2b5/8/8/5N2/8/1N5K w - - 0 1'))).not.toContain('Nbd2');
    });

    it('writes castling and promotion as the rules do', () =>
    {
        expect(named(at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'))).toEqual(expect.arrayContaining(['O-O', 'O-O-O']));
        expect(named(at('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1'))).toEqual(expect.arrayContaining(['b8=Q', 'b8=N']));
    });
});
