import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Match } from './match.entity.ts';
import { User } from './user.entity.ts';

export type MatchActionKind = 'roll' | 'move' | 'forfeit';

/**
 * Every action that was accepted, in order.
 *
 * Four jobs, and it is worth naming what is NOT one of them: this is not a rebuild log.
 * `matches.state` is the authority and nothing replays these rows to reconstruct a board. A fixed
 * rule would change the fold, and a finished game would stop being a fact.
 *
 * What it is for: the dice history, so what came up is auditable after the game; the idempotency
 * ledger, so a retried request is answered rather than applied twice; and the catch-up feed a
 * client reads after missing a realtime frame, which is why the events are stored rather than
 * recomputed; and the board a SPECTATOR is shown, which is `state` and is stored for the same
 * reason - a delayed view is a board that was recorded, never one that was reconstructed.
 *
 * `user_id` is null when the SERVER acted - a turn that ran out of time and was played for
 * somebody. It is nullable rather than pointing at a service account because there is no such
 * person, and `SET NULL` because a deleted account must not take the dice history with it.
 */
@Check('match_actions_die_on_roll', `(kind = 'roll') = (die is not null)`)
@Check('match_actions_die_range', `die is null or die between 1 and 6`)
@Check('match_actions_kind_known', `kind in ('roll', 'move', 'forfeit')`)
@Check('match_actions_piece_on_move', `(kind = 'move') = (piece is not null)`)
@Check('match_actions_piece_range', `piece is null or piece between 0 and 3`)
@Check('match_actions_rev_positive', `rev > 0`)
@Index('match_actions_rev', ['matchId', 'rev'], { unique: true })
@Index('match_actions_idem', ['matchId', 'userId', 'idempotencyKey'], { unique: true, where: `idempotency_key is not null` })
@Entity('match_actions')
export class MatchAction
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'match_id', type: 'uuid' })
    matchId!: string;

    @Column({ type: 'integer' })
    rev!: number;

    @Column({ type: 'smallint' })
    seat!: number;

    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId!: string | null;

    @Column({ type: 'varchar', length: 16 })
    kind!: MatchActionKind;

    @Column({ type: 'smallint', nullable: true })
    die!: number | null;

    @Column({ type: 'smallint', nullable: true })
    piece!: number | null;

    @Column({ type: 'jsonb', default: () => `'[]'` })
    events!: unknown[];

    /**
     * The board as it stood AFTER this action, which is what a spectator is shown.
     *
     * This is not a rebuild log and this column is what keeps it from becoming one. Serving a board
     * as it was two minutes ago needs a state at a moment, and the alternative - folding the events
     * of every action up to that moment - is exactly the replay the docblock above refuses, with
     * exactly the consequence it names: a rule that changed later would make a finished game come
     * back different. A stored state cannot be re-derived wrongly because it is not derived at all.
     *
     * NOT NULL with no default, deliberately. Postgres materialises a column default into every
     * existing row at `add column` time, which is the backfill this codebase forbids - so a database
     * that already holds actions refuses the column rather than quietly inventing a board for rows
     * that never recorded one, and the answer is to rebuild from nothing.
     */
    @Column({ type: 'jsonb' })
    state!: unknown;

    @Column({ name: 'idempotency_key', type: 'varchar', length: 64, nullable: true })
    idempotencyKey!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Match, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'match_id', referencedColumnName: 'id' })
    match!: Match;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User | null;
}
