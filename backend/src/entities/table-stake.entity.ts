import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Table } from './table.entity.ts';

@Check('table_stakes_amount_positive', `amount > 0`)
@Entity('table_stakes')
export class TableStake
{
    @PrimaryColumn({ name: 'table_id', type: 'uuid' })
    tableId!: string;

    @Column({ type: 'numeric', precision: 40, scale: 0 })
    amount!: string;

    @ManyToOne(() => Table, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table;
}
