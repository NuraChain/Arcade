import type { Tone } from '../ui/variants.ts';
import { useChat } from '../../stores/chat.store.ts';
import { useLobby } from '../../stores/lobby.store.ts';
import { useLocale } from '../../stores/locale.store.ts';
import { useNotifications } from '../../stores/notifications.store.ts';
import { useSocial } from '../../stores/social.store.ts';
import type { NavItem } from './nav-items.ts';

export interface NavCounts
{
    countOf: (item: NavItem) => number;
    labelOf: (item: NavItem) => string;
    toneOf: (item: NavItem) => Tone;
}

export function useNavCounts(): NavCounts
{
    const locale = useLocale();
    const chat = useChat();
    const social = useSocial();
    const lobby = useLobby();
    const notifications = useNotifications();

    const counts: Partial<Record<NavItem['tab'], () => number>> = {
        games: () => lobby.waiting().length,
        friends: () => social.incoming().length,
        chats: () => chat.totalUnread(),
        notifications: () => notifications.unread()
    };

    const countOf = (item: NavItem): number => counts[item.tab]?.() ?? 0;

    const labelOf = (item: NavItem): string =>
    {
        const count = countOf(item);
        switch (item.tab)
        {
            case 'games':
                return locale.plural('common.waitingTables', count);
            case 'friends':
                return locale.plural('common.requests', count);
            case 'notifications':
                return locale.plural('common.notices', count);
            default:
                return locale.plural('common.unread', count);
        }
    };

    const toneOf = (item: NavItem): Tone => (item.tab === 'games' ? 'live' : 'accent');

    return { countOf, labelOf, toneOf };
}
