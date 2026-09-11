import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * How an account proved it exists.
 *
 * `wallet` signed a challenge with a key it holds. `demo` is one of the seeded identities the
 * product offers for exploring, and `guest` is a name typed into a box. The last two prove
 * nothing, which is exactly why the distinction is a column rather than a guess: anything that
 * must not be spoofable - a device attestation, a moderation action - checks this.
 */
export type AccountKind = 'wallet' | 'demo' | 'guest';

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
