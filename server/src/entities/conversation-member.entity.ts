import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * One person's place in a conversation.
 *
 * `pinned` and `lastReadAt` live HERE and not on the conversation, because both are opinions
 * rather than facts about the thread. The mock kept them on the conversation, which meant one
 * person pinning a chat pinned it for everyone in it.
 */
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

    @Column({ name: 'last_read_at', type: 'timestamptz', default: () => "'epoch'" })
    lastReadAt!: Date;
}
