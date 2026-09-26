import { Check, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * One DIRECTION of a friendship. Both rows are written together, by one function.
 *
 * Mirroring costs a second row and buys the only query that matters: my friends are the rows
 * where `user_id` is me, one index scan, no union of two half-answers and no `or` that the
 * planner turns into a sequential scan once the table is large.
 */
@Check('friendships_not_self', `user_id <> friend_id`)
@Index('friendships_friend', ['friendId'])
@Entity('friendships')
export class Friendship
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ name: 'friend_id', type: 'uuid' })
    friendId!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'friend_id', referencedColumnName: 'id' })
    friend!: User;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
