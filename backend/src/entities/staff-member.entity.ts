import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

import type { GrantedRole } from '../domains/admin/roles.ts';

@Check('staff_members_role_known', `role in ('moderator', 'admin')`)
@Check('staff_members_not_self_granted', `granted_by is null or granted_by <> user_id`)
@Index('staff_members_granted_by', ['grantedBy'])
@Entity('staff_members')
export class StaffMember
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 16 })
    role!: GrantedRole;

    @Column({ name: 'granted_by', type: 'uuid', nullable: true })
    grantedBy!: string | null;

    @Column({ name: 'granted_at', type: 'timestamptz', default: () => 'now()' })
    grantedAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'granted_by', referencedColumnName: 'id' })
    granter!: User | null;
}
