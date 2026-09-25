import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

export type RequestOutcome = 'accepted' | 'declined' | 'withdrawn';

/**
 * An asked-for friendship, pending until answered.
 *
 * `answeredAt` and `outcome` are one fact in two columns and a CHECK keeps them together, so a
 * row can never be half-answered. Answered rows are kept rather than deleted: "you already
 * declined this person once" is something moderation and rate limiting both need to know.
 */
@Check('friend_requests_answered_pairs', `(answered_at is null) = (outcome is null)`)
@Check('friend_requests_not_self', `from_user <> to_user`)
@Check('friend_requests_outcome_known', `outcome is null or outcome in ('accepted', 'declined', 'withdrawn')`)
@Index('friend_requests_inbox', ['toUser'], { where: `answered_at is null` })
@Index('friend_requests_outbox', ['fromUser'], { where: `answered_at is null` })
@Entity('friend_requests')
export class FriendRequest
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'from_user', type: 'uuid' })
    fromUser!: string;

    @Column({ name: 'to_user', type: 'uuid' })
    toUser!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
    answeredAt!: Date | null;

    @Column({ type: 'varchar', length: 16, nullable: true })
    outcome!: RequestOutcome | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'from_user', referencedColumnName: 'id' })
    sender!: User;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'to_user', referencedColumnName: 'id' })
    recipient!: User;
}
