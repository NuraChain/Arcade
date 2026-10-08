import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

export function addFriend()
{
    void import('../components/social/add-friend.component.azeroth')
        .then((module) => useOverlay().open(module.default, {}, { label: useLocale().t('friends.add.title'), id: 'add-friend' }))
        .catch(() => useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: 'add-friend' }));
}
