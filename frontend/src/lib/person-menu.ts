import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

const SHEET = 'person-menu';

export function aboutPerson(personId: string)
{
    void import('../components/social/person-actions.component.azeroth')
        .then((module) => useOverlay().open(module.default, { personId }, { label: useLocale().t('actions.title'), id: SHEET }))
        .catch(() => useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: SHEET }));
}
