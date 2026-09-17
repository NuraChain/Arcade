import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type NotificationKind = 'friend-request' | 'friend-accepted' | 'group-added' | 'table-invite' | 'message';

@Check('notifications_count_positive', `count > 0`)
@Check('notifications_kind_known', `kind in ('friend-request', 'friend-accepted', 'group-added', 'table-invite', 'message')`)
@Index('notifications_dedupe', ['userId', 'dedupeKey'], { unique: true })
@Index('notifications_unread', ['userId'], { where: `read_at is null` })
@Entity('notifications')
export class Notification
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 24 })
    kind!: NotificationKind;

    @Column({ name: 'actor_id', type: 'uuid', nullable: true })
    actorId!: string | null;

    @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
    ref!: Record<string, string>;

    /**
     * What makes two notifications the same notification.
     *
     * Unique per recipient, so a second arrival bumps a count rather than adding a row. The
     * producer composes it - `chat:<conversationId>`, `friend-request:<requestId>` - and that
     * choice is the whole of the dedupe design.
     */
    @Column({ name: 'dedupe_key', type: 'text' })
    dedupeKey!: string;

    @Column({ type: 'integer', default: 1 })
    count!: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
    readAt!: Date | null;
}
