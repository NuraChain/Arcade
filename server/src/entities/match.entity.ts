import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Game } from './game.entity.ts';
import { Table } from './table.entity.ts';

export type MatchOutcome = 'won' | 'abandoned' | 'closed';

/**
 * One game somebody actually played.
 *
 * A table is a seat container and stops there; this is what plugs into that seam. `state` is the
 * authority and is read whole on every action, which is why it is jsonb rather than sixteen rows in
 * a piece table: Postgres cannot check a single ludo rule as a constraint, so normalising the board
 * would buy no integrity and cost a read and a write per token.
 *
 * `rev` is the one derivable-looking number that is deliberately stored. It is the precondition a
 * `where rev = $n` uses to make a stale action write nothing, and `matches_rev_matches_state` holds
 * it equal to the copy inside the snapshot so a state lifted out of the row still describes itself.
 *
 * Whether a table is PLAYING is not stored anywhere. It is derived in `TABLE_COLUMNS` from the
 * existence of an unfinished match, for the same reason `ready` is derived from occupied chairs: a
 * stored copy goes stale the first time a match ends down one of the three paths that end one.
 */
@Check('matches_finished_has_outcome', `(finished_at is null) = (outcome is null)`)
@Check('matches_live_has_deadline', `(finished_at is null) = (deadline_at is not null)`)
@Check('matches_outcome_known', `outcome is null or outcome in ('won', 'abandoned', 'closed')`)
@Check('matches_rev_matches_state', `(state ->> 'rev')::int = rev`)
@Check('matches_rev_positive', `rev >= 0`)
@Check('matches_seats_range', `seats between 2 and 4`)
/**
 * The RULES variant within a game, which is not the game's name.
 *
 * It read `variant in ('ludo')` - a game id checked against a column that exists to say which
 * ruleset of that game is being played. Every canonical implementation is `standard`; a variant
 * that is genuinely different (hokm to 13 rather than 7, nackgammon) widens this in the commit that
 * implements it, and the engine validates that the pair makes sense for its own game.
 */
@Check('matches_variant_known', `variant in ('standard')`)
@Check('matches_winner_seat_range', `winner_seat is null or winner_seat >= 0`)
@Index('matches_one_live', ['tableId'], { unique: true, where: `finished_at is null` })
@Index('matches_due', ['deadlineAt'], { where: `finished_at is null` })
@Index('matches_table', ['tableId'])
@Entity('matches')
export class Match
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'table_id', type: 'uuid' })
    tableId!: string;

    @Column({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'varchar', length: 24, default: 'standard' })
    variant!: string;

    @Column({ type: 'smallint' })
    seats!: number;

    @Column({ type: 'jsonb' })
    state!: unknown;

    @Column({ type: 'integer', default: 0 })
    rev!: number;

    @Column({ name: 'deadline_at', type: 'timestamptz', nullable: true })
    deadlineAt!: Date | null;

    @Column({ name: 'winner_seat', type: 'smallint', nullable: true })
    winnerSeat!: number | null;

    @Column({ type: 'varchar', length: 16, nullable: true })
    outcome!: MatchOutcome | null;

    @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
    startedAt!: Date;

    @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
    finishedAt!: Date | null;

    @ManyToOne(() => Game)
    @JoinColumn({ name: 'game', referencedColumnName: 'id' })
    gameRef!: Game;

    @ManyToOne(() => Table, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table;
}
