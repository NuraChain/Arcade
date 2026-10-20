import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { usePeople } from '../stores/people.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

const SHEET = 'play-with';

export const playingWith = () => useOverlay().items().some((entry) => entry.id === SHEET && entry.phase !== 'closing');

export function playWith(personId: string, teamable: boolean)
{
    void import('../components/social/play-with-sheet.component.azeroth')
        .then((module) => useOverlay().open(
            module.default,
            { personId, teamable },
            { label: useLocale().t('party.sheet.title', { name: usePeople().byHandle(personId)?.displayName ?? personId }), id: SHEET }
        ))
        .catch(() => useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: SHEET }));
}
