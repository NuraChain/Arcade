import type { GroupSummary } from '../../api.ts';
import type { Person } from '../../data/person.ts';
import type { Conversation } from '../../data/chat.ts';
import type { LocalizedText } from '../../lib/text.ts';

/**
 * The other people in a conversation.
 *
 * Takes the lookup rather than reaching for a store, for the reason `groupNameOf` states below:
 * this module is imported by a page, a list row, an actions sheet and a search result, and a store
 * call inside a `derived` would subscribe four times over.
 *
 * A handle nobody has described yet is dropped rather than invented; the caller renders the handle.
 */
export function othersOf(conversation: Conversation, me: string, find: (handle: string) => Person | null): Person[]
{
    return conversation.participants
        .filter((id) => id !== me)
        .map((id) => find(id))
        .filter((person): person is Person => person !== null);
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

export function titleOf(
    conversation: Conversation,
    me: string,
    find: (handle: string) => Person | null,
    groupName?: string
): LocalizedText | string
{
    if (conversation.title !== null)
    {
        return conversation.title;
    }
    if (groupName !== undefined && groupName !== '')
    {
        return groupName;
    }
    const others = othersOf(conversation, me, find);
    if (others.length === 1)
    {
        return others[0].displayName;
    }
    return { en: 'Table chat', fa: 'گفت‌وگوی میز' };
}
