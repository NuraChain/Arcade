import { useLocale } from '../stores/locale.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { useVoice } from '../stores/voice.store.ts';

export function joinVoice(table: string)
{
    const voice = useVoice();

    return voice.join(table).then(() =>
    {
        const mic = voice.mic();

        if (mic === 'denied' || mic === 'absent')
        {
            useToasts().show({ kind: 'info', text: useLocale().t(mic === 'denied' ? 'voice.micDenied' : 'voice.micAbsent'), dedupe: 'voice-mic' });
        }
    });
}
