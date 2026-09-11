import type { GameId } from '../data/games.ts';
import { AMBIENT, REPLIES } from '../data/mock/scripts.ts';
import type { Conversation } from '../data/mock/types.ts';
import type { Random } from '../lib/random.ts';
import type { LocalizedText } from '../lib/text.ts';

export interface Reply
{
    typingAfter: number;
    typingFor: number;
    from: string;
    text: LocalizedText;
}

export interface Ambient
{
    after: number;
    conversationId: string;
    from: string;
    text: LocalizedText;
}

export function replyLines(game: GameId | null): LocalizedText[]
{
    return game === null ? REPLIES.general : [...REPLIES[game], ...REPLIES.general];
}

export function planReply(conversation: Conversation, me: string, random: Random): Reply | null
{
    const others = conversation.participants.filter((id) => id !== me);
    if (others.length === 0)
    {
        return null;
    }
    const lines = replyLines(conversation.game);
    return {
        typingAfter: random.int(700, 2600),
        typingFor: random.int(1200, 3400),
        from: random.pick(others),
        text: random.pick(lines)
    };
}

export function planAmbient(conversations: readonly Conversation[], me: string, random: Random): Ambient | null
{
    const candidates = conversations.filter((conversation) => conversation.participants.some((id) => id !== me));
    if (candidates.length === 0)
    {
        return null;
    }
    const conversation = random.pick(candidates);
    const others = conversation.participants.filter((id) => id !== me);
    return {
        after: random.int(18000, 52000),
        conversationId: conversation.id,
        from: random.pick(others),
        text: random.chance(0.6) ? random.pick(AMBIENT) : random.pick(replyLines(conversation.game))
    };
}

export function previewOf(text: LocalizedText | string, kind: string, fallback: LocalizedText): LocalizedText | string
{
    return kind === 'text' ? text : fallback;
}
