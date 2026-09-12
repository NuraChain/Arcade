import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type NotificationKind = 'friend-request' | 'friend-accepted' | 'group-added' | 'table-invite' | 'message';

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
