import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One browser that asked to be told.
 *
 * `p256dh` and `auth` are the keys a push PAYLOAD would be encrypted to. They are stored because
 * a subscription has them, and they are unused: this product sends contentless pushes, so there
 * is no payload to encrypt and nothing about a message leaves the origin.
 */
@Entity('push_subscriptions')
export class PushSubscription
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'text' })
    endpoint!: string;

    @Column({ type: 'text' })
    p256dh!: string;

    @Column({ type: 'text' })
    auth!: string;

    @Column({ name: 'user_agent', type: 'text', default: '' })
    userAgent!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
    failedAt!: Date | null;
}
