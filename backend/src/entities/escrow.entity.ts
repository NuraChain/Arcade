import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Match } from './match.entity.ts';
import { Table } from './table.entity.ts';

export type EscrowState = 'locking' | 'open' | 'settling' | 'settled' | 'refunding' | 'refunded' | 'reclaimed' | 'failed';

@Check('escrows_state_known', `state in ('locking', 'open', 'settling', 'settled', 'refunding', 'refunded', 'reclaimed', 'failed')`)
@Check('escrows_amount_positive', `amount > 0`)
@Check('escrows_fee_range', `fee_bps between 0 and 1000`)
@Check('escrows_winners_when_paid', `(state in ('settling', 'settled')) = (winners is not null)`)
@Check('escrows_winners_positive', `winners is null or winners > 0`)
@Check('escrows_open_tx_shape', `open_tx is null or open_tx ~ '^0x[0-9a-f]{64}$'`)
@Check('escrows_close_tx_shape', `close_tx is null or close_tx ~ '^0x[0-9a-f]{64}$'`)
@Index('escrows_one_live', ['tableId'], { unique: true, where: `state in ('locking', 'open', 'settling', 'refunding')` })
@Index('escrows_match', ['matchId'], { unique: true, where: 'match_id is not null' })
@Index('escrows_pending', ['state', 'updatedAt'])
@Entity('escrows')
export class Escrow
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'table_id', type: 'uuid' })
    tableId!: string;

    @Column({ name: 'match_id', type: 'uuid', nullable: true })
    matchId!: string | null;

    @Column({ type: 'varchar', length: 32 })
    game!: string;

    @Column({ type: 'numeric', precision: 40, scale: 0 })
    amount!: string;

    @Column({ name: 'fee_bps', type: 'smallint' })
    feeBps!: number;

    @Column({ type: 'varchar', length: 16 })
    state!: EscrowState;

    @Column({ type: 'integer', nullable: true })
    winners!: number | null;

    @Column({ name: 'open_tx', type: 'varchar', length: 66, nullable: true })
    openTx!: string | null;

    @Column({ name: 'close_tx', type: 'varchar', length: 66, nullable: true })
    closeTx!: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    error!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
    updatedAt!: Date;

    @ManyToOne(() => Table, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table;

    @ManyToOne(() => Match, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'match_id', referencedColumnName: 'id' })
    match!: Match | null;
}
