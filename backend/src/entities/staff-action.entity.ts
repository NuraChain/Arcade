import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

import type { ActionKind, StaffRole } from '../domains/admin/roles.ts';

@Check('staff_actions_kind_known', `kind in ('grant', 'change', 'revoke', 'note', 'suspend', 'lift', 'expire', 'clear', 'sign-out')`)
@Check('staff_actions_role_known', `staff_role in ('moderator', 'admin', 'owner')`)
@Check('staff_actions_actor_whole', `(staff_handle is null) = (staff_role is null)`)
@Check('staff_actions_actor_named', `staff_handle is not null or kind = 'expire'`)
@Check('staff_actions_reason_length', `char_length(reason) between 3 and 500`)
@Check('staff_actions_person_named', `(person_id is null) or (person_handle is not null)`)
@Check('staff_actions_details_object', `jsonb_typeof(details) = 'object'`)
@Index('staff_actions_when', ['createdAt', 'id'])
@Index('staff_actions_person', ['personId', 'createdAt'])
@Index('staff_actions_staff', ['staffId', 'createdAt'])
@Entity('staff_actions')
export class StaffAction
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @Column({ name: 'staff_handle', type: 'text', nullable: true })
    staffHandle!: string | null;

    @Column({ name: 'staff_role', type: 'varchar', length: 16, nullable: true })
    staffRole!: StaffRole | null;

    @Column({ type: 'varchar', length: 24 })
    kind!: ActionKind;

    @Column({ name: 'person_id', type: 'uuid', nullable: true })
    personId!: string | null;

    @Column({ name: 'person_handle', type: 'text', nullable: true })
    personHandle!: string | null;

    @Column({ type: 'text' })
    reason!: string;

    @Column({ type: 'jsonb', default: () => `'{}'` })
    details!: Record<string, string>;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'person_id', referencedColumnName: 'id' })
    person!: User | null;
}
