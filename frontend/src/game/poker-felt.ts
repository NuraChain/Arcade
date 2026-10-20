import type { Category } from '../../../backend/src/domains/match/poker/evaluator.ts';
import { leftOf, split, standing } from '../../../backend/src/domains/match/poker/pots.ts';
import { HANDS_PER_LEVEL, STACK, type Street } from '../../../backend/src/domains/match/poker/state.ts';

export interface Chair
{
    seat: number;
    stack: number;
    bet: number;
    folded: boolean;
    allIn: boolean;
    out: boolean;
}

export interface Layer
{
    amount: number;
    eligible: readonly number[];
}

export interface Tabled
{
    seat: number;
    cards: readonly number[];
    category: Category;
}

export interface Paid
{
    amount: number;
    winners: readonly number[];
}

export interface Last
{
    board: readonly number[];
    shown: readonly Tabled[];
    pots: readonly Paid[];
}

export interface Blinds
{
    small: number;
    big: number;
    level: number;
    next: number;
}

export interface Felt
{
    reader: number | null;
    hand: number;
    street: Street;
    button: number;
    board: readonly number[];
    chairs: readonly Chair[];
    put: readonly number[] | null;
    pot: number;
    pots: readonly Layer[];
    blinds: Blinds;
    hole: readonly number[];
    tabled: readonly Tabled[];
    paid: readonly Paid[];
    last: Last | null;
    winner: number | null;
    dealt: boolean;
    turn: number | null;
}

export interface Board
{
    turn?: number;
    street: Street;
    hand: number;
    button: number;
    board: readonly number[];
    pot: number;
    pots: readonly Layer[];
    seats: readonly Chair[];
    blinds: Blinds;
    hole: readonly number[];
    last?: Last;
    winner?: number;
}

export interface Told
{
    e: 'deal' | 'blind' | 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'board' | 'refund' | 'show' | 'pot' | 'end' | 'bust' | 'forfeit' | 'finish';
    seat?: number;
    hand?: number;
    button?: number;
    small?: number;
    big?: number;
    amount?: number;
    street?: Street;
    cards?: readonly number[];
    category?: Category;
    winners?: readonly number[];
}

export const HISTORY = 6000;

export const EMPTY: Felt = {
    reader: null,
    hand: 1,
    street: 'preflop',
    button: 0,
    board: [],
    chairs: [],
    put: [],
    pot: 0,
    pots: [],
    blinds: { small: 0, big: 0, level: 1, next: HANDS_PER_LEVEL },
    hole: [],
    tabled: [],
    paid: [],
    last: null,
    winner: null,
    dealt: false,
    turn: null
};

const NO_CARDS: readonly number[] = [];

const ACTS: ReadonlySet<Told['e']> = new Set(['check', 'call', 'raise', 'allin']);

const HOLE = 2;

const levelAt = (hand: number) => Math.floor((Math.max(1, hand) - 1) / HANDS_PER_LEVEL);

const lastOf = (last: Last): Last => ({
    board: [...last.board],
    shown: last.shown.map((one) => ({ seat: one.seat, cards: [...one.cards], category: one.category })),
    pots: last.pots.map((pot) => ({ amount: pot.amount, winners: [...pot.winners] }))
});

function sealed(felt: Felt): Felt
{
    const chairs = felt.chairs.map((chair) => ({ ...chair, allIn: !chair.out && !chair.folded && chair.stack === 0 }));

    return {
        ...felt,
        chairs,
        pots: felt.put === null ? felt.pots : standing(felt.put, chairs.map((chair) => chair.folded || chair.out), chairs.map((chair) => chair.allIn))
    };
}

const seated = (felt: Felt, seat: number, change: (chair: Chair) => Chair) => felt.chairs.map((chair) => (chair.seat === seat ? change(chair) : chair));

const gathered = (felt: Felt) => felt.chairs.map((chair) => ({ ...chair, bet: 0 }));

const unheld = (felt: Felt, seat: number) => (seat === felt.reader ? NO_CARDS : felt.hole);

function commit(felt: Felt, seat: number, chips: number)
{
    return sealed({
        ...felt,
        chairs: seated(felt, seat, (chair) => ({ ...chair, stack: chair.stack - chips, bet: chair.bet + chips })),
        put: felt.put === null ? null : felt.put.map((put, at) => (at === seat ? put + chips : put)),
        pot: felt.pot + chips
    });
}

export function feltOf(board: Board, reader: number | null): Felt
{
    const chairs = board.seats.map((chair) => ({ seat: chair.seat, stack: chair.stack, bet: chair.bet, folded: chair.folded, allIn: chair.allIn, out: chair.out }));
    const last = board.last === undefined ? null : lastOf(board.last);
    const ended = board.winner !== undefined && last !== null;

    return {
        reader,
        hand: board.hand,
        street: board.street,
        button: board.button,
        board: [...board.board],
        chairs,
        put: board.street === 'preflop' || board.pot === 0 ? chairs.map((chair) => chair.bet) : null,
        pot: board.pot,
        pots: board.pots.map((pot) => ({ amount: pot.amount, eligible: [...pot.eligible] })),
        blinds: { small: board.blinds.small, big: board.blinds.big, level: board.blinds.level, next: board.blinds.next },
        hole: [...board.hole],
        tabled: ended ? last.shown : [],
        paid: ended ? last.pots : [],
        last,
        winner: board.winner ?? null,
        dealt: true,
        turn: board.winner === undefined ? (board.turn ?? null) : null
    };
}

export function sameAs(shown: Felt, felt: Felt)
{
    return JSON.stringify({ ...shown, put: null, turn: null }) === JSON.stringify({ ...felt, put: null, turn: null });
}

export interface Air
{
    bets: readonly number[];
    stacks: readonly number[];
    cards: readonly number[];
    board: number;
}

export const STILL: Air = { bets: [], stacks: [], cards: [], board: 0 };

export function flying(air: Air, seats: number, seat: number, toBet: number, toStack: number): Air
{
    return {
        ...air,
        bets: Array.from({ length: seats }, (_, at) => (air.bets[at] ?? 0) + (at === seat ? toBet : 0)),
        stacks: Array.from({ length: seats }, (_, at) => (air.stacks[at] ?? 0) + (at === seat ? toStack : 0))
    };
}

export function dealing(air: Air, felt: Felt): Air
{
    return { ...air, cards: felt.chairs.map((chair) => (chair.out ? 0 : HOLE)) };
}

export function landed(air: Air, seat: number): Air
{
    return { ...air, cards: air.cards.map((cards, at) => (at === seat ? Math.max(0, cards - 1) : cards)) };
}

export function unturned(air: Air, cards: number): Air
{
    return { ...air, board: Math.max(0, air.board + cards) };
}

export function turning(air: Air, felt: Felt, seat: number): Air
{
    return { ...air, cards: felt.chairs.map((chair) => (chair.seat === seat ? HOLE : (air.cards[chair.seat] ?? 0))) };
}

export function turned(air: Air, seat: number): Air
{
    return { ...air, cards: air.cards.map((cards, at) => (at === seat ? 0 : cards)) };
}

export function drawnOf(felt: Felt, air: Air): Felt
{
    const coming = air.bets.reduce((sum, chips) => sum + chips, 0);
    const owed = felt.reader === null ? 0 : (air.cards[felt.reader] ?? 0);

    if (coming === 0 && owed === 0 && air.board === 0 && air.stacks.every((chips) => chips === 0))
    {
        return felt;
    }

    return {
        ...felt,
        board: felt.board.slice(0, Math.max(0, felt.board.length - air.board)),
        chairs: felt.chairs.map((chair) => ({ ...chair, stack: chair.stack - (air.stacks[chair.seat] ?? 0), bet: chair.bet - (air.bets[chair.seat] ?? 0) })),
        pot: felt.pot - coming,
        hole: felt.hole.slice(0, Math.max(0, felt.hole.length - owed))
    };
}

export function staged(moves: readonly Told[])
{
    const out: Told[] = [];
    let at = 0;

    while (at < moves.length)
    {
        let streets = at;

        while (streets < moves.length && moves[streets].e === 'board')
        {
            streets += 1;
        }

        let after = streets;

        while (after < moves.length && (moves[after].e === 'refund' || moves[after].e === 'show'))
        {
            after += 1;
        }

        const tail = moves.slice(streets, after);

        if (streets > at && tail.some((move) => move.e === 'show'))
        {
            out.push(...tail.filter((move) => move.e === 'refund'), ...tail.filter((move) => move.e === 'show'), ...moves.slice(at, streets));
            at = after;
        }
        else
        {
            out.push(moves[at]);
            at += 1;
        }
    }

    return out;
}

export function sharesOf(felt: Felt, move: Told)
{
    return split(move.amount ?? 0, [...(move.winners ?? [])], leftOf(felt.button, felt.chairs.length));
}

export const winnersOf = (felt: Felt) => [...new Set(felt.paid.flatMap((pot) => pot.winners))];

export function dealOrder(felt: Felt)
{
    const rank = leftOf(felt.button, felt.chairs.length);
    const round = felt.chairs.filter((chair) => !chair.out).map((chair) => chair.seat).sort((one, other) => rank(one) - rank(other));

    return [...round, ...round];
}

export const inHand = (felt: Felt, seat: number) => felt.dealt && felt.chairs.some((chair) => chair.seat === seat && !chair.folded && !chair.out);

export function latest(moves: readonly Told[])
{
    const deals = moves.flatMap((move, at) => (move.e === 'deal' ? [at] : []));

    return deals.length > 1 ? deals[deals.length - 1] : 0;
}

export function swept(felt: Felt)
{
    return sealed({ ...felt, chairs: gathered(felt) });
}

export function before(felt: Felt): Felt
{
    return {
        ...felt,
        hand: 1,
        street: 'preflop',
        board: [],
        chairs: felt.chairs.map((chair) => ({ seat: chair.seat, stack: STACK, bet: 0, folded: false, allIn: false, out: false })),
        put: felt.chairs.map(() => 0),
        pot: 0,
        pots: [],
        blinds: { ...felt.blinds, level: felt.blinds.level - levelAt(felt.hand), next: HANDS_PER_LEVEL },
        hole: [],
        tabled: [],
        paid: [],
        last: null,
        winner: null,
        dealt: false,
        turn: null
    };
}

export function step(felt: Felt, move: Told, hole: readonly number[] = NO_CARDS): Felt
{
    const next = moved(felt, move, hole);
    const turn = ACTS.has(move.e) && move.seat !== undefined ? move.seat : null;

    return next.turn === turn ? next : { ...next, turn };
}

function moved(felt: Felt, move: Told, hole: readonly number[]): Felt
{
    const { seat, amount = 0 } = move;

    if (move.e === 'deal' && move.hand !== undefined && move.button !== undefined)
    {
        return sealed({
            ...felt,
            hand: move.hand,
            street: 'preflop',
            button: move.button,
            board: [],
            chairs: felt.chairs.map((chair) => ({ ...chair, bet: 0, folded: false })),
            put: felt.chairs.map(() => 0),
            pot: 0,
            blinds: {
                small: move.small ?? felt.blinds.small,
                big: move.big ?? felt.blinds.big,
                level: felt.blinds.level - levelAt(felt.hand) + levelAt(move.hand),
                next: HANDS_PER_LEVEL - ((move.hand - 1) % HANDS_PER_LEVEL)
            },
            hole: [...hole],
            tabled: [],
            paid: [],
            dealt: true
        });
    }

    if (move.e === 'board' && move.street !== undefined)
    {
        return sealed({ ...felt, street: move.street, board: [...felt.board, ...(move.cards ?? [])], chairs: gathered(felt) });
    }

    if (move.e === 'show' && seat !== undefined && move.category !== undefined)
    {
        return sealed({ ...felt, chairs: gathered(felt), tabled: [...felt.tabled, { seat, cards: [...(move.cards ?? [])], category: move.category }] });
    }

    if (move.e === 'pot')
    {
        const winners = [...(move.winners ?? [])];
        const shares = sharesOf(felt, move);

        return sealed({
            ...felt,
            chairs: gathered(felt).map((chair) => ({ ...chair, stack: chair.stack + (shares.get(chair.seat) ?? 0) })),
            put: null,
            pot: felt.pot - amount,
            pots: [],
            paid: [...felt.paid, { amount, winners }]
        });
    }

    if (move.e === 'end')
    {
        return sealed({
            ...felt,
            chairs: gathered(felt),
            put: felt.chairs.map(() => 0),
            pot: 0,
            last: { board: [...felt.board], shown: felt.tabled, pots: felt.paid }
        });
    }

    if (move.e === 'finish' && seat !== undefined)
    {
        return { ...felt, winner: seat };
    }

    if (seat === undefined)
    {
        return felt;
    }

    if (move.e === 'blind' || move.e === 'call')
    {
        return commit(felt, seat, amount);
    }

    if (move.e === 'raise' || move.e === 'allin')
    {
        return commit(felt, seat, amount - (felt.chairs.find((chair) => chair.seat === seat)?.bet ?? 0));
    }

    if (move.e === 'fold')
    {
        return sealed({ ...felt, chairs: seated(felt, seat, (chair) => ({ ...chair, folded: true })), hole: unheld(felt, seat) });
    }

    if (move.e === 'refund')
    {
        return sealed({
            ...felt,
            chairs: seated(felt, seat, (chair) => ({ ...chair, stack: chair.stack + amount, bet: Math.max(0, chair.bet - amount) })),
            put: felt.put === null ? null : felt.put.map((put, at) => (at === seat ? put - amount : put)),
            pot: felt.pot - amount
        });
    }

    if (move.e === 'bust')
    {
        return sealed({ ...felt, chairs: seated(felt, seat, (chair) => ({ ...chair, out: true, folded: false })), hole: unheld(felt, seat) });
    }

    if (move.e === 'forfeit')
    {
        return sealed({ ...felt, chairs: seated(felt, seat, (chair) => ({ ...chair, out: true, folded: false, stack: 0 })), hole: unheld(felt, seat) });
    }

    return felt;
}

export function through(felt: Felt, moves: readonly Told[], sight: Felt)
{
    const newest = moves.reduce((last, move, at) => (move.e === 'deal' ? at : last), -1);
    const tables: Felt[] = [];

    for (const [at, move] of moves.entries())
    {
        const shown = step(tables[at - 1] ?? felt, move, at === newest ? sight.hole : NO_CARDS);
        const arrived = at === moves.length - 1 && shown.put === null && shown.hand === sight.hand && shown.pot === sight.pot;

        tables.push(arrived ? { ...shown, pots: sight.pots } : shown);
    }

    return tables;
}
