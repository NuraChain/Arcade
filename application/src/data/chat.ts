import type { GameId } from './games.ts';

/**
 * The chat shapes the browser renders.
 *
 * These are the client's view of what the server sends - `chat.source.ts` maps a
 * `ConversationSummary` and a `ChatMessage` onto them. They were declared in `data/mock/types.ts`
 * alongside twenty-four invented people, which made them look like fixture types; they are not,
 * and the mock they lived in is gone.
 *
 * `text` is a plain string because a message is what somebody typed. It carried a bilingual pair
 * while the fixtures wrote both halves of every line, which is a shape the wire format does not
 * have and could not have: words are words.
 */

export type ConversationKind = 'direct' | 'group' | 'game';

export interface Conversation
{
    id: string;
    kind: ConversationKind;
    participants: string[];
    groupId: string | null;
    tableId: string | null;
    game: GameId | null;
    title: string | null;
    pinned: boolean;
    lastReadAt: number;
}

export type MessageKind = 'text' | 'system' | 'invite' | 'result';

/**
 * What a server-authored line says ABOUT, as a closed set.
 *
 * The same shape `lineParams` declares on the wire: every value is an id the client resolves, never
 * a sentence. An open bag here is how a "system message" ends up carrying prose.
 */
export interface MessageRef
{
    tableId?: string;
    game?: GameId;
    conversationId?: string;
    winnerId?: string;
}

/**
 * A sentence the SERVER wrote, as a catalogue key and its parameters.
 *
 * Composed at display time, so switching language re-renders it in place. A message somebody typed
 * does not change - which is why `text` and `line` are different fields and a row is one or the
 * other, never both.
 */
export interface MessageLine
{
    key: string;
    params: Record<string, string>;
}

export interface Message
{
    id: string;
    conversationId: string;
    from: string;
    kind: MessageKind;
    text: string;
    line?: MessageLine;
    at: number;
    ref: MessageRef | null;
}

export interface FriendRequest
{
    id: string;
    from: string;
    to: string;
    at: number;
}

export type ReportCategory = 'harassment' | 'spam' | 'cheating' | 'inappropriate' | 'other';

export type ReportStatus = 'received' | 'reviewed' | 'actioned';

export interface Report
{
    id: string;
    against: string;
    category: ReportCategory;
    at: number;
    status: ReportStatus;
}
