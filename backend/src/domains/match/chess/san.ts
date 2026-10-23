import { FILES, fileOf, kindOf, nameOf, rankOf } from './board.ts';
import type { Move } from './moves.ts';

/**
 * A move in standard algebraic notation, without the `+` or `#` after it, which the engine adds
 * once it has played the move.
 *
 * Another piece of the same kind that could LEGALLY reach the same square is what calls for a
 * file, a rank or both, so a pinned knight never makes its twin write its file.
 */
export function sanOf(move: Move, legal: readonly Move[]): string
{
    if (move.castle !== undefined)
    {
        return move.castle === 'k' ? 'O-O' : 'O-O-O';
    }

    const takes = move.captured === undefined ? '' : 'x';
    const square = nameOf(move.to);

    if (kindOf(move.piece) === 'p')
    {
        const file = takes === '' ? '' : FILES[fileOf(move.from)];
        const promotion = move.promotion === undefined ? '' : `=${ move.promotion.toUpperCase() }`;

        return `${ file }${ takes }${ square }${ promotion }`;
    }

    const twins = legal.filter((other) => other.to === move.to && other.piece === move.piece && other.from !== move.from);
    let from = '';

    if (twins.length > 0)
    {
        const sameFile = twins.some((other) => fileOf(other.from) === fileOf(move.from));
        const sameRank = twins.some((other) => rankOf(other.from) === rankOf(move.from));

        from = !sameFile ? FILES[fileOf(move.from)] : (!sameRank ? String(rankOf(move.from) + 1) : nameOf(move.from));
    }

    return `${ kindOf(move.piece).toUpperCase() }${ from }${ takes }${ square }`;
}
