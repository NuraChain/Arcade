import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Conversation } from './conversation.entity.ts';
import { User } from './user.entity.ts';

/**
 * One person's place in a conversation.
 *
 * `pinned` and `lastReadAt` live HERE and not on the conversation, because both are opinions
 * rather than facts about the thread. The mock kept them on the conversation, which meant one
 * person pinning a chat pinned it for everyone in it.
 */
@Index('conversation_members_user', ['userId'])
@Entity('conversation_members')
export class ConversationMember
{
    @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
    conversationId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
    joinedAt!: Date;

    @Column({ type: 'boolean', default: false })
    pinned!: boolean;

    @Column({ name: 'last_read_at', type: 'timestamptz', default: () => 'to_timestamp((0)::double precision)' })
    lastReadAt!: Date;

    @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversation_id', referencedColumnName: 'id' })
    conversation!: Conversation;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
