export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

export type Suit = typeof SUITS[number];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type Rank = typeof RANKS[number];

export const DECK: readonly number[] = Array.from({ length: SUITS.length * RANKS.length }, (_, card) => card);

export function suitOf(card: number): Suit
{
    return SUITS[Math.floor(card / RANKS.length)];
}

export function rankOf(card: number): number
{
    return card % RANKS.length;
}

export function cardOf(suit: Suit, rank: Rank): number
{
    return SUITS.indexOf(suit) * RANKS.length + RANKS.indexOf(rank);
}

export function nameOf(card: number): string
{
    return `${ RANKS[rankOf(card)] }${ suitOf(card)[0].toUpperCase() }`;
}
