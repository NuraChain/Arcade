import { describe, expect, it } from 'vitest';

import { coachOf, outcomeOf, type LudoHappened, type LudoOutcome } from '../src/game/helpers/ludo.ts';
import type { LudoBoard } from '../src/data/match.ts';
import { ludoEngine } from '../../server/src/domains/match/engines/ludo.ts';
import { apply, create } from '../../server/src/domains/match/ludo/engine.ts';
import { coloursFor } from '../../server/src/domains/match/ludo/board.ts';
import type { LudoState } from '../../server/src/domains/match/ludo/state.ts';

const YARD = [-1, -1, -1, -1];

const position = (pieces: number[][], die: number | null, turn = 0, sixes = die === 6 ? 1 : 0): LudoState =>
{
    const colours = coloursFor(pieces.length);

    return {
        v: 1,
        game: 'ludo',
        players: pieces.map((row, seat) => ({ seat, colour: colours[seat], pieces: [...row], out: false })),
        turn,
        die,
        sixes,
        rev: 1,
        winner: null
    };
};

const boardOf = (state: LudoState, seat: number | null = state.players[state.turn].seat): LudoBoard =>
    ludoEngine.view(state, seat) as LudoBoard;

describe('what a ludo move does', () =>
{
    const cases: { name: string; pieces: number[][]; die: number; turn?: number; piece: number; says: LudoOutcome | null }[] = [
        { name: 'a six brings a token out', pieces: [YARD, YARD], die: 6, piece: 0, says: { kind: 'enter' } },
        { name: 'landing exactly on a token sends it home', pieces: [[10, -1, -1, -1], [38, -1, -1, -1]], die: 2, piece: 0, says: { kind: 'capture', victim: 1, count: 1 } },
        { name: 'two tokens sharing the square both go', pieces: [[10, -1, -1, -1], [38, 38, -1, -1]], die: 2, piece: 0, says: { kind: 'capture', victim: 1, count: 2 } },
        { name: 'passing over a token takes nothing', pieces: [[10, -1, -1, -1], [37, -1, -1, -1]], die: 2, piece: 0, says: { kind: 'step' } },
        { name: 'an own token is neither a block nor a victim', pieces: [[10, 12, -1, -1], YARD], die: 2, piece: 0, says: { kind: 'step' } },
        { name: 'a token on a star is safe from one landing on it', pieces: [[5, -1, -1, -1], [34, -1, -1, -1]], die: 3, piece: 0, says: { kind: 'safe' } },
        { name: 'an empty star is a safe square', pieces: [[5, -1, -1, -1], YARD], die: 3, piece: 0, says: { kind: 'safe' } },
        { name: 'the exact count reaches home', pieces: [[53, -1, -1, -1], YARD], die: 3, piece: 0, says: { kind: 'home' } },
        { name: 'the home run is nobody else\'s square', pieces: [[49, -1, -1, -1], [27, -1, -1, -1]], die: 4, piece: 0, says: { kind: 'step' } },
        { name: 'an overshoot is not a move at all', pieces: [[54, 10, -1, -1], YARD], die: 3, piece: 0, says: null },
        { name: 'yellow captures across the top of the ring', pieces: [[49, -1, -1, -1], [20, -1, -1, -1]], die: 3, turn: 1, piece: 0, says: { kind: 'capture', victim: 0, count: 1 } },
        { name: 'four seats name the right victim', pieces: [[17, -1, -1, -1], [7, -1, -1, -1], YARD, YARD], die: 3, piece: 0, says: { kind: 'capture', victim: 1, count: 1 } }
    ];

    for (const { name, pieces, die, turn, piece, says } of cases)
    {
        it(name, () =>
        {
            const state = position(pieces, die, turn ?? 0);

            expect(outcomeOf(boardOf(state), state.players[state.turn].seat, piece)).toEqual(says);
        });
    }

    it('says nothing to somebody watching', () =>
    {
        const state = position([[10, -1, -1, -1], [38, -1, -1, -1]], 2);

        expect(outcomeOf(boardOf(state, null), 0, 0)).toBeNull();
    });

    it('agrees with the engine over whole games at two, three and four', () =>
    {
        let seed = 11;
        const next = (): number =>
        {
            seed = (seed * 48271) % 2147483647;
            return seed;
        };

        let checked = 0;

        for (const count of [2, 3, 4])
        {
            for (let game = 0; game < 6; game += 1)
            {
                let state = create([0, 1, 2, 3].slice(0, count), game);

                for (let step = 0; step < 4000 && state.winner === null; step += 1)
                {
                    const seat = state.players[state.turn].seat;

                    if (state.die === null)
                    {
                        const rolled = apply(state, { kind: 'roll', seat, die: next() % 6 + 1 });

                        if (!rolled.ok)
                        {
                            throw new Error(rolled.reason);
                        }

                        state = rolled.state;
                        continue;
                    }

                    const board = boardOf(state);
                    const piece = board.moves[next() % board.moves.length];
                    const said = outcomeOf(board, seat, piece);
                    const moved = apply(state, { kind: 'move', seat, piece });

                    if (!moved.ok)
                    {
                        throw new Error(moved.reason);
                    }

                    const captures = moved.events.filter((event) => event.e === 'capture');

                    expect(said?.kind === 'capture').toBe(captures.length > 0);
                    expect(said?.kind === 'home').toBe(moved.events.some((event) => event.e === 'home'));
                    expect(said?.kind === 'enter').toBe(moved.events.some((event) => event.e === 'enter'));

                    if (said?.kind === 'capture')
                    {
                        expect(said.count).toBe(captures.length);
                        expect(captures.every((event) => event.e === 'capture' && event.victim === said.victim)).toBe(true);
                    }

                    checked += 1;
                    state = moved.state;
                }
            }
        }

        expect(checked).toBeGreaterThan(1000);
    });
});

describe('the rule that matters now', () =>
{
    const cases: { name: string; pieces: number[][]; die: number | null; turn?: number; recent?: LudoHappened[]; key: string | null }[] = [
        { name: 'a full yard needs a six', pieces: [YARD, YARD], die: null, key: 'helpers.ludo.tip.yard' },
        { name: 'a yard is full when everything else is home', pieces: [[56, 56, -1, -1], YARD], die: null, key: 'helpers.ludo.tip.yard' },
        { name: 'a token on the track needs no reminder', pieces: [[10, -1, -1, -1], YARD], die: null, key: null },
        { name: 'a six rolls again', pieces: [[10, -1, -1, -1], YARD], die: 6, key: 'helpers.ludo.tip.six' },
        { name: 'a six that brings the last token home wins rather than rolling again', pieces: [[56, 56, 56, 50], YARD], die: 6, key: null },
        { name: 'a six still rolls again when a token reaching home is not the last', pieces: [[56, 56, 50, 10], YARD], die: 6, key: 'helpers.ludo.tip.six' },
        {
            name: 'three sixes are old news once somebody has rolled since',
            pieces: [[10, -1, -1, -1], [3, -1, -1, -1]],
            die: null,
            turn: 1,
            recent: [{ e: 'roll', seat: 0 }, { e: 'pass', seat: 0, why: 'three-sixes' }, { e: 'roll', seat: 1 }],
            key: null
        },
        {
            name: 'three sixes are old news once the turn has come back',
            pieces: [YARD, [3, -1, -1, -1]],
            die: null,
            recent: [{ e: 'pass', seat: 0, why: 'three-sixes' }],
            key: 'helpers.ludo.tip.yard'
        },
        { name: 'a star shields the token a move lands on', pieces: [[5, -1, -1, -1], [34, -1, -1, -1]], die: 3, key: 'helpers.ludo.tip.star' },
        { name: 'the star matters more than the six', pieces: [[2, -1, -1, -1], [34, -1, -1, -1]], die: 6, key: 'helpers.ludo.tip.star' },
        { name: 'coming out onto a start star somebody holds takes nothing', pieces: [YARD, [26, -1, -1, -1]], die: 6, key: 'helpers.ludo.tip.star' },
        { name: 'home needs the exact count', pieces: [[54, 10, -1, -1], YARD], die: 3, key: 'helpers.ludo.tip.exact' },
        { name: 'an ordinary roll needs no tip', pieces: [[10, -1, -1, -1], YARD], die: 3, key: null },
        { name: 'nothing while somebody else plays', pieces: [[10, -1, -1, -1], [3, -1, -1, -1]], die: null, turn: 1, key: null },
        {
            name: 'somebody else\'s three sixes are theirs to read about',
            pieces: [[10, -1, -1, -1], YARD],
            die: null,
            recent: [{ e: 'pass', seat: 1, why: 'three-sixes' }],
            key: null
        }
    ];

    for (const { name, pieces, die, turn, recent, key } of cases)
    {
        it(name, () =>
        {
            const state = position(pieces, die, turn ?? 0);

            expect(coachOf(boardOf(state, 0), 0, state.players[state.turn].seat, recent ?? [])?.key ?? null).toBe(key);
        });
    }

    it('explains a third six after the turn has already passed', () =>
    {
        const before = position([[10, -1, -1, -1], YARD], null, 0, 2);
        const rolled = apply(before, { kind: 'roll', seat: 0, die: 6 });

        if (!rolled.ok)
        {
            throw new Error(rolled.reason);
        }

        const after = rolled.state;

        expect(after.turn).toBe(1);
        expect(coachOf(boardOf(after, 0), 0, 1, rolled.events)?.key).toBe('helpers.ludo.tip.threeSixes');
    });

    it('says nothing to somebody watching', () =>
    {
        const state = position([YARD, YARD], null);

        expect(coachOf(boardOf(state, null), undefined, 0, [{ e: 'pass', seat: 0, why: 'three-sixes' }])).toBeNull();
    });
});
