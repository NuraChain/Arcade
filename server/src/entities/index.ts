import { Achievement } from './achievement.entity.ts';
import { Block } from './block.entity.ts';
import { ConversationMember } from './conversation-member.entity.ts';
import { Device } from './device.entity.ts';
import { Conversation } from './conversation.entity.ts';
import { FriendRequest } from './friend-request.entity.ts';
import { Friendship } from './friendship.entity.ts';
import { GameRule } from './game-rule.entity.ts';
import { GroupMember } from './group-member.entity.ts';
import { Group } from './group.entity.ts';
import { Game } from './game.entity.ts';
import { Message } from './message.entity.ts';
import { TableSeat } from './table-seat.entity.ts';
import { Table } from './table.entity.ts';
import { Mute } from './mute.entity.ts';
import { Notification } from './notification.entity.ts';
import { PushSubscription } from './push-subscription.entity.ts';
import { Report } from './report.entity.ts';
import { Session } from './session.entity.ts';
import { SiweNonce } from './siwe-nonce.entity.ts';
import { User } from './user.entity.ts';
import { Wallet } from './wallet.entity.ts';

export {
    Achievement, Block, Conversation, ConversationMember, Device, FriendRequest, Friendship,
    Game, GameRule, Group, GroupMember, Message, Mute, Notification, PushSubscription,
    Report, Session, SiweNonce, Table, TableSeat, User, Wallet
};

/**
 * Every entity, listed explicitly.
 *
 * Not a glob: TypeORM resolves glob patterns against `process.cwd()`, not against the file that
 * declares them, so a pattern that works under `npm run` yields nothing from anywhere else and
 * quietly resurrects the compiled remains of a deleted entity. Listing them also means a rename
 * fails `azeroth check` instead of failing at first query.
 *
 * The element type is TypeORM's own: a decorated class is a `Function` to it.
 */
export const entities: Function[] = [
    Game, GameRule, Achievement,
    User, Wallet, Session, SiweNonce, Device,
    Friendship, FriendRequest, Block, Mute, Report,
    Conversation, ConversationMember, Message,
    Group, GroupMember,
    Table, TableSeat,
    Notification, PushSubscription
];
