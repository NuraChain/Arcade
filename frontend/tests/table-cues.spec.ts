import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { turnChime } from '../src/components/games/table-cues.ts';
import type { SoundHandle } from '../src/game/sound.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(0), seed: 1 });
});

afterEach(() =>
{
    resetRuntime();
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

    it('rings only while its condition holds, and still learns the turn while it does not', () =>
    {
        const { played, sound } = handle();
        let hidden = false;
        const chime = turnChime(() => sound, () => hidden);

        chime(false);
        chime(true);
        expect(played).toEqual([]);

        hidden = true;
        chime(true);
        expect(played, 'a turn already held is not news when the page hides').toEqual([]);

        chime(false);
        chime(true);
        expect(played).toEqual(['turn']);
    });

    it('rings for a turn that comes round after the page hid, though the turn left while it was looked at', () =>
    {
        const { played, sound } = handle();
        let hidden = false;
        const chime = turnChime(() => sound, () => hidden);

        chime(true);
        chime(false);
        hidden = true;
        chime(true);
        expect(played).toEqual(['turn']);
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
