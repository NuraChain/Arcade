import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import TurnClock from '../src/components/games/turn-clock.component.azeroth';
import YardBadge from '../src/components/games/yard-badge.component.azeroth';
import type { LudoSeat, MatchPlayer } from '../src/data/match.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';

const played: string[] = [];

vi.mock('../src/game/sound.ts', () => ({
    createSound: () => ({
        play: (cue: string) => played.push(cue),
        setEnabled: () => undefined,
        dispose: () => undefined
    })
}));

type Rendered = HTMLElement;

const clock = () => runtime().clock as ManualClock;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(0), seed: 1 });
    played.length = 0;
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
});

describe('the last seconds of a turn', () =>
{
    it('tick for the reader from five seconds down, higher for the last two', async () =>
    {
        renderTest(() => TurnClock({ remainingMs: 7000, over: false, yours: true }) as Rendered);
        await Promise.resolve();

        for (let second = 0; second < 7; second += 1)
        {
            clock().advance(1000);
        }

        expect(played).toEqual(['tick', 'tick', 'tick', 'tick-hi', 'tick-hi']);
    });

    it('stay silent on somebody else\'s turn', async () =>
    {
        renderTest(() => TurnClock({ remainingMs: 7000, over: false, yours: false }) as Rendered);
        await Promise.resolve();

        for (let second = 0; second < 7; second += 1)
        {
            clock().advance(1000);
        }

        expect(played).toEqual([]);
    });
});

describe('the clock on a ludo plate', () =>
{
    const player = { seat: 0, who: 'alex', timeouts: 0 } as MatchPlayer;

    const seat: LudoSeat = { seat: 0, colour: 'red', tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: -1 })), home: 0, out: false, side: 0 };

    const plate = (over: { mine?: number; active?: boolean; finished?: boolean }) => renderTest(() => YardBadge({
        player,
        seat,
        corner: 'top-left',
        mine: over.mine,
        active: over.active ?? true,
        controls: 0,
        colours: ['red'],
        partner: false,
        finished: over.finished ?? false,
        remainingMs: 7000,
        turnMs: 30_000
    }) as Rendered).container;

    const lastSeconds = async () =>
    {
        await Promise.resolve();

        for (let second = 0; second < 7; second += 1)
        {
            clock().advance(1000);
        }
    };

    it('ticks on the reader\'s own plate from five seconds down', async () =>
    {
        const container = plate({ mine: 0 });

        await lastSeconds();

        expect(container.querySelector('.table-plate[data-turn] .plate-timer')).not.toBeNull();
        expect(played).toEqual(['tick', 'tick', 'tick', 'tick-hi', 'tick-hi']);
    });

    it('counts somebody else\'s turn down in silence', async () =>
    {
        const container = plate({ mine: 1 });

        await lastSeconds();

        expect(container.querySelector('.table-plate[data-turn] .plate-timer')).not.toBeNull();
        expect(played).toEqual([]);
    });

    it('is on no plate but the one to play, and on none once the game is over', async () =>
    {
        const waiting = plate({ mine: 0, active: false });
        const finished = plate({ mine: 0, finished: true });

        await lastSeconds();

        expect(waiting.querySelector('.plate-timer')).toBeNull();
        expect(finished.querySelector('.plate-timer')).toBeNull();
        expect(played).toEqual([]);
    });
});
