import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

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
@Entity('devices')
@Index(['userId'])
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

    @Column({ name: 'user_agent', type: 'varchar', length: 256, default: '' })
    userAgent!: string;
}
