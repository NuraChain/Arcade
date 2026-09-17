import { Check, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A block, written one way and read BOTH ways.
 *
 * Only the blocker has a row, but the effect is symmetric: neither side may see, message or
 * invite the other. Every check therefore looks for a row in either direction, which is what
 * the reverse index on `blocked_id` is for.
 */
@Check('blocks_not_self', `user_id <> blocked_id`)
@Index('blocks_blocked', ['blockedId'])
@Entity('blocks')
export class Block
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ name: 'blocked_id', type: 'uuid' })
    blockedId!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
}
