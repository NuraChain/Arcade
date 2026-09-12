import type { GroupSummary } from '../../api.ts';
import { personById } from '../../data/mock/index.ts';
import type { Conversation, Person } from '../../data/mock/types.ts';
import type { LocalizedText } from '../../lib/text.ts';

export function othersOf(conversation: Conversation, me: string): Person[]
{
    return conversation.participants
        .filter((id) => id !== me)
        .map((id) => personById(id))
        .filter((person): person is Person => person !== undefined);
}

/**
 * The name of the group a conversation belongs to, if it belongs to one.
 *
 * Takes the lookup rather than the store, so this module stays a pure function of what it is
 * given - it is imported by a page, a list row, an actions sheet and a search result, and any one
 * of them calling a store from inside a `derived` would subscribe four times over.
 */
export function groupNameOf(conversation: Conversation, find: (slug: string) => GroupSummary | undefined): string | undefined
{
    return conversation.groupId === null ? undefined : find(conversation.groupId)?.name;
}

export function titleOf(conversation: Conversation, me: string, groupName?: string): LocalizedText | string
{
    if (conversation.title !== null)
    {
        return conversation.title;
    }
    if (groupName !== undefined && groupName !== '')
    {
        return groupName;
    }
    const others = othersOf(conversation, me);
    if (others.length === 1)
    {
        return others[0].name;
    }
    return { en: 'Table chat', fa: 'گفت‌وگوی میز' };
}
