import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

@Entity('paid_accounts')
export class PaidAccount
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'accepted_at', type: 'timestamptz' })
    acceptedAt!: Date;

    @Column({ name: 'break_until', type: 'timestamptz', nullable: true })
    breakUntil!: Date | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
