import type { IconName } from '../icons/registry.ts';

/**
 * The browser's half of "a card is a number".
 *
 * The server encodes a card as 0 to 51, suit-major with the rank ascending, and sends that number -
 * so this is the decoding, and it is deliberately a SECOND copy of four lines rather than an import
 * from `server/src/domains/match/hokm/cards.ts`. That file is reached by the web typecheck program
 * only through the client-safe triangle, and nothing in `domains/` is client-safe; pulling it across
 * would drag a whole engine into the browser's program for two arrays.
 *
 * `hokm-wire.spec.ts` asserts the two agree, which is the same arrangement `handleFromName` has with
 * the browser's fake api: one implementation is shared where it can be and pinned where it cannot.
 */

export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

export type Suit = typeof SUITS[number];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

/** The house rule forbids `♠♥♦♣` as content, so every suit is a registry icon. */
export const SUIT_ICON: Record<Suit, IconName> = {
    clubs: 'suit-clubs',
    diamonds: 'suit-diamonds',
    hearts: 'suit-hearts',
    spades: 'suit-spades'
};

export function suitOf(card: number): Suit
{
    return SUITS[Math.floor(card / RANKS.length)];
}

export function rankOf(card: number): string
{
    return RANKS[card % RANKS.length];
}

/**
 * A face card is a WORD, not a letter.
 *
 * `J` is not a rank in Persian and a lone Latin initial on a Persian page is a glyph nobody can say
 * out loud - so the four that have names get catalogue keys and the nine that are numbers go through
 * `locale.n`, which is what turns a ten into `۱۰`.
 */
export const FACE_KEY: Record<string, 'card.rank.jack' | 'card.rank.queen' | 'card.rank.king' | 'card.rank.ace'> = {
    J: 'card.rank.jack',
    Q: 'card.rank.queen',
    K: 'card.rank.king',
    A: 'card.rank.ace'
};

const RED: ReadonlySet<Suit> = new Set<Suit>(['diamonds', 'hearts']);

export function arrangeHand(cards: readonly number[], trump?: Suit): number[]
{
    const present = SUITS.filter((suit) => cards.some((card) => suitOf(card) === suit));
    const rest = present.filter((suit) => suit !== trump);
    const order: Suit[] = trump !== undefined && present.includes(trump) ? [trump] : [];
    const redFirst = rest.filter((suit) => RED.has(suit)).length * 2 > rest.length;

    while (rest.length > 0)
    {
        const last = order.at(-1);
        const next = rest.findIndex((suit) => (last === undefined ? RED.has(suit) === redFirst : RED.has(suit) !== RED.has(last)));

        order.push(...rest.splice(Math.max(0, next), 1));
    }

    return [...cards].sort((a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || b - a);
}
