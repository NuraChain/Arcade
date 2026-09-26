import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Achievement } from './achievement.entity.ts';
import { Match } from './match.entity.ts';
import { User } from './user.entity.ts';

/**
 * Who has earned what.
 *
 * The composite primary key IS the idempotency guarantee. Awarding runs at the end of every match
 * and re-evaluates every rule from the record as it now stands, so the same achievement is offered
 * again on every subsequent game - and `on conflict do nothing` turns that from a bug into the
 * design. A retried action, a replayed idempotency key and a reconnect all converge on one row.
 *
 * `match_id` is the game that did it, and it is nullable because not every achievement is won at a
 * table: `first-seat` is earned by sitting down, which happens in the table domain with no match in
 * sight. It nulls rather than cascades, because a deleted match must not take the fact that
 * somebody earned something with it.
 *
 * The definition side cascades, and that is deliberate: `achievements` is reference content owned
 * entirely by `seed-reference.ts`, which deletes any row it no longer defines. An award of a
 * definition that no longer exists is a tile the client cannot draw.
 */
@Entity('user_achievements')
export class UserAchievement
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ name: 'achievement_id', type: 'varchar', length: 64 })
    achievementId!: string;

    @Column({ name: 'earned_at', type: 'timestamptz', default: () => 'now()' })
    earnedAt!: Date;

    @Column({ name: 'match_id', type: 'uuid', nullable: true })
    matchId!: string | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => Achievement, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'achievement_id', referencedColumnName: 'id' })
    achievement!: Achievement;

    @ManyToOne(() => Match, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'match_id', referencedColumnName: 'id' })
    match!: Match | null;
}
