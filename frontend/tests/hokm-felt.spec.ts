import { describe, expect, it } from 'vitest';

import { EMPTY, before, feltOf, sameAs, step, unplay, type Board, type Felt, type Told } from '../src/game/hokm-felt.ts';
import { hokmEngine } from '../../backend/src/domains/match/engines/hokm.ts';
import { apply, create, legalMoves } from '../../backend/src/domains/match/hokm/engine.ts';
import type { HokmState } from '../../backend/src/domains/match/hokm/state.ts';

interface Frame
{
    moves: readonly Told[];
    state: HokmState;
}

const randomOf = (seed: number) =>
{
    let state = seed;

    return () =>
    {
        state = (state * 48271) % 2147483647;

        return state;
    };
};

const feltAt = (state: HokmState, reader: number | null = null) => feltOf(hokmEngine.view(state, reader) as Board, state.seats);

const played = (seats: number, seed: number, quitsAfter = Infinity): Frame[] =>
{
    const next = randomOf(seed);
    const deal = (sides: number) => 1 + (next() % sides);
    const start = create(seats, 7, deal);
    const frames: Frame[] = [{ moves: start.events as Told[], state: start.state }];
    let state = start.state;

    for (let turn = 0; turn < 4000 && state.winner === null; turn += 1)
    {
        const seat = hokmEngine.turnOf(state) ?? 0;
        const moves = legalMoves(state, seat);
        const action = turn >= quitsAfter ? { kind: 'forfeit' as const, seat, reason: 'left' as const } : moves[next() % moves.length];
        const done = apply(state, action, deal);

        if (!done.ok)
        {
            throw new Error(`the engine refused its own legal move: ${ done.reason }`);
        }

        state = done.state;
        frames.push({ moves: done.events as Told[], state });
    }

    return frames;
};

const folded = (frames: readonly Frame[], from: Felt) =>
{
    let shown = from;

    return frames.map((frame) =>
    {
        shown = frame.moves.reduce(step, shown);

        return shown;
    });
};

describe('the hokm table as it has been shown', () =>
{
    for (const seats of [2, 3, 4])
    {
        it(`is the table the engine describes after every action at ${ seats } players, for every seat and for nobody, over whole matches`, () =>
        {
            for (const seed of [3, 11, 29, 71, 113, 257])
            {
                const frames = played(seats, seed);
                const shown = folded(frames, before(feltAt(frames[0].state)));

                expect(frames.at(-1)?.state.winner, `match ${ seed } never ended`).not.toBeNull();

                for (const [at, frame] of frames.entries())
                {
                    for (const reader of [null, ...Array.from({ length: seats }, (_, seat) => seat)])
                    {
                        expect(shown[at], `match ${ seed }, action ${ at }, read by ${ String(reader) }`).toEqual(feltAt(frame.state, reader));
                    }
                }
            }
        });
    }

    it('still is when somebody walks out, at each count and at several moments', () =>
    {
        for (const seats of [2, 3, 4])
        {
            for (const quitsAfter of [0, 1, 9, 30])
            {
                const frames = played(seats, 41, quitsAfter);
                const shown = folded(frames, before(feltAt(frames[0].state)));

                expect(shown.at(-1)).toEqual(feltAt(frames.at(-1)?.state as HokmState));
            }
        }
    });

    it('starts from a table with nothing dealt, which the first deal turns into the table the match opens on', () =>
    {
        const frames = played(4, 7);
        const empty = before(feltAt(frames[0].state));

        expect(empty.chairs.map((chair) => chair.held)).toEqual([0, 0, 0, 0]);
        expect(empty.round).toBe(0);
        expect(empty.trump).toBeNull();
        expect(sameAs(frames[0].moves.reduce(step, empty), feltAt(frames[0].state))).toBe(true);
        expect(sameAs(empty, feltAt(frames[0].state))).toBe(false);
    });

    it('leaves the cards of a trick on the table model until the trick is taken, and names who took them afterwards', () =>
    {
        const frames = played(4, 7);
        const shown = folded(frames, before(feltAt(frames[0].state)));
        const taken = frames.findIndex((frame) => frame.moves.some((move) => move.e === 'trick'));

        expect(shown[taken - 1].cards.length, 'the three cards before the fourth were not on the table').toBe(3);
        expect(shown[taken].cards).toEqual([]);
        expect(shown[taken].took?.cards.length).toBe(4);
        expect(shown[taken].took?.seat).toBe(frames[taken].moves.find((move) => move.e === 'trick')?.seat);
    });

    it('is the table it was again when a card that was played is taken back, wherever in a trick it fell', () =>
    {
        for (const seats of [2, 3, 4])
        {
            const frames = played(seats, 29);
            let shown = before(feltAt(frames[0].state));
            let cards = 0;

            for (const move of frames.flatMap((frame) => frame.moves))
            {
                if (move.e === 'card' && move.seat !== undefined && move.card !== undefined)
                {
                    cards += 1;
                    expect(unplay(step(shown, move), move.seat, move.card), `${ seats } players, card ${ cards }`).toEqual(shown);
                    expect(unplay(shown, move.seat, move.card), 'a card that had not been played was taken off the felt').toBe(shown);
                    expect(unplay(step(shown, move), (move.seat + 1) % seats, move.card), 'a card was taken back for a seat that had not played it').toEqual(step(shown, move));
                }

                shown = step(shown, move);
            }

            expect(cards, 'no card was played').toBeGreaterThan(20);
        }
    });

    it('has a table with nothing on it to stand in before there is a match to read', () =>
    {
        expect(EMPTY.chairs).toEqual([]);
        expect(EMPTY.cards).toEqual([]);
        expect([EMPTY.trump, EMPTY.took, EMPTY.stock]).toEqual([null, null, null]);
        expect(step(EMPTY, { e: 'finish', side: 0 })).toBe(EMPTY);
    });
});
