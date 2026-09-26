import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backgammonBeats, pokerBeats, tableCues } from '../src/components/games/table-cues.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import type { MatchEvent } from '../src/stores/match.store.ts';

const cues = (beats: { cue?: string }[]): (string | undefined)[] => beats.map((beat) => beat.cue);

const event = (rev: number): MatchEvent => ({ rev, seat: 0, at: '', log: { kind: 'backgammon', moves: [{ e: 'roll', seat: 0, dice: [3, 4] }] } });

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(0), seed: 1 });
});

afterEach(() =>
{
    resetRuntime();
});

describe('backgammon sounds like its pieces', () =>
{
    it('lands both dice, the second a moment after the first', () =>
    {
        const beats = backgammonBeats([{ e: 'roll', seat: 1, dice: [2, 5] }], { mine: 0, seats: 2 });

        expect(cues(beats)).toEqual(['die-land', 'die-land']);
        expect(beats[1].at).toBeGreaterThan(beats[0].at);
    });

    it('steps each checker, and a hit thuds and buzzes whoever it concerns', () =>
    {
        const moves = [
            { e: 'move' as const, seat: 0, from: 13, to: 10, die: 3, hit: false },
            { e: 'move' as const, seat: 0, from: 10, to: 6, die: 4, hit: true }
        ];

        expect(cues(backgammonBeats(moves, { mine: 0, seats: 2 }))).toEqual(['token-step', 'token-step', 'token-capture']);
        expect(backgammonBeats(moves, { mine: 0, seats: 2 }).at(-1)?.buzz).toBe('capture');
        expect(backgammonBeats(moves, { mine: 1, seats: 2 }).at(-1)?.buzz).toBe('hit');
        expect(backgammonBeats(moves, { mine: null, seats: 2 }).at(-1)?.buzz).toBeUndefined();
    });

    it('bears off onto the tray with a softer sound', () =>
    {
        expect(cues(backgammonBeats([{ e: 'move', seat: 0, from: 3, to: 0, die: 3, hit: false }], { mine: 0, seats: 2 }))).toEqual(['token-yard']);
    });

    it('celebrates only the reader\'s own win', () =>
    {
        expect(cues(backgammonBeats([{ e: 'finish', seat: 0 }], { mine: 0, seats: 2 }))).toEqual(['win']);
        expect(cues(backgammonBeats([{ e: 'finish', seat: 1 }], { mine: 0, seats: 2 }))).toEqual([]);
    });
});

describe('poker sounds like cards and chips', () =>
{
    it('shuffles and deals to the table', () =>
    {
        const beats = pokerBeats([{ e: 'deal', hand: 1, button: 0, small: 10, big: 20 }], { mine: 0, seats: 3 });

        expect(beats[0].cue).toBe('card-shuffle');
        expect(beats.filter((beat) => beat.cue === 'card-slide')).toHaveLength(6);
    });

    it('lays a chip for a bet, knocks for a check and stacks the pot for its winner', () =>
    {
        const beats = pokerBeats([
            { e: 'call', seat: 1, amount: 20 },
            { e: 'check', seat: 0, amount: 0 },
            { e: 'pot', amount: 60, winners: [0] }
        ], { mine: 0, seats: 2 });

        expect(cues(beats)).toEqual(['chip-lay', 'tick', 'chips-stack', 'hand-won']);
        expect(beats.find((beat) => beat.cue === 'chips-stack')?.buzz).toBe('hand');
    });

    it('turns every community card on its own', () =>
    {
        expect(cues(pokerBeats([{ e: 'board', street: 'flop', cards: [1, 2, 3] }], { mine: 0, seats: 2 }))).toEqual(['card-place', 'card-place', 'card-place']);
    });
});

describe('a table\'s cues', () =>
{
    it('never replays what was already there, and plays what arrives after', () =>
    {
        const beats = vi.fn(() => []);
        const table = tableCues({ enabled: false, seq: 3, match: { id: 'm', rev: 5 }, beats });

        table.hear({ seq: 3, events: [event(5)] }, { id: 'm', rev: 5 });
        expect(beats).not.toHaveBeenCalled();

        table.hear({ seq: 4, events: [event(6)] }, { id: 'm', rev: 6 });
        expect(beats).toHaveBeenCalledTimes(1);

        table.dispose();
    });

    it('stays quiet over a gap in the log rather than playing half a story', () =>
    {
        const beats = vi.fn(() => []);
        const table = tableCues({ enabled: false, seq: 0, match: { id: 'm', rev: 5 }, beats });

        table.hear({ seq: 1, events: [event(9)] }, { id: 'm', rev: 9 });

        expect(beats).not.toHaveBeenCalled();
        table.dispose();
    });

    it('starts over for a rematch rather than waiting for the old match\'s last revision', () =>
    {
        const beats = vi.fn(() => []);
        const table = tableCues({ enabled: false, seq: 0, match: { id: 'old', rev: 90 }, beats });

        table.hear({ seq: 1, events: [event(1)] }, { id: 'new', rev: 1 });
        table.hear({ seq: 2, events: [event(2)] }, { id: 'new', rev: 2 });

        expect(beats).toHaveBeenCalledTimes(1);
        table.dispose();
    });

    it('stays quiet over a long catch-up instead of replaying it', () =>
    {
        const beats = vi.fn(() => []);
        const table = tableCues({ enabled: false, seq: 0, match: { id: 'm', rev: 0 }, beats });

        table.hear({ seq: 1, events: Array.from({ length: 13 }, (_, index) => event(index + 1)) }, { id: 'm', rev: 13 });

        expect(beats).not.toHaveBeenCalled();
        table.dispose();
    });
});
