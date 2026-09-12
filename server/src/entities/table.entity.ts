import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type TableMode = 'live' | 'turns';

export type TablePrivacy = 'private' | 'friends' | 'public';

/**
 * `ready` means every seat is taken and nothing more.
 *
 * It is NOT "playing": there is no game engine, and a status that claimed one would be the first
 * lie in a domain built to stop at the seam. Whatever plays the hand moves it on from here.
 */
export type TableStatus = 'open' | 'ready' | 'closed';

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
