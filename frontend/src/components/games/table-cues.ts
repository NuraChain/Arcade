import type { SoundHandle } from '../../game/sound.ts';
import { haptic } from '../../lib/haptics.ts';

/** `when` narrows it: a game whose every move already sounds as it lands asks for it only while nobody is looking at the page. */
export function turnChime(sound: () => SoundHandle | null, when: () => boolean = () => true)
{
    let before: boolean | null = null;

    return (yours: boolean) =>
    {
        if (yours && before === false && when())
        {
            sound()?.play('turn', { urgent: true });
            haptic('ready');
        }

        before = yours;
    };
}
