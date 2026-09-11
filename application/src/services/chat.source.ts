import { dataset, personById } from '../data/mock/index.ts';
import type { Conversation, Message } from '../data/mock/types.ts';

export interface ChatScope
{
    me: string;
    blocked: readonly string[];
}

export interface ConversationRow
{
    conversation: Conversation;
    last: Message | null;
    unread: number;
}

export interface ChatSource
{
    conversations(scope: ChatScope, signal: AbortSignal): Promise<ConversationRow[]>;
    thread(id: string, scope: ChatScope, signal: AbortSignal): Promise<Message[]>;
    post(message: Message): Promise<void>;
    openDirect(scope: ChatScope, personId: string, at: number): Promise<string>;
    archive(scope: ChatScope): Message[];
    reset(): void;
}

const byAt = (a: Message, b: Message): number => a.at - b.at;

export function createLocalSource(): ChatSource
{
    const posted: Message[] = [];
    const extra: Conversation[] = [];

    const every = (): Message[] => [...dataset().messages, ...posted];

    const allowed = (scope: ChatScope) => (message: Message): boolean => !scope.blocked.includes(message.from);

    const rooms = (scope: ChatScope): Conversation[] => [...dataset().conversations, ...extra]
        .filter((conversation) => conversation.participants.includes(scope.me))
        .filter((conversation) => conversation.kind !== 'direct'
            || conversation.participants.every((id) => id === scope.me || !scope.blocked.includes(id)));

    const within = (id: string, scope: ChatScope): Message[] => every()
        .filter((message) => message.conversationId === id)
        .filter(allowed(scope))
        .sort(byAt);

    return {
        async conversations(scope)
        {
            return rooms(scope).map((conversation) =>
            {
                const messages = within(conversation.id, scope);
                const last = messages[messages.length - 1] ?? null;
                return {
                    conversation,
                    last,
                    unread: messages.filter((message) => message.from !== scope.me && message.at > conversation.lastReadAt).length
                };
            });
        },

        async thread(id, scope)
        {
            return within(id, scope);
        },

        async post(message)
        {
            posted.push(message);
        },

        async openDirect(scope, personId, at)
        {
            const existing = rooms(scope).find((conversation) => conversation.kind === 'direct'
                && conversation.participants.length === 2
                && conversation.participants.includes(personId)
                && conversation.participants.includes(scope.me));
            if (existing !== undefined)
            {
                return existing.id;
            }

            const id = `c-new-${ personId }`;
            extra.push({
                id,
                kind: 'direct',
                participants: [scope.me, personId],
                groupId: null,
                tableId: null,
                game: personById(personId)?.favourite ?? null,
                title: null,
                pinned: false,
                lastReadAt: at
            });
            return id;
        },

        archive(scope)
        {
            const mine = new Set(rooms(scope).map((conversation) => conversation.id));
            return every().filter((message) => mine.has(message.conversationId)).filter(allowed(scope)).sort(byAt);
        },

        reset()
        {
            posted.length = 0;
            extra.length = 0;
        }
    };
}
