import type { GameId } from '../data/games.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useOverlay } from '../stores/overlay.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

export function findGame(game: GameId)
{
    void import('../components/games/quick-finder.component.azeroth')
        .then((module) => useOverlay().open(module.default, { game }, { label: useLocale().t('quickMatch.title'), id: 'quick-finder' }))
        .catch(() => useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: 'quick-finder' }));
}
