import { describe, expect, it } from 'vitest';

import { BAR, CHECKERS, OFF, START, facing, type Hop, type Side } from '../src/domains/match/backgammon/board.ts';
import { mayDouble } from '../src/domains/match/backgammon/cube.ts';
import { apply, create, legalMoves } from '../src/domains/match/backgammon/engine.ts';
import { canStep, longest, settle, stage, step, turns } from '../src/domains/match/backgammon/moves.ts';
import { crawfordAfter, kindOf } from '../src/domains/match/backgammon/scoring.ts';
import type { BackgammonState } from '../src/domains/match/backgammon/state.ts';

interface Layout
{
    me: Record<number, number>;
    them?: Record<number, number>;
    themBar?: number;
}

function sideFrom(layout: Layout): Side
{
    const me = Array.from({ length: 26 }, () => 0);
    const them = Array.from({ length: 26 }, () => 0);

    for (const [point, count] of Object.entries(layout.me))
    {
        me[Number(point)] = count;
    }

    for (const [point, count] of Object.entries(layout.them ?? {}))
    {
        them[facing(Number(point))] = count;
    }

    them[BAR] = layout.themBar ?? 0;
    me[OFF] += CHECKERS - me.reduce((total, count) => total + count, 0);
    them[OFF] += CHECKERS - them.reduce((total, count) => total + count, 0);

    return { me, them };
}

const named = (hops: readonly Hop[]): string =>
    hops.map((hop) => `${ hop.from === BAR ? 'bar' : hop.from }/${ hop.to === OFF ? 'off' : hop.to }`).join(' ');

const listed = (side: Side, roll: number[]): string[] => turns(side, roll).map(named).sort();

const orders = (hops: readonly Hop[]): Hop[][] =>
    hops.length <= 1
        ? [[...hops]]
        : hops.flatMap((hop, index) => orders([...hops.slice(0, index), ...hops.slice(index + 1)]).map((rest) => [hop, ...rest]));

const firstSteps = (side: Side, roll: number[]): string[] =>
    [...new Set(turns(side, roll)
        .flatMap(orders)
        .filter((order) => settle(side, roll, order) !== null)
        .map((order) => named([order[0]])))].sort();

const scripted = (faces: number[]): ((sides: number) => number) =>
{
    let next = 0;

    return (sides: number) =>
    {
        const face = faces[next % faces.length];

        next += 1;

        return Math.min(face, sides);
    };
};

function stateWith(overrides: Partial<BackgammonState>): BackgammonState
{
    return {
        ...create(3, true, scripted([6, 1])),
        ...overrides
    };
}

describe('the opening position', () =>
{
    it('stands fifteen checkers a side on the 24, 13, 8 and 6 points', () =>
    {
        expect(START.reduce((total, count) => total + count, 0)).toBe(CHECKERS);
        expect([START[24], START[13], START[8], START[6]]).toEqual([2, 5, 3, 5]);
    });

    it('offers the known number of distinct plays for every opening roll', () =>
    {
        const side: Side = { me: [...START], them: [...START] };
        const expected: Record<string, number> = {
            '2-1': 15, '3-1': 16, '4-1': 14, '5-1': 8, '6-1': 10, '3-2': 17, '4-2': 18, '5-2': 8,
            '6-2': 14, '4-3': 17, '5-3': 9, '6-3': 14, '5-4': 9, '6-4': 14, '6-5': 7,
            '1-1': 42, '2-2': 75, '3-3': 73, '4-4': 52, '5-5': 4, '6-6': 11
        };

        for (const [roll, count] of Object.entries(expected))
        {
            const [high, low] = roll.split('-').map(Number);

            expect(turns(side, [high, low]), roll).toHaveLength(count);
        }
    });
});

describe('using the dice', () =>
{
    it('uses both dice whenever any legal sequence can', () =>
    {
        const side = sideFrom({ me: { 8: 1 }, them: { 3: 2 } });

        expect(listed(side, [5, 1])).toEqual(['8/7 7/2']);
        expect(firstSteps(side, [5, 1])).toEqual(['8/7']);
        expect(settle(side, [5, 1], [{ from: 8, to: 7 }])).toBeNull();
    });

    it('plays the higher die when only one die can be played and either could', () =>
    {
        const side = sideFrom({ me: { 13: 1 }, them: { 3: 2 } });

        expect(longest(side, [6, 4])).toBe(1);
        expect(listed(side, [6, 4])).toEqual(['13/7']);
        expect(settle(side, [6, 4], [{ from: 13, to: 9 }])).toBeNull();
        expect(settle(side, [6, 4], [{ from: 13, to: 7 }])).not.toBeNull();
    });

    it('plays the lower die when the higher cannot be played at all', () =>
    {
        const side = sideFrom({ me: { 13: 1 }, them: { 3: 2, 7: 2 } });

        expect(listed(side, [6, 4])).toEqual(['13/9']);
    });

    it('makes a combined move through its open intermediate point only', () =>
    {
        const side = sideFrom({ me: { 13: 1 }, them: { 7: 2 } });

        expect(listed(side, [6, 1])).toEqual(['13/12 12/6']);
        expect(firstSteps(side, [6, 1])).toEqual(['13/12']);
    });

    it('refuses a combined move when both intermediate points are blocked, though the destination is open', () =>
    {
        const side = sideFrom({ me: { 13: 1 }, them: { 8: 2, 10: 2 } });

        expect(canStep(side, 13, 5)).toBe(false);
        expect(canStep(side, 13, 3)).toBe(false);
        expect(longest(side, [5, 3])).toBe(0);
        expect(turns(side, [5, 3])).toEqual([]);
        expect(settle(side, [5, 3], [{ from: 13, to: 8 }, { from: 8, to: 5 }])).toBeNull();
    });

    it('gives four moves for doubles', () =>
    {
        const side: Side = { me: [...START], them: [...START] };

        for (const hops of turns(side, [3, 3]))
        {
            expect(hops).toHaveLength(4);
        }
    });

    it('plays as many of a double as can be played, and no fewer', () =>
    {
        const side = sideFrom({ me: { 25: 2, 6: 13 }, them: { 15: 2, 1: 2 } });

        expect(longest(side, [5, 5, 5, 5])).toBe(2);
        expect(listed(side, [5, 5])).toEqual(['bar/20 bar/20']);
    });

    it('hits a blot on the intermediate point of a combined move', () =>
    {
        const side = sideFrom({ me: { 24: 1, 6: 14 }, them: { 18: 1, 19: 2 } });

        expect(listed(side, [6, 5])).toEqual(['24/18 18/13', '24/18 6/1']);
        expect(firstSteps(side, [6, 5])).toEqual(['24/18', '6/1']);

        const played = settle(side, [6, 5], [{ from: 24, to: 18 }, { from: 18, to: 13 }]);

        expect(played?.played.map((one) => one.hit)).toEqual([true, false]);
        expect(played?.side.them[BAR]).toBe(1);
    });

    it('leaves the hitting play as the only one when the other runner is blocked', () =>
    {
        const side = sideFrom({ me: { 24: 1, 6: 14 }, them: { 18: 1, 19: 2, 13: 2 } });

        expect(listed(side, [6, 5])).toEqual(['24/18 6/1']);
    });
});

describe('hitting and the bar', () =>
{
    it('sends a lone checker to the bar and never two', () =>
    {
        const side = sideFrom({ me: { 13: 1 }, them: { 10: 1, 9: 2 } });

        expect(canStep(side, 13, 4)).toBe(false);

        const hit = step(side, 13, 3);

        expect(hit.played.hit).toBe(true);
        expect(hit.side.them[facing(10)]).toBe(0);
        expect(hit.side.them[BAR]).toBe(1);
        expect(hit.side.me[10]).toBe(1);
    });

    it('enters every checker from the bar before anything else moves', () =>
    {
        const side = sideFrom({ me: { 25: 1, 13: 5, 6: 9 }, them: { 19: 2 } });

        expect(canStep(side, 13, 1)).toBe(false);
        expect(listed(side, [6, 1])).toEqual(['bar/24 13/7', 'bar/24 24/18']);
        expect(firstSteps(side, [6, 1])).toEqual(['bar/24']);
    });

    it('enters on the opponent home point that matches the die, hitting a blot there', () =>
    {
        const side = sideFrom({ me: { 25: 1, 6: 14 }, them: { 22: 1 } });

        const entered = step(side, BAR, 3);

        expect(entered.played).toEqual({ from: BAR, to: 22, die: 3, hit: true });
        expect(entered.side.me[BAR]).toBe(0);
        expect(entered.side.them[BAR]).toBe(1);
    });

    it('loses the whole turn against a closed board', () =>
    {
        const side = sideFrom({ me: { 25: 1, 6: 14 }, them: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 } });

        expect(longest(side, [6, 6, 6, 6])).toBe(0);
        expect(turns(side, [6, 6])).toEqual([]);
        expect(settle(side, [6, 6], [{ from: BAR, to: 19 }])).toBeNull();
    });
});

describe('bearing off', () =>
{
    it('bears off nothing while any checker is outside the home board', () =>
    {
        const side = sideFrom({ me: { 7: 1, 3: 14 } });

        expect(canStep(side, 3, 3)).toBe(false);
        expect(canStep(side, 3, 6)).toBe(false);
        expect(listed(side, [6, 1])).toEqual(['7/1 1/off', '7/1 3/2']);
    });

    it('bears off with the exact die from its point', () =>
    {
        const side = sideFrom({ me: { 6: 1, 2: 1 } });

        expect(canStep(side, 6, 6)).toBe(true);
        expect(canStep(side, 2, 2)).toBe(true);
    });

    it('bears off with a higher die only from the highest occupied point', () =>
    {
        const side = sideFrom({ me: { 6: 1, 2: 1 } });

        expect(canStep(side, 2, 5)).toBe(false);
        expect(canStep(side, 6, 5)).toBe(true);
        expect(step(side, 6, 5).played.to).toBe(1);

        const lone = sideFrom({ me: { 3: 1, 2: 1 } });

        expect(canStep(lone, 3, 6)).toBe(true);
        expect(canStep(lone, 2, 6)).toBe(false);
        expect(listed(lone, [6, 5])).toEqual(['3/off 2/off']);
    });

    it('may move inside the home board rather than bear off', () =>
    {
        const side = sideFrom({ me: { 5: 1, 3: 1 } });

        expect(listed(side, [6, 4])).toEqual(['5/1 3/off', '5/off 3/off']);
    });

    it('works out which die a bear-off used without being told', () =>
    {
        const side = sideFrom({ me: { 5: 1, 2: 1 } });

        expect(listed(side, [6, 1])).toEqual(['5/4 4/off', '5/off 2/1']);

        const played = settle(side, [6, 1], [{ from: 2, to: 1 }, { from: 5, to: 0 }]);

        expect(played?.played.map((one) => one.die)).toEqual([1, 6]);
    });

    it('moves nothing off the tray', () =>
    {
        const side = sideFrom({ me: { 1: 1 } });

        expect(canStep(side, OFF, 1)).toBe(false);
    });
});

interface Line
{
    hops: Hop[];
    used: number[];
    side: Side;
}

function naive(side: Side, roll: number[]): Line[]
{
    const dice = roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : [roll[0], roll[1]];
    const lines: Line[] = [];

    const walk = (at: Side, left: number[], hops: Hop[], used: number[]): void =>
    {
        let moved = false;

        for (const die of new Set(left))
        {
            for (let from = BAR; from >= 1; from -= 1)
            {
                if (canStep(at, from, die))
                {
                    moved = true;

                    const next = step(at, from, die);
                    const rest = [...left];

                    rest.splice(rest.indexOf(die), 1);
                    walk(next.side, rest, [...hops, { from, to: next.played.to }], [...used, die]);
                }
            }
        }

        if (!moved)
        {
            lines.push({ hops, used, side: at });
        }
    };

    walk(side, dice, [], []);

    const most = Math.max(...lines.map((line) => line.hops.length));
    const full = lines.filter((line) => line.hops.length === most && most > 0);
    const high = Math.max(roll[0], roll[1]);

    if (most === 1 && roll[0] !== roll[1] && full.some((line) => line.used[0] === high))
    {
        return full.filter((line) => line.used[0] === high);
    }

    return full;
}

const finalOf = (side: Side): string => `${ side.me.join(',') }|${ side.them.join(',') }`;

describe('the move generator agrees with a naive enumerator written here', () =>
{
    it('offers exactly the final positions every legal sequence reaches, and accepts every one of those sequences', () =>
    {
        let seed = 991;
        const random = (): number =>
        {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed / 2147483648;
        };

        let side: Side = { me: [...START], them: [...START] };
        let checked = 0;

        for (let ply = 0; ply < 300; ply += 1)
        {
            const roll = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)];
            const oracle = naive(side, roll);
            const offered = turns(side, roll);

            expect(new Set(offered.map((hops) => finalOf(settle(side, roll, hops)!.side)))).toEqual(new Set(oracle.map((line) => finalOf(line.side))));
            expect(offered).toHaveLength(new Set(oracle.map((line) => finalOf(line.side))).size);

            for (const line of oracle)
            {
                expect(finalOf(settle(side, roll, line.hops)!.side)).toBe(finalOf(line.side));
                checked += 1;

                if (line.hops.length > 1)
                {
                    expect(settle(side, roll, line.hops.slice(0, -1))).toBeNull();
                }
            }

            if (offered.length > 0)
            {
                side = settle(side, roll, offered[Math.floor(random() * offered.length)])!.side;
            }

            side = side.me[OFF] === CHECKERS ? { me: [...START], them: [...START] } : { me: side.them, them: side.me };
        }

        expect(checked).toBeGreaterThan(2000);
    }, 30_000);
});

describe('staging a turn one hop at a time, which is how the board lets somebody play it', () =>
{
    it('offers exactly the hops some complete legal turn continues with, in whatever order they came', () =>
    {
        let seed = 4441;
        const random = (): number =>
        {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed / 2147483648;
        };

        let side: Side = { me: [...START], them: [...START] };
        let checked = 0;

        for (let ply = 0; ply < 150; ply += 1)
        {
            const roll = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)];
            const oracle = naive(side, roll);
            const prefixes = new Map<string, { hops: Hop[]; next: Set<string>; end: Side | null }>();

            for (const line of oracle)
            {
                for (let index = 0; index <= line.hops.length; index += 1)
                {
                    const hops = line.hops.slice(0, index);
                    const entry = prefixes.get(named(hops)) ?? { hops, next: new Set<string>(), end: null };

                    if (index < line.hops.length)
                    {
                        entry.next.add(named([line.hops[index]]));
                    }
                    else
                    {
                        entry.end = line.side;
                    }

                    prefixes.set(named(hops), entry);
                }
            }

            for (const entry of prefixes.values())
            {
                const staged = stage(side, roll, entry.hops);

                expect(staged).not.toBeNull();
                expect(new Set(staged!.next.map((hop) => named([hop])))).toEqual(entry.next);
                expect(staged!.done).toBe(entry.end !== null);

                if (entry.end !== null)
                {
                    expect(finalOf(staged!.at)).toBe(finalOf(entry.end));
                }

                checked += 1;
            }

            const offered = turns(side, roll);

            if (offered.length > 0)
            {
                side = settle(side, roll, offered[Math.floor(random() * offered.length)])!.side;
            }

            side = side.me[OFF] === CHECKERS ? { me: [...START], them: [...START] } : { me: side.them, them: side.me };
        }

        expect(checked).toBeGreaterThan(2000);
    }, 30_000);

    it('refuses a hop no legal turn begins with, and a turn longer than the dice allow', () =>
    {
        const side: Side = { me: [...START], them: [...START] };

        expect(stage(side, [6, 1], [{ from: 13, to: 7 }, { from: 7, to: 6 }])).not.toBeNull();
        expect(stage(side, [6, 1], [{ from: 13, to: 10 }])).toBeNull();
        expect(stage(side, [6, 1], [{ from: 13, to: 7 }, { from: 8, to: 7 }, { from: 6, to: 5 }])).toBeNull();
    });

    it('says the turn has nothing in it when nothing can be played, so the board offers no move at all', () =>
    {
        const closed = sideFrom({ me: { 25: 1, 6: 14 }, them: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 } });

        expect(stage(closed, [3, 5], [])).toEqual({ at: closed, next: [], done: true });
    });
});

describe('checkers are conserved', () =>
{
    it('keeps fifteen a side, and never two colours on one point, after every single hop', () =>
    {
        let seed = 17;
        const random = (): number =>
        {
            seed = (seed * 1103515245 + 12345) % 2147483648;

            return seed / 2147483648;
        };

        let side: Side = { me: [...START], them: [...START] };
        let hops = 0;

        for (let ply = 0; ply < 400; ply += 1)
        {
            const roll = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)];
            const options = turns(side, roll);

            if (options.length > 0)
            {
                const chosen = options[Math.floor(random() * options.length)];
                const played = settle(side, roll, chosen);

                expect(played).not.toBeNull();

                let walked = side;

                for (const hop of played!.played)
                {
                    walked = step(walked, hop.from, hop.die).side;
                    hops += 1;

                    for (const checkers of [walked.me, walked.them])
                    {
                        expect(checkers.reduce((total, count) => total + count, 0)).toBe(CHECKERS);
                        expect(Math.min(...checkers)).toBeGreaterThanOrEqual(0);
                    }

                    for (let point = 1; point <= 24; point += 1)
                    {
                        expect(walked.me[point] > 0 && walked.them[facing(point)] > 0, `point ${ point }`).toBe(false);
                    }
                }

                expect(walked).toEqual(played!.side);
                side = walked;
            }

            if (side.me[OFF] === CHECKERS)
            {
                side = { me: [...START], them: [...START] };
            }

            side = { me: side.them, them: side.me };
        }

        expect(hops).toBeGreaterThan(500);
    });

    it('accepts every legal play the list offers, in any order it could be played', () =>
    {
        const side = sideFrom({ me: { 24: 1, 6: 14 }, them: { 18: 1, 19: 2 } });

        expect(settle(side, [6, 5], [{ from: 6, to: 1 }, { from: 24, to: 18 }])).not.toBeNull();
        expect(settle(side, [6, 5], [{ from: 24, to: 18 }, { from: 6, to: 1 }])).not.toBeNull();
    });
});

describe('scoring', () =>
{
    it('counts a single when the loser has borne off a checker', () =>
    {
        expect(kindOf(sideFrom({ me: { 20: 5, 6: 9 } }).me)).toBe('single');
    });

    it('counts a gammon when the loser has borne off nothing', () =>
    {
        expect(kindOf(sideFrom({ me: { 6: 15 } }).me)).toBe('gammon');
    });

    it('counts a backgammon when the loser still has a checker on the bar or in the winner home board', () =>
    {
        expect(kindOf(sideFrom({ me: { 6: 14, 19: 1 } }).me)).toBe('backgammon');
        expect(kindOf(sideFrom({ me: { 6: 14, 25: 1 } }).me)).toBe('backgammon');
        expect(kindOf(sideFrom({ me: { 6: 14, 18: 1 } }).me)).toBe('gammon');
    });

    const finishing = (loser: Record<number, number>, cube: number): BackgammonState =>
    {
        const winner = sideFrom({ me: { 1: 1 } });
        const beaten = sideFrom({ me: loser });

        return stateWith({ checkers: [winner.me, beaten.me], turn: 0, phase: 'move', dice: [6, 5], cube, owner: 1, score: [0, 0], target: 25 });
    };

    for (const [how, loser, value] of [
        ['single', { 20: 5, 6: 9 }, 1],
        ['gammon', { 6: 15 }, 2],
        ['backgammon', { 6: 14, 22: 1 }, 3]
    ] as const)
    {
        it(`scores a ${ how } as ${ value } times the cube`, () =>
        {
            for (const cube of [1, 2, 4])
            {
                const played = apply(finishing(loser, cube), { kind: 'move', seat: 0, hops: [{ from: 1, to: 0 }] }, scripted([6, 1]));

                expect(played.ok).toBe(true);

                if (!played.ok)
                {
                    return;
                }

                expect(played.state.score[0]).toBe(value * cube);
                expect(played.events).toContainEqual({ e: 'game', seat: 0, how, points: value * cube, cube });
            }
        });
    }

    it('counts a gammon at full value with the cube never turned, because there is no Jacoby rule', () =>
    {
        const played = apply(finishing({ 6: 15 }, 1), { kind: 'move', seat: 0, hops: [{ from: 1, to: 0 }] }, scripted([6, 1]));

        expect(played.ok && played.state.score[0]).toBe(2);
    });

    it('scores a dropped double at the value of the cube before it was offered', () =>
    {
        const offered = stateWith({ turn: 0, phase: 'double', cube: 4, owner: 0, score: [0, 0], target: 25 });
        const dropped = apply(offered, { kind: 'drop', seat: 1 }, scripted([6, 1]));

        expect(dropped.ok && dropped.state.score).toEqual([4, 0]);
    });
});

describe('the doubling cube', () =>
{
    it('is dead in a one-point match', () =>
    {
        const state = create(1, true, scripted([6, 1]));

        expect(state.cubed).toBe(false);
        expect(mayDouble({ ...state, phase: 'roll' }, state.turn)).toBe(false);
    });

    it('is off when the table was opened without one', () =>
    {
        expect(create(5, false, scripted([6, 1])).cubed).toBe(false);
    });

    it('may be turned by either player while it is centred, and only by its owner after a take', () =>
    {
        const centred = stateWith({ phase: 'roll', owner: null });

        expect(mayDouble(centred, 0)).toBe(true);
        expect(mayDouble(centred, 1)).toBe(true);

        const owned = stateWith({ phase: 'roll', owner: 1, cube: 2 });

        expect(mayDouble(owned, 0)).toBe(false);
        expect(mayDouble(owned, 1)).toBe(true);
    });

    it('stops at sixty-four, the highest face it has', () =>
    {
        expect(mayDouble(stateWith({ phase: 'roll', owner: 0, cube: 64 }), 0)).toBe(false);
    });

    it('offers no beaver: the answer to a double is take or drop and nothing else', () =>
    {
        const offered = stateWith({ turn: 0, phase: 'double', owner: null, cube: 1 });

        expect(legalMoves(offered, 1)).toEqual([{ kind: 'take', seat: 1 }, { kind: 'drop', seat: 1 }]);
        expect(apply(offered, { kind: 'double', seat: 1 }, scripted([6, 1]))).toEqual({ ok: false, reason: 'double-pending' });
    });
});

describe('the Crawford rule', () =>
{
    it('starts the Crawford game when a player first reaches one point short of the match', () =>
    {
        expect(crawfordAfter('before', 2, 3)).toBe('now');
        expect(crawfordAfter('before', 4, 5)).toBe('now');
        expect(crawfordAfter('before', 3, 5)).toBe('before');
        expect(crawfordAfter('now', 1, 5)).toBe('after');
        expect(crawfordAfter('after', 4, 5)).toBe('after');
    });

    it('forbids the cube in the Crawford game and returns it afterwards', () =>
    {
        const crawford = stateWith({ phase: 'roll', crawford: 'now', owner: null });

        expect(mayDouble(crawford, 0)).toBe(false);
        expect(legalMoves(crawford, crawford.turn).map((action) => action.kind)).toEqual(['roll']);
        expect(apply(crawford, { kind: 'double', seat: crawford.turn }, scripted([6, 1]))).toEqual({ ok: false, reason: 'cannot-double' });

        expect(mayDouble({ ...crawford, crawford: 'after' }, 0)).toBe(true);
    });

    it('is played for real: reaching match point minus one makes the next game Crawford, and the one after it free', () =>
    {
        const winning = (score: number[], crawford: BackgammonState['crawford'], seat: number): BackgammonState =>
        {
            const winner = sideFrom({ me: { 1: 1, 0: 14 } });
            const loser = sideFrom({ me: { 2: 1, 0: 14 } });
            const checkers = seat === 0 ? [winner.me, loser.me] : [loser.me, winner.me];

            return stateWith({ checkers, turn: seat, phase: 'move', dice: [6, 5], cube: 1, owner: null, score, target: 3, crawford });
        };

        const first = apply(winning([1, 0], 'before', 0), { kind: 'move', seat: 0, hops: [{ from: 1, to: 0 }] }, scripted([6, 1]));

        expect(first.ok && first.state.score).toEqual([2, 0]);
        expect(first.ok && first.state.crawford).toBe('now');
        expect(first.ok && first.state.winner).toBeNull();

        const second = apply(winning([2, 0], 'now', 1), { kind: 'move', seat: 1, hops: [{ from: 1, to: 0 }] }, scripted([6, 1]));

        expect(second.ok && second.state.crawford).toBe('after');
        expect(second.ok && second.state.round).toBe(2);
    });
});
