import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The one-shot challenge a recovery signature is made over.
 *
 * Shaped like `siwe_nonces` and burned the same way, with one addition: it names the DEVICE it may
 * confirm. A signature collected while confirming one browser must not confirm another, which is
 * the rule the enrolment message enforces through EIP-4361's `Resources` line.
 */
@Entity('recovery_nonces')
export class RecoveryNonce
{
    @PrimaryColumn({ type: 'varchar', length: 64 })
    nonce!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'device_id', type: 'varchar', length: 22 })
    deviceId!: string;

    @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
    issuedAt!: Date;

    @Column({ name: 'expires_at', type: 'timestamptz' })
    expiresAt!: Date;

    @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
    consumedAt!: Date | null;
}
