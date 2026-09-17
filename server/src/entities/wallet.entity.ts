import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

/** How the address proved it was the signer. */
export type Attestation = 'wallet' | 'contract';

/**
 * A wallet bound to an account.
 *
 * A TABLE rather than a `users.wallet_address` column, because the first version of that column
 * is the last one that is easy: a person with a hardware wallet and a hot wallet is ordinary, and
 * retrofitting the second one means migrating every row and every query that assumed there was
 * one. One-to-many costs nothing today and is the difference between a feature and a rewrite.
 *
 * The address is stored LOWERCASE and the column is citext, so `0xAbC…` and `0xabc…` are the same
 * wallet no matter which casing a provider hands back. Checksum casing is a display concern.
 */
@Check('wallets_address_shape', `address ~ '^0x[0-9a-f]{40}$'`)
@Check('wallets_attestation_known', `attestation in ('wallet', 'contract')`)
@Index('wallets_user_id_idx', ['userId'])
@Entity('wallets')
export class Wallet
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    /** Unique across the whole table: one address is one account, never two. */
    @Column({ type: 'citext', unique: true })
    address!: string;

    /**
     * The chain the signature was made against, decimal EIP-155. Empty when the deployment has
     * no chain configured, which `chainIsConfigured()` in data/chain.ts reports as false.
     */
    @Column({ name: 'chain_id', type: 'varchar', length: 32, default: '' })
    chainId!: string;

    /**
     * EIP-6963 rdns of the provider that signed, when it announced one - 'io.metamask',
     * 'net.nurachain.wallet'. Diagnostic only: it is self-reported and must never gate anything.
     */
    @Column({ name: 'provider_rdns', type: 'varchar', length: 128, default: '' })
    providerRdns!: string;

    /**
     * `wallet` = an EOA, verified by recovering the key from the signature.
     * `contract` = a smart-contract wallet, verified by asking it through ERC-1271.
     *
     * There is no third value. A wallet that cannot be verified is not written.
     */
    @Column({ type: 'varchar', length: 16 })
    attestation!: Attestation;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
    lastUsedAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
