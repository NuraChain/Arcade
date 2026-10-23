import { describe, it, expect } from 'vitest';

import { pairsOf, pgnOf, type PgnGame } from '../src/lib/pgn.ts';

const LEGAL = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];

const game = (over: Partial<PgnGame> = {}): PgnGame => ({
    site: 'https://baziche.example',
    date: new Date(Date.UTC(2026, 9, 3, 23, 30)),
    white: 'dana.w',
    black: 'sara.k',
    result: '1-0',
    clock: { base: 600_000, increment: 0 },
    notation: LEGAL,
    ...over
});

describe('a game in portable game notation', () =>
{
    it('pairs the moves by number, White\'s first, and leaves Black\'s last one open', () =>
    {
        expect(pairsOf(['e4', 'e5', 'Nf3'])).toEqual([{ n: 1, white: 'e4', black: 'e5' }, { n: 2, white: 'Nf3', black: null }]);
        expect(pairsOf([])).toEqual([]);
    });

    it('opens with the seven tags in their order and the time control, dated by UTC', () =>
    {
        const lines = pgnOf(game()).split('\n');

        expect(lines.slice(0, 8)).toEqual([
            '[Event "Baziche"]',
            '[Site "https://baziche.example"]',
            '[Date "2026.10.03"]',
            '[Round "-"]',
            '[White "dana.w"]',
            '[Black "sara.k"]',
            '[Result "1-0"]',
            '[TimeControl "600"]'
        ]);
        expect(lines[8]).toBe('');
    });

    it('writes a control with an increment as base and increment in seconds, and none for a game a move a day', () =>
    {
        expect(pgnOf(game({ clock: { base: 180_000, increment: 2000 } }))).toContain('[TimeControl "180+2"]');
        expect(pgnOf(game({ clock: undefined }))).not.toContain('TimeControl');
    });

    it('numbers the moves and ends them with the result', () =>
    {
        expect(pgnOf(game())).toContain('\n\n1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0\n');
        expect(pgnOf(game({ notation: [], result: '*' }))).toMatch(/\n\n\*\n$/);
    });

    it('wraps a long game under eighty columns without breaking a move from its number', () =>
    {
        const long = Array.from({ length: 160 }, (_, at) => (at % 2 === 0 ? 'Nf3' : 'Nf6'));
        const moves = pgnOf(game({ notation: long, result: '1/2-1/2' })).split('\n\n')[1].trimEnd().split('\n');

        expect(moves.length).toBeGreaterThan(5);
        expect(moves.every((line) => line.length < 80)).toBe(true);
        expect(moves.filter((line) => /\d+\.$/.test(line))).toEqual([]);
        expect(moves.join(' ')).toBe(`${ Array.from({ length: 80 }, (_, at) => `${ at + 1 }. Nf3 Nf6`).join(' ') } 1/2-1/2`);
    });

    it('carries a move\'s number onto the next line with it, as the walk\'s mate in eight needed', () =>
    {
        const moves = pgnOf(game({ notation: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'O-O', 'Nc6', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'] })).split('\n\n')[1].trimEnd().split('\n');

        expect(moves).toEqual(['1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. O-O Nc6 5. Nc3 g6 6. Nxe5 Bxd1 7. Bxf7+ Ke7', '8. Nd5# 1-0']);
    });

    it('keeps a quote or a backslash in a name from ending its tag', () =>
    {
        expect(pgnOf(game({ white: 'a "quoted" \\name' }))).toContain('[White "a \\"quoted\\" \\\\name"]');
    });
});
