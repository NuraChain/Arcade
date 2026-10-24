import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

@Check('referrals_not_self', `invitee_id <> inviter_id`)
@Index('referrals_inviter', ['inviterId'])
@Entity('referrals')
export class Referral
{
    @PrimaryColumn({ name: 'invitee_id', type: 'uuid' })
    inviteeId!: string;

    @Column({ name: 'inviter_id', type: 'uuid', nullable: true })
    inviterId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    /** When the invitee finished a first game: only then does the invite count. */
    @Column({ name: 'counted_at', type: 'timestamptz', nullable: true })
    countedAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'invitee_id', referencedColumnName: 'id' })
    invitee!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'inviter_id', referencedColumnName: 'id' })
    inviter!: User | null;
}
