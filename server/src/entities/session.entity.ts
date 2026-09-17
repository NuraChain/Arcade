import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A signed-in session.
 *
 * The cookie carries an opaque 256-bit random token and NOTHING else - no user id, no expiry, no
 * signature. The row is found by the token's SHA-256, so what is stored here cannot be replayed
 * even by someone holding the whole table, and "sign out everywhere" is one UPDATE rather than a
 * secret rotation that logs out the entire product.
 *
 * That also means there is no HMAC to get wrong. A signed cookie saves a lookup, but revocation
 * needs the lookup anyway, so the saving was never available.
 */
@Check('sessions_token_hash_shape', `token_hash ~ '^[0-9a-f]{64}$'`)
@Index('sessions_device_idx', ['deviceId'], { where: `revoked_at is null` })
@Index('sessions_live_idx', ['tokenHash'], { where: `revoked_at is null` })
@Index('sessions_user_id_idx', ['userId'])
@Entity('sessions')
@Index(['userId'])
export class Session
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    /** SHA-256 of the bearer token, hex. The token itself is never stored, here or in a log. */
    @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
    tokenHash!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'expires_at', type: 'timestamptz' })
    expiresAt!: Date;

    /** Set by sign-out. A revoked row is kept so a stolen token's use can still be seen. */
    @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
    revokedAt!: Date | null;

    /** Refreshed on use, at most once an hour, so an idle session can be expired on a schedule. */
    @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
    lastUsedAt!: Date | null;

    /**
     * The device this session is signed in on, once it has enrolled.
     *
     * This is what makes revoking a device real: revocation ends every session that names it, so
     * the browser is signed out rather than merely losing its badge. Null for a session that has
     * not enrolled one yet.
     */
    @Column({ name: 'device_id', type: 'varchar', length: 22, nullable: true })
    deviceId!: string | null;

    /** For the devices list: "Chrome on Windows, last used an hour ago". Truncated, never parsed. */
    @Column({ name: 'user_agent', type: 'varchar', length: 256, default: '' })
    userAgent!: string;
}
