import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Game } from './game.entity.ts';
import { User } from './user.entity.ts';

/**
 * A person's record at one game, and every number in it is something that happened.
 *
 * The level, the skill band and the reliability score were all deleted from this product because
 * nothing produced them - they were a seeded RNG wearing a profile. This is the same shape with the
 * opposite property: every column here moves only when a match this server arbitrated reached an
 * end, and `match_players.rating_before`/`rating_after` records the move on the row that caused it,
 * so any figure can be traced back to the games that made it.
 *
 * It was called `game_ratings` while `rating` was the only thing in it. Played, won, captures and a
 * streak are not ratings, and a table read for years should be named for what it holds.
 *
 * One row per person per game, so a profile is one query rather than a fold over a history.
 */
@Check('player_stats_counts', `played >= 0 and won >= 0 and abandoned >= 0 and won + abandoned <= played`)
@Check('player_stats_range', `rating between 100 and 4000 and peak_rating between 100 and 4000`)
@Check('player_stats_peak_reached', `peak_rating >= rating or played = 0`)
@Check('player_stats_streaks', `streak >= 0 and best_streak >= streak`)
@Check('player_stats_tallies', `jsonb_typeof(tallies) = 'object' and xp >= 0`)
@Index('player_stats_board', ['game', 'xp'])
@Entity('player_stats')
export class PlayerStats
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'integer', default: 1200 })
    rating!: number;

    /**
     * The highest this rating has ever been. A rating that only goes up is a lie and a rating that
     * only shows today forgets the best somebody ever played, so both are kept.
     */
    @Column({ name: 'peak_rating', type: 'integer', default: 1200 })
    peakRating!: number;

    /**
     * The running total, per game. An account's XP is the SUM of these and is never stored.
     *
     * Storing an account total beside them would be a second copy of a derivable fact, which is the
     * mistake `tables.status` exists to avoid and the one the entities drifting from the schema made
     * invisible for months. Six rows summed on a profile read is not a cost worth a second source of
     * truth.
     */
    @Column({ type: 'integer', default: 0 })
    xp!: number;

    @Column({ type: 'integer', default: 0 })
    played!: number;

    @Column({ type: 'integer', default: 0 })
    won!: number;

    /** Games this person walked out of or was forfeited from. Never somebody else's walkout. */
    @Column({ type: 'integer', default: 0 })
    abandoned!: number;

    /** Wins in a row, as it stands. Reset by anything that is not a win. */
    @Column({ type: 'integer', default: 0 })
    streak!: number;

    @Column({ name: 'best_streak', type: 'integer', default: 0 })
    bestStreak!: number;

    /**
     * What this person DID at this game, in the engine's own words.
     *
     * Three integer columns before - `captures`, `rolls`, `tokens_home` - which are ludo's
     * vocabulary on a table every game shares: hokm would have wanted `tricks`, poker `showdowns`,
     * and every game would have stored zero in the others' columns forever. The row is keyed
     * `(user_id, game)`, so the names only ever have to make sense within one game.
     *
     * Nothing is DECIDED by these. No achievement, rating or level reads one; they are what a
     * profile shows, which is why an engine names them and no shared code has an opinion.
     */
    @Column({ type: 'jsonb', default: () => `'{}'` })
    tallies!: Record<string, number>;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @ManyToOne(() => Game, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'game', referencedColumnName: 'id' })
    gameRef!: Game;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
