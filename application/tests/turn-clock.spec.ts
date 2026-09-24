import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import TurnClock from '../src/components/games/turn-clock.component.azeroth';
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

const clock = (): ManualClock => runtime().clock as ManualClock;

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
