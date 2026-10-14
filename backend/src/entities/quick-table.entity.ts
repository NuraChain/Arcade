import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Table } from './table.entity.ts';

@Entity('quick_tables')
export class QuickTable
{
    @PrimaryColumn({ name: 'table_id', type: 'uuid' })
    tableId!: string;

    @ManyToOne(() => Table, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'table_id', referencedColumnName: 'id' })
    table!: Table;
}
