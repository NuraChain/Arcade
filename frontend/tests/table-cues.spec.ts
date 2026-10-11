import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pokerBeats, tableCues, turnChime } from '../src/components/games/table-cues.ts';
import type { SoundHandle } from '../src/game/sound.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { NO_EVENTS, type MatchEvent } from '../src/stores/match.store.ts';

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

        table.hear({ ...NO_EVENTS, seq: 3, events: [event(5)] }, { id: 'm', rev: 5 });
        expect(beats).not.toHaveBeenCalled();

        table.hear({ ...NO_EVENTS, seq: 4, events: [event(6)] }, { id: 'm', rev: 6 });
        expect(beats).toHaveBeenCalledTimes(1);

        table.dispose();
    });

    it('stays quiet over a gap in the log rather than playing half a story', () =>
    {
        const beats = vi.fn(() => []);
        const table = tableCues({ enabled: false, seq: 0, match: { id: 'm', rev: 5 }, beats });

        table.hear({ ...NO_EVENTS, seq: 1, events: [event(9)] }, { id: 'm', rev: 9 });

        expect(beats).not.toHaveBeenCalled();
        table.dispose();
    });

    it('starts over for a rematch rather than waiting for the old match\'s last revision', () =>
    {
        const beats = vi.fn(() => []);
        const table = tableCues({ enabled: false, seq: 0, match: { id: 'old', rev: 90 }, beats });

        table.hear({ ...NO_EVENTS, seq: 1, events: [event(1)] }, { id: 'new', rev: 1 });
        table.hear({ ...NO_EVENTS, seq: 2, events: [event(2)] }, { id: 'new', rev: 2 });

        expect(beats).toHaveBeenCalledTimes(1);
        table.dispose();
    });

    it('stays quiet over a long catch-up instead of replaying it', () =>
    {
        const beats = vi.fn(() => []);
        const table = tableCues({ enabled: false, seq: 0, match: { id: 'm', rev: 0 }, beats });

        table.hear({ ...NO_EVENTS, seq: 1, events: Array.from({ length: 13 }, (_, index) => event(index + 1)) }, { id: 'm', rev: 13 });

        expect(beats).not.toHaveBeenCalled();
        table.dispose();
    });
});

describe('the chime for a turn', () =>
{
    const handle = () =>
    {
        const played: string[] = [];
        const sound: SoundHandle = {
            play: (cue) =>
            {
                played.push(cue);
            },
            setEnabled: () => undefined,
            dispose: () => undefined
        };

        return { played, sound };
    };

    it('rings when the turn becomes the reader\'s, and not when it already was', () =>
    {
        const { played, sound } = handle();
        const chime = turnChime(() => sound);

        chime(true);
        expect(played).toEqual([]);

        chime(false);
        chime(true);
        chime(true);
        expect(played).toEqual(['turn']);

        chime(false);
        chime(true);
        expect(played).toEqual(['turn', 'turn']);
    });

    it('is silent on a board that has no sound yet, and rings on the one it is given later', () =>
    {
        const { played, sound } = handle();
        let held: SoundHandle | null = null;
        const chime = turnChime(() => held);

        chime(false);
        chime(true);
        expect(played).toEqual([]);

        held = sound;
        chime(false);
        chime(true);
        expect(played).toEqual(['turn']);
    });
});
