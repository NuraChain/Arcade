import { rankOf } from '../../../../server/src/domains/match/cards/cards.ts';
import { evaluate, type Category } from '../../../../server/src/domains/match/poker/evaluator.ts';
import type { PokerBoard } from '../../data/match.ts';
import type { Tip } from './tip.ts';

export interface Named
{
    category: Category;
    top: number;
    second: number | null;
    board: boolean;
}

export interface PokerOutcome
{
    hand: Named | null;
    call: { chips: number; pot: number } | null;
}

const RANK_BASE = 13;

const digit = (score: number, place: number): number => Math.floor(score / RANK_BASE ** place) % RANK_BASE;

export function namedHand(hole: readonly number[], board: readonly number[]): Named | null
{
    if (hole.length !== 2)
    {
        return null;
    }

    if (board.length === 0)
    {
        const [first, second] = [rankOf(hole[0]), rankOf(hole[1])];

        return { category: first === second ? 'pair' : 'high-card', top: Math.max(first, second), second: null, board: false };
    }

    const strength = evaluate([...hole, ...board]);
    const two = strength.category === 'two-pair' || strength.category === 'full-house';

    return {
        category: strength.category,
        top: digit(strength.score, 4),
        second: two ? digit(strength.score, 3) : null,
        board: board.length === 5 && evaluate(board).score === strength.score
    };
}

function playing(view: PokerBoard, mine: number | undefined): boolean
{
    const row = view.seats.find((one) => one.seat === mine);

    return mine !== undefined && view.winner === undefined && row !== undefined && !row.out && !row.folded;
}

export function outcomeOf(view: PokerBoard, mine: number | undefined): PokerOutcome | null
{
    if (!playing(view, mine))
    {
        return null;
    }

    const owe = view.turn === mine ? view.toCall ?? 0 : 0;

    return {
        hand: namedHand(view.hole, view.board),
        call: owe > 0 ? { chips: owe, pot: view.pot } : null
    };
}

export function coachOf(view: PokerBoard, mine: number | undefined): Tip | null
{
    if (!playing(view, mine))
    {
        return null;
    }

    if (view.seats.some((row) => row.seat === mine && row.allIn))
    {
        return { key: 'helpers.poker.allIn' };
    }

    if (view.turn !== mine || view.toCall === undefined)
    {
        return null;
    }

    if (view.toCall === 0)
    {
        return { key: 'helpers.poker.free' };
    }

    return { key: view.minRaiseTo === undefined ? 'helpers.poker.facing.noRaise' : 'helpers.poker.facing', params: { chips: view.toCall } };
}
