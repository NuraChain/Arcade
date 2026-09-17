import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** Which authority vouched for a device. `server` means nobody did. */
export type Attestation = 'wallet' | 'contract' | 'server';

/**
 * A browser or app that holds keys for one account.
 *
 * The primary key is NOT generated. It is `base64url(SHA-256(exchangeSpki || signingSpki))`
 * truncated to 22 characters, computed by the client and recomputed by the server before the row
 * is written - so an id can only be claimed by whoever holds those exact public keys. See
 * `domains/device/id.ts`.
 *
 * Only public halves are stored. There is no column here a private key could land in by accident,
 * which is the point: the server is not a party to the sealing, and the schema says so.
 */
@Check('devices_attestation_matches_kind', `(attested = 'server' and attested_address is null) or (attested in ('wallet', 'contract') and attested_address is not null)`)
@Check('devices_attestation_whole', `(attested_address is null and attested_message is null and attested_signature is null) or (attested_address is not null and attested_message is not null and attested_signature is not null)`)
@Check('devices_attested_address_shape', `attested_address is null or attested_address ~ '^0x[0-9a-f]{40}$'`)
@Check('devices_attested_known', `attested in ('wallet', 'contract', 'server')`)
@Check('devices_id_shape', `id ~ '^[A-Za-z0-9_-]{22}$'`)
@Index('devices_user_live', ['userId', 'createdAt'], { where: `revoked_at is null` })
@Entity('devices')
export class Device
{
    @PrimaryColumn({ type: 'varchar', length: 22 })
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    /** What the owner calls it. Theirs to write, never parsed. */
    @Column({ type: 'varchar', length: 64, default: '' })
    label!: string;

    @Column({ name: 'exchange_key', type: 'text' })
    exchangeKey!: string;

    @Column({ name: 'signing_key', type: 'text' })
    signingKey!: string;

    @Column({ type: 'varchar', length: 8 })
    attested!: Attestation;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    /** Null until one of the account's other devices vouches for it. */
    @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
    confirmedAt!: Date | null;

    @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
    lastSeenAt!: Date | null;

    /** Set once and never cleared: a revoked id can never be enrolled again. */
    @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
    revokedAt!: Date | null;

    /**
     * The proof, kept so somebody other than this server can check it.
     *
     * All three together or none: the address that signed the enrolment, the exact bytes it
     * signed, and the signature. A peer recovers the address itself and checks that the message
     * names this device, which is what stops a device this server fabricated from being wrapped
     * into a conversation. Null for `attested: 'server'`, where there is nothing to show.
     */
    @Column({ name: 'attested_address', type: 'citext', nullable: true })
    attestedAddress!: string | null;

    @Column({ name: 'attested_message', type: 'text', nullable: true })
    attestedMessage!: string | null;

    @Column({ name: 'attested_signature', type: 'text', nullable: true })
    attestedSignature!: string | null;

    @Column({ name: 'user_agent', type: 'varchar', length: 256, default: '' })
    userAgent!: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
