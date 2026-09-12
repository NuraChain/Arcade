import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';

import { Game } from './game.entity.ts';

/** How a game decides who goes first and what is random. */
/** Whether anything is wagered. `play-money` is chips with no value; there is no real money. */
export type Stakes = 'none' | 'play-money';

/**
 * What a table of this game may be configured as.
 *
 * These are the ONLY legal values, and the server is the one that says so. The client renders
 * pickers from this row and then the server validates a create against the same row — the
 * browser's copy is a convenience, never the authority. `isValidTable()` in
 * `application/src/data/tables.ts` moves here in PR 9.
 *
 * Every list is a Postgres array rather than a join table: they are short, fixed, read whole,
 * and never queried across. A `game_seat_options` table would be four rows of ceremony.
 */
@Entity('game_rules')
export class GameRule
{
    @PrimaryColumn({ name: 'game_id', type: 'varchar', length: 32 })
    gameId!: string;

    @OneToOne(() => Game, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'game_id' })
    game!: Game;

    /** Legal seat counts, ascending. Hokm is exactly [4]; poker is [2, 4, 6, 8]. */
    @Column({ type: 'smallint', array: true })
    seats!: number[];

    /** 'live' | 'turns'. Poker is live-only: a turn-based poker table is a different product. */
    @Column({ type: 'varchar', length: 16, array: true })
    modes!: string[];

    /**
     * Legal score targets. EMPTY means the game does not have one — poker ends when people
     * leave, ludo when someone gets home. An empty array is meaningful here, not a missing value,
     * which is why it is `not null` with a `'{}'` default rather than nullable.
     */
    @Column({ type: 'smallint', array: true })
    targets!: number[];

    @Column({ type: 'varchar', length: 16 })

    @Column({ type: 'varchar', length: 16 })
    stakes!: Stakes;

    /** Whether seats pair into teams. Hokm is the only one, and it is why seat order matters. */
    @Column({ type: 'boolean' })
    partners!: boolean;

    /** Whether the doubling cube is offered. Backgammon only. */
    @Column({ name: 'has_cube', type: 'boolean', default: false })
    hasCube!: boolean;

    /** Whether blind levels are offered. Poker only. */
    @Column({ name: 'has_blinds', type: 'boolean', default: false })
    hasBlinds!: boolean;
}
