import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

import type { SuspendCategory } from '../domains/admin/roles.ts';

@Check('suspensions_category_known', `category in ('harassment', 'spam', 'cheating', 'inappropriate', 'other')`)
@Check('suspensions_until_after', `until is null or until > created_at`)
@Index('suspensions_until', ['until'])
@Entity('suspensions')
export class Suspension
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 16 })
    category!: SuspendCategory;

    @Column({ type: 'timestamptz', nullable: true })
    until!: Date | null;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;
}
