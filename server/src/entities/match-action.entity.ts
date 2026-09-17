import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Match } from './match.entity.ts';
import { User } from './user.entity.ts';

export type MatchActionKind = 'roll' | 'move' | 'forfeit';

/**
 * Every action that was accepted, in order.
 *
 * Three jobs, and it is worth naming what is NOT one of them: this is not a rebuild log.
 * `matches.state` is the authority and nothing replays these rows to reconstruct a board. A fixed
 * rule would change the fold, and a finished game would stop being a fact.
 *
 * What it is for: the dice history, so what came up is auditable after the game; the idempotency
 * ledger, so a retried request is answered rather than applied twice; and the catch-up feed a
 * client reads after missing a realtime frame, which is why the events are stored rather than
 * recomputed.
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
    events!: unknown;

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
