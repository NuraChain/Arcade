import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity.ts';

/**
 * One account's recovery vault: everything the phrase protects, and nothing this server can use.
 *
 * `salt` is public by construction, `public_key` verifies a signature and decrypts nothing, and
 * both `wrapped` and `check_value` are sealed under a phrase that has never been here. Holding this
 * whole table gets an attacker no closer to a message than holding none of it.
 */
@Entity('recovery_vaults')
export class RecoveryVault
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ type: 'text' })
    salt!: string;

    @Column({ name: 'public_key', type: 'text' })
    publicKey!: string;

    /** The archive key under the phrase. The only copy anywhere. */
    @Column({ type: 'text' })
    wrapped!: string;

    /** A fixed sentence under the same key, so a wrong phrase is told apart from a corrupt archive. */
    @Column({ name: 'check_value', type: 'text' })
    checkValue!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @OneToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
