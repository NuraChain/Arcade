import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TableMode = 'live' | 'turns';

export type TablePrivacy = 'private' | 'friends' | 'public';

/**
 * `ready` means every seat is taken and nothing more.
 *
 * It is NOT "playing": there is no game engine, and a status that claimed one would be the first
 * lie in a domain built to stop at the seam. Whatever plays the hand moves it on from here.
 */
export type TableStatus = 'open' | 'ready' | 'closed';

@Check('tables_blinds_known', `blinds in ('low', 'mid', 'high')`)
@Check('tables_closed_has_at', `(status = 'closed') = (closed_at is not null)`)
@Check('tables_mode_known', `mode in ('live', 'turns')`)
@Check('tables_privacy_known', `privacy in ('private', 'friends', 'public')`)
@Check('tables_seats_range', `seats between 2 and 8`)
@Check('tables_status_known', `status in ('open', 'ready', 'closed')`)
@Index('tables_code', ['code'], { unique: true })
@Entity('tables')
export class Table
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /** The short shareable code. `citext`, claimed by INSERT against the unique index. */
    @Column({ type: 'citext' })
    code!: string;

    @Column({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'smallint' })
    seats!: number;

    @Column({ type: 'varchar', length: 16 })
    mode!: TableMode;

    @Column({ type: 'varchar', length: 16 })
    privacy!: TablePrivacy;

    @Column({ type: 'smallint', default: 0 })
    target!: number;

    @Column({ type: 'boolean', default: false })
    cube!: boolean;

    @Column({ type: 'varchar', length: 8, default: 'low' })
    blinds!: string;

    @Column({ type: 'varchar', length: 16, default: 'open' })
    status!: TableStatus;

    @Column({ name: 'host_id', type: 'uuid', nullable: true })
    hostId!: string | null;

    @Column({ name: 'group_id', type: 'uuid', nullable: true })
    groupId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
    closedAt!: Date | null;
}
