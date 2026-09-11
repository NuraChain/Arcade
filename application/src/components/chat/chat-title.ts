import { groupById, personById } from '../../data/mock/index.ts';
import type { Conversation, Person } from '../../data/mock/types.ts';
import type { LocalizedText } from '../../lib/text.ts';

export function othersOf(conversation: Conversation, me: string): Person[]
{
    return conversation.participants
        .filter((id) => id !== me)
        .map((id) => personById(id))
        .filter((person): person is Person => person !== undefined);
}

export function titleOf(conversation: Conversation, me: string): LocalizedText | string
{
    if (conversation.title !== null)
    {
        return conversation.title;
    }
    if (conversation.groupId !== null)
    {
        const group = groupById(conversation.groupId);
        if (group !== undefined)
        {
            return group.name;
        }
    }
    const others = othersOf(conversation, me);
    if (others.length === 1)
    {
        return others[0].name;
    }
    return { en: 'Table chat', fa: 'گفت‌وگوی میز' };
}
