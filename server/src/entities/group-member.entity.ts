import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type GroupRole = 'owner' | 'member';

/**
 * One person's place in a group.
 *
 * The role lives here rather than as an `owner_id` column on the group, and the difference is a
 * partial unique index: `group_members_single_owner` over `(group_id) where role = 'owner'` makes
 * two owners unrepresentable. An `owner_id` column would make it merely unlikely, and "the group
 * has two owners now" is the kind of state nobody notices until one of them removes the other.
 */
@Check('group_members_role_known', `role in ('owner', 'member')`)
@Index('group_members_single_owner', ['groupId'], { unique: true, where: `role = 'owner'` })
@Index('group_members_user', ['userId'])
@Entity('group_members')
export class GroupMember
{
    @PrimaryColumn({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'varchar', length: 16, default: 'member' })
    role!: GroupRole;

    @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
    joinedAt!: Date;
}
