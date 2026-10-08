import type { Notification, NotificationKind } from '../api.ts';
import { GAMES } from '../data/games.ts';
import type { IconName } from '../icons/registry.ts';
import type { MessageKey } from '../locales/en.ts';
import type { LocaleApi } from '../stores/locale.store.ts';

export const NOTIFICATION_ICON: Record<NotificationKind, IconName> = {
    'friend-request': 'friend-add',
    'friend-accepted': 'friend-check',
    'group-added': 'people',
    'table-invite': 'seat',
    'table-removed': 'sign-out',
    'message': 'chats',
    'turn': 'dice'
};

const SAYS: Record<NotificationKind, MessageKey> = {
    'friend-request': 'notify.friendRequest',
    'friend-accepted': 'notify.friendAccepted',
    'group-added': 'notify.groupAdded',
    'table-invite': 'notify.tableInvite',
    'table-removed': 'notify.tableRemoved',
    'turn': 'notify.turn',
    'message': 'notify.message'
};

export function sayOf(item: Notification, who: string, locale: Pick<LocaleApi, 't' | 'plural'>)
{
    const game = GAMES.find((one) => one.id === item.ref.game);

    return item.kind === 'message'
        ? locale.plural('notify.message', item.count, { who })
        : locale.t(SAYS[item.kind], { who, game: game === undefined ? '' : locale.t(game.nameKey) });
}

export function targetOf(item: Notification): string | null
{
    if (item.kind === 'friend-request')
    {
        return '/app/friends?tab=requests';
    }
    if (item.kind === 'table-removed')
    {
        return '/app/games';
    }
    if (item.ref.tableId !== undefined)
    {
        return `/app/play/${ item.ref.tableId }`;
    }
    if (item.ref.groupId !== undefined)
    {
        return `/app/groups/${ item.ref.groupId }`;
    }
    if (item.ref.conversationId !== undefined)
    {
        return `/app/chats/${ item.ref.conversationId }`;
    }
    if (item.actor !== undefined)
    {
        return `/app/people/${ item.actor }`;
    }
    return null;
}
