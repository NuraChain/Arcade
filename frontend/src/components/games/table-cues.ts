import type { SoundHandle } from '../../game/sound.ts';
import { haptic } from '../../lib/haptics.ts';

/**
 * `when` narrows it: a game whose every move already sounds as it lands asks for it only while nobody is looking at the page.
 * A turn the reader has held under a key is not rung again under the same one: a press of the reader's own that is
 * refused gives the same turn back, at the same revision, with nothing new to be told.
 */
export function turnChime(sound: () => SoundHandle | null, when: () => boolean = () => true)
{
    let before: boolean | null = null;
    let held: unknown;

    return (yours: boolean, key?: unknown) =>
    {
        if (yours && before === false && when() && (key === undefined || key !== held))
        {
            sound()?.play('turn', { urgent: true });
            haptic('ready');
        }

        if (yours)
        {
            held = key;
        }

        before = yours;
    };
}
