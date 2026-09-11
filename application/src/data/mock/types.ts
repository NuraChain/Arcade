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

export interface Group
{
    id: string;
    name: LocalizedText;
    blurb: LocalizedText;
    emoji: string;
    game: GameId | null;
    members: string[];
    owner: string;
    createdAt: number;
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

export interface Message
{
    id: string;
    conversationId: string;
    from: string;
    kind: MessageKind;
    text: LocalizedText | string;
    at: number;
    ref: MessageRef | null;
}

export type NotificationKind = 'friend-request' | 'invite' | 'result' | 'achievement' | 'rematch' | 'system';

export interface NotificationRef
{
    requestId?: string;
    tableId?: string;
    game?: GameId;
    achievementId?: string;
    conversationId?: string;
    personId?: string;
}

export interface Notification
{
    id: string;
    kind: NotificationKind;
    at: number;
    read: boolean;
    from: string | null;
    text: LocalizedText;
    ref: NotificationRef;
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
