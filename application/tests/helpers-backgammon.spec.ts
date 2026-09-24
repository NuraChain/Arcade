import { describe, it, expect } from 'vitest';

import { coachOf, hits, outcomeOf, type Moment, type Outcome } from '../src/game/helpers/backgammon.ts';
import { START, type Hop, type Side } from '../../server/src/domains/match/backgammon/board.ts';
import { stage } from '../../server/src/domains/match/backgammon/moves.ts';
import type { Tip } from '../src/game/helpers/tip.ts';
import { en } from '../src/locales/en/index.ts';
import { fa } from '../src/locales/fa/index.ts';

const row = (points: Record<number, number>): number[] =>
    Array.from({ length: 26 }, (_, point) => points[point] ?? 0);

const side = (me: Record<number, number>, them: Record<number, number>): Side => ({ me: row(me), them: row(them) });

const opening = (): Side => ({ me: [...START], them: [...START] });

const moment = (over: Partial<Moment>): Moment => ({
    phase: 'move',
    side: opening(),
    dice: [6, 1],
    staged: [],
    doubling: false,
    cube: 1,
    ...over
});

const forkedFive = side({ 13: 1, 10: 1, 1: 13 }, { 23: 2, 20: 2, 6: 11 });

const onlyOne = side({ 13: 1, 1: 14 }, { 23: 2, 6: 13 });

const onlyTheFive = side({ 13: 1, 1: 14 }, { 23: 2, 18: 2, 6: 11 });

const allHome = side({ 6: 5, 5: 5, 4: 5 }, { 6: 15 });

describe('what a backgammon hop does', () =>
{
    const cases: [string, Side, number[], Hop, Outcome | null][] = [
        ['a quiet opening hop does nothing to anybody', opening(), [6, 1], { from: 24, to: 18 }, null],
        ['landing on a lone checker hits it', side({ 13: 1, 1: 14 }, { 17: 1, 6: 14 }), [5, 3], { from: 13, to: 8 }, 'hit'],
        ['landing on an empty point is not a hit', side({ 13: 1, 1: 14 }, { 17: 1, 6: 14 }), [5, 3], { from: 13, to: 10 }, null],
        ['coming in from the bar onto an empty point enters', side({ 25: 1, 6: 14 }, { 6: 15 }), [5, 3], { from: 25, to: 20 }, 'enter'],
        ['coming in from the bar onto a blot enters and hits', side({ 25: 1, 6: 14 }, { 5: 1, 6: 14 }), [5, 3], { from: 25, to: 20 }, 'enterHit'],
        ['a checker leaving the board bears off', allHome, [6, 1], { from: 6, to: 0 }, 'off'],
        ['a bigger die bears off from the highest point', side({ 4: 15 }, { 6: 15 }), [6, 5], { from: 4, to: 0 }, 'off']
    ];

    it.each(cases)('%s', (_, position, dice, hop, expected) =>
    {
        const offered = stage(position, dice, [])?.next ?? [];

        expect(offered).toContainEqual(hop);
        expect(outcomeOf(position, hop)).toBe(expected);
    });

    it('calls a hit a hit whether or not it came in from the bar', () =>
    {
        expect([ 'hit', 'enter', 'enterHit', 'off', null ].map((one) => hits(one as Outcome | null))).toEqual([ true, false, true, false, false ]);
    });

    it('judges a later hop against the board as it stands after the earlier ones', () =>
    {
        const position = side({ 13: 2, 1: 13 }, { 17: 1, 6: 14 });
        const after = stage(position, [5, 5], [{ from: 13, to: 8 }]);

        expect(outcomeOf(position, { from: 13, to: 8 })).toBe('hit');
        expect(outcomeOf(after!.at, { from: 13, to: 8 })).toBeNull();
    });
});

describe('the backgammon rules coach', () =>
{
    const cases: [string, Moment, Tip | null][] = [
        ['says nothing when the opening roll binds nothing', moment({}), null],
        ['brings the bar in first', moment({ side: side({ 25: 1, 6: 14 }, { 6: 5, 13: 10 }) }), { key: 'helpers.backgammon.bar' }],
        ['says a double plays four times', moment({ dice: [3, 3] }), { key: 'helpers.backgammon.doubles', params: { die: 3 } }],
        ['does not promise four moves of a double when fewer can be played', moment({ side: side({ 13: 1, 1: 14 }, { 22: 2, 6: 13 }), dice: [5, 5] }), null],
        ['puts the bar before the double', moment({ side: side({ 25: 1, 6: 14 }, { 13: 15 }), dice: [4, 4] }), { key: 'helpers.backgammon.bar' }],
        ['names the higher die when either could go but not both', moment({ side: onlyOne, dice: [5, 6] }), { key: 'helpers.backgammon.higher', params: { die: 6 } }],
        ['stays quiet when only one die could ever be played', moment({ side: onlyTheFive, dice: [6, 5] }), null],
        ['says both dice must be used when a move would strand the other', moment({ side: forkedFive, dice: [6, 5] }), { key: 'helpers.backgammon.both' }],
        ['lets the both-dice rule go once the first hop is chosen', moment({ side: forkedFive, dice: [6, 5], staged: [{ from: 13, to: 8 }] }), null],
        ['says bearing off is open once every checker is home', moment({ side: allHome }), { key: 'helpers.backgammon.bear' }],
        ['does not repeat the bearing-off rule once a checker is off', moment({ side: side({ 6: 4, 5: 5, 4: 5, 0: 1 }, { 6: 15 }) }), null],
        ['says nothing when the whole move is staged', moment({ staged: [{ from: 13, to: 7 }, { from: 8, to: 7 }] }), null],
        ['explains the double before the roll the first time it is on offer', moment({ phase: 'roll', dice: [], doubling: true, cube: 1 }), { key: 'helpers.backgammon.double', params: { cube: 2 } }],
        ['says nothing about doubling once somebody in the game has doubled', moment({ phase: 'roll', dice: [], doubling: true, cube: 2 }), null],
        ['says nothing before the roll when there is no double to offer', moment({ phase: 'roll', dice: [], doubling: false }), null],
        ['weighs taking against giving up for the player who was doubled', moment({ phase: 'double', dice: [], cube: 2 }), { key: 'helpers.backgammon.take', params: { cube: 4, now: 2 } }]
    ];

    it.each(cases)('%s', (_, at, expected) =>
    {
        expect(coachOf(at)).toEqual(expected);
    });

    it('offers only the hops that keep both dice in play, which is what the coach is explaining', () =>
    {
        const offered = stage(forkedFive, [6, 5], [])!.next;

        expect(offered).toContainEqual({ from: 13, to: 8 });
        expect(offered).toContainEqual({ from: 10, to: 4 });
        expect(offered).not.toContainEqual({ from: 13, to: 7 });
    });

    it('has a sentence in both languages for every tip and outcome, and the Persian is its own', () =>
    {
        const keys = Object.keys(en).filter((key) => key.startsWith('helpers.backgammon.')) as (keyof typeof en)[];

        expect(keys.length).toBeGreaterThan(0);

        for (const key of keys)
        {
            expect(fa[key], key).toBeTruthy();
            expect(fa[key], key).not.toEqual(en[key]);
        }
    });
});
