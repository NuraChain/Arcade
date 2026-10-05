import { describe, expect, it } from 'vitest';

import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import type { HokmAction, HokmState } from '../src/domains/match/hokm/state.ts';
import { hokmBoard, hokmPlay, matchBoard, matchLog, matchPlay } from '../src/schemas.ts';

/**
 * A hokm hand is the first thing in this product that one player may see and another may not, and
 * this is the file that says so.
 *
 * **The test is information flow, not a field check.** Asserting `view.seats[2].hand` is absent only
 * catches a leak through the field somebody thought to check. Searching the serialised bytes for a
 * card NUMBER was the first attempt and it is worse than useless here: a hokm payload is full of
 * small integers - seats, sides, trick counts, points - so the two of clubs is the number 0 and
 * collides with a score of nil. It reported two leaks that were not there.
 *
 * So: compute a reader's view, REPLACE another seat's hand with different cards of the same length,
 * and compute it again. Byte-identical means the reader's view provably cannot depend on that hand,
 * through any field, named or added later, however encoded. A leak makes the two differ.
 */

const draws = { die: (sides: number) => 1 + (Math.floor(Math.random() * sides) % sides) };

function seeded(seed: number): { die: (sides: number) => number }
{
    let value = seed;

    return {
        die: (sides: number) =>
        {
            value |= 0;
            value = (value + 0x6d2b79f5) | 0;
            let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
            mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

            return 1 + Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * sides);
        }
    };
}

/**
 * The same number of cards, none of them the ones that were there. The LENGTH is deliberately kept,
 * because how many cards somebody holds is public - you can see that across a table - so a view that
 * moved with it would be reporting something true rather than leaking something private.
 */
function forged(hand: readonly number[]): number[]
{
    return hand.map((card) => (card + 26) % 52);
}

const opened = (seats: number, seed: number) =>
    hokmEngine.create(Array.from({ length: seats }, (_, seat) => seat), seeded(seed), { target: 7, cube: false, blinds: 'low' }) as HokmState;

function step(state: HokmState, action: HokmAction, dice = draws)
{
    const outcome = hokmEngine.apply(state, action, dice);

    if (!outcome.ok)
    {
        throw new Error(`${ action.kind }: ${ outcome.reason }`);
    }

    return outcome.state as HokmState;
}

function boardOf(state: HokmState, reader: number | null)
{
    const board = hokmEngine.view(state, reader);

    if (board.kind !== 'hokm')
    {
        throw new Error('not a hokm board');
    }

    return board;
}

describe('what one seat may see of another', () =>
{
    /**
     * The trump pause, which is the whole reason hokm needed a per-viewer view: for the first action
     * of every hand exactly one player in the world is entitled to see anything at all.
     */
    it('shows the Hâkem five cards and everybody else none, during the pause', () =>
    {
        const state = opened(4, 7);

        const mine = hokmEngine.view(state, state.hakem);
        const theirs = hokmEngine.view(state, (state.hakem + 1) % 4);

        expect(mine.kind).toBe('hokm');
        expect(theirs.kind).toBe('hokm');

        if (mine.kind !== 'hokm' || theirs.kind !== 'hokm')
        {
            return;
        }

        expect(mine.hand).toHaveLength(5);
        expect(theirs.hand).toHaveLength(0);
        expect(mine.phase).toBe('trump');

        const forgery = { ...state, hands: state.hands.map(forged) };

        expect(JSON.stringify(hokmEngine.view(forgery, (state.hakem + 1) % 4)),
            'a waiting seat view moved when the Hâkem cards changed')
            .toBe(JSON.stringify(theirs));
    });

    it('keeps each two-handed view blind to the other hand and to the stock, during the trump call', () =>
    {
        const state = opened(2, 7);

        for (const reader of [0, 1, null])
        {
            const base = JSON.stringify(hokmEngine.view(state, reader));
            const forgery = {
                ...state,
                hands: state.hands.map((hand, seat) => (seat === reader ? hand : forged(hand))),
                stock: forged(state.stock)
            };

            expect(JSON.stringify(hokmEngine.view(forgery, reader)), `reader ${ reader }`).toBe(base);
        }
    });

    it('shows the offer to the drawer alone, a glimpse to the seat that looked alone, and the stock as a count', () =>
    {
        const start = opened(2, 19);
        const called = step(start, { kind: 'trump', seat: start.hakem, suit: 'hearts' });
        const hakem = called.hakem;
        const dealer = 1 - hakem;

        expect(boardOf(called, hakem).discard).toBe(3);
        expect(boardOf(called, dealer).discard).toBeUndefined();
        expect(boardOf(called, null).stock).toBe(42);
        expect(boardOf(called, hakem).full).toBe(13);

        const put = step(called, hokmEngine.legal(called, hakem)[0]);

        expect(boardOf(put, dealer).discard).toBe(2);
        expect(boardOf(put, hakem).discard).toBeUndefined();

        const drawing = step(put, hokmEngine.legal(put, dealer)[0]);

        expect(boardOf(drawing, hakem).offer).toBe(drawing.offer);
        expect(boardOf(drawing, dealer).offer).toBeUndefined();
        expect(boardOf(drawing, null).offer).toBeUndefined();
        expect(boardOf(drawing, dealer).stock).toBe(41);

        const kept = step(drawing, { kind: 'keep', seat: hakem });

        expect(boardOf(kept, hakem).glimpse).toBe(kept.glimpse[hakem]);
        expect(boardOf(kept, dealer).glimpse).toBeUndefined();
        expect(boardOf(kept, null).glimpse).toBeUndefined();
        expect(boardOf(kept, dealer).offer).toBe(kept.offer);
        expect(boardOf(kept, null).seats.map((row) => row.held)).toEqual(kept.hands.map((hand) => hand.length));
        expect(boardOf(opened(3, 1), null).full).toBe(17);
        expect(boardOf(opened(4, 1), null).full).toBe(13);
        expect(boardOf(opened(4, 1), null).stock).toBeUndefined();
    });

    /**
     * Played out for a whole match, at every player count, checking every seat's view after EVERY
     * action. One hand would miss a leak that only appears once somebody is void, or once a hand is
     * down to its last card, or in the second deal.
     */
    it('composes a view that cannot depend on another seat hand, for a whole match', () =>
    {
        const faults: string[] = [];

        for (const seats of [2, 3, 4])
        {
            let state = opened(seats, seats * 31);
            let actions = 0;

            while (hokmEngine.finish(state) === null && actions < 20000)
            {
                for (let reader = 0; reader < seats; reader += 1)
                {
                    const base = JSON.stringify(hokmEngine.view(state, reader));

                    for (let other = 0; other < seats; other += 1)
                    {
                        if (other === reader || state.hands[other].length === 0)
                        {
                            continue;
                        }

                        const hands = state.hands.map((hand, seat) => (seat === other ? forged(hand) : hand));

                        if (JSON.stringify(hokmEngine.view({ ...state, hands }, reader)) !== base)
                        {
                            faults.push(`${ seats }p action ${ actions }: seat ${ reader } moved with seat ${ other } hand`);
                        }
                    }

                    const hidden = {
                        ...state,
                        stock: forged(state.stock),
                        offer: state.offer === null || reader === state.turn ? state.offer : (state.offer + 26) % 52,
                        glimpse: state.glimpse.map((card, seat) => (card === null || seat === reader ? card : (card + 26) % 52))
                    };

                    if (JSON.stringify(hokmEngine.view(hidden, reader)) !== base)
                    {
                        faults.push(`${ seats }p action ${ actions }: seat ${ reader } moved with the stock, the offer or a glimpse`);
                    }
                }

                const watched = JSON.stringify(hokmEngine.view(state, null));
                const everything = {
                    ...state,
                    hands: state.hands.map(forged),
                    stock: forged(state.stock),
                    offer: state.offer === null ? null : (state.offer + 26) % 52,
                    glimpse: state.glimpse.map((card) => (card === null ? null : (card + 26) % 52))
                };

                if (JSON.stringify(hokmEngine.view(everything, null)) !== watched)
                {
                    faults.push(`${ seats }p action ${ actions }: a watcher moved with something face down`);
                }

                const turn = hokmEngine.turnOf(state);

                if (turn === null)
                {
                    break;
                }

                const move = hokmEngine.autoplay(state, turn, draws);

                if (move === null)
                {
                    break;
                }

                const outcome = hokmEngine.apply(state, move, draws);

                if (!outcome.ok)
                {
                    faults.push(`${ seats }p: refused at action ${ actions }: ${ outcome.reason }`);
                    break;
                }

                state = outcome.state as HokmState;
                actions += 1;
            }

            if (actions < 50)
            {
                faults.push(`${ seats }p: only ${ actions } actions, so this checked almost nothing`);
            }
        }

        expect(faults.slice(0, 5)).toEqual([]);
    }, 60_000);

    /**
     * A spectator has no chair, so they are handed `null` and get strictly less than any player -
     * which for hokm is every hand in the game rather than a shorter list of legal moves.
     */
    it('shows a spectator nobody hand at all', () =>
    {
        const state = opened(4, 5);
        const called = hokmEngine.apply(state, { kind: 'trump', seat: state.hakem, suit: 'hearts' }, draws);

        expect(called.ok).toBe(true);

        if (!called.ok)
        {
            return;
        }

        const dealt = called.state as HokmState;
        const watching = hokmEngine.view(dealt, null);

        expect(watching.kind).toBe('hokm');

        if (watching.kind === 'hokm')
        {
            expect(watching.hand).toEqual([]);
            expect(watching.plays).toEqual([]);
            expect(watching.seats.map((row) => row.held)).toEqual([13, 13, 13, 13]);
        }

        const forgery = { ...dealt, hands: dealt.hands.map(forged) };

        expect(JSON.stringify(hokmEngine.view(forgery, null)), 'a watcher view moved when every hand changed')
            .toBe(JSON.stringify(watching));
    });

    it('offers legal plays to the seat on turn and to nobody else', () =>
    {
        const state = opened(4, 17);
        const called = hokmEngine.apply(state, { kind: 'trump', seat: state.hakem, suit: 'clubs' }, draws);

        expect(called.ok).toBe(true);

        if (!called.ok)
        {
            return;
        }

        const dealt = called.state as HokmState;

        for (let seat = 0; seat < 4; seat += 1)
        {
            const board = hokmEngine.view(dealt, seat);

            if (board.kind !== 'hokm')
            {
                continue;
            }

            expect(board.plays.length > 0, `seat ${ seat }`).toBe(seat === dealt.turn);
        }
    });
});

const DECK = Array.from({ length: 52 }, (_, card) => card);

const shownTo = (state: HokmState, reader: number | null) =>
{
    const board = boardOf(state, reader);

    return {
        board,
        cards: [...board.hand, ...board.plays, ...board.trick, ...(board.took?.cards ?? []), ...(board.offer === undefined ? [] : [board.offer])]
    };
};

describe('what a two-handed view can never tell', () =>
{
    it('leaves the Hâkem twelve cards and the dealer fourteen they cannot place, through every trick', () =>
    {
        const faults: string[] = [];
        let starts = 0;

        for (const seed of [3, 13, 23, 33])
        {
            const dice = seeded(seed + 1);
            let state = opened(2, seed);
            let round = -1;
            let seen = [new Set<number>(), new Set<number>()];

            for (let action = 0; action < 400 && hokmEngine.finish(state) === null; action += 1)
            {
                if (state.round !== round)
                {
                    round = state.round;
                    seen = [new Set<number>(), new Set<number>()];
                }

                for (const reader of [0, 1])
                {
                    const { board, cards } = shownTo(state, reader);

                    for (const card of [...cards, ...(board.glimpse === undefined ? [] : [board.glimpse])])
                    {
                        seen[reader].add(card);
                    }
                }

                if (state.phase === 'tricks')
                {
                    const hakem = state.hakem;
                    const dealer = 1 - hakem;

                    if (state.trick.length === 0 && state.tricks.every((count) => count === 0))
                    {
                        starts += 1;

                        if (seen[hakem].size !== 27 || seen[dealer].size !== 25 || [...seen[hakem]].some((card) => seen[dealer].has(card)))
                        {
                            faults.push(`seed ${ seed } round ${ round }: saw ${ seen[hakem].size } and ${ seen[dealer].size } at the first lead`);
                        }
                    }

                    for (const reader of [hakem, dealer])
                    {
                        const gap = DECK.filter((card) => !seen[reader].has(card) && !state.hands[1 - reader].includes(card)).length;

                        if (gap !== (reader === hakem ? 12 : 14))
                        {
                            faults.push(`seed ${ seed } action ${ action }: seat ${ reader } cannot place ${ gap }`);
                        }
                    }
                }

                state = step(state, hokmEngine.autoplay(state, hokmEngine.turnOf(state)!, dice)!, dice);
            }
        }

        expect(faults.slice(0, 5)).toEqual([]);
        expect(starts).toBeGreaterThan(4);
    });
});

describe('nothing put face down reaches any payload', () =>
{
    it('never shows a card put face down again, but to the drawer who looked at it, and logs only who did what', () =>
    {
        const faults: string[] = [];

        for (const seed of [5, 15, 25])
        {
            const dice = seeded(seed + 2);
            let state = opened(2, seed);
            let round = state.round;
            let played = new Set<number>();

            for (let action = 0; action < 400 && hokmEngine.finish(state) === null; action += 1)
            {
                if (state.round !== round)
                {
                    round = state.round;
                    played = new Set<number>();
                }

                const live = new Set([...state.hands.flat(), ...state.stock, ...(state.offer === null ? [] : [state.offer])]);
                const down = new Set(DECK.filter((card) => !live.has(card) && !played.has(card)));

                for (const reader of [0, 1, null])
                {
                    const { board, cards } = shownTo(state, reader);
                    const leaked = cards.filter((card) => down.has(card));

                    if (leaked.length > 0)
                    {
                        faults.push(`seed ${ seed } action ${ action }: reader ${ reader } shown ${ leaked.join(',') } after it went down`);
                    }

                    if ((board.glimpse ?? null) !== (reader === null ? null : state.glimpse[reader]))
                    {
                        faults.push(`seed ${ seed } action ${ action }: reader ${ reader } shown a glimpse that is not theirs`);
                    }
                }

                const outcome = hokmEngine.apply(state, hokmEngine.autoplay(state, hokmEngine.turnOf(state)!, dice)!, dice);

                if (!outcome.ok)
                {
                    faults.push(`seed ${ seed } action ${ action }: ${ outcome.reason }`);
                    break;
                }

                const logs = [0, 1, null].map((reader) => JSON.stringify(matchLog.parse(hokmEngine.log(outcome.events, reader))));

                if (new Set(logs).size !== 1)
                {
                    faults.push(`seed ${ seed } action ${ action }: the log differs by reader`);
                }

                const log = hokmEngine.log(outcome.events, null);

                for (const move of log.kind === 'hokm' ? log.moves : [])
                {
                    if ((move.e === 'discard' || move.e === 'draw') && Object.keys(move).sort().join() !== 'e,seat')
                    {
                        faults.push(`seed ${ seed } action ${ action }: a ${ move.e } logged ${ Object.keys(move).join() }`);
                    }

                    if (move.e === 'card' && move.card !== undefined)
                    {
                        played.add(move.card);
                    }
                }

                state = outcome.state as HokmState;
            }
        }

        expect(faults.slice(0, 5)).toEqual([]);
    });
});

describe('the hokm wire', () =>
{
    it('carries a two-handed board in the discard and the draw without dropping a field', () =>
    {
        const start = opened(2, 29);
        const called = step(start, { kind: 'trump', seat: start.hakem, suit: 'clubs' });
        const put = step(called, hokmEngine.legal(called, called.hakem)[0]);
        const drawing = step(put, hokmEngine.legal(put, put.turn)[0]);
        const kept = step(drawing, { kind: 'keep', seat: drawing.turn });

        for (const [state, reader] of [[called, called.hakem], [drawing, drawing.turn], [kept, drawing.turn], [kept, kept.turn]] as const)
        {
            const board = hokmEngine.view(state, reader);

            expect(matchBoard.parse(board)).toEqual(board);
        }
    });

    it('reads the draw verbs, and a discard only with its cards', () =>
    {
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'discard', cards: [3, 9, 40] }, 1)).toEqual({ kind: 'discard', seat: 1, cards: [3, 9, 40] });
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'keep' }, 0)).toEqual({ kind: 'keep', seat: 0 });
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'reject' }, 0)).toEqual({ kind: 'reject', seat: 0 });
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'discard' }, 0)).toBeNull();
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'reject', card: 7 }, 0)).toBeNull();
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'keep', cards: [7, 8] }, 0)).toBeNull();
    });

    it('refuses anything but two or three cards face down, and a card off the deck', () =>
    {
        expect(hokmPlay.safeParse({ kind: 'hokm', verb: 'discard', cards: [1, 2, 3] }).ok).toBe(true);
        expect(hokmPlay.safeParse({ kind: 'hokm', verb: 'discard', cards: [1, 2] }).ok).toBe(true);
        expect(hokmPlay.safeParse({ kind: 'hokm', verb: 'discard', cards: [1, 2, 3, 4] }).ok).toBe(false);
        expect(hokmPlay.safeParse({ kind: 'hokm', verb: 'discard', cards: [1] }).ok).toBe(false);
        expect(hokmPlay.safeParse({ kind: 'hokm', verb: 'discard', cards: [1, 2, 52] }).ok).toBe(false);
    });

    it('tells every reader who stopped the match and how, beside the finish it caused', () =>
    {
        for (const reason of ['resign', 'left', 'timeout'] as const)
        {
            const quit = hokmEngine.apply(opened(4, 9), hokmEngine.forfeit(2, reason), seeded(1));

            expect(quit.ok).toBe(true);

            if (!quit.ok)
            {
                return;
            }

            for (const reader of [null, 0, 1, 2, 3])
            {
                expect(matchLog.parse(hokmEngine.log(quit.events, reader)), `${ reason } read by ${ reader }`).toEqual({
                    kind: 'hokm',
                    moves: [{ e: 'forfeit', seat: 2, reason }, { e: 'finish', side: 1 }]
                });
            }
        }
    });

    it('is a member of the shared unions, discriminated by the game name', () =>
    {
        const board = hokmEngine.view(opened(4, 3), 0);

        expect(matchBoard.parse(board)).toEqual(hokmBoard.parse(board));

        const play = { kind: 'hokm' as const, verb: 'trump' as const, suit: 'spades' as const };

        expect(matchPlay.parse(play)).toEqual(hokmPlay.parse(play));
    });

    /**
     * The wire is what the parser lets through, so a hand smuggled onto a seat row is dropped even
     * if somebody builds one. Asserted by PARSING rather than by reading the declaration.
     */
    it('drops a hand smuggled onto somebody else seat row', () =>
    {
        const parsed = hokmBoard.parse({
            kind: 'hokm',
            phase: 'tricks',
            hakem: 0,
            dealer: 3,
            turn: 1,
            lead: 0,
            hand: [4, 9],
            plays: [4],
            trick: [],
            seats: [{ seat: 0, side: 0, held: 13, tricks: 0, out: false, hand: [1, 2, 3] }],
            points: [0, 0],
            target: 7,
            round: 1,
            needed: 7,
            full: 13
        });

        expect(Object.keys(parsed.seats[0]).sort()).toEqual(['held', 'out', 'seat', 'side', 'tricks']);
    });

    it('refuses a play that names neither a suit nor a card', () =>
    {
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'trump' }, 0)).toBeNull();
        expect(hokmEngine.parse({ kind: 'hokm', verb: 'card' }, 0)).toBeNull();
        expect(hokmEngine.parse({ kind: 'ludo', verb: 'roll' }, 0)).toBeNull();
    });
});
