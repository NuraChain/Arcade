import { describe, expect, it } from 'vitest';

import type { Draws } from '../src/domains/match/engine.ts';
import type { BackgammonState } from '../src/domains/match/backgammon/state.ts';
import { backgammonEngine } from '../src/domains/match/engines/backgammon.ts';
import { backgammonBoard, backgammonLog, backgammonPlay, matchBoard, matchLog, matchPlay } from '../src/schemas.ts';

function seeded(seed: number): { draws: Draws; next: () => number }
{
    let value = seed;

    const next = (): number =>
    {
        value |= 0;
        value = (value + 0x6d2b79f5) | 0;
        let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };

    return { draws: { die: (sides: number) => 1 + Math.floor(next() * sides) }, next };
}

const opened = (seed: number, target: number, cube: boolean): BackgammonState =>
    backgammonEngine.create([0, 1], seeded(seed).draws, { target, cube, blinds: 'low' });

describe('what one seat may see of the other', () =>
{
    it('shows every reader the same board and the same log, all match long', () =>
    {
        const { draws, next } = seeded(41);
        let state = backgammonEngine.create([0, 1], draws, { target: 5, cube: true, blinds: 'low' });
        const events: unknown[] = [];
        let compared = 0;

        while (backgammonEngine.finish(state) === null && compared < 3000)
        {
            const views = [0, 1, null].map((reader) => JSON.stringify(backgammonEngine.view(state, reader)));
            const logs = [0, 1, null].map((reader) => JSON.stringify(backgammonEngine.log(events, reader)));

            expect(new Set(views).size).toBe(1);
            expect(new Set(logs).size).toBe(1);

            const seat = backgammonEngine.turnOf(state)!;
            const legal = backgammonEngine.legal(state, seat);
            const applied = backgammonEngine.apply(state, legal[Math.floor(next() * legal.length)], draws);

            expect(applied.ok).toBe(true);

            if (!applied.ok)
            {
                return;
            }

            state = applied.state;
            events.push(...applied.events);
            compared += 1;
        }

        expect(compared).toBeGreaterThan(20);
    });

    it('puts every checker of both seats on the board it shows', () =>
    {
        const board = backgammonEngine.view(opened(3, 3, true), null);

        expect(board.kind).toBe('backgammon');

        if (board.kind !== 'backgammon')
        {
            return;
        }

        expect(board.seats.map((row) => row.seat)).toEqual([0, 1]);
        expect(board.seats.map((row) => row.checkers.reduce((total, count) => total + count, 0))).toEqual([15, 15]);
        expect(board.seats.map((row) => row.pips)).toEqual([167, 167]);
        expect(board.dice).toHaveLength(2);
    });
});

describe('the backgammon wire', () =>
{
    it('is a member of the shared unions, discriminated by the game name, and loses nothing on the way through', () =>
    {
        const board = backgammonEngine.view({ ...opened(5, 5, true), owner: 1, cube: 2 }, 0);

        expect(matchBoard.parse(board)).toEqual(board);
        expect(backgammonBoard.parse(board)).toEqual(board);

        const log = backgammonEngine.log([{ e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false }], 0);

        expect(matchLog.parse(log)).toEqual(log);
        expect(backgammonLog.parse(log)).toEqual(log);

        const play = { kind: 'backgammon' as const, verb: 'move' as const, hops: [{ from: 13, to: 7 }, { from: 8, to: 7 }] };

        expect(matchPlay.parse(play)).toEqual(backgammonPlay.parse(play));
    });

    it('bounds a play to four hops over the twenty-six places a checker can be', () =>
    {
        const hop = { from: 13, to: 7 };

        expect(backgammonPlay.safeParse({ kind: 'backgammon', verb: 'move', hops: [hop, hop, hop, hop, hop] }).ok).toBe(false);
        expect(backgammonPlay.safeParse({ kind: 'backgammon', verb: 'move', hops: [{ from: 26, to: 7 }] }).ok).toBe(false);
        expect(backgammonPlay.safeParse({ kind: 'backgammon', verb: 'move', hops: [{ from: 13, to: -1 }] }).ok).toBe(false);
        expect(backgammonPlay.safeParse({ kind: 'backgammon', verb: 'beaver' }).ok).toBe(false);
    });

    it('turns every verb into an action for the seat it was handed, never one read off the wire', () =>
    {
        for (const verb of ['roll', 'double', 'take', 'drop'] as const)
        {
            expect(backgammonEngine.parse({ kind: 'backgammon', verb }, 1)).toEqual({ kind: verb, seat: 1 });
        }

        expect(backgammonEngine.parse({ kind: 'backgammon', verb: 'move', hops: [{ from: 25, to: 20 }] }, 0))
            .toEqual({ kind: 'move', seat: 0, hops: [{ from: 25, to: 20 }] });
    });

    it('refuses a play addressed to another game, and one that does not add up', () =>
    {
        expect(backgammonEngine.parse({ kind: 'ludo', verb: 'roll' }, 0)).toBeNull();
        expect(backgammonEngine.parse({ kind: 'hokm', verb: 'card', card: 3 }, 0)).toBeNull();
        expect(backgammonEngine.parse({ kind: 'backgammon', verb: 'move' }, 0)).toBeNull();
        expect(backgammonEngine.parse({ kind: 'backgammon', verb: 'roll', hops: [{ from: 13, to: 7 }] }, 0)).toBeNull();
        expect(backgammonEngine.parse({ kind: 'backgammon', verb: 'move', hops: [{ from: 7, to: 13 }] }, 0)).toBeNull();
        expect(backgammonEngine.parse({ kind: 'backgammon', verb: 'move', hops: [{ from: 7, to: 7 }] }, 0)).toBeNull();
    });
});
