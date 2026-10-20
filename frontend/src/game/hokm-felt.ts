import { dealerOf } from '../../../backend/src/domains/match/hokm/scoring.ts';

export type Phase = 'trump' | 'discard' | 'draw' | 'tricks';

export interface Laid
{
    card: number;
    seat: number;
}

export interface Chair
{
    seat: number;
    side: number;
    held: number;
    tricks: number;
    out: boolean;
}

export interface Taken
{
    seat: number;
    cards: number[];
}

export interface Felt
{
    seats: number;
    full: number;
    phase: Phase;
    hakem: number;
    dealer: number;
    trump: string | null;
    round: number;
    lead: number;
    turn: number;
    cards: readonly Laid[];
    took: Taken | null;
    chairs: readonly Chair[];
    points: readonly number[];
    stock: number | null;
}

export interface Board
{
    phase: Phase;
    hakem: number;
    dealer: number;
    trump?: string;
    round: number;
    lead: number;
    turn: number;
    trick: readonly number[];
    took?: { seat: number; cards: readonly number[] };
    seats: readonly Chair[];
    points: readonly number[];
    full: number;
    stock?: number;
}

export interface Told
{
    e: 'trump' | 'card' | 'trick' | 'hand' | 'deal' | 'discard' | 'draw' | 'forfeit' | 'finish';
    seat?: number;
    suit?: string;
    card?: number;
    side?: number;
    points?: number;
    kot?: boolean;
    hakem?: number;
}

export const HISTORY = 6000;

export const OPENING = 5;

export const EMPTY: Felt = {
    seats: 0,
    full: 0,
    phase: 'trump',
    hakem: 0,
    dealer: 0,
    trump: null,
    round: 0,
    lead: 0,
    turn: 0,
    cards: [],
    took: null,
    chairs: [],
    points: [],
    stock: null
};

const STOCK = 42;

export function feltOf(board: Board, seats: number): Felt
{
    return {
        seats,
        full: board.full,
        phase: board.phase,
        hakem: board.hakem,
        dealer: board.dealer,
        trump: board.trump ?? null,
        round: board.round,
        lead: board.lead,
        turn: board.turn,
        cards: board.trick.map((card, offset) => ({ card, seat: (board.lead + offset) % seats })),
        took: board.took === undefined ? null : { seat: board.took.seat, cards: [...board.took.cards] },
        chairs: board.seats.map((chair) => ({ seat: chair.seat, side: chair.side, held: chair.held, tricks: chair.tricks, out: chair.out })),
        points: [...board.points],
        stock: board.stock ?? null
    };
}

export function before(felt: Felt): Felt
{
    return {
        ...felt,
        phase: 'trump',
        trump: null,
        round: 0,
        cards: [],
        took: null,
        chairs: felt.chairs.map((chair) => ({ ...chair, held: 0, tricks: 0 })),
        points: felt.points.map(() => 0),
        stock: null
    };
}

export function sameAs(shown: Felt, felt: Felt)
{
    return JSON.stringify(shown) === JSON.stringify(felt);
}

const seated = (felt: Felt, change: (chair: Chair) => Chair): Chair[] => felt.chairs.map(change);

export function unplay(felt: Felt, seat: number, card: number): Felt
{
    if (!felt.cards.some((one) => one.card === card && one.seat === seat))
    {
        return felt;
    }

    return {
        ...felt,
        cards: felt.cards.filter((one) => one.card !== card),
        chairs: seated(felt, (chair) => (chair.seat === seat ? { ...chair, held: chair.held + 1 } : chair)),
        turn: seat
    };
}

export function step(felt: Felt, move: Told): Felt
{
    const { seats } = felt;

    if (move.e === 'card' && move.seat !== undefined && move.card !== undefined)
    {
        return {
            ...felt,
            cards: [...felt.cards, { card: move.card, seat: move.seat }],
            chairs: seated(felt, (chair) => (chair.seat === move.seat ? { ...chair, held: chair.held - 1 } : chair)),
            turn: felt.cards.length + 1 === seats ? move.seat : (move.seat + 1) % seats
        };
    }

    if (move.e === 'trick' && move.seat !== undefined)
    {
        return {
            ...felt,
            cards: [],
            took: { seat: move.seat, cards: felt.cards.map((one) => one.card) },
            chairs: seated(felt, (chair) => (chair.seat === move.seat ? { ...chair, tricks: chair.tricks + 1 } : chair)),
            lead: move.seat,
            turn: move.seat
        };
    }

    if (move.e === 'hand' && move.side !== undefined)
    {
        return { ...felt, points: felt.points.map((points, side) => (side === move.side ? points + (move.points ?? 0) : points)) };
    }

    if (move.e === 'deal' && move.hakem !== undefined)
    {
        return {
            ...felt,
            phase: 'trump',
            hakem: move.hakem,
            dealer: dealerOf(move.hakem, seats),
            trump: null,
            round: felt.round + 1,
            lead: move.hakem,
            turn: move.hakem,
            cards: [],
            took: null,
            chairs: seated(felt, (chair) => ({ ...chair, tricks: 0, held: seats === 2 || chair.seat === move.hakem ? OPENING : 0 })),
            stock: seats === 2 ? STOCK : null
        };
    }

    if (move.e === 'trump' && move.suit !== undefined)
    {
        return seats === 2
            ? { ...felt, trump: move.suit, phase: 'discard' }
            : { ...felt, trump: move.suit, phase: 'tricks', chairs: seated(felt, (chair) => ({ ...chair, held: felt.full })) };
    }

    if (move.e === 'discard' && move.seat !== undefined)
    {
        const first = move.seat === felt.hakem;
        const chairs = seated(felt, (chair) => (chair.seat === move.seat ? { ...chair, held: chair.held - (first ? 3 : 2) } : chair));

        return first
            ? { ...felt, chairs, turn: dealerOf(felt.hakem, seats) }
            : { ...felt, chairs, phase: 'draw', turn: felt.hakem, stock: (felt.stock ?? 0) - 1 };
    }

    if (move.e === 'draw' && move.seat !== undefined)
    {
        const left = (felt.stock ?? 0) - 1;
        const chairs = seated(felt, (chair) => (chair.seat === move.seat ? { ...chair, held: chair.held + 1 } : chair));

        return left > 0
            ? { ...felt, chairs, stock: left - 1, turn: (move.seat + 1) % seats }
            : { ...felt, chairs, stock: null, phase: 'tricks', turn: felt.hakem, lead: felt.hakem };
    }

    if (move.e === 'forfeit' && move.seat !== undefined)
    {
        return { ...felt, chairs: seated(felt, (chair) => (chair.seat === move.seat ? { ...chair, out: true } : chair)) };
    }

    return felt;
}
