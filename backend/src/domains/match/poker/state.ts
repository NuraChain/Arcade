import type { Category } from './evaluator.ts';

export const SEATS = [2, 6, 9] as const;

export const STACK = 1500;

export const HANDS_PER_LEVEL = 10;

export const MAX_CHIPS = 1_000_000;

const SCHEDULE: readonly (readonly [number, number])[] = [
    [10, 20],
    [15, 30],
    [25, 50],
    [50, 100],
    [75, 150],
    [100, 200],
    [150, 300],
    [200, 400],
    [300, 600],
    [400, 800],
    [600, 1200],
    [800, 1600],
    [1000, 2000]
];

export const OPENING: Readonly<Record<'low' | 'mid' | 'high', number>> = { low: 0, mid: 2, high: 3 };

export interface Blinds
{
    small: number;
    big: number;
}

export function blindsAt(level: number): Blinds
{
    const known = SCHEDULE[Math.min(level, SCHEDULE.length - 1)];
    const doublings = Math.max(0, level - (SCHEDULE.length - 1));
    const factor = 2 ** Math.min(doublings, 20);

    return {
        small: Math.min(MAX_CHIPS / 2, known[0] * factor),
        big: Math.min(MAX_CHIPS, known[1] * factor)
    };
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type Exit = 'chips' | 'resign' | 'timeout' | 'left';

export interface Shown
{
    seat: number;
    cards: number[];
    category: Category;
}

export interface Won
{
    amount: number;
    winners: number[];
}

export interface LastHand
{
    board: number[];
    shown: Shown[];
    pots: Won[];
}

export interface PokerState
{
    v: 1;
    game: 'poker';
    rev: number;
    seats: number;
    opening: number;
    hand: number;
    button: number;
    street: Street;
    board: number[];
    holes: number[][];
    stacks: number[];
    bets: number[];
    put: number[];
    start: number[];
    folded: boolean[];
    faced: number[];
    current: number;
    raise: number;
    turn: number;
    out: boolean[];
    exits: (Exit | null)[];
    places: (number | null)[];
    acts: number[];
    gone: number;
    last: LastHand | null;
    winner: number | null;
}

export type Verb = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export type PokerAction =
    | { kind: 'fold' | 'check' | 'call' | 'allin'; seat: number }
    | { kind: 'raise'; seat: number; amount: number }
    | { kind: 'forfeit'; seat: number; reason: 'resign' | 'timeout' | 'left' };

export type PokerEvent =
    | { e: 'deal'; hand: number; button: number; small: number; big: number }
    | { e: 'blind'; seat: number; amount: number }
    | { e: 'hole'; seat: number; cards: number[] }
    | { e: Verb; seat: number; amount: number }
    | { e: 'board'; street: Street; cards: number[] }
    | { e: 'refund'; seat: number; amount: number }
    | { e: 'show'; seat: number; cards: number[]; category: Category }
    | { e: 'pot'; amount: number; winners: number[] }
    | { e: 'end'; hand: number; dealt: number[] }
    | { e: 'bust'; seat: number; place: number; by: number[] }
    | { e: 'forfeit'; seat: number; reason: string; place: number }
    | { e: 'finish'; seat: number };

export type PokerRefusal =
    | 'game-over'
    | 'not-playing'
    | 'not-your-turn'
    | 'cannot-check'
    | 'nothing-to-call'
    | 'cannot-raise'
    | 'raise-too-small'
    | 'raise-too-large';
