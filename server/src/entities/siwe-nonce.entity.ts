import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A single-use challenge for a wallet signature.
 *
 * Three properties, and the flow is worthless without all three:
 *
 *  - UNPREDICTABLE. 128 bits from `crypto.randomBytes`. The version this replaces derived the
 *    nonce from `hashSeed(seed, address, floor(now / 1000))` with the seed defaulting to 1 in
 *    production - anyone could compute the nonce for any address for any second.
 *  - SHORT-LIVED. Five minutes, so a signature captured from a screen or a log is worthless soon.
 *  - CONSUMED EXACTLY ONCE. `consumed_at` is set by a conditional UPDATE that only matches an
 *    unconsumed row, so two requests replaying the same signature race in the database and
 *    exactly one wins. Deleting the row instead would make a replay look like an expiry.
 */
@Entity('siwe_nonces')
@Index(['expiresAt'])
export class SiweNonce
{
    @PrimaryColumn({ type: 'varchar', length: 64 })
    nonce!: string;

    /** Lowercase. The signature must come from THIS address; a nonce is not transferable. */
    @Column({ type: 'citext' })
    address!: string;

    /**
     * The exact bytes the wallet is asked to sign, built by the SERVER.
     *
     * Stored rather than rebuilt at verification time, because rebuilding means agreeing about
     * every field again - domain, uri, chain id, the timestamp's formatting - and a mismatch
     * there fails as "bad signature", which sends the next person hunting through crypto code
     * for a bug in a string.
     */
    @Column({ type: 'text' })
    message!: string;

    @Column({ name: 'issued_at', type: 'timestamptz' })
    issuedAt!: Date;

    @Column({ name: 'expires_at', type: 'timestamptz' })
    expiresAt!: Date;

    @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
    consumedAt!: Date | null;
}
