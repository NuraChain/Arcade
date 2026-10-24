import type { Notification, NotificationKind } from '../api.ts';
import { GAMES } from '../data/games.ts';
import type { MessageKey } from '../locales/en.ts';
import { messageText, type Message } from '../locales/format.ts';
import { LOCALE_DIR, LOCALE_TAG, messageOf, type Locale } from '../stores/locale.store.ts';

export const KEPT = 'nura-notices';

export const WORDS = '/notice-words.json';

export const CUE_KEYS: Record<NotificationKind, MessageKey> = {
    'friend-request': 'cue.requestBody',
    'friend-accepted': 'notify.friendAccepted',
    'group-added': 'notify.groupAdded',
    'table-invite': 'notify.tableInvite',
    'table-removed': 'notify.tableRemoved',
    'message': 'cue.chatBody',
    'turn': 'notify.turn',
    'invite-joined': 'notify.inviteJoined'
};

export interface NoticeWords
{
    lang: string;
    tag: string;
    dir: 'ltr' | 'rtl';
    general: Message;
    says: Record<NotificationKind, Message>;
    games: Record<string, string>;
}

export const REQUEST_TAG = 'request';

export const chatTag = (thread: string) => `chat:${ thread }`;

export const rowTag = (item: Pick<Notification, 'kind' | 'ref' | 'actor'>) =>
    `${ item.kind }:${ item.ref.tableId ?? item.ref.groupId ?? item.ref.conversationId ?? item.actor ?? '' }`;

export function wordsOf(lang: Locale): NoticeWords
{
    const said = (kind: NotificationKind) => messageOf(lang, CUE_KEYS[kind]);

    return {
        lang,
        tag: LOCALE_TAG[lang],
        dir: LOCALE_DIR[lang],
        general: messageOf(lang, 'notify.system.general'),
        says: {
            'friend-request': said('friend-request'),
            'friend-accepted': said('friend-accepted'),
            'group-added': said('group-added'),
            'table-invite': said('table-invite'),
            'table-removed': said('table-removed'),
            'message': said('message'),
            'turn': said('turn'),
            'invite-joined': said('invite-joined')
        },
        games: Object.fromEntries(GAMES.map((game) => [game.id, messageText(messageOf(lang, game.nameKey))]))
    };
}

export async function keepWords(words: NoticeWords)
{
    if (typeof caches === 'undefined')
    {
        return false;
    }

    const kept = await caches.open(KEPT);

    await kept.put(WORDS, new Response(JSON.stringify(words), { headers: { 'content-type': 'application/json' } }));

    return true;
}
