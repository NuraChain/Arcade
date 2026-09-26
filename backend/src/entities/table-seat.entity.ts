import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Table } from './table.entity.ts';
import { User } from './user.entity.ts';

/**
 * One chair at one table.
 *
 * The row exists from the moment the table does, empty. That is what makes claiming a seat a
 * single UPDATE the database arbitrates rather than a read followed by an insert - and
 * `table_seats_one_per_person`, a partial unique index over `(table_id, user_id)`, is what stops
 * one person holding two of them however many requests they send.
 */
@Check('table_seats_empty_is_not_ready', `user_id is not null or ready = false`)
@Check('table_seats_occupied_has_joined', `(user_id is null) = (joined_at is null)`)
@Index('table_seats_one_per_person', ['tableId', 'userId'], { unique: true, where: `user_id is not null` })
@Index('table_seats_user', ['userId'], { where: `user_id is not null` })
@Entity('table_seats')
export class TableSeat
{
    @PrimaryColumn({ name: 'table_id', type: 'uuid' })
    tableId!: string;

    @PrimaryColumn({ type: 'smallint' })
    seat!: number;

    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId!: string | null;

    /** Held for one person. A stranger's claim skips this seat rather than taking it. */
    @Column({ name: 'invited_id', type: 'uuid', nullable: true })
    invitedId!: string | null;

    @Column({ type: 'boolean', default: false })
    ready!: boolean;

    @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
    joinedAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'invited_id', referencedColumnName: 'id' })
    invited!: User | null;

    @ManyToOne(() => Table, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table;

    @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User | null;
}
