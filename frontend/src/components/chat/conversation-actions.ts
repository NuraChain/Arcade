import { useNavigate } from 'azerothjs';

import { attempt } from '../../lib/attempt.ts';
import { useChat } from '../../stores/chat.store.ts';
import { useGroups } from '../../stores/groups.store.ts';
import { useLocale } from '../../stores/locale.store.ts';
import { useOverlay } from '../../stores/overlay.store.ts';
import { usePeople } from '../../stores/people.store.ts';
import { useSocial } from '../../stores/social.store.ts';
import type { ChatAction } from './actions.ts';
import { othersOf } from './chat-title.ts';
import ExpirySheet from './expiry-sheet.component.azeroth';

/**
 * What can be done with a conversation, for the sheet a held row opens and the menu a right click
 * opens. Called while a component is being made, because it asks the router for the way to go.
 */
export function conversationActions()
{
    const locale = useLocale();
    const social = useSocial();
    const chat = useChat();
    const groups = useGroups();
    const people = usePeople();
    const overlay = useOverlay();
    const { navigate } = useNavigate();

    return (conversationId: string) =>
    {
        const conversation = chat.conversation(conversationId) ?? null;
        const pinned = chat.pinned(conversationId);
        const muted = social.isMuted('conversation', conversationId);
        const list: ChatAction[] = [
            {
                id: 'pin',
                icon: 'star',
                label: locale.t(pinned ? 'chats.unpin' : 'chats.pin'),
                run: () => void chat.togglePin(conversationId)
            },
            {
                id: 'mute',
                icon: muted ? 'sound' : 'sound-off',
                label: locale.t(muted ? 'chat.unmute' : 'chat.mute'),
                run: () => void attempt(social.toggleMute('conversation', conversationId), { kind: 'info', text: locale.t(muted ? 'chat.unmutedDone' : 'chat.mutedDone') })
            },
            {
                id: 'expiry',
                icon: 'timer',
                label: locale.t('expiry.title'),
                run: () => overlay.open(ExpirySheet, { conversationId }, { label: locale.t('expiry.title') })
            }
        ];

        if (chat.unread(conversationId) > 0)
        {
            list.push({ id: 'read', icon: 'selected', label: locale.t('chats.markRead'), run: () => void chat.markRead(conversationId) });
        }

        const group = conversation?.groupId === null || conversation?.groupId === undefined ? undefined : groups.byId(conversation.groupId);

        if (group !== undefined)
        {
            list.push({ id: 'group', icon: 'people', label: locale.t('chat.openGroup'), run: () => navigate(`/app/groups/${ group.id }`) });
            return list;
        }

        const others = conversation === null ? [] : othersOf(conversation, chat.me(), people.byHandle);

        if (others.length === 1)
        {
            list.push({ id: 'profile', icon: 'me', label: locale.t('chat.viewProfile'), run: () => navigate(`/app/people/${ others[0].handle }`) });
        }

        return list;
    };
}
