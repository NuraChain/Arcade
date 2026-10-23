import { describe, expect, it } from 'vitest';

import { FIRST_MOVE_MS } from '../src/domains/match/chess/clock.ts';
import { squareNamed } from '../src/domains/match/chess/board.ts';
import type { ChessAction, ChessState } from '../src/domains/match/chess/state.ts';
import { chessEngine } from '../src/domains/match/engines/chess.ts';
import type { Draws, TableConfig } from '../src/domains/match/engine.ts';
import { chessBoard, chessLog, chessPlay, matchBoard, matchLog } from '../src/schemas.ts';

/**
 * Chess behind the seam every game shares: what a table hands it, what it reads off the wire, and
 * what it shows and tells, held to the wire's own declarations over whole games played at random.
 */

const TABLE: TableConfig = { target: 0, cube: false, blinds: 'low', variant: 'standard' };

const dice = (face: number): Draws => ({ die: () => face });

const sq = (name: string) => squareNamed(name)!;

/** A small generator with a seed, so a game played at random is the same game every run. */
const seeded = (seed: number) =>
{
    let at = seed >>> 0;

    return (below: number) =>
    {
        at = (Math.imul(at, 1_664_525) + 1_013_904_223) >>> 0;

        return at % below;
    };
};

/** Plays a game to its end, or to a bound, choosing among the legal moves at random. */
function played(seed: number, plies = 400)
{
    const pick = seeded(seed);
    let { state, events } = chessEngine.create([0, 1], dice(1 + (seed % 2)), TABLE);
    const states: ChessState[] = [state];
    const batches: unknown[][] = [events];

    while (chessEngine.finish(state) === null && states.length <= plies)
    {
        const seat = chessEngine.turnOf(state)!;
        const legal = chessEngine.legal(state, seat);
        const applied = chessEngine.apply(state, legal[pick(legal.length)], dice(1));

        if (!applied.ok)
        {
            throw new Error(`a legal move was refused: ${ applied.reason }`);
        }

        ({ state, events } = applied);
        states.push(state);
        batches.push(events);
    }

    return { states, batches };
}

const GAMES = Array.from({ length: 12 }, (_, game) => played(97 + game * 31));

describe('chess behind the seam', () =>
{
    it('plays one format, two players apart', () =>
    {
        expect(chessEngine.formats).toEqual([{ seats: 2, variant: 'standard' }]);
        expect([0, 1].map((seat) => chessEngine.sideOf(seat, chessEngine.formats[0]))).toEqual([0, 1]);
    });

    it('draws which seat plays White from the dice it is handed, and says so first', () =>
    {
        expect(chessEngine.create([0, 1], dice(1), TABLE)).toMatchObject({ state: { white: 0 }, events: [{ e: 'colours', white: 0 }] });
        expect(chessEngine.create([0, 1], dice(2), TABLE)).toMatchObject({ state: { white: 1 }, events: [{ e: 'colours', white: 1 }] });
    });

    it('starts each side with the table\'s control, and keeps no clock without one', () =>
    {
        const timed = chessEngine.create([0, 1], dice(1), { ...TABLE, clock: { base: 180_000, increment: 2000 } }).state;

        expect(timed.clock).toEqual({ base: 180_000, increment: 2000, left: [180_000, 180_000] });
        expect(chessEngine.create([0, 1], dice(1), TABLE).state.clock).toBeNull();
    });

    it('reads a move by its squares and its piece, and every other play by its verb alone', () =>
    {
        expect(chessEngine.parse({ kind: 'chess', verb: 'move', from: sq('e2'), to: sq('e4') }, 1)).toEqual({ kind: 'move', seat: 1, from: sq('e2'), to: sq('e4') });
        expect(chessEngine.parse({ kind: 'chess', verb: 'move', from: sq('a7'), to: sq('a8'), promotion: 'n' }, 0)).toEqual({ kind: 'move', seat: 0, from: sq('a7'), to: sq('a8'), promotion: 'n' });

        for (const verb of ['offer', 'accept', 'decline', 'flag'] as const)
        {
            expect(chessEngine.parse({ kind: 'chess', verb }, 0)).toEqual({ kind: verb, seat: 0 });
            expect(chessEngine.parse({ kind: 'chess', verb, from: sq('e2') }, 0), verb).toBeNull();
        }

        expect(chessEngine.parse({ kind: 'chess', verb: 'move', from: sq('e2') }, 0)).toBeNull();
        expect(chessEngine.parse({ kind: 'ludo', verb: 'roll' }, 0)).toBeNull();
    });

    it('takes on the wire only the plays it can read', () =>
    {
        expect(chessPlay.safeParse({ kind: 'chess', verb: 'move', from: 12, to: 28 }).ok).toBe(true);
        expect(chessPlay.safeParse({ kind: 'chess', verb: 'move', from: 64, to: 28 }).ok).toBe(false);
        expect(chessPlay.safeParse({ kind: 'chess', verb: 'move', from: 52, to: 60, promotion: 'k' }).ok).toBe(false);
        expect(chessPlay.safeParse({ kind: 'chess', verb: 'resign' }).ok).toBe(false);
    });

    it('shows every reader the same board, which the wire takes, at every move of whole games', () =>
    {
        for (const { states } of GAMES)
        {
            for (const state of states)
            {
                const seen = [0, 1, null].map((seat) => JSON.stringify(chessEngine.view(state, seat)));

                expect(new Set(seen).size).toBe(1);
                expect(chessBoard.safeParse(chessEngine.view(state, null)).ok).toBe(true);
                expect(matchBoard.safeParse(chessEngine.view(state, 0)).ok).toBe(true);
            }
        }
    });

    it('carries on its board every move played so far, as the log told it, at every move of whole games', () =>
    {
        type Told = { e: string; san?: string };

        for (const { states, batches } of GAMES)
        {
            states.forEach((state, at) =>
            {
                const told = batches.slice(0, at + 1)
                    .flatMap((events) => (chessEngine.log(events, null) as { moves: Told[] }).moves)
                    .filter((move) => move.e === 'move')
                    .map((move) => move.san);
                const view = chessEngine.view(state, null) as { notation: string[] };

                expect(view.notation).toEqual(told);
                expect(view.notation).toHaveLength(state.ply);
            });
        }
    });

    it('tells every move of whole games in a log the wire takes', () =>
    {
        for (const { batches } of GAMES)
        {
            for (const events of batches)
            {
                expect(chessLog.safeParse(chessEngine.log(events, 0)).ok).toBe(true);
                expect(matchLog.safeParse(chessEngine.log(events, null)).ok).toBe(true);
            }
        }
    });

    it('moves its turn on with every move, and on nothing else', () =>
    {
        const [{ states }] = GAMES;

        for (let at = 1; at < states.length; at += 1)
        {
            expect(chessEngine.turnKey(states[at])).not.toBe(chessEngine.turnKey(states[at - 1]));
        }

        const offered = chessEngine.apply(states[2], { kind: 'offer', seat: chessEngine.turnOf(states[2])! }, dice(1));

        expect(offered.ok && chessEngine.turnKey(offered.state)).toBe(chessEngine.turnKey(states[2]));
    });

    it('banks the first-move window, then each side\'s own time, and nothing at a game with no clock or one over', () =>
    {
        const timed = chessEngine.create([0, 1], dice(1), { ...TABLE, clock: { base: 300_000, increment: 0 } }).state;

        expect(chessEngine.bank!(timed)).toBe(FIRST_MOVE_MS);
        expect(chessEngine.bank!(GAMES[0].states[0])).toBeNull();

        const ended = GAMES.find(({ states }) => chessEngine.finish(states[states.length - 1]) !== null)!;

        expect(chessEngine.bank!(ended.states[ended.states.length - 1])).toBeNull();
    });

    it('plays only a flag for the side whose time is up, and concedes a resignation as a result', () =>
    {
        const state = GAMES[0].states[4];
        const seat = chessEngine.turnOf(state)!;

        expect(chessEngine.autoplay(state, seat, dice(1))).toEqual({ kind: 'flag', seat });
        expect(chessEngine.autoplay(state, 1 - seat, dice(1))).toBeNull();

        const conceded = chessEngine.apply(state, chessEngine.concede!(seat) as ChessAction, dice(1));

        expect(conceded.ok && chessEngine.finish(conceded.state)).toEqual({ winners: [1 - seat], unsettled: [], trailing: [] });
        expect(conceded.ok && chessEngine.standings(conceded.state)).toEqual([{ seat: 1 - seat, place: 1 }, { seat, place: 2 }].sort((a, b) => a.seat - b.seat));
    });

    it('ends whole games in a way the judge can read: a winner placed first, or one place shared', () =>
    {
        for (const { states } of GAMES)
        {
            const last = states[states.length - 1];
            const ending = chessEngine.finish(last);

            if (ending === null)
            {
                continue;
            }

            const places = chessEngine.standings(last).map((one) => one.place).sort();

            expect(places).toEqual(ending.winners.length === 1 ? [1, 2] : [1, 1]);
        }

        expect(GAMES.some(({ states }) => chessEngine.finish(states[states.length - 1]) !== null)).toBe(true);
    });

    it('counts what each side did in the words its ladders will read', () =>
    {
        const counted = new Set(GAMES.flatMap(({ batches }) => [...chessEngine.tally(batches.flat()).values()].flatMap((tally) => Object.keys(tally))));

        expect(counted).toContain('moves');
        expect(counted).toContain('captures');
        expect(chessEngine.points({ captures: 3, promotions: 1, checkmates: 1 })).toBe(8);
        expect(chessEngine.points({ captures: 40 })).toBe(25);
    });
});
