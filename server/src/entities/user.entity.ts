import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * How an account proved it exists.
 *
 * `wallet` signed a challenge with a key it holds; `guest` is a name typed into a box and proves
 * nothing, which is exactly why the distinction is a column rather than a guess: anything that
 * must not be spoofable - a device attestation, a moderation action - checks this. There was a
 * third, `demo`, and `0011-drop-demo.ts` rewrote the CHECK rather than leaving the value legal
 * with nothing writing it.
 */
export type AccountKind = 'wallet' | 'guest';

@Check('users_handle_shape', `handle ~ '^[[:alnum:]][[:alnum:]._-]{0,30}[[:alnum:]]$'`)
@Check('users_hue_range', `hue between 0 and 359`)
@Check('users_kind_known', `kind in ('wallet', 'guest')`)
@Check('users_minor_no_strangers', `not (is_minor and allow_stranger_messages)`)
@Entity('users')
export class User
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /**
     * The @handle. Unique, case-insensitively.
     *
     * The uniqueness lives in a `citext` column with a unique index, not in application code:
     * two people claiming the same handle in the same millisecond is a race a `select` then
     * `insert` cannot win, and the only thing that can arbitrate it is the database.
     */
    @Column({ type: 'citext', unique: true })
    handle!: string;

    @Column({ name: 'display_name', type: 'text' })
    displayName!: string;

    @Column({ type: 'text', default: '' })
    bio!: string;

    /** The avatar hue, 0-359. Derived once at creation so a face does not change colour later. */
    @Column({ type: 'smallint' })
    hue!: number;

    @Column({ type: 'varchar', length: 16 })
    kind!: AccountKind;

    /**
     * Teen safety. Enforced by the SERVER - it gates stranger DMs, invites and discovery - and
     * not by the badge the profile renders. A flag that only draws a badge is decoration.
     */
    @Column({ name: 'is_minor', type: 'boolean', default: false })
    isMinor!: boolean;

    @Column({ name: 'is_suspended', type: 'boolean', default: false })
    isSuspended!: boolean;

    /**
     * Whether somebody nobody has befriended may write to this account.
     *
     * `users_minor_no_strangers` is a CHECK over this and `is_minor` together, so a minor who
     * allows stranger messages is not a row this database can hold whoever writes it.
     */
    @Column({ name: 'allow_stranger_messages', type: 'boolean', default: true })
    allowStrangerMessages!: boolean;

    /** Whether presence is published at all. Invisible means invisible to everyone but friends. */
    @Column({ name: 'show_online', type: 'boolean', default: true })
    showOnline!: boolean;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    /**
     * Coarse, and deliberately so: written at most once a minute on activity. Live presence is
     * the WebSocket's business and never touches Postgres - a write per heartbeat per user is
     * how a presence system becomes the database's biggest table.
     */
    @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
    lastSeenAt!: Date | null;
}
