import { describe, expect, it } from 'vitest';

import { coachOf, handOf, movedTo, outcomeOf, pieceFor, type LudoHappened, type LudoOutcome } from '../src/game/helpers/ludo.ts';
import type { LudoBoard } from '../src/data/match.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { apply, create } from '../../backend/src/domains/match/ludo/engine.ts';
import { FINISHED, coloursFor } from '../../backend/src/domains/match/ludo/board.ts';
import type { GameEvent, LudoState } from '../../backend/src/domains/match/ludo/state.ts';

const YARD = [-1, -1, -1, -1];

const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

const PAIRED = [0, 1, 0, 1];

const position = (pieces: number[][], die: number | null, turn = 0, sixes = die === 6 ? 1 : 0, sides = pieces.map((_, seat) => seat)): LudoState =>
{
    const colours = coloursFor(pieces.length);

    return {
        v: 1,
        game: 'ludo',
        players: pieces.map((row, seat) => ({ seat, colour: colours[seat], pieces: [...row], out: false, side: sides[seat] })),
        turn,
        die,
        sixes,
        rev: 1,
        winner: null
    };
};

const pairs = (pieces: number[][], die: number | null, turn = 0) => position(pieces, die, turn, die === 6 ? 1 : 0, PAIRED);

const boardOf = (state: LudoState, seat: number | null = state.players[state.turn].seat) =>
    ludoEngine.view(state, seat) as LudoBoard;

const moved = (state: LudoState, piece: number) =>
{
    const outcome = apply(state, { kind: 'move', seat: state.players[state.turn].seat, piece });

    if (!outcome.ok)
    {
        throw new Error(outcome.reason);
    }

    return outcome;
};

describe('what a ludo move does', () =>
{
    const cases: { name: string; pieces: number[][]; die: number; turn?: number; piece: number; says: LudoOutcome | null }[] = [
        { name: 'a six brings a token out', pieces: [YARD, YARD], die: 6, piece: 0, says: { kind: 'enter' } },
        { name: 'coming out sends home an opponent on the start square', pieces: [YARD, [26, 10, -1, -1]], die: 6, piece: 0, says: { kind: 'enter', count: 1 } },
        { name: 'coming out sends home every colour on the start square', pieces: [YARD, [39, 39, -1, -1], YARD, [13, -1, -1, -1]], die: 6, piece: 0, says: { kind: 'enter', count: 3 } },
        { name: 'landing on the start square of another colour takes nothing', pieces: [[24, -1, -1, -1], [13, -1, -1, -1], YARD, YARD], die: 2, piece: 0, says: { kind: 'safe' } },
        { name: 'landing exactly on a token sends it home', pieces: [[10, -1, -1, -1], [38, -1, -1, -1]], die: 2, piece: 0, says: { kind: 'capture', victim: 1, count: 1 } },
        { name: 'a block of two is not a move at all', pieces: [[10, -1, -1, -1], [38, 38, -1, -1]], die: 2, piece: 0, says: null },
        { name: 'passing a block is not a move at all', pieces: [[10, -1, -1, -1], [38, 38, -1, -1]], die: 4, piece: 0, says: null },
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
            expect(outcomeOf(boardOf(position(pieces, die, turn ?? 0)), piece)).toEqual(says);
        });
    }

    it('says nothing to somebody watching', () =>
    {
        const state = position([[10, -1, -1, -1], [38, -1, -1, -1]], 2);

        expect(outcomeOf(boardOf(state, null), 0)).toBeNull();
    });

    it('agrees with the engine over whole games at two, three and four', () =>
    {
        let seed = 11;
        const next = () =>
        {
            seed = (seed * 48271) % 2147483647;
            return seed;
        };

        let checked = 0;
        let entries = 0;

        for (const count of [2, 3, 4])
        {
            for (let game = 0; game < 6; game += 1)
            {
                const seats = [0, 1, 2, 3].slice(0, count);
                let state = create(seats, game, seats);

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
                    const said = outcomeOf(board, piece);
                    const ahead = movedTo(board, piece);
                    const after = moved(state, piece);

                    const mineAfter = boardOf(after.state, seat).seats.find((one) => one.seat === seat)!;
                    const guessed = ahead?.seats.find((one) => one.seat === seat);

                    expect(board.controls).toBe(seat);
                    expect(guessed?.tokens.find((token) => token.piece === piece)).toEqual(mineAfter.tokens.find((token) => token.piece === piece));
                    expect(guessed?.home).toBe(mineAfter.home);

                    const captures = after.events.filter((event) => event.e === 'capture');

                    expect(said?.kind === 'capture' || (said?.kind === 'enter' && said.count !== undefined)).toBe(captures.length > 0);
                    expect(said?.kind === 'home').toBe(after.events.some((event) => event.e === 'home'));
                    expect(said?.kind === 'enter').toBe(after.events.some((event) => event.e === 'enter'));

                    if (said?.kind === 'capture')
                    {
                        expect(said.count).toBe(captures.length);
                        expect(captures.every((event) => event.e === 'capture' && event.victim === said.victim)).toBe(true);
                    }

                    if (said?.kind === 'enter' && said.count !== undefined)
                    {
                        expect(said.count).toBe(captures.length);
                        entries += 1;
                    }

                    checked += 1;
                    state = after.state;
                }
            }
        }

        expect(checked).toBeGreaterThan(1000);
        expect(entries, 'some self-played entry must capture').toBeGreaterThan(0);
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
        { name: 'coming out onto a start star somebody holds is a capture rather than a shield', pieces: [YARD, [26, -1, -1, -1]], die: 6, key: 'helpers.ludo.tip.six' },
        { name: 'home needs the exact count', pieces: [[54, 10, -1, -1], YARD], die: 3, key: 'helpers.ludo.tip.exact' },
        { name: 'a block ahead is why a token cannot move', pieces: [[10, 30, -1, -1], [38, 38, -1, -1]], die: 4, key: 'helpers.ludo.tip.blocked' },
        { name: 'no third token joins a block, and the tip says so', pieces: [[10, 12, 12, -1], YARD], die: 2, key: 'helpers.ludo.tip.blocked' },
        { name: 'a token on the start square holds the yard back', pieces: [[0, -1, -1, -1], YARD], die: 6, key: 'helpers.ludo.tip.start' },
        {
            name: 'a pass a block caused is explained once the turn has gone',
            pieces: [[10, -1, -1, -1], [38, 38, -1, -1]],
            die: null,
            turn: 1,
            recent: [{ e: 'roll', seat: 0, die: 4 }, { e: 'pass', seat: 0, why: 'no-move' }],
            key: 'helpers.ludo.tip.blocked'
        },
        {
            name: 'a six a block wasted is explained before the next roll',
            pieces: [[10, 56, 56, 56], [38, 38, -1, -1]],
            die: null,
            recent: [{ e: 'roll', seat: 0, die: 6 }],
            key: 'helpers.ludo.tip.blocked'
        },
        {
            name: 'a pass the exact count caused says nothing about blocks',
            pieces: [[54, 56, 56, 56], YARD],
            die: null,
            turn: 1,
            recent: [{ e: 'roll', seat: 0, die: 5 }, { e: 'pass', seat: 0, why: 'no-move' }],
            key: null
        },
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

describe('a tap on any yard token means the yard token the server offered', () =>
{
    it('maps every yard token to the one entry on offer', () =>
    {
        const board = boardOf(position([[-1, 10, -1, -1], YARD], 6));

        expect(board.moves).toEqual([0, 1]);
        expect([0, 2, 3].map((piece) => pieceFor(board, piece))).toEqual([0, 0, 0]);
    });

    it('keeps a token the server offered and refuses one it did not', () =>
    {
        const board = boardOf(position([[-1, 10, 54, -1], YARD], 6));

        expect(pieceFor(board, 1)).toBe(1);
        expect(pieceFor(board, 2)).toBeNull();
    });

    it('maps no yard token without a six, and none for somebody watching', () =>
    {
        const six = position([[-1, 10, -1, -1], YARD], 6);

        expect(pieceFor(boardOf(position([[-1, 10, -1, -1], YARD], 4)), 2)).toBeNull();
        expect(pieceFor(boardOf(six, null), 2)).toBeNull();
    });
});

describe('two against two', () =>
{
    const coached = (state: LudoState, mine: number, recent: readonly LudoHappened[] = []) =>
        coachOf(boardOf(state, mine), mine, state.players[state.turn].seat, recent)?.key ?? null;

    describe('what a move does', () =>
    {
        it('sends nobody home by landing on a partner, and says that the two make a block', () =>
        {
            const state = pairs([[27, -1, -1, -1], YARD, [4, -1, -1, -1], YARD], 3);

            expect(outcomeOf(boardOf(state), 0)).toEqual({ kind: 'step' });
            expect(coached(state, 0)).toBe('helpers.ludo.tip.partner');
            expect(moved(state, 0).events.map((event) => event.e)).toEqual(['step']);
        });

        it('still sends home an opponent it lands on, and names that opponent', () =>
        {
            const state = pairs([[27, -1, -1, -1], [17, -1, -1, -1], [10, -1, -1, -1], YARD], 3);

            expect(outcomeOf(boardOf(state), 0)).toEqual({ kind: 'capture', victim: 1, count: 1 });
            expect(coached(state, 0)).toBeNull();
        });

        it('offers no move onto or past a pair of opponents of two colours, and says why in the words for sides', () =>
        {
            const state = pairs([[27, 5, -1, -1], [17, -1, -1, -1], YARD, [43, -1, -1, -1]], 3);
            const board = boardOf(state);

            expect(board.moves).toEqual([1]);
            expect(outcomeOf(board, 0)).toBeNull();
            expect(coached(state, 0)).toBe('helpers.ludo.tip.blockedTeams');
            expect(coached(pairs([[26, 5, -1, -1], [17, -1, -1, -1], YARD, [43, -1, -1, -1]], 6), 0)).toBe('helpers.ludo.tip.blockedTeams');
        });

        it('lets no third token of a side join a pair of partners, and says so', () =>
        {
            const state = pairs([[27, 30, -1, -1], YARD, [4, -1, -1, -1], YARD], 3);

            expect(boardOf(state).moves).toEqual([1]);
            expect(coached(state, 0)).toBe('helpers.ludo.tip.blockedTeams');
        });

        it('keeps the words for colours wherever every seat plays for itself', () =>
        {
            expect(coached(position([[27, 5, -1, -1], [17, 17, -1, -1], YARD, YARD], 3), 0)).toBe('helpers.ludo.tip.blocked');
        });
    });

    describe('a seat whose four are home', () =>
    {
        it('moves the tokens of its partner: the outcome, the board ahead and a tap on the yard are all theirs', () =>
        {
            const state = pairs([HOME, [25, -1, -1, -1], [10, -1, 20, -1], YARD], 2);
            const board = boardOf(state);
            const ahead = movedTo(board, 0)!;

            expect(board.controls).toBe(2);
            expect(board.moves).toEqual([0, 2]);
            expect(outcomeOf(board, 0)).toEqual({ kind: 'capture', victim: 1, count: 1 });
            expect(outcomeOf(board, 2)).toEqual({ kind: 'step' });
            expect(ahead.seats.find((one) => one.seat === 2)!.tokens.find((token) => token.piece === 0)!.at).toBe(12);
            expect(ahead.seats.find((one) => one.seat === 0)).toEqual(board.seats.find((one) => one.seat === 0));
            expect(pieceFor(board, 1)).toBeNull();
        });

        it('brings out a token of its partner onto the partner\'s start square, and counts the opponents standing there', () =>
        {
            const state = pairs([HOME, [13, -1, -1, -1], [-1, 10, -1, -1], [13, -1, -1, -1]], 6);
            const board = boardOf(state);

            expect(board.moves).toEqual([0, 1]);
            expect(outcomeOf(board, 0)).toEqual({ kind: 'enter', count: 1 });
            expect([0, 2, 3].map((piece) => pieceFor(board, piece))).toEqual([0, 0, 0]);
            expect(moved(state, 0).events).toEqual([
                { e: 'enter', seat: 0, owner: 2, piece: 0 },
                { e: 'capture', seat: 0, owner: 2, piece: 0, victim: 1, victimPiece: 0 }
            ]);
        });

        it('is told so when its fourth token comes home, on the roll a six earned and when the turn has passed', () =>
        {
            const six = moved(pairs([[56, 56, 56, 50], YARD, [10, -1, -1, -1], YARD], 6), 3);
            const three = moved(pairs([[56, 56, 56, 53], YARD, [10, -1, -1, -1], YARD], 3), 3);

            expect(six.state.turn).toBe(0);
            expect(coached(six.state, 0, six.events)).toBe('helpers.ludo.tip.helping');
            expect(three.state.turn).toBe(1);
            expect(coached(three.state, 0, three.events)).toBe('helpers.ludo.tip.helping');
            expect(coached(three.state, 2, three.events)).toBeNull();
        });

        it('is not told again on the turns after', () =>
        {
            const state = pairs([HOME, YARD, [10, -1, -1, -1], YARD], null);

            expect(coached(state, 0, [{ e: 'roll', seat: 3, die: 2 }, { e: 'step', seat: 3, owner: 3 }])).toBeNull();
            expect(coached(pairs([HOME, YARD, YARD, YARD], null), 0)).toBe('helpers.ludo.tip.yard');
        });

        it('rolls again on a six that brings its own fourth home, and wins on the one that brings the side\'s eighth', () =>
        {
            expect(coached(pairs([[56, 56, 56, 50], YARD, [10, -1, -1, -1], YARD], 6), 0)).toBe('helpers.ludo.tip.six');
            expect(coached(pairs([[56, 56, 56, 50], YARD, HOME, YARD], 6), 0)).toBeNull();
            expect(coached(pairs([HOME, YARD, [56, 56, 56, 50], YARD], 6), 0)).toBeNull();
        });

        it('has a pass explained by what stopped its partner\'s tokens, once the turn has gone', () =>
        {
            const state = pairs([HOME, [17, -1, -1, -1], [1, -1, -1, -1], [43, -1, -1, -1]], null, 1);
            const recent = [{ e: 'roll', seat: 0, die: 3 }, { e: 'pass', seat: 0, why: 'no-move' }];

            expect(coached(state, 0, recent)).toBe('helpers.ludo.tip.blockedTeams');
        });
    });

    it('agrees with the engine over whole games, never names a partner a victim, and tells every seat when it starts moving its partner\'s tokens', () =>
    {
        const TOKEN: readonly GameEvent['e'][] = ['enter', 'step', 'home', 'capture'];
        let seed = 29;
        const next = () =>
        {
            seed = (seed * 48271) % 2147483647;
            return seed;
        };

        let checked = 0;
        let helped = 0;
        let handed = 0;
        let finished = 0;

        for (let game = 0; game < 6; game += 1)
        {
            let state = create([0, 1, 2, 3], game, PAIRED);

            for (let step = 0; step < 12_000 && state.winner === null; step += 1)
            {
                const seat = state.players[state.turn].seat;
                const board = boardOf(state);

                expect(handOf(board, seat)?.seat, 'the browser and the server disagree about whose tokens the seat on turn moves').toBe(board.controls);

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

                const hand = board.controls;
                const sideOf = (who: number) => board.seats.find((one) => one.seat === who)!.side;
                const piece = board.moves[next() % board.moves.length];
                const said = outcomeOf(board, piece);
                const ahead = movedTo(board, piece);
                const after = moved(state, piece);

                const theirsAfter = boardOf(after.state, seat).seats.find((one) => one.seat === hand)!;
                const guessed = ahead?.seats.find((one) => one.seat === hand);
                const captures = after.events.filter((event) => event.e === 'capture');

                expect(sideOf(hand)).toBe(sideOf(seat));
                expect(guessed?.tokens.find((token) => token.piece === piece)).toEqual(theirsAfter.tokens.find((token) => token.piece === piece));
                expect(guessed?.home).toBe(theirsAfter.home);
                expect(ahead?.seats.filter((one) => one.seat !== hand)).toEqual(board.seats.filter((one) => one.seat !== hand));
                expect(after.events.filter((event) => TOKEN.includes(event.e)).every((event) => 'owner' in event && event.owner === hand)).toBe(true);

                expect(said?.kind === 'capture' || (said?.kind === 'enter' && said.count !== undefined)).toBe(captures.length > 0);
                expect(said?.kind === 'home').toBe(after.events.some((event) => event.e === 'home'));
                expect(said?.kind === 'enter').toBe(after.events.some((event) => event.e === 'enter'));

                if (said?.kind === 'capture')
                {
                    expect(said.count).toBe(captures.length);
                    expect(sideOf(said.victim), 'a partner was named a victim').not.toBe(sideOf(seat));
                    expect(captures.every((event) => event.e === 'capture' && event.victim === said.victim)).toBe(true);
                }

                if (said?.kind === 'enter' && said.count !== undefined)
                {
                    expect(said.count).toBe(captures.length);
                }

                for (const token of board.seats.find((one) => one.seat === hand)!.tokens)
                {
                    const mapped = pieceFor(board, token.piece);

                    expect(mapped === null || board.moves.includes(mapped)).toBe(true);
                    expect(board.moves.includes(token.piece) ? mapped : token.piece).toBe(token.piece);
                }

                const own = boardOf(after.state, seat).seats.find((one) => one.seat === seat)!;
                const justHome = hand === seat && own.home === 4 && after.state.winner === null;
                const told = coachOf(boardOf(after.state, seat), seat, after.state.players[after.state.turn].seat, after.events)?.key ?? null;

                expect(told === 'helpers.ludo.tip.helping').toBe(justHome && after.events.some((event) => event.e === 'home'));

                checked += 1;
                helped += hand === seat ? 0 : 1;
                handed += told === 'helpers.ludo.tip.helping' ? 1 : 0;
                state = after.state;
            }

            finished += state.winner === null ? 0 : 1;
        }

        expect(checked).toBeGreaterThan(1000);
        expect(finished, 'a self-played team game did not end').toBe(6);
        expect(helped, 'no seat ever moved a token of its partner').toBeGreaterThan(0);
        expect(handed, 'no seat was told its four were home').toBeGreaterThan(0);
    });
});
