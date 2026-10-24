import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Table } from './table.entity.ts';
import { User } from './user.entity.ts';

@Check('stake_consents_nonce_shape', `nonce ~ '^0x[0-9a-f]{64}$'`)
@Check('stake_consents_commitment_shape', `commitment ~ '^0x[0-9a-f]{64}$'`)
@Check('stake_consents_secret_shape', `secret ~ '^0x[0-9a-f]{64}$'`)
@Check('stake_consents_address_shape', `address ~ '^0x[0-9a-f]{40}$'`)
@Check('stake_consents_amount_positive', `amount > 0`)
@Check('stake_consents_fee_range', `fee_bps between 100 and 1500`)
@Index('stake_consents_one_per_seat', ['tableId', 'userId'], { unique: true, where: 'table_id is not null' })
@Index('stake_consents_user', ['userId'])
@Entity('stake_consents')
export class StakeConsent
{
    @PrimaryColumn({ type: 'varchar', length: 66 })
    nonce!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @Column({ name: 'table_id', type: 'uuid', nullable: true })
    tableId!: string | null;

    @Column({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'numeric', precision: 40, scale: 0 })
    amount!: string;

    @Column({ name: 'fee_bps', type: 'smallint' })
    feeBps!: number;

    @Column({ type: 'varchar', length: 42 })
    address!: string;

    @Column({ type: 'varchar', length: 66 })
    commitment!: string;

    @Column({ type: 'varchar', length: 66 })
    secret!: string;

    @Column({ type: 'timestamptz' })
    deadline!: Date;

    @Column({ type: 'text', nullable: true })
    signature!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;

    @ManyToOne(() => Table, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table | null;
}
