import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Conversation } from './conversation.entity.ts';
import { User } from './user.entity.ts';

/**
 * One epoch key, sealed to an account's archive key rather than to a device.
 *
 * This is the second copy that makes a recovery phrase worth having: one secret restores every
 * conversation, instead of one wrapped key per device per epoch. It is also, stated plainly, what
 * makes the phrase dangerous - whoever holds it can read everything the account has ever received,
 * and there is no revoking that.
 */
@Entity('epoch_archive')
export class EpochArchive
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
    conversationId!: string;

    @PrimaryColumn({ type: 'int' })
    epoch!: number;

    @Column({ type: 'text' })
    wrapped!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversation_id', referencedColumnName: 'id' })
    conversation!: Conversation;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
