import { describe, expect, it } from 'vitest';

import { BAR, CHECKERS, OFF, START, facing } from '../src/domains/match/backgammon/board.ts';
import { apply, autoplay, create, legalMoves, type Die, type Outcome } from '../src/domains/match/backgammon/engine.ts';
import type { BackgammonAction, BackgammonEvent, BackgammonState } from '../src/domains/match/backgammon/state.ts';
import { backgammonEngine } from '../src/domains/match/engines/backgammon.ts';

const scripted = (faces: number[]): Die =>
{
    let next = 0;

    return (sides: number) =>
    {
        const face = faces[next % faces.length];

        next += 1;

        return Math.min(face, sides);
    };
};

function seeded(seed: number): () => number
{
    let value = seed;

    return () =>
    {
        value |= 0;
        value = (value + 0x6d2b79f5) | 0;
        let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

const dieFrom = (random: () => number): Die => (sides: number) => 1 + Math.floor(random() * sides);

function applied(outcome: Outcome): { state: BackgammonState; events: BackgammonEvent[] }
{
    if (!outcome.ok)
    {
        throw new Error(`refused: ${ outcome.reason }`);
    }

    return outcome;
}

function layout(points: Record<number, number>): number[]
{
    const checkers = Array.from({ length: 26 }, () => 0);

    for (const [point, count] of Object.entries(points))
    {
        checkers[Number(point)] = count;
    }

    checkers[OFF] += CHECKERS - checkers.reduce((total, count) => total + count, 0);

    return checkers;
}

const opened = (target: number, cube: boolean, faces: number[] = [6, 1]): BackgammonState => create(target, cube, scripted(faces));

function outcomeAfter(state: BackgammonState, seat: number): string | undefined
{
    const forfeited = applied(apply(state, { kind: 'forfeit', seat, reason: 'resign' }, scripted([1])));

    return backgammonEngine.finish(forfeited.state)?.outcome;
}

describe('the opening roll', () =>
{
    it('gives the first move to the higher of one die each, and that player plays both', () =>
    {
        const state = opened(3, true, [5, 2]);

        expect(state.turn).toBe(0);
        expect(state.dice).toEqual([5, 2]);
        expect(state.phase).toBe('move');
        expect(state.rev).toBe(0);
        expect(state.round).toBe(1);

        const other = opened(3, true, [1, 6]);

        expect(other.turn).toBe(1);
        expect(other.dice).toEqual([1, 6]);
    });

    it('rolls again on a tie', () =>
    {
        const state = opened(3, true, [3, 3, 4, 4, 2, 5]);

        expect(state.turn).toBe(1);
        expect(state.dice).toEqual([2, 5]);
    });

    it('still opens when every throw ties, rather than rolling forever', () =>
    {
        const state = opened(3, true, [4]);

        expect([0, 1]).toContain(state.turn);
        expect(state.phase).toBe('move');
        expect(state.dice).toEqual([4, 4]);
    });

    it('opens every later game of the match the same way, and says so in the log', () =>
    {
        const state: BackgammonState = {
            ...opened(3, true),
            checkers: [layout({ 1: 1 }), layout({ 6: 1 })],
            turn: 0,
            phase: 'move',
            dice: [6, 5]
        };

        const next = applied(apply(state, { kind: 'move', seat: 0, hops: [{ from: 1, to: 0 }] }, scripted([2, 4])));

        expect(next.state.round).toBe(2);
        expect(next.state.checkers).toEqual([[...START], [...START]]);
        expect(next.state.turn).toBe(1);
        expect(next.state.dice).toEqual([2, 4]);
        expect(next.events).toContainEqual({ e: 'opening', seat: 1, dice: [2, 4] });
    });

    it('turns a table with no target into a one-point match with a dead cube', () =>
    {
        const state = backgammonEngine.create([0, 1], { die: scripted([6, 1]) }, { target: 0, cube: true, blinds: 'low' });

        expect(state.target).toBe(1);
        expect(state.cubed).toBe(false);
    });
});

describe('rolling', () =>
{
    it('rolls for the next player inside the move that ended the last turn when they cannot double', () =>
    {
        const state = opened(1, false);
        const next = applied(apply(state, { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }, { from: 8, to: 7 }] }, scripted([3, 5])));

        expect(next.state.turn).toBe(1);
        expect(next.state.phase).toBe('move');
        expect(next.state.dice).toEqual([3, 5]);
        expect(next.events.at(-1)).toEqual({ e: 'roll', seat: 1, dice: [3, 5] });
        expect(next.state.rev).toBe(state.rev + 1);
    });

    it('waits for a player who could double, and rolls when they ask', () =>
    {
        const state = opened(3, true);
        const moved = applied(apply(state, { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }, { from: 8, to: 7 }] }, scripted([3, 5])));

        expect(moved.state.turn).toBe(1);
        expect(moved.state.phase).toBe('roll');
        expect(moved.state.dice).toEqual([]);
        expect(moved.events.some((event) => event.e === 'roll')).toBe(false);

        const rolled = applied(apply(moved.state, { kind: 'roll', seat: 1 }, scripted([3, 5])));

        expect(rolled.state.phase).toBe('move');
        expect(rolled.state.dice).toEqual([3, 5]);
        expect(rolled.events).toEqual([{ e: 'roll', seat: 1, dice: [3, 5] }]);
    });

    it('rolls for the doubler once the double is taken, because the cube is no longer theirs to turn', () =>
    {
        const waiting: BackgammonState = { ...opened(3, true), turn: 0, phase: 'roll', dice: [] };
        const doubled = applied(apply(waiting, { kind: 'double', seat: 0 }, scripted([1])));

        expect(doubled.state.phase).toBe('double');
        expect(backgammonEngine.turnOf(doubled.state)).toBe(1);
        expect(doubled.events).toEqual([{ e: 'double', seat: 0, cube: 2 }]);

        const taken = applied(apply(doubled.state, { kind: 'take', seat: 1 }, scripted([4, 2])));

        expect(taken.state.cube).toBe(2);
        expect(taken.state.owner).toBe(1);
        expect(taken.state.turn).toBe(0);
        expect(taken.state.phase).toBe('move');
        expect(taken.state.dice).toEqual([4, 2]);
        expect(taken.events).toEqual([{ e: 'take', seat: 1, cube: 2 }, { e: 'roll', seat: 0, dice: [4, 2] }]);
    });
});

describe('a turn with no legal move', () =>
{
    const blocked = (): BackgammonState => ({
        ...opened(1, false),
        checkers: [
            layout({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 13: 3 }),
            layout({ [BAR]: 1, 6: 14 })
        ],
        turn: 0,
        phase: 'move',
        dice: [6, 5]
    });

    it('passes inside the same action and logs the pass', () =>
    {
        const next = applied(apply(blocked(), { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }, { from: 13, to: 8 }] }, scripted([6, 6, 2, 1])));

        expect(next.events.map((event) => event.e)).toEqual(['move', 'move', 'roll', 'pass', 'roll']);
        expect(next.events).toContainEqual({ e: 'pass', seat: 1 });
        expect(next.state.turn).toBe(0);
        expect(next.state.phase).toBe('move');
        expect(next.state.dice).toEqual([2, 1]);
        expect(next.state.rev).toBe(blocked().rev + 1);
    });

    it('never leaves the player on turn with nothing to do', () =>
    {
        const next = applied(apply(blocked(), { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }, { from: 13, to: 8 }] }, scripted([6, 6, 2, 1])));

        expect(legalMoves(next.state, next.state.turn).length).toBeGreaterThan(0);
    });
});

describe('refusals', () =>
{
    const die = scripted([3, 5]);

    it('refuses anything once the match is over', () =>
    {
        const over = applied(apply(opened(1, false), { kind: 'forfeit', seat: 1, reason: 'resign' }, die)).state;

        expect(apply(over, { kind: 'roll', seat: 0 }, die)).toEqual({ ok: false, reason: 'game-over' });
    });

    it('refuses a seat that is not at the table', () =>
    {
        expect(apply(opened(1, false), { kind: 'roll', seat: 2 }, die)).toEqual({ ok: false, reason: 'not-playing' });
    });

    it('refuses the player who is not on turn', () =>
    {
        expect(apply(opened(1, false), { kind: 'move', seat: 1, hops: [{ from: 13, to: 7 }, { from: 8, to: 7 }] }, die))
            .toEqual({ ok: false, reason: 'not-your-turn' });
    });

    it('refuses a doubler answering their own double', () =>
    {
        const offered: BackgammonState = { ...opened(3, true), turn: 0, phase: 'double', dice: [] };

        expect(apply(offered, { kind: 'take', seat: 0 }, die)).toEqual({ ok: false, reason: 'not-your-turn' });
    });

    it('refuses a move before the roll', () =>
    {
        const waiting: BackgammonState = { ...opened(3, true), turn: 0, phase: 'roll', dice: [] };

        expect(apply(waiting, { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }] }, die)).toEqual({ ok: false, reason: 'must-roll-first' });
    });

    it('refuses a second roll and a double after the dice are down', () =>
    {
        const moving = opened(3, true);

        expect(apply(moving, { kind: 'roll', seat: 0 }, die)).toEqual({ ok: false, reason: 'already-rolled' });
        expect(apply(moving, { kind: 'double', seat: 0 }, die)).toEqual({ ok: false, reason: 'already-rolled' });
    });

    it('refuses a double the cube does not allow', () =>
    {
        const waiting: BackgammonState = { ...opened(3, true), turn: 0, phase: 'roll', dice: [], owner: 1, cube: 2 };

        expect(apply(waiting, { kind: 'double', seat: 0 }, die)).toEqual({ ok: false, reason: 'cannot-double' });
    });

    it('refuses an answer to a double nobody offered', () =>
    {
        const waiting: BackgammonState = { ...opened(3, true), turn: 0, phase: 'roll', dice: [] };

        expect(apply(waiting, { kind: 'take', seat: 0 }, die)).toEqual({ ok: false, reason: 'no-double' });
        expect(apply(opened(3, true), { kind: 'drop', seat: 0 }, die)).toEqual({ ok: false, reason: 'no-double' });
    });

    it('refuses anything but an answer while a double is pending', () =>
    {
        const offered: BackgammonState = { ...opened(3, true), turn: 0, phase: 'double', dice: [] };

        expect(apply(offered, { kind: 'roll', seat: 1 }, die)).toEqual({ ok: false, reason: 'double-pending' });
    });

    it('refuses a play that is not a whole legal turn', () =>
    {
        const state = opened(1, false);

        expect(apply(state, { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }] }, die)).toEqual({ ok: false, reason: 'illegal-move' });
        expect(apply(state, { kind: 'move', seat: 0, hops: [{ from: 24, to: 18 }, { from: 18, to: 12 }] }, die)).toEqual({ ok: false, reason: 'illegal-move' });
        expect(apply(state, { kind: 'move', seat: 0, hops: [{ from: 6, to: 0 }, { from: 8, to: 7 }] }, die)).toEqual({ ok: false, reason: 'illegal-move' });
    });

    it('changes nothing when it refuses', () =>
    {
        const state = opened(1, false);
        const before = JSON.stringify(state);

        apply(state, { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }] }, die);

        expect(JSON.stringify(state)).toBe(before);
    });
});

describe('walking out', () =>
{
    it('ends the match, names the other seat, and logs it', () =>
    {
        const state = opened(5, true);
        const gone = applied(apply(state, { kind: 'forfeit', seat: 0, reason: 'left' }, scripted([1])));

        expect(gone.state.winner).toBe(1);
        expect(gone.state.rev).toBe(state.rev + 1);
        expect(gone.events).toEqual([{ e: 'forfeit', seat: 0, reason: 'left' }, { e: 'finish', seat: 1 }]);
        expect(backgammonEngine.turnOf(gone.state)).toBeNull();
        expect(backgammonEngine.finish(gone.state)?.winners).toEqual([1]);
    });

    it('is abandoned, and unrated, until both seats have taken two actions', () =>
    {
        const state = opened(5, true);

        expect(outcomeAfter(state, 0)).toBe('abandoned');
        expect(outcomeAfter({ ...state, acted: [2, 1] }, 0)).toBe('abandoned');
        expect(outcomeAfter({ ...state, acted: [1, 2] }, 1)).toBe('abandoned');
    });

    it('is a rated win for the other seat once both have taken two actions', () =>
    {
        const state = opened(5, true);

        expect(outcomeAfter({ ...state, acted: [2, 2] }, 0)).toBe('won');
        expect(outcomeAfter({ ...state, acted: [7, 3] }, 1)).toBe('won');
    });

    it('counts the actions a seat really took, and nothing the engine did for it', () =>
    {
        let state = opened(1, false);

        state = applied(apply(state, { kind: 'move', seat: 0, hops: [{ from: 13, to: 7 }, { from: 8, to: 7 }] }, scripted([3, 5]))).state;

        expect(state.acted).toEqual([1, 0]);

        state = applied(apply(state, legalMoves(state, 1)[0], scripted([6, 5]))).state;

        expect(state.acted).toEqual([1, 1]);
        expect(apply(state, { kind: 'roll', seat: 1 }, scripted([1])).ok).toBe(false);
        expect(state.acted).toEqual([1, 1]);
    });

    it('is always won when the match was played to its target', () =>
    {
        const state: BackgammonState = {
            ...opened(1, false),
            checkers: [layout({ 1: 1 }), layout({ 6: 1 })],
            turn: 0,
            phase: 'move',
            dice: [6, 5],
            acted: [0, 0]
        };

        const won = applied(apply(state, { kind: 'move', seat: 0, hops: [{ from: 1, to: 0 }] }, scripted([1])));

        expect(won.state.winner).toBe(0);
        expect(won.events.at(-1)).toEqual({ e: 'finish', seat: 0 });
        expect(backgammonEngine.finish(won.state)).toEqual({ winners: [0], outcome: 'won' });
        expect(backgammonEngine.standings(won.state)).toEqual([{ seat: 0, place: 1 }, { seat: 1, place: 2 }]);
    });
});

describe('autoplay', () =>
{
    it('rolls, and never doubles, when the cube could be turned', () =>
    {
        const waiting: BackgammonState = { ...opened(3, true), turn: 0, phase: 'roll', dice: [] };

        expect(legalMoves(waiting, 0)).toContainEqual({ kind: 'double', seat: 0 });
        expect(autoplay(waiting, 0)).toEqual({ kind: 'roll', seat: 0 });
    });

    it('plays the first full legal sequence', () =>
    {
        const state = opened(1, false);
        const auto = autoplay(state, 0);

        expect(auto).toEqual(legalMoves(state, 0)[0]);
        expect(auto?.kind).toBe('move');
        expect(apply(state, auto!, scripted([3, 5])).ok).toBe(true);
    });

    it('drops a double, which is the loss that is bounded', () =>
    {
        const offered: BackgammonState = { ...opened(3, true), turn: 0, phase: 'double', dice: [] };

        expect(autoplay(offered, 1)).toEqual({ kind: 'drop', seat: 1 });
        expect(autoplay(offered, 0)).toBeNull();
    });

    it('plays nothing for somebody who is not on turn, or after the match', () =>
    {
        const state = opened(1, false);

        expect(autoplay(state, 1)).toBeNull();
        expect(autoplay({ ...state, winner: 0 }, 0)).toBeNull();
    });
});

describe('what a match leaves behind', () =>
{
    const events: BackgammonEvent[] = [
        { e: 'move', seat: 0, from: 8, to: 3, die: 5, hit: true },
        { e: 'move', seat: 0, from: 3, to: 0, die: 3, hit: false },
        { e: 'move', seat: 1, from: 25, to: 22, die: 3, hit: true },
        { e: 'game', seat: 0, how: 'gammon', points: 2, cube: 1 },
        { e: 'game', seat: 0, how: 'backgammon', points: 6, cube: 2 },
        { e: 'game', seat: 1, how: 'single', points: 1, cube: 1 }
    ];

    it('tallies games, gammons, backgammons, hits and checkers borne off, per seat', () =>
    {
        const tally = backgammonEngine.tally(events);

        expect(tally.get(0)).toEqual({ hits: 1, borneOff: 1, games: 2, gammons: 2, backgammons: 1 });
        expect(tally.get(1)).toEqual({ hits: 1, games: 1 });
    });

    it('pays three a game and three a gammon, and never more than twenty-five', () =>
    {
        expect(backgammonEngine.points({ games: 2, gammons: 1 })).toBe(9);
        expect(backgammonEngine.points({ hits: 40, borneOff: 15 })).toBe(0);
        expect(backgammonEngine.points({ games: 9, gammons: 4 })).toBe(25);
    });
});

interface Coverage
{
    doubles: number;
    takes: number;
    drops: number;
    passes: number;
    crawford: number;
    gammons: number;
    forfeits: number;
}

function wrong(state: BackgammonState, before: BackgammonState): string | null
{
    for (const checkers of state.checkers)
    {
        if (checkers.length !== 26 || checkers.reduce((total, count) => total + count, 0) !== CHECKERS || checkers.some((count) => count < 0))
        {
            return `checkers ${ checkers.join(',') }`;
        }
    }

    for (let point = 1; point <= 24; point += 1)
    {
        if (state.checkers[0][point] > 0 && state.checkers[1][facing(point)] > 0)
        {
            return `two colours on point ${ point }`;
        }
    }

    if (state.phase === 'move' ? state.dice.length !== 2 : state.dice.length !== 0)
    {
        return `dice ${ state.dice.join(',') } in ${ state.phase }`;
    }

    if (state.dice.some((face) => !Number.isInteger(face) || face < 1 || face > 6))
    {
        return `dice ${ state.dice.join(',') }`;
    }

    if (state.score.some((points, seat) => points < before.score[seat]))
    {
        return 'a score went down';
    }

    if (![1, 2, 4, 8, 16, 32, 64].includes(state.cube) || (!state.cubed && state.cube !== 1) || (state.cube > 1) !== (state.owner !== null))
    {
        return `cube ${ state.cube } owned by ${ state.owner }`;
    }

    if (state.rev !== before.rev + 1)
    {
        return `revision ${ before.rev } -> ${ state.rev }`;
    }

    return null;
}

describe('a match always ends', () =>
{
    it('plays whole matches at one, three and five points, cube on and off, and keeps every rule after every action', () =>
    {
        const seen: Coverage = { doubles: 0, takes: 0, drops: 0, passes: 0, crawford: 0, gammons: 0, forfeits: 0 };
        const faults: string[] = [];

        for (const target of [1, 3, 5])
        {
            for (const cube of [true, false])
            {
                for (let match = 0; match < 12; match += 1)
                {
                    const random = seeded(target * 1000 + (cube ? 500 : 0) + match);
                    const die = dieFrom(random);
                    let state = create(target, cube, die);
                    let actions = 0;

                    while (state.winner === null && actions < 5000)
                    {
                        const seat = backgammonEngine.turnOf(state);

                        if (seat === null)
                        {
                            faults.push('no turn while live');
                            break;
                        }

                        const legal = legalMoves(state, seat);

                        if (legal.length === 0)
                        {
                            faults.push(`nothing legal for seat ${ seat } in ${ state.phase }`);
                            break;
                        }

                        if (state.crawford === 'now' && legal.some((action) => action.kind === 'double'))
                        {
                            faults.push('a double offered in the Crawford game');
                        }

                        seen.crawford += state.crawford === 'now' ? 1 : 0;

                        const chosen: BackgammonAction = random() < 0.003
                            ? { kind: 'forfeit', seat, reason: 'resign' }
                            : legal[Math.floor(random() * legal.length)];

                        let outcome: Outcome;

                        try
                        {
                            outcome = apply(state, chosen, die);
                        }
                        catch (error)
                        {
                            faults.push(`apply threw ${ String(error) }`);
                            break;
                        }

                        if (!outcome.ok)
                        {
                            faults.push(`refused its own legal ${ chosen.kind }: ${ outcome.reason }`);
                            break;
                        }

                        const fault = wrong(outcome.state, state);

                        if (fault !== null)
                        {
                            faults.push(`target ${ target } match ${ match } action ${ actions }: ${ fault }`);
                            break;
                        }

                        for (const event of outcome.events)
                        {
                            seen.doubles += event.e === 'double' ? 1 : 0;
                            seen.takes += event.e === 'take' ? 1 : 0;
                            seen.drops += event.e === 'drop' ? 1 : 0;
                            seen.passes += event.e === 'pass' ? 1 : 0;
                            seen.forfeits += event.e === 'forfeit' ? 1 : 0;
                            seen.gammons += event.e === 'game' && event.how !== 'single' ? 1 : 0;
                        }

                        state = outcome.state;
                        actions += 1;
                    }

                    if (state.winner === null)
                    {
                        faults.push(`target ${ target } match ${ match } never ended`);
                    }
                    else if (state.score[state.winner] < target && backgammonEngine.finish(state) === null)
                    {
                        faults.push('a finished match with no ending');
                    }
                }
            }
        }

        expect(faults).toEqual([]);

        for (const [name, count] of Object.entries(seen))
        {
            expect(count, name).toBeGreaterThan(0);
        }
    }, 60_000);
});
