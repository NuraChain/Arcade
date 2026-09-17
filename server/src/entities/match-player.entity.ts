import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Match } from './match.entity.ts';
import { User } from './user.entity.ts';

export type MatchResult = 'won' | 'lost' | 'abandoned';

/**
 * Who sat in which chair, permanently.
 *
 * The board lives in `matches.state` and the engine never sees a uuid - it is handed a seat number
 * and hands one back. This table is the only join between a seat and a person, which is what makes
 * "you cannot move somebody else's token" a lookup rather than a rule: a caller is resolved to a
 * seat here, and a caller with no row is answered as a match that does not exist.
 *
 * It does not follow `table_seats`. Standing up from a chair frees the chair; it does not unplay
 * the game, so a finished match still names everyone who played it.
 */
@Check('match_players_colour_range', `colour between 0 and 3`)
@Check('match_players_rating_pairs', `(rating_before is null) = (rating_after is null)`)
@Check('match_players_result_known', `result is null or result in ('won', 'lost', 'abandoned')`)
@Check('match_players_timeouts_positive', `timeouts >= 0`)
@Index('match_players_one_per_person', ['matchId', 'userId'], { unique: true })
@Index('match_players_user', ['userId'])
@Entity('match_players')
export class MatchPlayer
{
    @PrimaryColumn({ name: 'match_id', type: 'uuid' })
    matchId!: string;

    @PrimaryColumn({ type: 'smallint' })
    seat!: number;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'smallint' })
    colour!: number;

    @Column({ type: 'varchar', length: 16, nullable: true })
    result!: MatchResult | null;

    @Column({ type: 'smallint', default: 0 })
    timeouts!: number;

    @Column({ name: 'rating_before', type: 'integer', nullable: true })
    ratingBefore!: number | null;

    @Column({ name: 'rating_after', type: 'integer', nullable: true })
    ratingAfter!: number | null;

    @ManyToOne(() => Match, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'match_id', referencedColumnName: 'id' })
    match!: Match;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
