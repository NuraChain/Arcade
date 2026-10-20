import type { SoundHandle } from '../../game/sound.ts';
import { haptic } from '../../lib/haptics.ts';

export function turnChime(sound: () => SoundHandle | null)
{
    let before: boolean | null = null;

    return (yours: boolean) =>
    {
        if (yours && before === false)
        {
            sound()?.play('turn', { urgent: true });
            haptic('ready');
        }

        before = yours;
    };
}
