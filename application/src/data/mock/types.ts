import type { IconName } from '../../icons/registry.ts';
import type { LocalizedText } from '../../lib/text.ts';
import type { GameId } from '../games.ts';

export type Skill = 'new' | 'casual' | 'regular' | 'sharp' | 'expert';

export type Region = 'eu' | 'me' | 'na' | 'asia';

export interface GameRecord
{
    played: number;
    won: number;
    streak: number;
}

export interface Person
{
    id: string;
    handle: string;
    name: LocalizedText;
    bio: LocalizedText;
    hue: number;
    portrait: string | null;
    favourite: GameId;
    level: number;
    skill: Skill;
    reliability: number;
    region: Region;
    joinedAt: number;
    minor: boolean;
    demo: boolean;
    stats: Record<GameId, GameRecord>;
    achievements: string[];
}

export type ConversationKind = 'direct' | 'group' | 'game';

export interface Conversation
{
    id: string;
    kind: ConversationKind;
    participants: string[];
    groupId: string | null;
    tableId: string | null;
    game: GameId | null;
    title: LocalizedText | null;
    pinned: boolean;
    lastReadAt: number;
}

export type MessageKind = 'text' | 'system' | 'invite' | 'result';

export interface MessageRef
{
    tableId?: string;
    game?: GameId;
    conversationId?: string;
    winnerId?: string;
}

/**
 * A server-authored line: a catalogue key and the ids it needs, never prose.
 *
 * `system`, `invite` and `result` are written by the server, so they are structured data
 * rendered at display time - which is also what lets one follow a language switch. Only
 * `kind: 'text'` carries words, and words are what gets sealed.
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
    text: LocalizedText | string;
    line?: MessageLine;
    at: number;
    ref: MessageRef | null;
}

export type ActivityKind = 'played' | 'won' | 'joined' | 'achievement' | 'invited';

export interface Activity
{
    id: string;
    personId: string;
    kind: ActivityKind;
    game: GameId | null;
    at: number;
    targetId: string | null;
}

export type AchievementTier = 'bronze' | 'silver' | 'gold';

export interface Achievement
{
    id: string;
    name: LocalizedText;
    blurb: LocalizedText;
    icon: IconName;
    tier: AchievementTier;
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
