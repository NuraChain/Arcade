import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type RequestOutcome = 'accepted' | 'declined' | 'withdrawn';

/**
 * An asked-for friendship, pending until answered.
 *
 * `answeredAt` and `outcome` are one fact in two columns and a CHECK keeps them together, so a
 * row can never be half-answered. Answered rows are kept rather than deleted: "you already
 * declined this person once" is something moderation and rate limiting both need to know.
 */
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
}
