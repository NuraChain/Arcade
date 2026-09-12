import { client } from '../api.ts';
import type { Conversation, Message, MessageKind } from '../data/chat.ts';

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

/**
 * Where a conversation comes from.
 *
 * One interface, and the store talks to nothing else. `createApiSource` is the only
 * implementation the product ships; a test substitutes its own through `setChatSource` to drive
 * the states - loading, refused, offline - that a working server does not produce on demand.
 *
 * The `scope` argument is what the caller KNOWS rather than what the source needs: the session
 * cookie already says who is asking, so the API implementation ignores it. It is still passed,
 * because a source that had to guess who it was serving would be a source that could serve the
 * wrong person.
 */
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

/**
 * The SERVER's chat, behind the same interface the local one implements.
 *
 * Two translations happen here and nowhere else. A server message is `body` XOR
 * `{ key, params }`; the client's `Message` still carries the mock's `text` field, so a payload
 * arrives as `line` and the bubble renders it through the catalogue. And a conversation's
 * members are HANDLES, which is what the client keys people by since the people themselves became
 * the server's.
 *
 * `archive` is what this DEVICE has fetched. Under `nura-e2ee/v1` there is no server-side
 * message index to ask, so search is over the history this browser has actually seen - and saying
 * so is the honest version of a feature that cannot be what it was.
 */
export function createApiSource(): ChatSource
{
    const archive = new Map<string, Message>();

    const remember = (message: Message): Message =>
    {
        archive.set(message.id, message);
        return message;
    };

    const asMessage = (wire: {
        id: string;
        conversationId: string;
        kind: string;
        from?: string;
        body?: string;
        payload?: { key: string; params: Record<string, string | undefined> };
        at: string;
    }): Message =>
    {
        const params = Object.fromEntries(
            Object.entries(wire.payload?.params ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)
        );

        return remember({
            id: wire.id,
            conversationId: wire.conversationId,
            from: wire.from ?? '',
            kind: wire.kind as MessageKind,
            text: wire.body ?? '',
            ...(wire.payload === undefined ? {} : { line: { key: wire.payload.key, params } }),
            at: Date.parse(wire.at),
            ref: wire.payload === undefined
                ? null
                : {
                    ...(params.game === undefined ? {} : { game: params.game as NonNullable<Message['ref']>['game'] }),
                    ...(params.tableId === undefined ? {} : { tableId: params.tableId }),
                    ...(params.winner === undefined ? {} : { winnerId: params.winner })
                }
        });
    };

    const asConversation = (wire: {
        id: string;
        kind: string;
        members: string[];
        game?: string;
        title?: string;
        groupId?: string;
        tableId?: string;
        pinned: boolean;
    }): Conversation => ({
        id: wire.id,
        kind: wire.kind as Conversation['kind'],
        participants: wire.members,
        groupId: wire.groupId ?? null,
        tableId: wire.tableId ?? null,
        game: (wire.game ?? null) as Conversation['game'],
        title: null,
        pinned: wire.pinned,
        lastReadAt: 0
    });

    return {
        async conversations()
        {
            const answer = await client.chat.list();
            return answer.conversations.map((row) => ({
                conversation: asConversation(row),
                last: row.last === undefined ? null : asMessage(row.last),
                unread: row.unread
            }));
        },

        async thread(id)
        {
            const page = await client.chat.messages({ params: { id }, query: {} });
            return page.messages.map(asMessage);
        },

        async post(message)
        {
            await client.chat.send({ params: { id: message.conversationId }, input: { body: String(message.text) } });
        },

        async openDirect(_scope, personId)
        {
            const answer = await client.chat.direct({ input: { id: personId } });
            return answer.id;
        },

        archive: () => [...archive.values()].sort(byAt),

        reset()
        {
            archive.clear();
        }
    };
}
