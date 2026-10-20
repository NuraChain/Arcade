import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

const SHEET = 'voice-manager';

export function manageVoice(table: string)
{
    void import('../components/voice/voice-manager.component.azeroth')
        .then((module) => useOverlay().open(module.default, { table }, { label: useLocale().t('voice.manager.open'), id: SHEET }))
        .catch(() => useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: SHEET }));
}
