import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Game } from './game.entity.ts';
import { User } from './user.entity.ts';

/**
 * A number about a person that something actually measures.
 *
 * The level, the skill band and the reliability score were all deleted from this product because
 * nothing produced them - they were a seeded RNG wearing a profile. This is the same shape with the
 * opposite property: it moves only when a match this server arbitrated reached a real end, and the
 * row that moved it is `match_players.rating_before`/`rating_after`, so any figure here can be
 * traced back to the games that made it.
 *
 * One row per person per game, so a profile reads one row rather than folding a history.
 */
@Check('game_ratings_counts', `played >= 0 and won >= 0 and abandoned >= 0 and won + abandoned <= played`)
@Check('game_ratings_range', `rating between 100 and 4000`)
@Entity('game_ratings')
export class GameRating
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'integer', default: 1200 })
    rating!: number;

    @Column({ type: 'integer', default: 0 })
    played!: number;

    @Column({ type: 'integer', default: 0 })
    won!: number;

    @Column({ type: 'integer', default: 0 })
    abandoned!: number;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @ManyToOne(() => Game, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'game', referencedColumnName: 'id' })
    gameRef!: Game;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
