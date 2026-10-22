import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

@Check('notices_en_length', `char_length(en) between 3 and 200`)
@Check('notices_fa_length', `char_length(fa) between 3 and 200`)
@Check('notices_until_after', `until > created_at`)
@Check('notices_ended_after', `ended_at is null or ended_at >= created_at`)
@Index('notices_when', ['createdAt'])
@Entity('notices')
export class Notice
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    en!: string;

    @Column({ type: 'text' })
    fa!: string;

    @Column({ type: 'timestamptz' })
    until!: Date;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
    endedAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;
}
