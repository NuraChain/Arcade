import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Conversation } from './conversation.entity.ts';
import { Game } from './game.entity.ts';
import { User } from './user.entity.ts';

export type TableMode = 'live' | 'turns';

/**
 * Who may sit down, and every level is read by a query.
 *
 * It was `private | friends | public` and only one of those was true. `open()` filters on `public`
 * strictly, so a `friends` table was invisible to friends too; and `byId` had no privacy check at
 * all, so `private` - offered to a person as "Only people you invite can sit down" - was joinable
 * by anybody holding the link. Two settings that lied to whoever picked them, one of them while
 * promising the opposite of what it did.
 *
 * `room` is the new one and it is what a table opened from a chat or a group is: the conversation
 * it came from IS the guest list, so there is no second membership to keep in step with the first.
 */
export type TablePrivacy = 'invite' | 'room' | 'friends' | 'public';

/**
 * What is STORED, which is two things and not the four a reader is shown.
 *
 * `ready` and `playing` are derived where they are read - from how many chairs are full and from
 * whether a match is still running - because a stored copy of a derivable fact goes stale the first
 * time it moves down a path that forgot to update it, and playing has three such paths already. So
 * the column holds the one thing nothing can derive: whether somebody closed the table.
 */
export type TableStatus = 'open' | 'closed';

@Check('tables_blinds_known', `blinds in ('low', 'mid', 'high')`)
@Check('tables_closed_has_at', `(status = 'closed') = (closed_at is not null)`)
@Check('tables_mode_known', `mode in ('live', 'turns')`)
@Check('tables_privacy_known', `privacy in ('invite', 'room', 'friends', 'public')`)
@Check('tables_room_is_private', `(privacy = 'room') = (room_id is not null)`)
@Check('tables_seats_range', `seats between 2 and 8`)
@Check('tables_status_known', `status in ('open', 'closed')`)
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

    /**
     * The conversation this table was opened IN, and whose members may sit at it.
     *
     * Not the same conversation as the one a table OWNS: every table has a `kind: 'game'` thread of
     * its own, and this is the different one it came from - the direct thread or the group room
     * where somebody said "let's play". Pointing at the conversation rather than at the group is
     * what makes one column serve both: a group's membership already moves in lockstep with its
     * thread's, so "members of the room" is the answer in both cases and there is no second guest
     * list to keep in step with the first.
     *
     * It replaces a `group_id` that no query ever read.
     */
    @Column({ name: 'room_id', type: 'uuid', nullable: true })
    roomId!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
    closedAt!: Date | null;

    @ManyToOne(() => Game)
    @JoinColumn({ name: 'game', referencedColumnName: 'id' })
    gameRef!: Game;

    /**
     * `CASCADE`, which is the opposite of what the neighbouring relations do and is deliberate.
     *
     * `SET NULL` would leave a `privacy = 'room'` row with no room, which `tables_room_is_private`
     * forbids - the same pair of rules that cannot both hold as wedged the expiry sweep through
     * `reports_disclosure_whole` for a whole deployment. So the room going away takes its tables
     * with it, which is also the honest reading: a table nobody can enumerate the guest list of is
     * a table nobody can join.
     */
    @ManyToOne(() => Conversation, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'room_id', referencedColumnName: 'id' })
    room!: Conversation | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'host_id', referencedColumnName: 'id' })
    host!: User | null;
}
