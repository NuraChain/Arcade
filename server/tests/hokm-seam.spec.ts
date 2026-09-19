import { describe, expect, it } from 'vitest';

import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import type { HokmState } from '../src/domains/match/hokm/state.ts';
import { hokmBoard, hokmPlay, matchBoard, matchPlay } from '../src/schemas.ts';

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

const opened = (seats: number, seed: number): HokmState =>
    hokmEngine.create(Array.from({ length: seats }, (_, seat) => seat), seeded(seed), 7) as HokmState;

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

describe('the hokm wire', () =>
{
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
            needed: 7
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
